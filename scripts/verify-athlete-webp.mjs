import assert from 'node:assert/strict'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep, join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import { privateImageMime } from '../supabase/functions/game-engine/images.ts'

if (process.argv.length !== 3) throw new Error('WebP preparation receipt required')
const path = await realpath(process.argv[2])
const directory = dirname(path)
const receipt = JSON.parse(await readFile(path, 'utf8'))
assert.ok(Number.isInteger(receipt.requested) && receipt.requested >= 1 && receipt.requested <= 124)
assert.equal(receipt.converted, receipt.requested)
assert.equal(receipt.failed, 0)
assert.equal(receipt.unprocessed, 0)
assert.equal(new Set(receipt.entries.map(entry => entry.wikidataId)).size, receipt.requested)
const database = new PGlite()
const contacts = []
try {
  const original = await readFile(new URL('../supabase/migrations/20261023120000_game_engine.sql', import.meta.url), 'utf8')
  const draft = await readFile(new URL('../supabase/migration-drafts/20261024120000_game_image_formats.sql', import.meta.url), 'utf8')
  await database.exec(original.split('CREATE TABLE public.game_image_assets')[0])
  await database.exec(draft.split('ALTER TABLE public.game_image_assets')[0] + 'COMMIT;')
  let outputBytes = 0
  for (const [index, entry] of receipt.entries.entries()) {
    assert.match(entry.imagePath, /^images\/[0-9a-f-]{36}\.webp$/)
    const imagePath = await realpath(resolve(directory, entry.imagePath))
    assert.ok(imagePath.startsWith(directory + sep))
    assert.equal((await stat(imagePath)).mode & 0o777, 0o600)
    const image = await readFile(imagePath)
    assert.equal(createHash('sha256').update(image).digest('hex'), entry.imageSha256)
    assert.equal(privateImageMime(image), 'image/webp')
    assert.equal((await database.query('SELECT public.game_engine_webp_valid($1::bytea) AS valid', [image])).rows[0].valid, true)
    const decoder = sharp(image, { limitInputPixels: 1048576, failOn: 'error' })
    const metadata = await decoder.metadata()
    await decoder.stats()
    assert.equal(metadata.width, entry.width); assert.equal(metadata.height, entry.height)
    assert.ok(!metadata.exif && !metadata.icc && !metadata.xmp && !metadata.orientation)
    assert.equal(image.length, entry.outputBytes)
    assert.equal(entry.approved, false)
    assert.ok(Math.abs(entry.width / entry.height - entry.originalWidth / entry.originalHeight) < 0.02)
    outputBytes += image.length
    const label = entry.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const thumb = await sharp(image).resize({ width: 140, height: 150, fit: 'contain', background: '#ffffff' }).png().toBuffer()
    const card = await sharp({ create: { width: 148, height: 180, channels: 3, background: '#ffffff' } }).composite([{ input: thumb, left: 4, top: 2 }, { input: Buffer.from(`<svg width="148" height="26"><text x="4" y="15" font-size="10">${index + 1}. ${label}</text></svg>`), left: 0, top: 152 }]).png().toBuffer()
    contacts.push({ input: card, left: index % 8 * 148, top: Math.floor(index / 8) * 180 })
  }
  assert.equal(outputBytes, receipt.outputBytes)
  const contact = await sharp({ create: { width: 1184, height: Math.ceil(receipt.entries.length / 8) * 180, channels: 3, background: '#ffffff' } }).composite(contacts).png().toBuffer()
  await writeFile(join(directory, 'technical-contact-sheet.png'), contact, { mode: 0o600, flag: 'wx' })
  const summary = { result: 'PASS', scope: 'Real candidate files, technical validation only; not rights approval', decoded: receipt.requested, databaseStructuralChecks: receipt.requested, sourceBytes: receipt.sourceBytes, downloadedBytes: receipt.downloadedBytes, outputBytes, compressionPercent: Number((100 * (1 - outputBytes / receipt.sourceBytes)).toFixed(2)), smallestBytes: Math.min(...receipt.entries.map(entry => entry.outputBytes)), largestBytes: Math.max(...receipt.entries.map(entry => entry.outputBytes)), approved: 0, cloudWrites: 0 }
  await writeFile(join(directory, 'technical-verification.json'), JSON.stringify(summary, null, 2), { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify(summary))
} finally { await database.close() }
