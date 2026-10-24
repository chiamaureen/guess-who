import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile,writeFile,mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { buildV3Candidates } from './lib/test-bank-v3.mjs'
import { selectDemoBank,demoImageBlockers,summarizeDemoBank } from './lib/demo-bank-v3.mjs'
import { makeV3SeedSql,planV3Seed } from './lib/test-bank-v3-seed.mjs'
import { validateReviewedEntries,prepareQuestionImport } from './prepare-question-import.mjs'
import { createGameFixture,fixturePng } from '../supabase/tests/game-fixture.mjs'
import { identifyLicense } from './lib/question-license.mjs'
const scope=JSON.parse(await readFile(new URL('../data/question-bank/test-bank-v3-scope.json',import.meta.url),'utf8'))
const selection=JSON.parse(await readFile(new URL('../data/question-bank/test-bank-v3-demo-scope.json',import.meta.url),'utf8'))
const bank=()=>({ entries: buildV3Candidates(scope) })
const category='10000000-0000-4000-8000-000000000004'
async function syntheticImport(transform = () => {}) {
  const directory=await mkdtemp('/tmp/gw-demo-import-')
  const bytes=fixturePng()
  await writeFile(join(directory,'fixture.png'),bytes)
  const entries=Array.from({ length: 15 },(_,index)=>({
    wikidataId: `Q${89000000+index}`,nameZh: `LOCAL SYNTHETIC DEMO ${index}`,license: 'CC0',restrictions: '',
    source: 'https://commons.wikimedia.org/wiki/File:LOCAL_FIXTURE.png',imageUrl: 'https://upload.wikimedia.org/LOCAL_FIXTURE.png',
    author: 'LOCAL FIXTURE ONLY',attribution: 'Synthetic review; not a real subject approval',categoryIds: [category],
    imagePath: 'fixture.png',imageSha256: createHash('sha256').update(bytes).digest('hex'),approved: true,
    review: { rights: true,image: true,subject: true,reviewedBy: 'LOCAL SYNTHETIC FIXTURE ONLY',reviewedAt: '2026-10-24T00:00:00Z' },
  }))
  transform(entries)
  const manifest=join(directory,'reviewed.json')
  await writeFile(manifest,JSON.stringify({ entries }))
  const prepared=await prepareQuestionImport(manifest,{ idempotent: true })
  return { entries,directory,prepared,sql: await readFile(prepared.output,'utf8'),rollback: await readFile(join(directory,'rollback-import.sql'),'utf8') }
}

test('Demo selection is exactly8x15, reuses athlete identities and preserves all60 deferred candidates',()=>{
  const original=bank()
  const before=JSON.stringify(original)
  const result=selectDemoBank(original,selection)
  assert.equal(result.selected.length,120); assert.equal(result.deferred.length,60)
  assert.equal(new Set([...result.selected,...result.deferred].map(entry=>entry.id)).size,180)
  assert.ok(summarizeDemoBank(result.selected).every(group=>group.selected===15&&group.approved===0))
  assert.equal(JSON.stringify(original),before)
  const changed=structuredClone(selection); changed.selectedGroups.athletes[0]='morgan-freeman'
  assert.throws(()=>selectDemoBank(original,changed))
})

test('Missing photos, custom Attribution labels and copyrighted characters never become approved from URLs or CC metadata',()=>{
  const entry=selectDemoBank(bank(),selection).selected[0]
  assert.deepEqual(demoImageBlockers(entry),['MISSING_IMAGE'])
  entry.image={ author: 'Source author',license: 'Attribution' }
  assert.ok(demoImageBlockers(entry).includes('UNSUPPORTED_OR_UNVERIFIED_LICENSE'))
  entry.group='animated-characters'; entry.image.license='Public domain'
  assert.deepEqual(demoImageBlockers(entry),['CHARACTER_RIGHTS_CLEARANCE_REQUIRED'])
})

