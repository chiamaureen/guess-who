import { createHash } from 'node:crypto'
import sharp from 'sharp'

export const maxImageBytes = 8 * 1024 * 1024
export const maxPixels = 40000000
const groups = new Set(['nba-active-instagram-35', 'taiwan-u23-baseball-2026', 'taiwan-olympic-medalists'])
export const confirmations = ['subjectCorrect', 'personSourceConfirmed', 'categoryConfirmed', 'rightsConfirmed', 'conditionsSatisfied']
const text = value => String(value ?? '').replace(/<[^>]*>/g, '').trim()
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim()
const searchHost = hostname => /(^|\.)(google\.[a-z.]+|googleusercontent\.com|gstatic\.com|bing\.com|yahoo\.com|duckduckgo\.com)$/.test(hostname)

export function httpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null
  } catch { return null }
}

export function imageUrlAllowed(value) {
  const url = httpsUrl(value)
  return Boolean(url && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname))
}

export function evidenceUrlAllowed(value) {
  const url = httpsUrl(value)
  return Boolean(url && !searchHost(url.hostname)
    && !['creativecommons.org', 'www.creativecommons.org'].includes(url.hostname))
}

export function parseCandidateMarkdown(markdown) {
  const rows = markdown.split(/\r?\n/).filter(line => /^\| (nba-active|taiwan-)/.test(line))
  if (!rows.length) throw new Error('EMPTY_CANDIDATE_TABLE')
  return rows.map(line => {
    const cells = line.replace(/^\|\s*|\s*\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replaceAll('\\|', '|'))
    if (cells.length !== 8 || !groups.has(cells[0]) || !cells[2]) throw new Error('INVALID_CANDIDATE_ROW')
    const sourcePage = cells[4].match(/^\[來源頁\]\((https:\/\/.*)\)$/)?.[1] ?? ''
    if (sourcePage && !(new URL(sourcePage).hostname === 'commons.wikimedia.org' && new URL(sourcePage).pathname.startsWith('/wiki/File:'))) throw new Error('INVALID_COMMONS_SOURCE')
    return {
      id: createHash('sha256').update(`${cells[0]}:${cells[2].normalize('NFC')}`).digest('hex').slice(0, 24),
      group: cells[0], rank: /^\d+$/.test(cells[1]) ? Number(cells[1]) : null,
      name: cells[2], wikidataId: /^Q[1-9]\d*$/.test(cells[3]) ? cells[3] : '', category: 'athletes',
      sourcePage, imageUrl: '', author: cells[5] === '—' ? '' : text(cells[5]), license: cells[6] === '—' ? '' : cells[6],
      licenseTermsUrl: '', evidenceUrl: sourcePage, personSource: '', rosterSource: '', sourceSha1: null, metadataRetrievedAt: null,
      qualificationNote: '', identityWarning: '', duplicateIssues: [], status: sourcePage ? 'PENDING' : 'MISSING_IMAGE',
      imageCheck: { status: 'NOT_CHECKED', checkedAt: null },
      review: { ...Object.fromEntries(confirmations.map(key => [key, false])), reviewer: '', notes: '', attributionPlan: '', evidenceCheckedOn: '', reviewedAt: null },
    }
  })
}

export function reconcileCandidates(markdown, scope, manifest = null) {
  const entries = parseCandidateMarkdown(markdown)
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('DUPLICATE_CANDIDATE_ROW')
  for (const entry of entries) {
    const group = scope.groups.find(group => group.id === entry.group)
    if (!group?.names.includes(entry.name) || scope.categorySlug !== 'athletes') throw new Error('CANDIDATE_SCOPE_MISMATCH')
    entry.rosterSource = group.source
    entry.qualificationNote = group.note
    entry.identityWarning = scope.identityWarnings?.[entry.name] ?? ''
    const metadata = manifest?.entries?.find(candidate => candidate.name === entry.name && candidate.group === entry.group)
    if (metadata && entry.sourcePage && decodeURIComponent(metadata.source ?? '') === decodeURIComponent(entry.sourcePage)
      && metadata.wikidataId === (entry.wikidataId || null)) {
      entry.imageUrl = imageUrlAllowed(metadata.imageUrl) ? metadata.imageUrl : ''
      entry.licenseTermsUrl = httpsUrl(metadata.licenseUrl) ? metadata.licenseUrl : ''
      entry.personSource = metadata.wikipediaSource ?? (entry.wikidataId ? `https://www.wikidata.org/wiki/${entry.wikidataId}` : '')
      entry.sourceSha1 = metadata.sourceSha1 ?? null
      entry.metadataRetrievedAt = manifest.preparedAt ?? null
    }
    entry.status = entry.sourcePage || entry.imageUrl ? 'PENDING' : 'MISSING_IMAGE'
  }
  return updateDuplicateIssues(entries)
}

