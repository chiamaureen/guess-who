import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fixturePng } from '../supabase/tests/game-fixture.mjs'
import { prepareAthleteAssets, validateAthleteAssetBatch } from './prepare-athlete-assets.mjs'

const entries = () => Array.from({ length: 69 }, (_, index) => ({
  wikidataId: `Q${990000 + index}`, name: `LOCAL TEST ONLY ${index}`, category: 'athletes',
  imageUrl: `https://upload.wikimedia.org/wikipedia/commons/a/ab/LOCAL_${index}.png`, sourcePage: `https://commons.wikimedia.org/wiki/File:LOCAL_${index}.png`,
  sourceSha1: createHash('sha1').update(fixturePng()).digest('hex'), author: 'Synthetic fixture', license: 'CC0', status: 'PENDING',
}))

test('asset request must be exactly69 distinct athletes with safe source digests', () => {
  assert.throws(() => validateAthleteAssetBatch(entries().slice(0, 68)), /69/)
  const duplicate = entries(); duplicate[1].wikidataId = duplicate[0].wikidataId
  assert.throws(() => validateAthleteAssetBatch(duplicate), /69/)
  const unsafe = entries(); unsafe[0].imageUrl = 'https://127.0.0.1/image.png'
  assert.throws(() => validateAthleteAssetBatch(unsafe), /UNSAFE/)
})

test('preparation stages69 anonymous PNGs without falsely approving rights or generating mutation SQL', async () => {
  const directory = join(await mkdtemp('/tmp/guess-who-athlete-assets-'), 'batch')
  const receipt = await prepareAthleteAssets(entries(), directory, async () => fixturePng())
  assert.equal(receipt.prepared, 69)
  assert.equal(receipt.cloudWrites, 0)
  assert.equal(receipt.mutationSqlGenerated, false)
  assert.ok(receipt.entries.every(entry => entry.approved === false && entry.reviewStatus === 'PENDING'))
  assert.ok(receipt.entries.every(entry => /^images\/[0-9a-f-]+\.png$/.test(entry.imagePath)))
  assert.ok(receipt.entries.every(entry => entry.bytes <= 131072 && entry.width <= 1600 && entry.height <= 1600))
  assert.equal((await stat(join(directory, receipt.entries[0].imagePath))).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await readFile(join(directory, 'asset-preparation.json'), 'utf8')).requestedDatabaseApproved, true)
  await assert.rejects(prepareAthleteAssets(entries(), directory, async () => fixturePng()))
})

test('source change or429 stops the whole staging batch without partial Cloud writes or automatic retry', async () => {
  for (const request of [async () => Buffer.from('changed'), async () => { throw new Error('IMAGE_HTTP_429') }]) {
    let requests = 0
    const receipt = await prepareAthleteAssets(entries(), join(await mkdtemp('/tmp/guess-who-athlete-assets-stop-'), 'batch'), async url => { requests++; return request(url) })
    assert.equal(receipt.status, 'BLOCKED')
    assert.equal(requests, 1)
    assert.equal(receipt.prepared, 0)
    assert.equal(receipt.cloudWrites, 0)
  }
})
