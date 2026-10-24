import { readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { publicMetadata, commonsQuery, plainText } from './lib/commons-images.mjs'
import { identifyLicense } from './lib/question-license.mjs'

if (![4, 5].includes(process.argv.length) || process.argv[4] && !/^[a-z0-9-]+$/.test(process.argv[4])) throw new Error('Inventory, WebP receipt paths and optional new output basename required')
const path = resolve(process.argv[2])
const inventory = JSON.parse(await readFile(path, 'utf8'))
const converted = JSON.parse(await readFile(process.argv[3], 'utf8'))
const evidence = new Map(JSON.parse(await readFile(join(dirname(resolve(process.argv[3])), 'source-evidence.json'), 'utf8')))
const basename = process.argv[4] ?? 'source-inventory-completed'
const output = join(dirname(path), `${basename}.json`)
const scope = JSON.parse(await readFile('data/question-bank/athletes-v2-scope.json', 'utf8'))
const observations = JSON.parse(await readFile('data/question-bank/athletes-image-observations.json', 'utf8'))
for (const entry of inventory.entries) {
  const finding = observations.observations.find(finding => finding.name === entry.name && (!finding.source || finding.source === entry.existingSource))
  if (finding) { entry.imageReviewFinding = finding; entry.imageRejected = finding.decision === 'REJECTED' }
  if (entry.imageRejected) {
    try {
      const query = await publicMetadata(commonsQuery({ generator: 'search', gsrsearch: `"${entry.name}" filetype:bitmap`, gsrnamespace: '6', gsrlimit: '3', prop: 'imageinfo', iiprop: 'url|extmetadata' }))
      entry.attempts.push({ stage: 'commons-replacement', status: query.query?.pages?.length ? 'ONLY_UNCONFIRMED_RESULTS' : 'NO_RESULTS' })
    } catch { entry.attempts.push({ stage: 'commons-replacement', status: 'BLOCKED' }) }
  }
}
for (const language of ['en', 'zh']) {
  const entries = inventory.entries.filter(entry => (!entry.existingImageUrl || entry.imageRejected) && scope.groups.find(group => group.id === entry.group)?.language === language)
  for (let offset = 0; offset < entries.length; offset += 40) {
    const batch = entries.slice(offset, offset + 40)
    const url = new URL(`https://${language}.wikipedia.org/w/api.php`)
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: batch.map(entry => entry.name).join('|'), redirects: '1', converttitles: '1', prop: 'pageimages|pageprops', piprop: 'name' })
    try {
      const query = (await publicMetadata(url)).query ?? {}
      const redirects = new Map([...(query.normalized ?? []), ...(query.converted ?? []), ...(query.redirects ?? [])].map(item => [item.from, item.to]))
      for (const entry of batch) {
        let title = entry.name
        const visited = new Set()
        while (redirects.has(title) && !visited.has(title)) { visited.add(title); title = redirects.get(title) }
        const page = query.pages?.find(page => page.title === title)
        const correct = page?.pageprops?.wikibase_item && (!entry.wikidataId || page.pageprops.wikibase_item === entry.wikidataId) && !Object.hasOwn(page.pageprops ?? {}, 'disambiguation')
        entry.attempts = entry.attempts.filter(attempt => attempt.stage !== 'wikipedia')
        entry.attempts.push({ stage: 'wikipedia', status: correct && page.pageimage ? 'FILE_REQUIRES_COMMONS_LICENSE_CHECK' : 'NO_CONFIRMED_FREE_PHOTO', filename: correct ? page.pageimage ?? null : null, checkedAt: new Date().toISOString() })
      }
    } catch { for (const entry of batch) entry.attempts.push({ stage: 'wikipedia', status: 'BLOCKED_NETWORK_OR_API' }) }
  }
}
for (const entry of inventory.entries) {
  const prepared = converted.entries.find(image => image.wikidataId && image.wikidataId === entry.wikidataId && image.name === entry.name)
  if (prepared) {
    entry.attempts[0] = { stage: 'commons', status: 'ORIGINAL_SHA1_AND_RENDITION_VERIFIED', evidenceUrl: prepared.evidenceUrl, checkedAt: prepared.checkedAt }
    entry.license = prepared.license
    entry.rightsMetadataComplete = prepared.rightsMetadataComplete
  }
  for (const image of entry.alternatives) {
    if (entry.name === '徐磊' && image.filename === '四季花开俏江南152241.jpg'
      || entry.name === '吳思賢' && image.filename.startsWith('Cast of A Controversial Entertainer')
      || entry.name === '陳靜' && /Gemma_Chan|Gemma Chan|Chen_Jingmin|Chen Jingmin/.test(image.filename)
      || entry.name === 'Anthony Edwards' && image.filename === 'AnthonyEdwards.jpg') {
      image.status = 'REJECTED'
      image.reason = '同名搜尋結果不是指定運動員；保留候選證據，不移入正式題庫'
    }
  }
  const attempt = entry.attempts.find(attempt => attempt.stage === 'wikipedia' && attempt.filename)
  if (attempt) {
    if (/\.svg$|flag|logo|icon|銅像/i.test(attempt.filename)) attempt.status = 'REJECTED_NON_PORTRAIT'
    else {
      try {
        const result = await publicMetadata(commonsQuery({ titles: `File:${attempt.filename}`, prop: 'imageinfo', iiprop: 'url|sha1|extmetadata|timestamp' }))
        const info = result.query?.pages?.[0]?.imageinfo?.[0]
        const metadata = info?.extmetadata ?? {}
        attempt.status = info ? 'COMMONS_SOURCE_TRACED_RIGHTS_PENDING' : 'NO_COMMONS_FREE_LICENSE_EVIDENCE'
        if (info) entry.alternatives.push({ method: 'wikipedia', source: info.descriptionurl, imageUrl: info.url, author: plainText(metadata.Artist?.value), license: plainText(metadata.LicenseShortName?.value), licenseTermsUrl: metadata.LicenseUrl?.value ?? '', status: 'PENDING_IDENTITY_AND_RIGHTS', compatibleLicenseMetadata: Boolean(identifyLicense(plainText(metadata.LicenseShortName?.value), metadata.LicenseUrl?.value)) })
      } catch { attempt.status = 'BLOCKED_COMMONS_SOURCE_LOOKUP' }
    }
  }
  entry.status = prepared && !entry.imageRejected || entry.alternatives.some(image => image.status !== 'REJECTED' && image.compatibleLicenseMetadata) ? 'PENDING' : 'MISSING_IMAGE'
}
const fallback = inventory.entries.filter(entry => entry.status === 'MISSING_IMAGE')
if (fallback.length) {
  let result = 'BLOCKED_NETWORK'
  try {
    const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(fallback[0].name)}`
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    const body = await response.text()
    result = response.status === 429 || /captcha|unusual traffic|\/sorry\//i.test(body) ? 'BLOCKED_CAPTCHA_OR_RATE_LIMIT' : response.status === 200 ? 'HTML_RETRIEVED_FIRST_IMAGE_NOT_VERIFIED' : `HTTP_${response.status}`
  } catch {}
  for (const [index, entry] of fallback.entries()) {
    let attempt = entry.attempts.find(attempt => attempt.stage === 'google')
    if (!attempt) { attempt = { stage: 'google', searchUrl: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(entry.name)}` }; entry.attempts.push(attempt) }
    Object.assign(attempt, { status: index === 0 ? result : 'NOT_ATTEMPTED_PROVIDER_UNVERIFIED', checkedAt: new Date().toISOString(), firstResultVerified: false })
  }
}
inventory.summary = {
  total: 124, commonsOriginalsVerified: converted.entries.length,
  rejectedExistingImages: inventory.entries.filter(entry => entry.imageRejected).length,
  newCommonsPendingCandidates: inventory.entries.filter(entry => !entry.existingImageUrl && entry.status === 'PENDING').length,
  wikipediaFreePortraitsVerified: 0, googlePhotosVerified: 0, approved: 0,
  pending: inventory.entries.filter(entry => entry.status === 'PENDING').length,
  missingImage: inventory.entries.filter(entry => entry.status === 'MISSING_IMAGE').length,
  licenseMetadataComplete: converted.entries.filter(entry => entry.rightsMetadataComplete).length,
  licenseMetadataPending: converted.entries.filter(entry => !entry.rightsMetadataComplete).length,
  cloudWrites: 0,
}
if (evidence.size !== converted.entries.length) throw new Error('EVIDENCE_BATCH_MISMATCH')
await writeFile(output, JSON.stringify(inventory, null, 2), { mode: 0o600, flag: 'wx' })
const rows = inventory.entries.map(entry => `| ${entry.name.replaceAll('|', '\\|')} | ${entry.wikidataId || '待確認'} | ${entry.status} | ${entry.existingSource ? `[Commons${entry.imageRejected ? '（已排除）' : ''}](${entry.existingSource})` : entry.alternatives.filter(image => image.status !== 'REJECTED').map(image => `[待審候選](${image.source})`).join('、') || '—'} | ${entry.imageReviewFinding?.reason ?? ''} ${entry.attempts.filter(attempt => attempt.stage !== 'commons' || !entry.existingSource).map(attempt => `${attempt.stage}: ${attempt.status}`).join('；')} |`)
await writeFile(join(dirname(path), `${basename}.md`), `# 124 位圖片盤點（全部未核准）\n\nGoogle 第一筆未確認不代表無圖片；MISSING_IMAGE 表示目前未取得可確認的合法人物照片。\n\n| 人物 | QID | 狀態 | 來源 | 查驗限制 |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`, { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify(inventory.summary))
