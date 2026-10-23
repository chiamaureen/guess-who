import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ids = ['Q76','Q6279','Q22686','Q207','Q1124','Q23505','Q9960','Q35648','Q9582','Q9588','Q9640','Q9696','Q9916','Q11613','Q12325']
const userAgent = 'GuessWhoQuestionReview/1.0 (https://github.com/chiamaureen/guess-who; local rights review, no automatic approval)'
async function json(url) {
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`METADATA_HTTP_${response.status}`)
  const body = await response.text()
  if (body.length > 8 * 1024 * 1024) throw new Error('METADATA_TOO_LARGE')
  const parsed = JSON.parse(body)
  if (parsed.error) throw new Error('METADATA_API_ERROR')
  return parsed
}

export async function prepareQuestionBank() {
  const wikidata = new URL('https://www.wikidata.org/w/api.php')
  wikidata.search = new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|claims', languages: 'zh-tw|zh|en', format: 'json' })
  const entities = (await json(wikidata)).entities
  const rows = ids.map(id => {
    const entity = entities[id]
    const filename = entity?.claims?.P18?.find(claim => claim.rank !== 'deprecated' && typeof claim.mainsnak?.datavalue?.value === 'string')?.mainsnak.datavalue.value
    if (!filename || entity.missing !== undefined) throw new Error('MISSING_SUBJECT_OR_IMAGE')
    return { wikidataId: id, wikidataRevision: entity.lastrevid, nameZh: entity.labels?.['zh-tw']?.value ?? entity.labels?.zh?.value ?? entity.labels?.en?.value, nameEn: entity.labels?.en?.value, filename }
  })
  const commons = new URL('https://commons.wikimedia.org/w/api.php')
  commons.search = new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|sha1|timestamp', titles: rows.map(row => `File:${row.filename}`).join('|'), format: 'json', formatversion: '2' })
  const pages = (await json(commons)).query.pages
  return { preparedAt: new Date().toISOString(), approvedCount: 0, entries: rows.map(row => {
    const info = pages.find(page => page.title === `File:${row.filename}`)?.imageinfo?.[0]
    if (!info?.descriptionurl || !info?.url) throw new Error('MISSING_COMMONS_PROVENANCE')
    const metadata = info.extmetadata ?? {}
    return {
      ...row, categoryIds: ['10000000-0000-4000-8000-000000000004'], source: info.descriptionurl, imageUrl: info.url,
      sourceSha1: info.sha1, sourceTimestamp: info.timestamp,
      authorHtml: metadata.Artist?.value ?? '', license: metadata.LicenseShortName?.value ?? '', licenseUrl: metadata.LicenseUrl?.value ?? '',
      creditHtml: metadata.Credit?.value ?? '', restrictions: metadata.Restrictions?.value ?? '',
      approved: false, review: { rights: false, image: false, subject: false, reviewedBy: '', reviewedAt: null },
      author: '', attribution: '', imagePath: null, imageSha256: null,
    }
  }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const bank = await prepareQuestionBank()
    const directory = resolve('data/question-bank/prepared')
    const filename = process.argv[2] ?? 'candidates.json'
    if (process.argv.length > 3 || !/^[a-z0-9-]+\.json$/.test(filename)) throw new Error('INVALID_FILENAME')
    await mkdir(directory, { recursive: true })
    await writeFile(resolve(directory, filename), JSON.stringify(bank, null, 2), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ result: 'PASS', candidates: bank.entries.length, approved: 0, output: `data/question-bank/prepared/${filename}`, cloudWrites: 0 }))
  } catch (error) {
    console.error(JSON.stringify({ result: 'BLOCKED', reason: error.code === 'EEXIST' ? 'Existing review manifest preserved; move it manually before preparing again.' : 'Public metadata could not be retrieved or validated; no candidates approved.', cloudWrites: 0 }))
    process.exitCode = 2
  }
}
