import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { normalizeQuestionImage } from './lib/question-images.mjs'

const userAgent = 'GuessWhoQuestionReview/1.0 (https://github.com/chiamaureen/guess-who; local source verification)'
async function download(url, json = false) {
  const target = new URL(url)
  if (target.protocol !== 'https:' || target.username || target.password || !['commons.wikimedia.org', 'upload.wikimedia.org', 'www.wikidata.org'].includes(target.hostname)) throw new Error('UNSAFE_SOURCE')
  const response = await fetch(target, { headers: { 'User-Agent': userAgent }, redirect: 'error', signal: AbortSignal.timeout(45000) })
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`)
  const maximum = json ? 8 * 1024 * 1024 : 32 * 1024 * 1024
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maximum) { await reader.cancel(); throw new Error('SOURCE_TOO_LARGE') }
    chunks.push(Buffer.from(value))
  }
  const body = Buffer.concat(chunks)
  return json ? JSON.parse(body.toString('utf8')) : body
}

export async function prepareReviewedImages(outputDirectory) {
  const decisions = JSON.parse(await readFile(new URL('../data/question-bank/source-review.json', import.meta.url), 'utf8'))
  const accepted = decisions.entries.filter(entry => entry.decision === 'accepted')
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  url.search = new URLSearchParams({ action: 'query', prop: 'imageinfo|revisions', rvprop: 'ids', iiprop: 'url|extmetadata|sha1|timestamp', titles: accepted.map(row => `File:${row.filename}`).join('|'), format: 'json', formatversion: '2' })
  const metadata = await download(url, true)
  if (metadata.error || !Array.isArray(metadata.query?.pages)) throw new Error('INVALID_METADATA')
  const directory = resolve(outputDirectory)
  await mkdir(directory, { recursive: false })
  await mkdir(join(directory, 'images'))
  await mkdir(join(directory, 'sources'))
  await writeFile(join(directory, 'commons-evidence.json'), JSON.stringify(metadata, null, 2), { mode: 0o600, flag: 'wx' })
  const entries = []
  for (const decision of accepted) {
    const page = metadata.query.pages.find(row => row.title.replaceAll('_', ' ') === `File:${decision.filename}`.replaceAll('_', ' '))
    const info = page?.imageinfo?.[0]
    if (!info?.url || !/^[0-9a-f]{40}$/.test(info.sha1) || info.extmetadata?.LicenseShortName?.value !== 'Public domain' || info.extmetadata?.Restrictions?.value) throw new Error(`RIGHTS_CHANGED_${decision.wikidataId}`)
    const imageUrl = new URL(info.url); imageUrl.search = ''
    if (imageUrl.hostname !== 'upload.wikimedia.org' || !imageUrl.pathname.startsWith('/wikipedia/commons/')) throw new Error('UNSAFE_IMAGE')
    const bytes = await download(imageUrl)
    if (createHash('sha1').update(bytes).digest('hex') !== info.sha1) throw new Error('SOURCE_CHANGED')
    const image = await normalizeQuestionImage(bytes)
    const assetId = crypto.randomUUID()
    await writeFile(join(directory, 'sources', `${assetId}.jpg`), bytes, { mode: 0o600, flag: 'wx' })
    const imagePath = `images/${assetId}.png`
    await writeFile(join(directory, imagePath), image.png, { mode: 0o600, flag: 'wx' })
    entries.push({ wikidataId: decision.wikidataId, nameZh: decision.nameZh, nameEn: '', categoryIds: [decisions.categoryId], source: info.descriptionurl, imageUrl: imageUrl.href, filename: decision.filename, author: decision.author, attribution: `${decision.author}. ${decision.basis}. Resized and re-encoded without metadata; source retained.`, license: 'Public domain', restrictions: '', sourceSha1: info.sha1, sourceTimestamp: info.timestamp, sourcePageRevision: page.revisions?.[0]?.revid, evidenceUrl: `https://commons.wikimedia.org/w/index.php?oldid=${page.revisions?.[0]?.revid}`, rightsBasis: decision.basis, additionalEvidence: decision.additionalEvidence ?? [], imagePath, imageSha256: createHash('sha256').update(image.png).digest('hex'), imageWidth: image.width, imageHeight: image.height, approved: false, review: { rights: true, subject: false, image: false, reviewedBy: '', reviewedAt: null } })
    console.log(JSON.stringify({ prepared: entries.length, wikidataId: decision.wikidataId, sourceSha1Verified: true, bytes: image.png.length, approved: false }))
  }
  await writeFile(join(directory, 'reviewed-images.json'), JSON.stringify({ preparedAt: new Date().toISOString(), entries }, null, 2), { mode: 0o600, flag: 'wx' })
  const tiles = await Promise.all(entries.map(async (entry, index) => ({ input: await sharp(join(directory, entry.imagePath)).resize({ width: 160, height: 210, fit: 'contain', background: 'white' }).extend({ top: 20, bottom: 0, left: 0, right: 0, background: 'white' }).composite([{ input: Buffer.from(`<svg width="160" height="20"><text x="8" y="16" font-size="16">${index + 1}</text></svg>`), top: 0, left: 0 }]).png().toBuffer(), left: index % 5 * 160, top: Math.floor(index / 5) * 230 })))
  await sharp({ create: { width: 800, height: Math.ceil(entries.length / 5) * 230, channels: 3, background: 'white' } }).composite(tiles).png().toFile(join(directory, 'contact-sheet.png'))
  return { directory, images: entries.length, approved: 0, cloudWrites: 0 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !resolve(process.argv[2]).startsWith(resolve('data/question-bank/prepared') + '/')) throw new Error('Use a new ignored prepared subdirectory')
    console.log(JSON.stringify({ result: 'PASS', ...await prepareReviewedImages(process.argv[2]) }))
  } catch (error) { console.error(JSON.stringify({ result: 'BLOCKED', reason: error.message, approved: 0, cloudWrites: 0 })); process.exitCode = 2 }
}