export function updateDuplicateIssues(entries) {
  for (const entry of entries) {
    entry.duplicateIssues = entries.filter(other => other.id !== entry.id && (normalize(other.name) === normalize(entry.name) || entry.wikidataId && entry.wikidataId === other.wikidataId)).map(other => other.name)
  }
  return entries
}

export async function probeImage(imageUrl, fetchImpl = fetch) {
  const checkedAt = new Date().toISOString()
  const base = { checkedAt, verifiedUrl: imageUrl }
  if (!imageUrlAllowed(imageUrl)) return { check: { ...base, status: 'FAIL', reason: 'IMAGE_HOST_NOT_ALLOWED' } }
  try {
    const response = await fetchImpl(imageUrl, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'GuessWhoLocalImageReview/1.0 (https://github.com/chiamaureen/guess-who; read-only image check)' } })
    if (response.status !== 200) {
      await response.body?.cancel()
      const retryAfter = response.headers.get('retry-after')
      const retryMs = /^\d+$/.test(retryAfter ?? '') ? Number(retryAfter) * 1000 : Date.parse(retryAfter ?? '') - Date.now()
      const retryAllowedAt = response.status === 429 ? new Date(Date.now() + Math.max(60000, Number.isFinite(retryMs) && retryMs < 31536000000 ? retryMs : 60000)).toISOString() : null
      return { check: { ...base, status: 'FAIL', reason: `HTTP_${response.status}`, httpStatus: response.status, retryAllowedAt } }
    }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) { await response.body?.cancel(); return { check: { ...base, status: 'FAIL', reason: 'CONTENT_TYPE_NOT_ALLOWED', mime } } }
    if (Number(response.headers.get('content-length')) > maxImageBytes) { await response.body?.cancel(); return { check: { ...base, status: 'FAIL', reason: 'IMAGE_TOO_LARGE', mime } } }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('EMPTY_BODY')
    const pieces = []
    let bytes = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.length
      if (bytes > maxImageBytes) { await reader.cancel(); return { check: { ...base, status: 'FAIL', reason: 'IMAGE_TOO_LARGE', mime } } }
      pieces.push(part.value)
    }
    const buffer = Buffer.concat(pieces)
    const image = sharp(buffer, { limitInputPixels: maxPixels, failOn: 'error' })
    const metadata = await image.metadata()
    const format = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[mime]
    if (metadata.format !== format || metadata.pages > 1 || !metadata.width || !metadata.height) throw new Error('INVALID_IMAGE')
    await image.stats()
    return { buffer, check: { ...base, status: 'PASS', httpStatus: 200, mime, bytes, width: metadata.width, height: metadata.height, sha256: createHash('sha256').update(buffer).digest('hex') } }
  } catch (error) {
    const cause = error.cause?.code ?? error.code
    const reason = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'TIMEOUT'
      : ['ENOTFOUND', 'EAI_AGAIN'].includes(cause) ? 'DNS_ERROR'
      : /invalid|unsupported|corrupt|pixel|Input buffer|decode/i.test(error.message) ? 'DECODE_OR_PIXEL_LIMIT_FAILED' : 'NETWORK_OR_REDIRECT_ERROR'
    return { check: { ...base, status: 'FAIL', reason } }
  }
}

export async function resolveCommonsSource(entry, fetchImpl = fetch) {
  const source = httpsUrl(entry.sourcePage)
  if (!source || source.hostname !== 'commons.wikimedia.org' || !source.pathname.startsWith('/wiki/File:')) throw new Error('COMMONS_SOURCE_REQUIRED')
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({ action: 'query', titles: decodeURIComponent(source.pathname.slice('/wiki/'.length)), prop: 'imageinfo', iiprop: 'url|extmetadata|sha1|timestamp', formatversion: '2', format: 'json' })
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'GuessWhoLocalImageReview/1.0 (https://github.com/chiamaureen/guess-who)' } })
  if (response.status !== 200) throw new Error('COMMONS_METADATA_UNAVAILABLE')
  const body = await response.text()
  if (body.length > 2 * 1024 * 1024) throw new Error('METADATA_TOO_LARGE')
  const info = JSON.parse(body).query?.pages?.[0]?.imageinfo?.[0]
  if (!info || !imageUrlAllowed(info.url)) throw new Error('COMMONS_IMAGE_NOT_FOUND')
  const metadata = info.extmetadata ?? {}
  return { imageUrl: info.url, author: text(metadata.Artist?.value), license: text(metadata.LicenseShortName?.value), licenseTermsUrl: metadata.LicenseUrl?.value ?? '', sourceSha1: info.sha1 ?? null, metadataRetrievedAt: new Date().toISOString() }
}

