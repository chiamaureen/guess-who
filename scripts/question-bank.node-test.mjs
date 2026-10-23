import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateReviewedEntries, prepareQuestionImport } from './prepare-question-import.mjs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createGameFixture, fixturePng } from '../supabase/tests/game-fixture.mjs'
import { gameVerificationSql } from './make-game-verification.mjs'

const reviewedFixture = () => Array.from({ length: 15 }, (_, index) => ({
  wikidataId: `Q${90000000 + index}`, nameZh: `LOCAL TEST ONLY ${index}`, license: 'CC0-1.0', restrictions: '',
  source: 'https://commons.wikimedia.org/wiki/File:LOCAL_TEST_ONLY.png', imageUrl: 'https://upload.wikimedia.org/LOCAL_TEST_ONLY.png',
  author: 'LOCAL TEST ONLY', attribution: 'Synthetic validation record; not official corpus', categoryIds: ['10000000-0000-4000-8000-000000000004'],
  imagePath: 'LOCAL_TEST_ONLY.png', imageSha256: 'a'.repeat(64), approved: true,
  review: { rights: true, image: true, subject: true, reviewedBy: 'LOCAL TEST ONLY', reviewedAt: '2026-10-23T00:00:00Z' },
}))

test('unreviewed candidate cannot generate a usable entry', () => {
  const entries = reviewedFixture(); entries[0].approved = false
  assert.throws(() => validateReviewedEntries(entries), /Unreviewed/)
  entries[0].approved = true; entries[0].review.rights = false
  assert.throws(() => validateReviewedEntries(entries), /Unreviewed/)
})
test('duplicate identities and fewer than15 reviewed people are refused', () => {
  const entries = reviewedFixture(); entries[1].wikidataId = entries[0].wikidataId
  assert.throws(() => validateReviewedEntries(entries), /Duplicate/)
  assert.throws(() => validateReviewedEntries(reviewedFixture().slice(0,14)), /15/)
})
test('unknown rights, restrictions or unrelated provenance require further review', () => {
  const entries = reviewedFixture(); entries[0].license = 'Unknown'
  assert.throws(() => validateReviewedEntries(entries), /Rights/)
  entries[0].license = 'CC0-1.0'; entries[0].restrictions = 'Needs permission'
  assert.throws(() => validateReviewedEntries(entries), /Rights/)
})
test('complete synthetic reviewed metadata passes structural validation without writing Cloud', () => {
  assert.equal(validateReviewedEntries(reviewedFixture()).length,15)
})

test('cloud game verifier is read-only and requires an exact room code, not SQL input', () => {
  assert.throws(()=>gameVerificationSql("ABC123';DELETE"))
  const sql=gameVerificationSql('ABC123')
  assert.ok(sql.startsWith('BEGIN READ ONLY;'))
  assert.ok(!/INSERT INTO|DELETE FROM|UPDATE public|TRUNCATE/.test(sql))
  assert.ok(sql.includes("room_code='ABC123'"))
})

test('offline import generates a single transaction; actual local SQL inserts15 approved distinct people and refuses overwrite', async () => {
  const directory = await mkdtemp('/tmp/gw-bank-test-')
  const png = fixturePng()
  const entries = reviewedFixture().map(entry => ({ ...entry, imagePath: 'image.png', imageSha256: createHash('sha256').update(png).digest('hex') }))
  const manifest = join(directory, 'reviewed.json')
  await writeFile(join(directory, 'image.png'), png)
  await writeFile(manifest, JSON.stringify({ entries }))
  const generated = await prepareQuestionImport(manifest)
  assert.equal(generated.cloudWrites, 0)
  assert.equal(generated.reviewedSubjects, 15)
  const fixture = await createGameFixture()
  try {
    await fixture.database.exec(await readFile(generated.output, 'utf8'))
    await fixture.database.exec(await readFile(join(directory, 'verify-import.sql'), 'utf8'))
    assert.equal((await fixture.database.query('SELECT count(DISTINCT celebrity_id)::int AS total FROM public.game_image_assets WHERE is_approved')).rows[0].total,15)
    await assert.rejects(prepareQuestionImport(manifest), error => error.code === 'EEXIST')
    await assert.rejects(fixture.database.exec(await readFile(generated.output, 'utf8')), /Duplicate bank subjects/)
    await fixture.database.exec('ROLLBACK')
    await fixture.database.exec('UPDATE public.celebrities SET is_approved=false')
    await assert.rejects(fixture.database.exec(await readFile(join(directory,'verify-import.sql'),'utf8')), /verification failed/)
    await fixture.database.exec('ROLLBACK')
  } finally { await fixture.close() }
})
