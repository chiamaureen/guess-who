import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { normalizeQuestionImage } from './lib/question-images.mjs'

const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex')

export function validateAthleteAssetBatch(entries, expectedCount = 69) {
  if (!Array.isArray(entries) || (expectedCount === null ? entries.length < 1 || entries.length > 124 : entries.length !== expectedCount)
    || new Set(entries.map(entry => entry.wikidataId)).size !== entries.length) throw new Error(expectedCount === null ? 'EXPECTED_1_TO_124_UNIQUE_ATHLETES' : 'EXPECTED_69_UNIQUE_ATHLETES')
  for (const entry of entries) {
    const image = new URL(entry.imageUrl)
    const source = new URL(entry.sourcePage)
    if (entry.category !== 'athletes' || !/^Q[1-9]\d*$/.test(entry.wikidataId)
      || image.protocol !== 'https:' || image.hostname !== 'upload.wikimedia.org' || image.port || image.username || image.password
      || !image.pathname.startsWith('/wikipedia/commons/') || source.protocol !== 'https:' || source.hostname !== 'commons.wikimedia.org'
      || source.username || source.password || source.port || !source.pathname.startsWith('/wiki/File:') || !/^[0-9a-f]{40}$/.test(entry.sourceSha1 ?? '')) throw new Error('INCOMPLETE_OR_UNSAFE_SOURCE')
  }
}

async function downloadImage(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'GuessWhoImagePreparation/1.0 (https://github.com/chiamaureen/guess-who; offline asset staging)' } })
  if (response.status !== 200) { await response.body?.cancel(); throw new Error(`IMAGE_HTTP_${response.status}`) }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase())) { await response.body?.cancel(); throw new Error('UNSUPPORTED_IMAGE_TYPE') }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    size += item.value.length
    if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('ORIGINAL_EXCEEDS_32_MIB') }
    chunks.push(item.value)
  }
  return Buffer.concat(chunks)
}

export async function prepareAthleteAssets(entries, directory, fetchImage = downloadImage) {
  validateAthleteAssetBatch(entries)
  await mkdir(directory, { mode: 0o700 })
  await mkdir(join(directory, 'images'), { mode: 0o700 })
  const receipt = {
    requestedSubjects: 69, requestedImageAssets: 69, requestedDatabaseApproved: true,
    requestBasis: 'User requested69 subjects approved and private database image storage on2026-10-24. This records a request, not completed rights or image review.',
    preparedAt: new Date().toISOString(), prepared: 0, independentRightsReviewCompleted: false,
    approvedReviewCount: 0, mutationSqlGenerated: false, cloudWrites: 0, status: 'PREPARING', entries: [],
  }
  const output = join(directory, 'asset-preparation.json')
  await writeFile(output, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' })
  for (const entry of entries) {
    try {
      const bytes = await fetchImage(entry.imageUrl)
      if (digest('sha1', bytes) !== entry.sourceSha1) throw new Error('ORIGINAL_SHA1_CHANGED')
      const image = await normalizeQuestionImage(bytes)
      const filename = `${randomUUID()}.png`
      await writeFile(join(directory, 'images', filename), image.png, { mode: 0o600, flag: 'wx' })
      receipt.entries.push({
        wikidataId: entry.wikidataId, name: entry.name, source: entry.sourcePage, imageUrl: entry.imageUrl,
        author: entry.author, license: entry.license, licenseTermsUrl: entry.licenseTermsUrl, evidenceUrl: entry.evidenceUrl,
        originalSha1: entry.sourceSha1, imagePath: `images/${filename}`, imageSha256: digest('sha256', image.png),
        width: image.width, height: image.height, bytes: image.png.length, reviewStatus: entry.status,
        requestedDatabaseApproved: true, approved: false,
      })
      receipt.prepared++
      if (fetchImage === downloadImage) console.log(JSON.stringify({ prepared: receipt.prepared, requested: 69, approvedReviewCount: 0, cloudWrites: 0 }))
    } catch (error) {
      receipt.status = 'BLOCKED'
      receipt.failure = { name: entry.name, reason: /^IMAGE_HTTP_\d+$|^ORIGINAL_SHA1_CHANGED$|^ORIGINAL_EXCEEDS_32_MIB$|^UNSUPPORTED_IMAGE_TYPE$/.test(error.message) ? error.message : /pixel limit/i.test(error.message) ? 'PIXEL_LIMIT_EXCEEDED' : error.name === 'TimeoutError' ? 'DOWNLOAD_TIMEOUT' : 'DOWNLOAD_OR_CONVERSION_FAILED' }
      break
    }
    if (fetchImage === downloadImage && receipt.prepared < entries.length) await delay(1500)
  }
  if (receipt.prepared === 69) receipt.status = 'ASSETS_PREPARED_IMPORT_RIGHTS_GATE_PENDING'
  await writeFile(output, JSON.stringify(receipt, null, 2), { mode: 0o600 })
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !/^[a-z0-9-]+$/.test(process.argv[2])) throw new Error('New staging directory name required')
    const snapshot = JSON.parse(await readFile('data/question-bank/prepared/athletes-local-review/phase8-athletes-reviewed.json', 'utf8'))
    const receipt = await prepareAthleteAssets(snapshot.entries.filter(entry => entry.imageUrl), resolve('data/question-bank/prepared', process.argv[2]))
    console.log(JSON.stringify({ status: receipt.status, prepared: receipt.prepared, requested: 69, failure: receipt.failure ?? null, approvedReviewCount: 0, cloudWrites: 0 }))
    if (receipt.status === 'BLOCKED') process.exitCode = 2
  } catch { console.error('BLOCKED: input/output validation failed; no Cloud write or approval performed.'); process.exitCode = 2 }
}
