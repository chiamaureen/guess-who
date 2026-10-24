import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { buildV3Candidates, validateV3Candidates, summarizeV3, collectV3Metadata, groupTargets } from './lib/test-bank-v3.mjs'
import { candidatePayload, planV3Seed, makeV3SeedSql } from './lib/test-bank-v3-seed.mjs'
import { createGameFixture, seedGameFixtures, actor } from '../supabase/tests/game-fixture.mjs'
import { hashToken, nonce } from '../supabase/functions/room-system/crypto.ts'

const scope = JSON.parse(await readFile(new URL('../data/question-bank/test-bank-v3-scope.json', import.meta.url), 'utf8'))
const catalog = JSON.parse(await readFile(new URL('../data/question-bank/test-bank-v3-catalog.json', import.meta.url), 'utf8'))
const bank = () => ({ version: 3, entries: buildV3Candidates(scope) })
const draft = name => readFile(new URL(`../supabase/migration-drafts/${name}`, import.meta.url), 'utf8')
async function setup() {
  const fixture = await createGameFixture()
  await fixture.database.exec(await draft('20261024160000_add_youtubers_category.sql'))
  await fixture.database.exec(await draft('20261024161000_test_bank_candidates.sql'))
  return fixture
}
async function snapshot(fixture) {
  return { projectRef: 'fgvajdnzrnptdjurhjfo', environment: 'local-isolated-fixture', checkedAt: new Date().toISOString(), stagingExists: true,
    categories: (await fixture.database.query('SELECT id,slug,is_active FROM public.categories')).rows,
    celebrities: (await fixture.database.query("SELECT person.id,person.wikidata_id,person.name_zh,person.name_en,person.is_approved,ARRAY(SELECT category.slug FROM public.celebrity_categories AS membership JOIN public.categories AS category ON category.id=membership.category_id WHERE membership.celebrity_id=person.id) AS categories,(SELECT count(*)::int FROM public.game_image_assets AS image WHERE image.celebrity_id=person.id AND image.is_approved) AS approved_assets FROM public.celebrities AS person")).rows,
    staged: (await fixture.database.query('SELECT id,identity_key,wikidata_id,category_slug,group_slug FROM public.question_bank_candidates')).rows,
  }
}
async function totals(database) {
  return (await database.query('SELECT (SELECT count(*)::int FROM public.celebrities) AS people,(SELECT count(*)::int FROM public.game_image_assets) AS images,(SELECT count(*)::int FROM public.rooms) AS rooms,(SELECT count(*)::int FROM public.room_questions) AS questions,(SELECT count(*)::int FROM public.host_question_history) AS history')).rows[0]
}

test('v3 contains exactly180 globally distinct people/characters with the requested eight counts and stable independent IDs', () => {
  const entries = bank().entries
  assert.deepEqual(summarizeV3(bank()).map(group => group.candidates), [15,15,30,30,30,15,15,30])
  assert.equal(entries.length, 180)
  assert.equal(new Set(entries.map(entry => entry.id)).size, 180)
  assert.equal(entries.filter(entry => entry.category === 'scientists' || entry.category === 'historical-figures').length, 0)
  assert.equal(entries.filter(entry => entry.category === 'youtubers').length, 15)
  assert.ok(entries.every(entry => !entry.approved && entry.sources.length))
  validateV3Candidates(catalog.entries.map(entry => ({ ...entry, image: null })))
  assert.equal(new Set(catalog.entries.map(entry => entry.wikidataId)).size, 180)
  assert.ok(catalog.entries.every(entry => /^Q[1-9]\d*$/.test(entry.wikidataId)))
  assert.deepEqual(catalog.entries.map(({ id, nameZh, nameOriginal, category, group }) => ({ id, nameZh, nameOriginal, category, group })), entries.map(({ id, nameZh, nameOriginal, category, group }) => ({ id, nameZh, nameOriginal, category, group })))
  const changed = structuredClone(scope); changed.groups[0].subjects[0][1] += '（別名）'
  assert.equal(buildV3Candidates(changed)[0].id, entries[0].id)
})

