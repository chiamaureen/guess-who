import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const userAgent = 'GuessWhoQuestionReview/2.0 (https://github.com/chiamaureen/guess-who; pending candidates only)'
const allowedHosts = new Set(['en.wikipedia.org', 'zh.wikipedia.org', 'www.wikidata.org', 'commons.wikimedia.org'])
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
const fileKey = value => value.replaceAll('_', ' ').normalize('NFC')

export function buildAthleteCandidates(scope) {
  if (scope.version !== 2 || scope.categorySlug !== 'athletes' || scope.categoryId !== '10000000-0000-4000-8000-000000000003') throw new Error('Invalid athletes scope')
  const names = new Set()
  return scope.groups.flatMap(group => group.names.map((name, index) => {
    const key = name.normalize('NFC').trim()
    if (!key || names.has(key)) throw new Error('Ambiguous duplicate name; resolve identity before merging')
    names.add(key)
    return {
      candidateId: `${group.id}-${index + 1}`, name, group: group.id, language: group.language,
      rank: group.id === 'nba-active-instagram-35' ? index + 1 : null,
      categoryIds: [scope.categoryId], categorySlug: scope.categorySlug,
      rosterSource: group.source, qualificationStatus: group.qualificationStatus,
      identityWarning: scope.identityWarnings[name] ?? null,
      identityStatus: 'PENDING', wikidataId: scope.wikidataHints?.[name] ?? null, wikipediaSource: null,
      google: { query: name, firstImageUrl: null, firstSourcePage: null, status: name === scope.googleImages.attemptedQuery ? scope.googleImages.status : 'NOT_ATTEMPTED_PROVIDER_BLOCKED', firstResultVerified: false },
      filename: null, imageUrl: null, source: null, authorHtml: null, author: '', license: null, licenseUrl: null,
      attribution: '', restrictions: null, sourceSha1: null, sourceTimestamp: null,
      imagePath: null, imageSha256: null, imageStatus: 'MISSING_CANDIDATE', approved: false,
      review: { subject: false, rights: false, image: false, reviewedBy: '', reviewedAt: null },
    }
  }))
}

