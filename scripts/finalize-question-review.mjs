import { readFile, writeFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { validateReviewedEntries } from './prepare-question-import.mjs'

export async function finalizeQuestionReview(path, confirmation, reviewer) {
  if (confirmation !== '--confirm-source-and-visual-review' || typeof reviewer !== 'string' || !reviewer.trim()) throw new Error('Explicit completed source and visual review required')
  path = await realpath(path)
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  const decisions = JSON.parse(await readFile(new URL('../data/question-bank/source-review.json', import.meta.url), 'utf8'))
  const accepted = decisions.entries.filter(entry => entry.decision === 'accepted')
  if (manifest.entries.length !== accepted.length) throw new Error('Incomplete source review batch')
  for (const entry of manifest.entries) {
    const decision = accepted.find(row => row.wikidataId === entry.wikidataId && row.filename === entry.filename)
    if (!decision || entry.rightsBasis !== decision.basis || entry.review?.rights !== true || !entry.sourcePageRevision || !/^[0-9a-f]{40}$/.test(entry.sourceSha1)) throw new Error('Missing source review evidence')
    const imagePath = await realpath(resolve(dirname(path), entry.imagePath))
    if (!imagePath.startsWith(dirname(path) + sep)) throw new Error('Image outside review directory')
    const bytes = await readFile(imagePath)
    if (createHash('sha256').update(bytes).digest('hex') !== entry.imageSha256) throw new Error('Image changed since inspection')
    const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    if (decoded.info.width !== entry.imageWidth || decoded.info.height !== entry.imageHeight || decoded.info.channels !== 3) throw new Error('Image decode mismatch')
    entry.approved = true
    entry.review = { rights: true, subject: true, image: true, reviewedBy: reviewer.trim(), reviewedAt: new Date().toISOString(), imageSha256: entry.imageSha256, sourceRevision: entry.sourcePageRevision, useContext: 'Portrait guessing game; no endorsement or advertising use claimed' }
  }
  validateReviewedEntries(manifest.entries)
  const output = resolve(dirname(path), 'reviewed-bank.json')
  await writeFile(output, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' })
  return { output, reviewedSubjects: manifest.entries.length, cloudWrites: 0 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5) throw new Error('Manifest, explicit review confirmation and reviewer are required')
    console.log(JSON.stringify({ result: 'PASS', ...await finalizeQuestionReview(process.argv[2], process.argv[3], process.argv[4]) }))
  } catch { console.error('BLOCKED: explicit source/visual confirmation or immutable review evidence missing; no Cloud write.'); process.exitCode = 2 }
}