test('Official CC0 deed and HTTP links canonicalize without accepting misleading domains or custom licenses',()=>{
  assert.equal(identifyLicense('CC0','http://creativecommons.org/publicdomain/zero/1.0/deed.en').url,'https://creativecommons.org/publicdomain/zero/1.0/')
  assert.equal(identifyLicense('CC BY 4.0','https://creativecommons.org/licenses/by/4.0/deed.zh_TW'),null)
  assert.equal(identifyLicense('CC0','https://creativecommons.org.evil.invalid/publicdomain/zero/1.0/'),null)
  assert.equal(identifyLicense('Attribution','https://creativecommons.org/licenses/by/4.0/'),null)
})

test('Existing pending Seed supports120 selected subjects idempotently with rollback, never enabling formal people',async()=>{
  const fixture=await createGameFixture()
  try {
    for (const draft of ['20261024160000_add_youtubers_category.sql','20261024161000_test_bank_candidates.sql']) await fixture.database.exec(await readFile(new URL(`../supabase/migration-drafts/${draft}`,import.meta.url),'utf8'))
    const current=bank(); const ids=selectDemoBank(current,selection).selected.map(entry=>entry.id)
    const snapshot={ projectRef: 'fgvajdnzrnptdjurhjfo',checkedAt: new Date().toISOString(),categories: [],celebrities: [],stagingExists: true,staged: [] }
    assert.equal(planV3Seed(current,snapshot,ids).pendingStagingInserts,120)
    assert.throws(()=>makeV3SeedSql(current,undefined,ids.slice(1)))
    const sql=makeV3SeedSql(current,undefined,ids)
    await fixture.database.exec(sql.seed); await fixture.database.exec(sql.seed)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.question_bank_candidates')).rows[0].total,120)
    await fixture.database.exec(sql.rollback)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.question_bank_candidates')).rows[0].total,0)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,0)
  } finally { await fixture.close() }
})

test('Formal importer remains fail-closed for unreviewed characters and persists separate character rights evidence',async()=>{
  const sample=await syntheticImport()
  sample.entries[0].subjectType='fictional_character'
  assert.throws(()=>validateReviewedEntries(sample.entries),/Character copyright/)
  sample.entries[0].approved=false
  assert.throws(()=>validateReviewedEntries(sample.entries),/Unreviewed/)
})

test('Reviewed importer explicit idempotent mode reruns without duplicates and rollback preserves pre-existing Q76/Q22686-like people',async()=>{
  const sample=await syntheticImport()
  const fixture=await createGameFixture()
  try {
    const personInsert="INSERT INTO public.celebrities(wikidata_id,name_zh,subject_type,image_url,image_source,image_author,image_license,image_attribution,is_approved) VALUES($1,$2,'real_person','https://fixture.invalid/photo.png','https://fixture.invalid/source','LOCAL','CC0','LOCAL',true)"
    await fixture.database.query(personInsert,['Q76','LOCAL PRESERVED Q76'])
    await fixture.database.query(personInsert,['Q22686','LOCAL PRESERVED Q22686'])
    for (const qid of ['Q76','Q22686']) {
      const person=(await fixture.database.query('SELECT id FROM public.celebrities WHERE wikidata_id=$1',[qid])).rows[0]
      await fixture.database.query('INSERT INTO public.celebrity_categories(celebrity_id,category_id) VALUES($1,$2)',[person.id,category])
      await fixture.database.query('INSERT INTO public.game_image_assets(celebrity_id,png,is_approved) VALUES($1,$2,true)',[person.id,fixturePng()])
    }
    await fixture.database.exec(sample.sql); await fixture.database.exec(sample.sql)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,17)
    await fixture.database.exec(await readFile(join(sample.directory,'verify-import.sql'),'utf8'))
    await fixture.database.exec(sample.rollback); await fixture.database.exec(sample.rollback)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,2)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.game_image_assets WHERE is_approved')).rows[0].total,2)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrity_categories')).rows[0].total,2)
  } finally { await fixture.close() }
})