async function metadataJson(url) {
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('Unapproved metadata host')
  const response = await fetch(url, { headers: { 'User-Agent': userAgent }, redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  const body = await response.text()
  if (body.length > 8 * 1024 * 1024) throw new Error('Metadata too large')
  const result = JSON.parse(body)
  if (result.error) throw new Error('Metadata API error')
  return result
}

export async function collectAthleteMetadata(scope, request = metadataJson) {
  const entries = buildAthleteCandidates(scope)
  const failures = []
  for (const language of ['en', 'zh']) {
    const candidates = entries.filter(entry => entry.language === language && !entry.wikidataId && !entry.identityWarning?.startsWith('BLOCKED_'))
    for (const batch of chunks(candidates, 40)) {
      const url = new URL(`https://${language}.wikipedia.org/w/api.php`)
      url.search = new URLSearchParams({ action: 'query', titles: batch.map(entry => entry.name).join('|'), prop: 'pageprops', redirects: '1', converttitles: '1', formatversion: '2', format: 'json' })
      try {
        const result = await request(url)
        const query = result.query ?? {}
        const redirects = new Map([...(query.normalized ?? []), ...(query.converted ?? []), ...(query.redirects ?? [])].map(item => [item.from, item.to]))
        for (const entry of batch) {
          let title = entry.name
          const visited = new Set()
          while (redirects.has(title) && !visited.has(title)) { visited.add(title); title = redirects.get(title) }
          const page = query.pages?.find(item => item.title === title)
          if (!page || page.missing || !/^Q[1-9][0-9]*$/.test(page.pageprops?.wikibase_item) || Object.hasOwn(page.pageprops ?? {}, 'disambiguation')) continue
          entry.wikidataId = page.pageprops.wikibase_item
          entry.wikipediaSource = `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title)}`
          entry.identityStatus = 'PENDING_MATCH_REVIEW'
        }
      } catch { failures.push({ stage: 'wikipedia', language, count: batch.length, status: 'BLOCKED' }) }
    }
  }
  const ids = [...new Set(entries.map(entry => entry.wikidataId).filter(Boolean))]
  for (const batch of chunks(ids, 40)) {
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.search = new URLSearchParams({ action: 'wbgetentities', ids: batch.join('|'), props: 'labels|descriptions|claims', languages: 'zh-tw|zh|en', format: 'json' })
    try {
      const result = await request(url)
      for (const entry of entries.filter(candidate => batch.includes(candidate.wikidataId))) {
        const entity = result.entities?.[entry.wikidataId]
        entry.wikidataRevision = entity?.lastrevid ?? null
        entry.nameZhCandidate = entity?.labels?.['zh-tw']?.value ?? entity?.labels?.zh?.value ?? null
        entry.descriptionCandidate = entity?.descriptions?.['zh-tw']?.value ?? entity?.descriptions?.zh?.value ?? entity?.descriptions?.en?.value ?? null
        entry.dateOfBirthCandidate = entity?.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time ?? null
        entry.filename = entity?.claims?.P18?.find(claim => claim.rank !== 'deprecated' && typeof claim.mainsnak?.datavalue?.value === 'string')?.mainsnak.datavalue.value ?? null
      }
    } catch { failures.push({ stage: 'wikidata', count: batch.length, status: 'BLOCKED' }) }
  }
  const files = [...new Set(entries.map(entry => entry.filename).filter(Boolean))]
  for (const batch of chunks(files, 40)) {
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.search = new URLSearchParams({ action: 'query', prop: 'imageinfo', titles: batch.map(filename => `File:${filename}`).join('|'), iiprop: 'url|extmetadata|sha1|timestamp', formatversion: '2', format: 'json' })
    try {
      const result = await request(url)
      for (const entry of entries.filter(candidate => batch.includes(candidate.filename))) {
        const info = result.query?.pages?.find(page => fileKey(page.title) === fileKey(`File:${entry.filename}`))?.imageinfo?.[0]
        if (!info?.url || !info.descriptionurl) continue
        const metadata = info.extmetadata ?? {}
        Object.assign(entry, {
          source: info.descriptionurl, imageUrl: info.url, sourceSha1: info.sha1 ?? null, sourceTimestamp: info.timestamp ?? null,
          authorHtml: metadata.Artist?.value ?? null, license: metadata.LicenseShortName?.value ?? null,
          licenseUrl: metadata.LicenseUrl?.value ?? null, creditHtml: metadata.Credit?.value ?? null,
          restrictions: metadata.Restrictions?.value ?? '', imageStatus: 'PENDING_SOURCE_AND_VISUAL_REVIEW',
        })
      }
    } catch { failures.push({ stage: 'commons', count: batch.length, status: 'BLOCKED' }) }
  }
  return filterAthleteImageCandidates(await supplementAthleteImages({ version: 2, preparedAt: new Date().toISOString(), scopeDate: scope.snapshotDate, imageStorageMode: scope.imageStorageMode, approvedCount: 0, cloudWrites: 0, failures, entries }, request), scope)
}

export async function supplementAthleteImages(bank, request = metadataJson) {
  for (const entry of bank.entries.filter(candidate => !candidate.imageUrl && !candidate.identityWarning?.startsWith('BLOCKED_'))) {
    const url = new URL('https://commons.wikimedia.org/w/api.php')
    url.search = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `"${entry.name}" filetype:bitmap`, gsrnamespace: '6', gsrlimit: '1', prop: 'imageinfo', iiprop: 'url|extmetadata|sha1|timestamp', formatversion: '2', format: 'json' })
    try {
      const result = await request(url)
      const page = result.query?.pages?.[0]
      const info = page?.imageinfo?.[0]
      entry.commonsSearch = { query: entry.name, status: info ? 'UNVERIFIED_CANDIDATE' : 'NO_EXACT_NAME_RESULT' }
      if (!info?.url || !info.descriptionurl) continue
      const metadata = info.extmetadata ?? {}
      Object.assign(entry, {
        filename: page.title.replace(/^File:/, ''), source: info.descriptionurl, imageUrl: info.url,
        sourceSha1: info.sha1 ?? null, sourceTimestamp: info.timestamp ?? null,
        authorHtml: metadata.Artist?.value ?? null, license: metadata.LicenseShortName?.value ?? null,
        licenseUrl: metadata.LicenseUrl?.value ?? null, creditHtml: metadata.Credit?.value ?? null,
        restrictions: metadata.Restrictions?.value ?? '', imageStatus: 'PENDING_COMMONS_SEARCH_IDENTITY_RIGHTS_AND_VISUAL_REVIEW',
      })
    } catch {
      entry.commonsSearch = { query: entry.name, status: 'BLOCKED' }
      bank.failures.push({ stage: 'commons-search', candidateId: entry.candidateId, status: 'BLOCKED' })
      break
    }
  }
  return bank
}

