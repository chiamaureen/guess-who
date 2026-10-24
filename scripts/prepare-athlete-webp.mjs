import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { normalizeQuestionWebp } from './lib/question-images.mjs'
import { resolveCommonsRenditions, downloadCommonsImage, plainText } from './lib/commons-images.mjs'
import { identifyLicense } from './lib/question-license.mjs'
import { validateAthleteAssetBatch } from './prepare-athlete-assets.mjs'
import sharp from 'sharp'

export async function prepareAthleteWebp(entries, directory, dependencies = {}) {
  validateAthleteAssetBatch(entries, null)
  await mkdir(directory, { mode: 0o700 })
  await mkdir(join(directory, 'images'), { mode: 0o700 })
  const receipt = { preparedAt: new Date().toISOString(), status: 'PREPARING', technicalOnly: true, requested: entries.length, converted: 0, failed: 0, unprocessed: entries.length, approved: 0, sourceBytes: 0, downloadedBytes: 0, outputBytes: 0, cloudWrites: 0, entries: [] }
  const output = join(directory, 'webp-preparation.json')
  const save = () => writeFile(output, JSON.stringify(receipt, null, 2), { mode: 0o600 })
  await writeFile(output, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
  try {
    const sources = await (dependencies.resolveSources ?? resolveCommonsRenditions)(entries)
    await writeFile(join(directory, 'source-evidence.json'), JSON.stringify([...sources], null, 2), { flag: 'wx', mode: 0o600 })
    for (const entry of entries) {
      try {
        const source = sources.get(entry.wikidataId)
        if (!source) throw new Error('MISSING_SOURCE')
        const bytes = await (dependencies.download ?? downloadCommonsImage)(source.downloadUrl)
        const image = await normalizeQuestionWebp(bytes)
        const license = identifyLicense(source.license, source.licenseTermsUrl)
        const filename = `${randomUUID()}.webp`
        await writeFile(join(directory, 'images', filename), image.webp, { mode: 0o600, flag: 'wx' })
        const modifications = 'Official Commons rendition; proportional resize, EXIF orientation applied, metadata removed, WebP quality 82; no crop, no AI retouch. Prior source edits and notices retained in evidence.'
        receipt.entries.push({
          name: entry.name, wikidataId: entry.wikidataId, categoryIds: ['10000000-0000-4000-8000-000000000003'],
          source: entry.sourcePage, imageUrl: entry.imageUrl, ...source, metadata: undefined,
          imagePath: `images/${filename}`, imageSha256: createHash('sha256').update(image.webp).digest('hex'), renditionSha256: createHash('sha256').update(bytes).digest('hex'),
          downloadedBytes: bytes.length, outputBytes: image.webp.length, width: image.width, height: image.height, mimeType: 'image/webp', quality: 82,
          compressionRatio: Number((source.originalBytes / image.webp.length).toFixed(3)), modifications,
          licenseName: license?.name ?? null, licenseVersion: license?.version ?? null,
          originalNotices: plainText([source.metadata.ObjectName?.value, source.metadata.Credit?.value, source.metadata.Attribution?.value, source.metadata.UsageTerms?.value, source.metadata.Restrictions?.value].filter(Boolean).join(' · ')),
          attribution: `${source.author} · ${source.license} · ${entry.sourcePage} · ${modifications}`,
          rightsMetadataComplete: Boolean(license && source.author && source.evidenceUrl && !source.metadata.Restrictions?.value),
          status: 'PENDING', approved: false,
          pendingReasons: ['人物／分類及原始權利仍須確認', '揭曉前不提供來源的署名時機尚須相容性審核', ...(license ? [] : ['授權類型或條款 URL 不完整／不相容'])],
        })
        receipt.converted++
        receipt.unprocessed--
        receipt.sourceBytes += source.originalBytes
        receipt.downloadedBytes += bytes.length
        receipt.outputBytes += image.webp.length
        await save()
        if (!dependencies.download) { console.log(JSON.stringify({ converted: receipt.converted, total: entries.length, approved: 0, cloudWrites: 0 })); await delay(2000) }
      } catch (error) {
        receipt.failed++
        receipt.unprocessed--
        receipt.failure = { name: entry.name, reason: /^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : /pixel limit/i.test(error.message) ? 'PIXEL_LIMIT_EXCEEDED' : 'DECODE_OR_DOWNLOAD_FAILED' }
        throw error
      }
    }
    receipt.status = 'TECHNICAL_PREPARATION_COMPLETE_RIGHTS_PENDING'
  } catch (error) {
    receipt.status = 'BLOCKED'
    receipt.failure ??= { stage: 'source-resolution', reason: /^[A-Z][A-Z_0-9]+$/.test(error.message) ? error.message : 'SOURCE_LOOKUP_FAILED' }
  }
  await save()
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  sharp.cache({ memory: 16, files: 0, items: 16 })
  sharp.concurrency(1)
  if (![3, 4].includes(process.argv.length) || !/^[a-z0-9-]+$/.test(process.argv[2])) throw new Error('New output directory and optional local candidate manifest required')
  const snapshot = JSON.parse(await readFile(process.argv[3] ?? 'data/question-bank/prepared/athletes-local-review/phase8-athletes-reviewed.json', 'utf8'))
  const result = await prepareAthleteWebp(snapshot.entries.filter(entry => entry.imageUrl), resolve('data/question-bank/prepared', process.argv[2]))
  console.log(JSON.stringify({ ...result, entries: undefined }))
  if (result.status === 'BLOCKED') process.exitCode = 2
}
