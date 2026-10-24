import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { dirname, resolve, join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createGameFixture } from '../supabase/tests/game-fixture.mjs'
import { privateImageMime } from '../supabase/functions/game-engine/images.ts'
import { validateV3Candidates } from './lib/test-bank-v3.mjs'
import { planV3Seed, makeV3SeedSql } from './lib/test-bank-v3-seed.mjs'

if (process.argv.length !== 3) throw new Error('Local candidate manifest path required')
const path = await realpath(process.argv[2])
const directory = join(dirname(path), 'local-seed-qa')
await mkdir(directory, { mode: 0o700 })
const bank = JSON.parse(await readFile(path, 'utf8'))
validateV3Candidates(bank.entries)
const root = await realpath('data/question-bank/prepared')
let checkedAssets = 0
for (const entry of bank.entries.filter(entry => entry.preparedAsset)) {
  const asset = entry.preparedAsset
  const assetPath = await realpath(resolve(asset.path))
  assert.ok(assetPath.startsWith(root + sep))
  const bytes = await readFile(assetPath)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256)
  assert.equal(privateImageMime(bytes), 'image/webp')
  assert.equal(bytes.length, asset.bytes)
  const decoder = sharp(bytes, { limitInputPixels: 1048576, failOn: 'error' })
  const metadata = await decoder.metadata()
  await decoder.stats()
  assert.ok(Math.max(metadata.width, metadata.height) <= 1024 && !metadata.exif && !metadata.icc && !metadata.xmp)
  checkedAssets++
}
const fixture = await createGameFixture()
try {
  for (const migration of ['20261024160000_add_youtubers_category.sql', '20261024161000_test_bank_candidates.sql']) await fixture.database.exec(await readFile(new URL(`../supabase/migration-drafts/${migration}`, import.meta.url), 'utf8'))
  const snapshot = { projectRef: 'fgvajdnzrnptdjurhjfo', environment: 'LOCAL_ISOLATED_EMPTY_PGLITE_NOT_CLOUD', checkedAt: new Date().toISOString(), stagingExists: true, staged: [], celebrities: [], categories: (await fixture.database.query('SELECT id,slug,is_active FROM public.categories')).rows }
  const plan = planV3Seed(bank, snapshot)
  assert.equal(plan.pendingStagingInserts, 180)
  const sql = makeV3SeedSql(bank)
  await fixture.database.exec(sql.seed)
  const count = () => fixture.database.query('SELECT count(*)::int AS total FROM public.question_bank_candidates')
  assert.equal((await count()).rows[0].total, 180)
  await fixture.database.exec(sql.seed)
  assert.equal((await count()).rows[0].total, 180)
  assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.question_bank_candidates WHERE is_approved')).rows[0].total, 0)
  await fixture.database.exec(sql.rollback)
  assert.equal((await count()).rows[0].total, 0)
  for (const table of ['celebrities', 'game_image_assets', 'rooms', 'room_questions', 'host_question_history']) assert.equal((await fixture.database.query(`SELECT count(*)::int AS total FROM public.${table}`)).rows[0].total, 0)
  const receipt = { result: 'PASS', environment: snapshot.environment, candidates: 180, firstInsert: 180, repeatedTotal: 180, rollbackTotal: 0, realReusedWebpChecked: checkedAssets, approved: 0, cloudWrites: 0, runId: sql.runId, sqlSha256: createHash('sha256').update(sql.seed).digest('hex') }
  for (const [filename, contents] of [['local-snapshot.json', JSON.stringify(snapshot, null, 2)], ['dry-run.json', JSON.stringify(plan, null, 2)], ['pending-seed.LOCAL-QA.sql', sql.seed], ['rollback.LOCAL-QA.sql', sql.rollback], ['receipt.json', JSON.stringify(receipt, null, 2)]]) await writeFile(join(directory, filename), contents, { mode: 0o600, flag: 'wx' })
  console.log(JSON.stringify(receipt))
} finally { await fixture.close() }