export function filterAthleteImageCandidates(bank, scope) {
  bank.imageStorageMode = scope.imageStorageMode
  for (const entry of bank.entries) {
    const reason = scope.imageExclusions?.[entry.filename] ?? (/\.(pdf|djvu|svg|webm|ogg)$/i.test(entry.filename ?? '') ? 'NOT_A_RASTER_PORTRAIT' : null)
    if (!reason) continue
    entry.rejectedImageCandidates = [...(entry.rejectedImageCandidates ?? []), {
      filename: entry.filename, source: entry.source, imageUrl: entry.imageUrl, authorHtml: entry.authorHtml,
      license: entry.license, licenseUrl: entry.licenseUrl, reason,
    }]
    for (const key of ['filename', 'source', 'imageUrl', 'authorHtml', 'license', 'licenseUrl', 'sourceSha1', 'sourceTimestamp', 'creditHtml', 'restrictions', 'imagePath', 'imageSha256']) entry[key] = null
    entry.approved = false
    entry.review.rights = false
    entry.review.image = false
    entry.imageStatus = 'REJECTED_SEARCH_RESULT_REPLACEMENT_REQUIRED'
  }
  return bank
}

export function summarizeAthleteReview(bank) {
  const entries = bank.entries
  const ids = entries.map(entry => entry.wikidataId).filter(Boolean)
  const duplicateQids = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  return {
    candidates: entries.length, groups: Object.fromEntries([...new Set(entries.map(entry => entry.group))].map(group => [group, entries.filter(entry => entry.group === group).length])),
    matchedQids: ids.length, duplicateQids, withImageCandidate: entries.filter(entry => entry.imageUrl && entry.source).length,
    missingImageCandidate: entries.filter(entry => !entry.imageUrl || !entry.source).length,
    imageStorageMode: bank.imageStorageMode ?? 'link-only',
    pendingImageReview: entries.filter(entry => entry.review?.rights !== true || entry.review?.image !== true).length,
    importReady: 0,
    licenses: Object.fromEntries([...new Set(entries.map(entry => entry.license ?? 'UNKNOWN'))].map(license => [license, entries.filter(entry => (entry.license ?? 'UNKNOWN') === license).length])),
    excludedImageResults: entries.reduce((total, entry) => total + (entry.rejectedImageCandidates?.length ?? 0), 0),
    failures: bank.failures, cloudWrites: 0,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !/^[a-z0-9-]+$/.test(process.argv[2])) throw new Error('New review directory name required')
    const scope = JSON.parse(await readFile(new URL('../data/question-bank/athletes-v2-scope.json', import.meta.url), 'utf8'))
    const directory = resolve('data/question-bank/prepared', process.argv[2])
    await mkdir(directory, { mode: 0o700 })
    const bank = await collectAthleteMetadata(scope)
    const json = JSON.stringify(bank, null, 2) + '\n'
    await writeFile(resolve(directory, 'candidates.json'), json, { mode: 0o600, flag: 'wx' })
    const summary = { ...summarizeAthleteReview(bank), manifestSha256: createHash('sha256').update(json).digest('hex') }
    await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify(summary))
  } catch {
    console.error('BLOCKED: candidate metadata could not be prepared or output already exists; no approval or Cloud write performed.')
    process.exitCode = 2
  }
}
