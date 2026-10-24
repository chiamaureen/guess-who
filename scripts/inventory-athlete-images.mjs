import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { publicMetadata, commonsQuery, plainText } from './lib/commons-images.mjs'
import { identifyLicense } from './lib/question-license.mjs'

export async function inventoryAthleteImages(snapshot, scope, request = publicMetadata) {
  if (snapshot.entries.length !== 124 || new Set(snapshot.entries.map(entry => entry.id)).size !== 124) throw new Error('EXPECTED_124_UNIQUE_CANDIDATES')
  const entries = snapshot.entries.map(entry => ({ id: entry.id, name: entry.name, group: entry.group, wikidataId: entry.wikidataId, category: 'athletes', existingSource: entry.sourcePage, existingImageUrl: entry.imageUrl, status: entry.imageUrl ? 'PENDING' : 'MISSING_IMAGE', approved: false, attempts: [], alternatives: [], identityWarning: entry.identityWarning }))
  let throttled = false
  for (const entry of entries) {
    if (entry.existingImageUrl) { entry.attempts.push({ stage: 'commons', status: 'EXISTING_CANDIDATE_RECHECK_REQUIRED', source: entry.existingSource }); continue }
    if (throttled) { entry.attempts.push({ stage: 'commons', status: 'BLOCKED_PROVIDER_RATE_LIMIT' }); continue }
    try {
      const result = await request(commonsQuery({ generator: 'search', gsrsearch: `"${entry.name}" filetype:bitmap`, gsrnamespace: '6', gsrlimit: '3', prop: 'imageinfo', iiprop: 'url|extmetadata|sha1|timestamp' }))
      const pages = result.query?.pages ?? []
      entry.attempts.push({ stage: 'commons', status: pages.length ? 'SEARCH_COMPLETED' : 'NO_RESULTS' })
      for (const page of pages) {
        const info = page.imageinfo?.[0]
        const filename = page.title.replace(/^File:/, '')
        const metadata = info?.extmetadata ?? {}
        const license = plainText(metadata.LicenseShortName?.value)
        const rejected = scope.imageExclusions?.[filename] || (/\.(pdf|djvu|svg|webm|ogg)$/i.test(filename) ? 'NOT_A_RASTER_PORTRAIT' : '')
        if (!info?.url) continue
        entry.alternatives.push({ method: 'commons', source: info.descriptionurl, imageUrl: info.url, filename, sourceSha1: info.sha1, author: plainText(metadata.Artist?.value), license, licenseTermsUrl: metadata.LicenseUrl?.value ?? '', status: rejected ? 'REJECTED' : 'PENDING_IDENTITY_AND_RIGHTS', reason: rejected, compatibleLicenseMetadata: Boolean(identifyLicense(license, metadata.LicenseUrl?.value)) })
      }
    } catch (error) {
      entry.attempts.push({ stage: 'commons', status: 'BLOCKED', reason: /^METADATA_HTTP_\d+$/.test(error.message) ? error.message : 'NETWORK_OR_METADATA_ERROR' })
      if (error.message === 'METADATA_HTTP_429') throttled = true
    }
    if (request === publicMetadata) await delay(1000)
  }
  for (const language of ['en', 'zh']) {
    const pending = entries.filter(entry => !entry.existingImageUrl && scope.groups.find(group => group.id === entry.group)?.language === language)
    for (let offset = 0; offset < pending.length; offset += 40) {
      const batch = pending.slice(offset, offset + 40)
      const url = new URL(`https://${language}.wikipedia.org/w/api.php`)
      url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: batch.map(entry => entry.name).join('|'), redirects: '1', converttitles: '1', prop: 'pageimages|pageprops', piprop: 'name' })
      try {
        const result = await request(url)
        const query = result.query ?? {}
        const redirects = new Map([...(query.normalized ?? []), ...(query.converted ?? []), ...(query.redirects ?? [])].map(item => [item.from, item.to]))
        for (const entry of batch) {
          let title = entry.name
          const visited = new Set()
          while (redirects.has(title) && !visited.has(title)) { visited.add(title); title = redirects.get(title) }
          const page = query.pages?.find(page => page.title === title)
          const validIdentity = page?.pageprops?.wikibase_item && (!entry.wikidataId || page.pageprops.wikibase_item === entry.wikidataId) && !Object.hasOwn(page.pageprops ?? {}, 'disambiguation')
          entry.attempts.push({ stage: 'wikipedia', status: validIdentity && page.pageimage ? 'FILE_REQUIRES_COMMONS_LICENSE_CHECK' : 'NO_CONFIRMED_FREE_PHOTO', filename: validIdentity ? page.pageimage ?? null : null })
        }
      } catch { for (const entry of batch) entry.attempts.push({ stage: 'wikipedia', status: 'BLOCKED_NETWORK_OR_API' }) }
    }
  }
  for (const entry of entries.filter(entry => !entry.existingImageUrl)) {
    entry.attempts.push({ stage: 'google', status: 'NOT_VERIFIED_PROVIDER_PREVIOUSLY_CAPTCHA_BLOCKED', searchUrl: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(entry.name)}` })
    entry.status = entry.alternatives.some(image => image.status !== 'REJECTED' && image.compatibleLicenseMetadata) ? 'PENDING' : 'MISSING_IMAGE'
  }
  return { checkedAt: new Date().toISOString(), total: 124, approved: 0, cloudWrites: 0, entries }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || !/^[a-z0-9-]+$/.test(process.argv[2])) throw new Error('New inventory directory required')
  const directory = resolve('data/question-bank/prepared', process.argv[2])
  await mkdir(directory, { mode: 0o700 })
  const snapshot = JSON.parse(await readFile('data/question-bank/prepared/athletes-local-review/phase8-athletes-reviewed.json', 'utf8'))
  const scope = JSON.parse(await readFile('data/question-bank/athletes-v2-scope.json', 'utf8'))
  const result = await inventoryAthleteImages(snapshot, scope)
  await writeFile(join(directory, 'source-inventory.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ total: result.total, approved: 0, commonsSearches: result.entries.filter(entry => entry.attempts.some(attempt => attempt.stage === 'commons' && attempt.status === 'SEARCH_COMPLETED')).length, missingOrUnconfirmed: result.entries.filter(entry => entry.status === 'MISSING_IMAGE').length, cloudWrites: 0 }))
}