test('Idempotent importer refuses changed or disabled subjects, and forced failure rolls back every new row',async()=>{
  const sample=await syntheticImport(); const fixture=await createGameFixture()
  try {
    await assert.rejects(fixture.database.exec(sample.sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')))
    await fixture.database.exec('ROLLBACK')
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,0)
    await fixture.database.exec(sample.sql)
    await fixture.database.exec('UPDATE public.celebrities SET is_approved=false')
    await assert.rejects(fixture.database.exec(sample.sql),/never overwrite/)
    await fixture.database.exec('ROLLBACK')
    await assert.rejects(fixture.database.exec(sample.rollback),/refuse rollback/)
    await fixture.database.exec('ROLLBACK')
  } finally { await fixture.close() }
})

test('Rollback refuses any imported subject referenced by room_questions or C-history and never deletes game history',async()=>{
  const sample=await syntheticImport(); const fixture=await createGameFixture()
  try {
    await fixture.database.exec(sample.sql)
    await fixture.rpc('room','host-session',{ mode: 'bootstrap',host_hash: 'a'.repeat(64) })
    await fixture.rpc('room','create-room',{ host_hash: 'a'.repeat(64),room_token_hash: 'b'.repeat(64),room_code: 'DEMO15',category_ids: [category] })
    await fixture.rpc('game','start-game',{ host_hash: 'a'.repeat(64),room_token_hash: 'b'.repeat(64),room_code: 'DEMO15' })
    await assert.rejects(fixture.database.exec(sample.rollback),/refuse rollback/)
    await fixture.database.exec('ROLLBACK')
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.room_questions')).rows[0].total,1)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.host_question_history')).rows[0].total,1)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,15)
  } finally { await fixture.close() }
})

test('Rebuilding an equivalent reviewed batch safely reuses existing rows and its new receipt cannot roll back the original batch',async()=>{
  const first=await syntheticImport(); const second=await syntheticImport()
  const fixture=await createGameFixture()
  try {
    await fixture.database.exec(first.sql); await fixture.database.exec(second.sql)
    await fixture.database.exec(await readFile(join(second.directory,'verify-import.sql'),'utf8'))
    await fixture.database.exec(second.rollback)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,15)
    await fixture.database.exec(first.rollback)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,0)
  } finally { await fixture.close() }
})

test('Explicit original-fictional-character rights are preserved and dollar-tag source strings cannot escape the import block',async()=>{
  const sample=await syntheticImport(entries=>{
    const entry=entries[0]
    entry.nameZh="LOCAL '$import$ CHARACTER"
    entry.subjectType='fictional_character'
    entry.rights={author:entry.author,source:entry.source,attribution:entry.attribution,licenseName:'CC0',licenseVersion:'1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',modifications:'Synthetic code-generated pixels; not an existing copyrighted character',originalNotices:'Original local fixture only',evidenceUrl:'https://commons.wikimedia.org/wiki/File:LOCAL_FIXTURE.png',checkedAt:'2026-10-24T00:00:00Z',presentation:'host-and-after-reveal',presentationReviewed:true,characterRightsReviewed:true,characterRightsBasis:'LOCAL ORIGINAL SYNTHETIC FIXTURE ONLY',characterRightsEvidenceUrl:'https://commons.wikimedia.org/wiki/File:LOCAL_FIXTURE.png'}
  })
  const fixture=await createGameFixture()
  try {
    await fixture.database.exec(sample.sql)
    const row=(await fixture.database.query('SELECT subject_type,image_attribution FROM public.celebrities WHERE wikidata_id=$1',[sample.entries[0].wikidataId])).rows[0]
    assert.equal(row.subject_type,'fictional_character')
    assert.equal(JSON.parse(row.image_attribution).characterRightsBasis,'LOCAL ORIGINAL SYNTHETIC FIXTURE ONLY')
    await fixture.database.exec(sample.rollback)
  } finally { await fixture.close() }
})