test('duplicate identity/QID, altered group counts, wrong YouTuber category and approval flags fail closed', () => {
  for (const change of [entries => { entries[1].identityKey = entries[0].identityKey }, entries => { entries[0].wikidataId = 'Q1'; entries[1].wikidataId = 'Q1' }, entries => { entries[0].approved = true }, entries => { entries.find(entry => entry.group === 'taiwan-youtubers').category = 'scientists' }, entries => { entries.pop() }]) {
    const entries = bank().entries; change(entries)
    assert.throws(() => validateV3Candidates(entries))
  }
})

test('athlete reuse preserves original evidence and prepared file references but never inherits approval', async () => {
  const athletes = bank().entries.filter(entry => entry.group === 'athletes')
  const evidence = athletes.map((entry, index) => ({ name: entry.nameOriginal, wikidataId: `Q${9000 + index}`, source: 'https://commons.wikimedia.org/wiki/File:LOCAL.jpg', person: { revision: 123 }, commons: { evidenceUrl: 'https://commons.wikimedia.org/w/index.php?oldid=123', image: { url: 'https://upload.wikimedia.org/LOCAL.jpg', sha1: 'a'.repeat(40), extmetadata: { Artist: { value: 'Synthetic author' }, LicenseShortName: { value: 'CC0' } } } } }))
  const assets = athletes.map(entry => ({ name: entry.nameOriginal, imagePath: 'images/LOCAL.webp', imageSha256: 'a'.repeat(64), mimeType: 'image/webp', width: 32, height: 32, outputBytes: 100 }))
  const result = await collectV3Metadata(scope, { athleteEvidence: evidence, athleteAssets: assets, request: async () => ({ query: { pages: [] } }) })
  assert.equal(result.entries.filter(entry => entry.preparedAsset).length, 30)
  assert.ok(result.entries.every(entry => !entry.approved && !entry.review.rights))
})

test('fresh checkout without ignored athlete assets still resolves athlete source candidates rather than silently omitting the group', async () => {
  const requests = []
  const result = await collectV3Metadata(scope, { request: async url => { requests.push(url); return { query: { pages: [] } } } })
  assert.ok(requests.some(url => url.searchParams.get('titles')?.split('|').includes('LeBron James')))
  assert.equal(result.entries.filter(entry => entry.group === 'athletes').length, 30)
  assert.ok(result.entries.every(entry => !entry.approved))
  const incomplete = bank().entries; delete incomplete[0].image
  assert.throws(() => validateV3Candidates(incomplete), /INCOMPLETE/)
})

test('missing Cloud snapshot is BLOCKED, not inferred from historical local successes; malformed/staging snapshots are refused', () => {
  const plan = planV3Seed(bank())
  assert.equal(plan.status, 'BLOCKED_CLOUD_DUPLICATE_CHECK')
  assert.ok(plan.groups.every(group => group.playableNewHost === null))
  assert.throws(() => planV3Seed(bank(), { projectRef: 'wrong' }))
  assert.throws(() => planV3Seed(bank(), { projectRef: 'fgvajdnzrnptdjurhjfo', categories: [], celebrities: [], stagingExists: true }), /STAGING/)
  assert.throws(() => planV3Seed(bank(), { projectRef: 'fgvajdnzrnptdjurhjfo', categories: [], celebrities: [], checkedAt: '2020-01-01T00:00:00Z' }), /FRESH/)
})

test('new category draft is repeatable, inactive, preserves all seven categories and has no scientists remapping', async () => {
  const fixture = await setup()
  try {
    await fixture.database.exec(await draft('20261024160000_add_youtubers_category.sql'))
    const categories = (await fixture.database.query('SELECT slug,is_active FROM public.categories ORDER BY slug')).rows
    assert.equal(categories.length, 8)
    assert.equal(categories.find(category => category.slug === 'youtubers').is_active, false)
    assert.equal(categories.filter(category => category.slug !== 'youtubers' && category.is_active).length, 7)
    assert.equal(categories.find(category => category.slug === 'scientists').is_active, true)
  } finally { await fixture.close() }
})

