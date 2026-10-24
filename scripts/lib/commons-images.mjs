import { setTimeout as delay } from 'node:timers/promises'

const agent = 'GuessWhoLocalImageAudit/3.0 (https://github.com/chiamaureen/guess-who; read-only provenance checks)'
export const plainText = value => String(value ?? '').replace(/<[^>]*>/g, '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ').trim()
const key = value => decodeURIComponent(value).replaceAll('_', ' ').normalize('NFC')

export async function publicMetadata(url, fetchImpl = fetch) {
  if (url.protocol !== 'https:' || !['commons.wikimedia.org', 'en.wikipedia.org', 'zh.wikipedia.org', 'www.wikidata.org'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('UNSAFE_METADATA_HOST')
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': agent } })
  if (response.status !== 200) { await response.body?.cancel(); throw new Error(`METADATA_HTTP_${response.status}`) }
  const reader = response.body.getReader()
  const pieces = []
  let size = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    size += part.value.length
    if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('METADATA_TOO_LARGE') }
    pieces.push(part.value)
  }
  const result = JSON.parse(Buffer.concat(pieces).toString('utf8'))
  if (result.error) throw new Error('METADATA_API_ERROR')
  return result
}

export function commonsQuery(parameters) {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...parameters })
  return url
}

export function validateRendition(entry, page) {
  const info = page?.imageinfo?.[0]
  const expected = new URL(entry.imageUrl)
  const original = new URL(info?.url ?? 'https://invalid.invalid')
  const thumbnail = new URL(info?.thumburl ?? info?.url ?? 'https://invalid.invalid')
  const title = new URL(entry.sourcePage).pathname.slice('/wiki/'.length)
  if (key(page?.title ?? '') !== key(title) || info?.sha1 !== entry.sourceSha1 || original.origin !== expected.origin || original.pathname !== expected.pathname) throw new Error('ORIGINAL_REVISION_CHANGED')
  if (thumbnail.protocol !== 'https:' || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(thumbnail.hostname) || thumbnail.username || thumbnail.password || thumbnail.port || !thumbnail.pathname.startsWith('/wikipedia/commons/')
    || !Number.isInteger(info.width) || !Number.isInteger(info.height) || !Number.isInteger(info.size) || !page.lastrevid
    || (info.thumburl ? !info.thumbwidth || !info.thumbheight || Math.max(info.thumbwidth, info.thumbheight) > 1024 : info.width * info.height > 40000000 || info.size > 32 * 1024 * 1024)) throw new Error('UNSAFE_RENDITION')
  const metadata = info.extmetadata ?? {}
  return {
    downloadUrl: thumbnail.href, originalSha1: info.sha1, originalBytes: info.size, originalWidth: info.width, originalHeight: info.height,
    originalTimestamp: info.timestamp, pageRevision: page.lastrevid, evidenceUrl: `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(page.title)}&oldid=${page.lastrevid}`,
    checkedAt: new Date().toISOString(), metadata,
    author: plainText(metadata.Artist?.value), license: plainText(metadata.LicenseShortName?.value), licenseTermsUrl: metadata.LicenseUrl?.value ?? '',
    sourceVerification: 'Commons API original SHA-1 and URL matched; downloaded rendition has a separate SHA-256, not the original SHA-1',
  }
}

export async function resolveCommonsRenditions(entries, request = publicMetadata) {
  const sources = new Map()
  for (let offset = 0; offset < entries.length; offset += 10) {
    const batch = entries.slice(offset, offset + 10)
    const titles = batch.map(entry => decodeURIComponent(new URL(entry.sourcePage).pathname.slice('/wiki/'.length)))
    if (titles.some(title => !title.startsWith('File:') || title.includes('|'))) throw new Error('INVALID_FILE_TITLE')
    const result = await request(commonsQuery({ titles: titles.join('|'), prop: 'imageinfo|info', iiprop: 'url|size|sha1|timestamp|extmetadata', iiurlwidth: '1024', iiurlheight: '1024' }))
    for (const [index, entry] of batch.entries()) {
      const page = result.query?.pages?.find(page => key(page.title) === key(titles[index]))
      sources.set(entry.wikidataId, validateRendition(entry, page))
    }
    if (request === publicMetadata) await delay(1500)
  }
  return sources
}

export async function downloadCommonsImage(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port || !parsed.pathname.startsWith('/wikipedia/commons/')) throw new Error('UNSAFE_IMAGE_HOST')
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'User-Agent': agent } })
  if (response.status !== 200) { await response.body?.cancel(); throw new Error(`IMAGE_HTTP_${response.status}`) }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(response.headers.get('content-type')?.split(';')[0])) { await response.body?.cancel(); throw new Error('UNSUPPORTED_IMAGE_TYPE') }
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 32 * 1024 * 1024) throw new Error('SOURCE_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