export function approvalErrors(entry, now = Date.now()) {
  const errors = []
  if (!imageUrlAllowed(entry.imageUrl)) errors.push('只允許 Wikimedia 原始圖片 HTTPS 連結')
  const checkedAt = Date.parse(entry.imageCheck.checkedAt)
  if (entry.imageCheck.status !== 'PASS' || entry.imageCheck.verifiedUrl !== entry.imageUrl || !Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 86400000 || !/^[0-9a-f]{64}$/.test(entry.imageCheck.sha256 ?? '')) errors.push('須先通過圖片連線、型別、大小及解碼檢查（24 小時內）')
  if (!/^Q[1-9]\d*$/.test(entry.wikidataId) || !evidenceUrlAllowed(entry.personSource) || !evidenceUrlAllowed(entry.rosterSource)) errors.push('須填入正確人物 QID、人物來源與名單來源')
  if (entry.category !== 'athletes' || entry.duplicateIssues.length) errors.push('分類或重複人物尚未解決')
  const terms = httpsUrl(entry.licenseTermsUrl)
  if (!evidenceUrlAllowed(entry.sourcePage) || !evidenceUrlAllowed(entry.evidenceUrl) || !terms || searchHost(terms.hostname)) errors.push('缺少原始來源、特定圖片授權證據或授權條款；Google 搜尋不是證明')
  if (!entry.author.trim() || !entry.license.trim() || /^(unknown|unverified|n\/a|—|未知|不明|待確認|未審核)$/i.test(entry.license.trim()) || !entry.review.attributionPlan.trim()) errors.push('須填入作者、授權與署名／使用條件計畫')
  if (!confirmations.every(key => entry.review[key] === true)) errors.push('須逐一確認人物、來源、分類、授權及使用條件')
  if (!entry.review.reviewer.trim() || !entry.review.notes.trim()) errors.push('須填寫審核者與具體審核備註')
  const date = new Date(entry.review.evidenceCheckedOn)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.review.evidenceCheckedOn) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== entry.review.evidenceCheckedOn || date.getTime() > now) errors.push('須填寫有效且不在未來的授權查證日期')
  return errors
}

export function applyReview(entries, id, input) {
  const current = entries.find(entry => entry.id === id)
  if (!current || !['APPROVE', 'REJECT', 'PENDING'].includes(input.action)) throw new Error('INVALID_REVIEW_ACTION')
  const entry = structuredClone(current)
  const fields = ['imageUrl', 'sourcePage', 'personSource', 'rosterSource', 'wikidataId', 'author', 'license', 'licenseTermsUrl', 'evidenceUrl']
  for (const field of fields) {
    if (typeof input[field] !== 'string' || input[field].length > 3000) throw new Error('INVALID_REVIEW_FIELD')
    entry[field] = input[field].trim()
  }
  if (!input.review || ['reviewer', 'notes', 'attributionPlan', 'evidenceCheckedOn'].some(key => typeof input.review[key] !== 'string' || input.review[key].length > 5000)) throw new Error('INVALID_REVIEW_NOTES')
  entry.review = Object.fromEntries([...confirmations.map(key => [key, input.review[key] === true]), ...['reviewer', 'notes', 'attributionPlan', 'evidenceCheckedOn'].map(key => [key, input.review[key].trim()])])
  if (fields.some(field => entry[field] !== current[field])) {
    if (entry.imageUrl !== current.imageUrl) entry.imageCheck = { status: 'NOT_CHECKED', checkedAt: null }
  }
  updateDuplicateIssues(entries.map(person => person.id === id ? entry : structuredClone(person)))
  if (input.action === 'APPROVE') {
    const errors = approvalErrors(entry)
    if (errors.length) throw new Error(errors.join('；'))
    entry.status = 'APPROVED'
  } else if (input.action === 'REJECT') {
    if (!entry.review.notes) throw new Error('拒絕時須記錄原因')
    entry.status = 'REJECTED'
  } else entry.status = entry.imageUrl || entry.sourcePage ? 'PENDING' : 'MISSING_IMAGE'
  entry.review.reviewedAt = new Date().toISOString()
  return entry
}

export function reviewSummary(entries) {
  const counts = Object.fromEntries(['APPROVED', 'REJECTED', 'PENDING', 'MISSING_IMAGE'].map(status => [status, entries.filter(entry => entry.status === status).length]))
  const validApprovals = entries.filter(entry => entry.status === 'APPROVED' && approvalErrors(entry).length === 0)
  const uniqueApproved = new Set(validApprovals.map(entry => entry.wikidataId)).size
  return { total: entries.length, ...counts, checked: entries.filter(entry => entry.imageCheck.checkedAt).length, imageCheckPass: entries.filter(entry => entry.imageCheck.status === 'PASS').length,
    uniqueApproved, metadataPreparationReady: uniqueApproved >= 15 && validApprovals.length === counts.APPROVED,
    minimumApproved: 15, additionalApprovalsRequired: Math.max(0, 15 - uniqueApproved), imageStorageMode: 'link-only', gameEngineCompatible: false, cloudImportAuthorized: false }
}
