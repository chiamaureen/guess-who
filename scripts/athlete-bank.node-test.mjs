import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildAthleteCandidates, collectAthleteMetadata, summarizeAthleteReview, filterAthleteImageCandidates } from './prepare-athlete-review.mjs'
import { planAthleteChanges, renderAthleteCatalog } from './plan-athlete-bank.mjs'
import { createGameFixture } from '../supabase/tests/game-fixture.mjs'

const scope = JSON.parse(await readFile(new URL('../data/question-bank/athletes-v2-scope.json', import.meta.url), 'utf8'))
const candidates = () => ({ entries: buildAthleteCandidates(scope), failures: [], preparedAt: '2026-10-24T00:00:00Z' })
const impact = () => ({
  categories: scope.preserveCategories.map(slug => ({ slug, is_active: true })),
  politicians: ['Q11613', 'Q12325', 'Q207', 'Q22686', 'Q23505', 'Q34836', 'Q35648', 'Q76', 'Q91', 'Q9582', 'Q9588', 'Q9640', 'Q9696', 'Q9916', 'Q9960'].map(wikidata_id => ({ wikidata_id, is_approved: true, categories: ['politicians'] })),
  existing_subjects: [], counts: { playing_rooms: 0 },
})

test('scope preserves seven categories and has35 active-NBA candidates,24 final-roster candidates and65 unique Olympians', () => {
  const summary = summarizeAthleteReview(candidates())
  assert.equal(scope.preserveCategories.length, 7)
  assert.deepEqual(Object.values(summary.groups), [35, 24, 65])
  assert.equal(summary.candidates, 124)
  assert.equal(new Set(buildAthleteCandidates(scope).map(entry => entry.name)).size, 124)
  assert.equal(summary.importReady, 0)
})

test('all candidates remain unapproved and CAPTCHA is not reported as a verified Google first result', () => {
  for (const entry of candidates().entries) {
    assert.equal(entry.approved, false)
    assert.deepEqual([entry.review.subject, entry.review.rights, entry.review.image], [false, false, false])
    assert.equal(entry.google.firstResultVerified, false)
    assert.equal(entry.google.status, entry.name === 'LeBron James' ? 'BLOCKED_CAPTCHA' : 'NOT_ATTEMPTED_PROVIDER_BLOCKED')
  }
})

test('homonyms cannot acquire an automatic image or QID from Wikipedia', async () => {
  const requests = []
  const bank = await collectAthleteMetadata(scope, async url => {
    requests.push(url)
    return { query: { pages: [] }, entities: {} }
  })
  for (const name of ['林柏佑', '吳瑞璁']) {
    const entry = bank.entries.find(person => person.name === name)
    assert.equal(entry.wikidataId, null)
    assert.equal(entry.imageUrl, null)
    assert.ok(!requests.some(url => url.searchParams.get('titles')?.split('|').includes(name)))
  }
  assert.ok(bank.entries.some(entry => entry.name === '吳丞顥'))
  assert.ok(bank.entries.some(entry => entry.name === '吳承皓'))
})

test('public metadata failures remain blocked without approval or Cloud writes', async () => {
  const bank = await collectAthleteMetadata(scope, async () => { throw new Error('offline') })
  assert.ok(bank.failures.length > 0)
  assert.equal(bank.cloudWrites, 0)
  assert.equal(summarizeAthleteReview(bank).importReady, 0)
})

test('missing review blocks the entire mutation preview instead of disabling the only playable bank', () => {
  const preview = planAthleteChanges(candidates(), impact())
  assert.equal(preview.status, 'BLOCKED')
  assert.deepEqual(Object.values(preview.executableChanges), [0, 0, 0, 0])
  assert.equal(preview.pendingMaximumEstimate.celebritiesDeactivate, 15)
  assert.equal(preview.sqlGenerated, false)
})

test('shared-category politicians and changed category snapshot are blocked', () => {
  const snapshot = impact()
  snapshot.politicians[0].categories.push('historical-figures')
  snapshot.categories.pop()
  const preview = planAthleteChanges(candidates(), snapshot)
  assert.ok(preview.blockers.includes('SHARED_OR_CHANGED_POLITICIAN'))
  assert.ok(preview.blockers.includes('CATEGORY_SNAPSHOT_CHANGED'))
})

test('politician set drift and active games require another review, not room closure or deletion', () => {
  const snapshot = impact()
  snapshot.politicians.pop()
  snapshot.counts.playing_rooms = 1
  const preview = planAthleteChanges(candidates(), snapshot)
  assert.ok(preview.blockers.includes('POLITICIAN_SET_CHANGED'))
  assert.ok(preview.blockers.includes('DEACTIVATION_REQUIRES_SAFE_GAME_BOUNDARY_RECHECK'))
  assert.ok(preview.preserved.includes('rooms'))
  assert.ok(preview.preserved.includes('host_question_history'))
})

test('duplicate candidate QIDs require identity review before merging, never count twice', () => {
  const bank = candidates()
  bank.entries[0].wikidataId = 'Q1'
  bank.entries[1].wikidataId = 'Q1'
  assert.ok(planAthleteChanges(bank, impact()).blockers.includes('DUPLICATE_QID_REQUIRES_REVIEWED_MERGE'))
})

test('existing subjects are never overwritten and foreign categories cannot enter athlete batch', () => {
  const bank = candidates()
  bank.entries[0].review = { subject: true, rights: true, image: true }
  bank.entries[0].wikidataId = 'Q1'
  bank.entries[0].categoryIds.push('10000000-0000-4000-8000-000000000004')
  const snapshot = impact()
  snapshot.existing_subjects.push({ wikidata_id: 'Q1' })
  const preview = planAthleteChanges(bank, snapshot)
  assert.ok(preview.blockers.includes('EXISTING_SUBJECT_CONFLICT_NO_OVERWRITE'))
  assert.ok(preview.blockers.includes('ATHLETE_CATEGORY_MISMATCH'))
})