test('existing QID reuse and repeatable pending seed leave people, private images, rooms, questions and C-history unchanged', async () => {
  const fixture = await setup()
  try {
    await seedGameFixtures(fixture.database, 15)
    const current = bank(); current.entries[0].wikidataId = 'Q90000001'
    await fixture.database.query("UPDATE public.celebrities SET wikidata_id='Q90000001' WHERE id='60000000-0000-4000-8000-000000000001'")
    const host = await hashToken('host', `gw_host_${nonce()}`)
    const token = await hashToken('room', `gw_room_${nonce()}`)
    await fixture.rpc('room', 'host-session', { mode: 'bootstrap', host_hash: host })
    await fixture.rpc('room', 'create-room', { host_hash: host, room_token_hash: token, room_code: 'V3TEST', category_ids: [actor] })
    await fixture.rpc('game', 'start-game', { host_hash: host, room_token_hash: token, room_code: 'V3TEST' })
    const before = await totals(fixture.database)
    const plan = planV3Seed(current, await snapshot(fixture))
    assert.equal(plan.pendingStagingInserts, 179); assert.equal(plan.existingReused, 1)
    const sql = makeV3SeedSql(current)
    await fixture.database.exec(sql.seed)
    await fixture.database.exec(sql.seed)
    assert.deepEqual(await totals(fixture.database), before)
    assert.equal((await snapshot(fixture)).staged.length, 179)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.question_bank_candidates WHERE is_approved')).rows[0].total, 0)
    assert.equal(planV3Seed(current, await snapshot(fixture)).pendingStagingInserts, 0)
    const second = makeV3SeedSql(current)
    await fixture.database.exec(second.seed)
    await fixture.database.exec(second.rollback)
    assert.equal((await snapshot(fixture)).staged.length, 179)
    await fixture.database.exec(sql.rollback)
    assert.equal((await snapshot(fixture)).staged.length, 0)
    assert.deepEqual(await totals(fixture.database), before)
  } finally { await fixture.close() }
})

test('failed pending seed rolls back the entire transaction without partial staging or game writes', async () => {
  const fixture = await setup()
  try {
    const before = await totals(fixture.database)
    const sql = makeV3SeedSql(bank())
    await assert.rejects(fixture.database.exec(sql.seed.replace('COMMIT;', 'SELECT 1/0; COMMIT;')))
    await fixture.database.exec('ROLLBACK')
    assert.equal((await snapshot(fixture)).staged.length, 0)
    assert.deepEqual(await totals(fixture.database), before)
  } finally { await fixture.close() }
})

test('rollback refuses reviewed/changed staging records and never wipes later review notes', async () => {
  const fixture = await setup()
  try {
    const sql = makeV3SeedSql(bank())
    await fixture.database.exec(sql.seed)
    await fixture.database.query("UPDATE public.question_bank_candidates SET payload=jsonb_set(payload,'{notes}','\"Human review note\"'::jsonb) WHERE id=$1", [bank().entries[0].id])
    await assert.rejects(fixture.database.exec(sql.rollback), /review changed/)
    await fixture.database.exec('ROLLBACK')
    assert.equal((await snapshot(fixture)).staged.length, 180)
    await fixture.database.exec(sql.seed)
    assert.equal((await fixture.database.query('SELECT payload->>\'notes\' AS notes FROM public.question_bank_candidates WHERE id=$1', [bank().entries[0].id])).rows[0].notes, 'Human review note')
  } finally { await fixture.close() }
})

