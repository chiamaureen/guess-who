import { createHash } from 'node:crypto'
import { publicMetadata, commonsQuery, plainText } from './commons-images.mjs'

export const groupTargets = { 'foreign-actors': 15, 'taiwan-actors': 15, 'english-singers': 30, 'taiwan-singers': 30, athletes: 30, 'taiwan-politicians': 15, 'taiwan-youtubers': 15, 'animated-characters': 30 }
export const groupCategories = { 'foreign-actors': 'actors', 'taiwan-actors': 'actors', 'english-singers': 'singers', 'taiwan-singers': 'singers', athletes: 'athletes', 'taiwan-politicians': 'politicians', 'taiwan-youtubers': 'youtubers', 'animated-characters': 'animated-characters' }
const key = value => value.normalize('NFKC').toLocaleLowerCase('en').replace(/[\s._'’·-]+/g, '')
const fileKey = value => value.replaceAll('_', ' ').normalize('NFC')
export function candidateUuid(identityKey) {
  const digest = createHash('sha256').update(`guess-who:candidate:${identityKey}`).digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
}

export function validateV3Candidates(entries) {
  if (!Array.isArray(entries) || entries.length !== 180) throw new Error('EXPECTED_180_CANDIDATES')
  for (const field of ['id', 'identityKey', 'nameZh', 'nameOriginal']) {
    const values = entries.map(entry => typeof entry[field] === 'string' ? key(entry[field]) : '')
    if (values.some(value => !value) || new Set(values).size !== entries.length) throw new Error(`DUPLICATE_OR_MISSING_${field}`)
  }
  const ids = entries.map(entry => entry.wikidataId).filter(Boolean)
  if (ids.some(id => !/^Q[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('DUPLICATE_OR_INVALID_QID')
  for (const [group, target] of Object.entries(groupTargets)) {
    const members = entries.filter(entry => entry.group === group)
    if (members.length !== target || members.some(entry => entry.category !== groupCategories[group])) throw new Error('GROUP_OR_CATEGORY_MISMATCH')
  }
  if (entries.some(entry => entry.id !== candidateUuid(entry.identityKey) || entry.approved !== false || !Array.isArray(entry.sources) || !entry.sources.length || entry.sources.some(source => !/^https:\/\//.test(source)))) throw new Error('INVALID_ID_APPROVAL_OR_SOURCES')
  if (entries.some(entry => !Object.hasOwn(entry, 'image') || entry.image !== null && (typeof entry.image !== 'object' || Array.isArray(entry.image)))) throw new Error('INCOMPLETE_CANDIDATE_MANIFEST')
  return entries
}

export function buildV3Candidates(scope) {
  if (scope.version !== 3 || scope.targetCount !== 180 || scope.groups.length !== 8) throw new Error('INVALID_V3_SCOPE')
  return validateV3Candidates(scope.groups.flatMap(group => group.subjects.map(([identityKey, nameZh, nameOriginal, title]) => ({
    id: candidateUuid(identityKey), identityKey, nameZh, nameOriginal, wikidataId: null,
    category: group.category, group: group.id, subjectType: group.category === 'animated-characters' ? 'fictional_character' : 'real_person',
    wikipedia: { language: group.language, requestedTitle: title }, sources: [`https://${group.language}.wikipedia.org/wiki/${encodeURIComponent(title)}`],
    identityStatus: 'PENDING', approved: false, image: null, preparedAsset: null,
    imageStatus: group.category === 'animated-characters' ? 'CHARACTER_RIGHTS_CLEARANCE_REQUIRED' : 'MISSING_IMAGE',
    review: { subject: false, rights: false, image: false, presentation: false, reviewedBy: null, reviewedAt: null },
  }))))
}

export async function collectV3Metadata(scope, { athleteEvidence = [], athleteAssets = [], previousBank = null, request = publicMetadata } = {}) {
  const entries = buildV3Candidates(scope)
  const failures = []
  if (previousBank) validateV3Candidates(previousBank.entries)
  for (const entry of entries.filter(entry => entry.group !== 'athletes')) {
    const previous = previousBank?.entries.find(previous => previous.id === entry.id && previous.group === entry.group && previous.nameZh === entry.nameZh && previous.nameOriginal === entry.nameOriginal && previous.wikipedia.requestedTitle === entry.wikipedia.requestedTitle && previous.personEvidence?.revision)
    if (previous) { Object.assign(entry, structuredClone(previous)); entry.metadataReused = true }
  }
  for (const entry of entries.filter(entry => entry.group === 'athletes')) {
    const previous = athleteEvidence.find(person => [entry.nameZh, entry.nameOriginal].includes(person.name))
    const asset = athleteAssets.find(person => [entry.nameZh, entry.nameOriginal].includes(person.name))
    if (!previous?.commons || !previous.person) continue
    entry.wikidataId = previous.wikidataId
    entry.personEvidence = previous.person
    entry.image = { source: previous.source, imageUrl: previous.commons.image.url, author: plainText(previous.commons.image.extmetadata.Artist?.value), license: plainText(previous.commons.image.extmetadata.LicenseShortName?.value), licenseUrl: previous.commons.image.extmetadata.LicenseUrl?.value ?? '', evidenceUrl: previous.commons.evidenceUrl, restrictions: previous.commons.image.extmetadata.Restrictions?.value ?? '', sourceSha1: previous.commons.image.sha1 }
    entry.identityStatus = 'REUSED_PENDING_FINAL_REVIEW'
    entry.imageStatus = 'PENDING_RIGHTS_AND_PRESENTATION'
    entry.sources.push(`https://www.wikidata.org/wiki/${entry.wikidataId}`, previous.source)
    entry.reusedAthleteEvidence = true
    if (asset) entry.preparedAsset = { path: `data/question-bank/prepared/athletes-webp-20261024/${asset.imagePath}`, sha256: asset.imageSha256, mime: asset.mimeType, width: asset.width, height: asset.height, bytes: asset.outputBytes }
  }
  for (const language of ['en', 'zh']) {
    const members = entries.filter(entry => !entry.reusedAthleteEvidence && !entry.metadataReused && entry.wikipedia.language === language)
    for (let offset = 0; offset < members.length; offset += 35) {
      const batch = members.slice(offset, offset + 35)
      const url = new URL(`https://${language}.wikipedia.org/w/api.php`)
      url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: batch.map(entry => entry.wikipedia.requestedTitle).join('|'), redirects: '1', converttitles: '1', prop: 'pageprops|pageimages', piprop: 'name' })
      try {
        const query = (await request(url)).query ?? {}
        const redirects = new Map([...(query.normalized ?? []), ...(query.converted ?? []), ...(query.redirects ?? [])].map(item => [item.from, item.to]))
        for (const entry of batch) {
          let title = entry.wikipedia.requestedTitle
          const seen = new Set()
          while (redirects.has(title) && !seen.has(title)) { seen.add(title); title = redirects.get(title) }
          const page = query.pages?.find(page => page.title === title)
          if (page?.missing || !page?.pageprops?.wikibase_item || Object.hasOwn(page.pageprops, 'disambiguation')) { entry.identityStatus = 'ARTICLE_MISSING_OR_AMBIGUOUS'; continue }
          entry.wikidataId = page.pageprops.wikibase_item
          entry.wikipedia.resolvedTitle = page.title
          entry.wikipedia.pageImageCandidate = page.pageimage ?? null
          entry.filenameCandidate = page.pageimage ?? null
          entry.sources = [`https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, `https://www.wikidata.org/wiki/${entry.wikidataId}`]
          entry.identityStatus = 'PENDING_MATCH_REVIEW'
        }
      } catch { failures.push({ stage: 'wikipedia', language, ids: batch.map(entry => entry.id) }) }
    }
  }
  const members = entries.filter(entry => entry.wikidataId && !entry.reusedAthleteEvidence && !entry.metadataReused)
  for (let offset = 0; offset < members.length; offset += 25) {
    const batch = members.slice(offset, offset + 25)
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.search = new URLSearchParams({ action: 'wbgetentities', ids: batch.map(entry => entry.wikidataId).join('|'), props: 'info|labels|descriptions', languages: 'zh-tw|zh|en', format: 'json' })
    try {
      const entities = (await request(url)).entities ?? {}
      for (const entry of batch) {
        const entity = entities[entry.wikidataId]
        entry.personEvidence = { revision: entity?.lastrevid ?? null, labels: entity?.labels, descriptions: entity?.descriptions, instanceOf: entity?.claims?.P31?.map(claim => claim.mainsnak?.datavalue?.value?.id) ?? [] }
        entry.filenameCandidate = entity?.claims?.P18?.find(claim => claim.rank !== 'deprecated')?.mainsnak?.datavalue?.value ?? entry.wikipedia.pageImageCandidate
      }
    } catch { failures.push({ stage: 'wikidata', ids: batch.map(entry => entry.id) }) }
  }
  const withFiles = entries.filter(entry => entry.filenameCandidate && !entry.metadataReused)
  for (let offset = 0; offset < withFiles.length; offset += 20) {
    const batch = withFiles.slice(offset, offset + 20)
    try {
      const query = (await request(commonsQuery({ prop: 'imageinfo|info', titles: batch.map(entry => `File:${entry.filenameCandidate}`).join('|'), iiprop: 'url|extmetadata|sha1|timestamp' }))).query
      for (const entry of batch) {
        const page = query?.pages?.find(page => fileKey(page.title) === fileKey(`File:${entry.filenameCandidate}`))
        const info = page?.imageinfo?.[0]
        if (!info?.descriptionurl || !info?.url) continue
        const metadata = info.extmetadata ?? {}
        entry.image = { source: info.descriptionurl, imageUrl: info.url, author: plainText(metadata.Artist?.value), license: plainText(metadata.LicenseShortName?.value), licenseUrl: metadata.LicenseUrl?.value ?? '', restrictions: metadata.Restrictions?.value ?? '', evidenceUrl: `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(page.title)}&oldid=${page.lastrevid}`, sourceSha1: info.sha1 }
        entry.sources.push(info.descriptionurl)
        entry.imageStatus = entry.subjectType === 'fictional_character' ? 'CHARACTER_RIGHTS_CLEARANCE_REQUIRED' : /\.svg$|\.pdf$|\.djvu$/i.test(entry.filenameCandidate) ? 'NON_PORTRAIT_REQUIRES_REPLACEMENT' : 'PENDING_SUBJECT_AND_RIGHTS_REVIEW'
      }
    } catch { failures.push({ stage: 'commons', ids: batch.map(entry => entry.id) }) }
  }
  return { version: 3, preparedAt: new Date().toISOString(), approved: 0, cloudWrites: 0, failures, entries: validateV3Candidates(entries) }
}

export function summarizeV3(bank, snapshot = null) {
  return Object.entries(groupTargets).map(([group, target]) => {
    const entries = bank.entries.filter(entry => entry.group === group)
    const category = snapshot?.categories?.find(category => category.slug === groupCategories[group])
    const matches = entries.map(entry => snapshot?.celebrities?.find(person => entry.wikidataId && person.wikidata_id === entry.wikidataId)).filter(Boolean)
    const playable = snapshot ? matches.filter(person => person.is_approved && person.approved_assets > 0 && person.categories.includes(groupCategories[group]) && category?.is_active).length : null
    return { group, target, candidates: entries.length, imageCandidates: entries.filter(entry => entry.image).length, missingImageCandidates: entries.filter(entry => !entry.image || entry.imageStatus === 'NON_PORTRAIT_REQUIRES_REPLACEMENT').length, preparedWebp: entries.filter(entry => entry.preparedAsset).length, approvedNew: entries.filter(entry => entry.approved).length, existingMatches: snapshot ? matches.length : null, playableNewHost: playable, meets15: playable === null ? null : playable >= 15 }
  })
}