test('candidate catalog strips raw HTML and marks missing images instead of fabricating provenance', () => {
  const bank = candidates()
  bank.entries[0].authorHtml = '<a href="https://example.com/">Test | author</a>'
  const catalog = renderAthleteCatalog(bank)
  assert.ok(!catalog.includes('<a'))
  assert.ok(catalog.includes('Test \\| author'))
  assert.ok(catalog.includes('缺候選'))
  assert.ok(catalog.includes('未審核'))
})

test('public-domain PDFs are rejected as non-photo results without discarding the rejection evidence', () => {
  const bank = candidates()
  Object.assign(bank.entries[0], { filename: 'Government Gazette.pdf', imageUrl: 'https://example.invalid/gazette.pdf', license: 'Public domain' })
  filterAthleteImageCandidates(bank, scope)
  assert.equal(bank.entries[0].imageUrl, null)
  assert.equal(bank.entries[0].rejectedImageCandidates[0].license, 'Public domain')
  assert.equal(bank.entries[0].rejectedImageCandidates[0].reason, 'NOT_A_RASTER_PORTRAIT')
  assert.equal(summarizeAthleteReview(bank).importReady, 0)
})

test('a licensed image of an actor with the same name cannot become the NBA player photo', () => {
  const bank = candidates()
  const entry = bank.entries.find(person => person.name === 'Anthony Edwards')
  Object.assign(entry, { filename: 'Anthony Edwards 2018 - 1 in 6 181029-F-VX890-1029 (cropped).jpg', imageUrl: 'https://example.invalid/actor.jpg', license: 'Public domain' })
  filterAthleteImageCandidates(bank, scope)
  assert.equal(entry.imageUrl, null)
  assert.ok(entry.rejectedImageCandidates[0].reason.includes('不是NBA'))
  assert.equal(entry.approved, false)
})

test('impact audit is read-only and excludes credentials, question IDs and image bytes', async () => {
  const sql = await readFile(new URL('../supabase/tests/review_athlete_bank_v2.sql', import.meta.url), 'utf8')
  assert.ok(sql.startsWith('BEGIN READ ONLY;'))
  assert.ok(sql.trimEnd().endsWith('ROLLBACK;'))
  assert.ok(!/\b(UPDATE|INSERT|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(sql))
  assert.ok(!/credential_hash|host_token_hash|session_token_hash|asset\.png/i.test(sql))
})

test('link-only verifier is read-only, retains old people and does not mistake metadata for a playable game', async () => {
  const sql = await readFile(new URL('../supabase/tests/verify_athlete_links_v2.sql', import.meta.url), 'utf8')
  assert.ok(sql.startsWith('BEGIN READ ONLY;'))
  assert.ok(!/\b(UPDATE|INSERT|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/i.test(sql))
  const fixture = await createGameFixture()
  try {
    await assert.rejects(fixture.database.exec(sql), /Original politicians/)
    await fixture.database.exec('ROLLBACK')
    for (const person of impact().politicians) {
      await fixture.database.query(`INSERT INTO public.celebrities(wikidata_id,name_zh,subject_type,image_url,image_source,image_author,image_license,image_attribution,is_approved)
        VALUES($1,'LOCAL TEST ONLY','real_person','https://fixture.invalid/image','https://fixture.invalid/source','Synthetic fixture','CC0','LOCAL TEST ONLY',false)`, [person.wikidata_id])
    }
    await assert.rejects(fixture.database.exec(sql), /draft metadata not found/)
    await fixture.database.exec('ROLLBACK')
    await fixture.database.exec(`INSERT INTO public.celebrities(name_zh,subject_type,image_url,image_source,image_author,image_license,image_attribution,is_approved)
      VALUES('LOCAL LINK ONLY','real_person','https://upload.wikimedia.org/LOCAL_TEST.jpg','https://commons.wikimedia.org/wiki/File:LOCAL_TEST.jpg','Synthetic fixture','CC0','LOCAL TEST ONLY',false);
      INSERT INTO public.celebrity_categories(celebrity_id,category_id)
      SELECT id,'10000000-0000-4000-8000-000000000003'::uuid FROM public.celebrities WHERE wikidata_id IS NULL;`)
    await fixture.database.exec(sql)
    assert.equal((await fixture.database.query('SELECT count(*)::integer AS total FROM public.celebrities')).rows[0].total, 16)
    assert.equal((await fixture.database.query('SELECT count(*)::integer AS total FROM public.game_image_assets')).rows[0].total, 0)
    await fixture.database.exec("UPDATE public.celebrities SET is_approved=true WHERE wikidata_id IS NULL")
    await assert.rejects(fixture.database.exec(sql), /draft metadata not found/)
    await fixture.database.exec('ROLLBACK')
  } finally { await fixture.close() }
})

test('link-only preview never schedules binary image inserts or a premature active-pool switch', () => {
  const preview = planAthleteChanges(candidates(), impact())
  assert.equal(preview.imageStorageMode, 'link-only')
  assert.equal(preview.pendingMaximumEstimate.privateImagesInsert, 0)
  assert.ok(preview.blockers.includes('LINK_ONLY_IMAGES_NOT_SUPPORTED_BY_DEPLOYED_GAME_ENGINE'))
  assert.equal(preview.executableChanges.celebritiesDeactivate, 0)
  assert.equal(preview.sqlGenerated, false)
})