test('private staging rejects anon/authenticated access and approval; artwork rights never become playable from metadata', async () => {
  const fixture = await setup()
  try {
    const current = bank(); current.entries.find(entry => entry.group === 'animated-characters').image = { license: 'CC BY-SA 4.0', imageUrl: 'https://fixture.invalid/cosplay.jpg' }
    await fixture.database.exec(makeV3SeedSql(current).seed)
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await fixture.database.query("SELECT has_table_privilege($1,'public.question_bank_candidates','SELECT') AS allowed", [role])).rows[0].allowed, false)
      await fixture.database.exec(`SET ROLE ${role}`)
      await assert.rejects(fixture.database.query('SELECT * FROM public.question_bank_candidates'), /permission denied/)
      await fixture.database.exec('RESET ROLE')
    }
    await assert.rejects(fixture.database.query('UPDATE public.question_bank_candidates SET is_approved=true'))
    assert.equal((await totals(fixture.database)).people, 0)
    assert.ok(summarizeV3(current, await snapshot(fixture)).every(group => group.playableNewHost === 0))
    const verification = await fixture.database.exec(await readFile(new URL('../supabase/tests/verify_test_bank_v3_staging.sql', import.meta.url), 'utf8'))
    const verificationRows = verification.flatMap(result => result.rows)
    const rls = verificationRows.find(row => Object.hasOwn(row, 'rls_enabled'))
    assert.equal(rls.rls_enabled, true)
    assert.equal(rls.rls_forced, true)
    assert.equal(Number(verificationRows.find(row => Object.hasOwn(row, 'missing_category_relations')).missing_category_relations), 0)
    assert.equal((await snapshot(fixture)).staged.length, 180)
  } finally { await fixture.close() }
})

test('SQL quoting and dollar tags withstand hostile source strings; normalized name conflicts stop, not duplicate', async () => {
  const fixture = await setup()
  try {
    const current = bank()
    current.entries[0].nameZh = "LOCAL '; DELETE FROM public.rooms; $seed$ $guard$"
    const sql = makeV3SeedSql(current)
    await fixture.database.exec(sql.seed)
    assert.equal((await snapshot(fixture)).staged.length, 180)
    await fixture.database.exec(sql.rollback)
    await seedGameFixtures(fixture.database, 1)
    await fixture.database.query("UPDATE public.celebrities SET name_en='Ｌｅｏｎａｒｄｏ　ＤｉＣａｐｒｉｏ'")
    assert.equal(planV3Seed(bank(), await snapshot(fixture)).status, 'BLOCKED_IDENTITY_CONFLICT')
    await assert.rejects(fixture.database.exec(makeV3SeedSql(bank()).seed), /identity reconciliation/)
    await fixture.database.exec('ROLLBACK')
    assert.equal((await snapshot(fixture)).staged.length, 0)
  } finally { await fixture.close() }
})

test('staging identity collisions cannot be silently overwritten, and local source paths are never seeded', async () => {
  const fixture = await setup()
  try {
    const current = bank()
    const original = current.entries[0]
    const collision = { ...candidatePayload(original), id: randomUUID() }
    await fixture.database.query("INSERT INTO public.question_bank_candidates(id,identity_key,category_slug,group_slug,payload,review_status,seed_run_id) VALUES($1,$2,$3,$4,$5,'PENDING',$6)", [collision.id, collision.identityKey, collision.category, collision.group, JSON.stringify(collision), randomUUID()])
    assert.equal(planV3Seed(current, await snapshot(fixture)).status, 'BLOCKED_IDENTITY_CONFLICT')
    await assert.rejects(fixture.database.exec(makeV3SeedSql(current).seed), /identity changed/)
    await fixture.database.exec('ROLLBACK')
    current.entries[0].preparedAsset = { path: '/LOCAL/PRIVATE/ASSET.webp', sha256: 'a'.repeat(64) }
    assert.ok(!makeV3SeedSql(current).seed.includes('/LOCAL/PRIVATE/ASSET'))
  } finally { await fixture.close() }
})
