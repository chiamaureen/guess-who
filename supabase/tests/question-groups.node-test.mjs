import assert from 'node:assert/strict'
import { before,after,beforeEach,test } from 'node:test'
import { readFile,mkdtemp,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { prepareQuestionImport } from '../../scripts/prepare-question-import.mjs'
import { createGameFixture,seedGameFixtures,fixturePng } from './game-fixture.mjs'
import { createRoomHandler,RoomError } from '../functions/room-system/handler.ts'
import { nonce,hashToken } from '../functions/room-system/crypto.ts'

const group='20000000-0000-4000-8000-000000000003'
const secondGroup='20000000-0000-4000-8000-000000000004'
let fixture,database,handler
const rpc=async(action,input)=>database.transaction(async transaction=>{
  await transaction.exec('SET LOCAL ROLE service_role')
  try { return (await transaction.query('SELECT public.room_group_action($1,$2::jsonb) AS data',[action,JSON.stringify(input)])).rows[0].data }
  catch(error) { throw new RoomError(error.code==='P0001'?error.message:'INTERNAL_ERROR') }
})
const request=async(action,input,headers={})=>{
  const response=await handler(new Request(`https://edge.invalid/${action}`,{method:'POST',headers:{origin:fixture.config.origins[0],apikey:'sb_publishable_fixture','content-type':'application/json',...headers},body:JSON.stringify(input)}))
  return {status:response.status,...await response.json()}
}
const identity=async()=>{
  const {data}=await request('host-session',{mode:'bootstrap',bootstrapKey:nonce()})
  return {headers:{'x-host-credential':data.credential},hash:await hashToken('host',data.credential)}
}
before(async()=>{
  fixture=await createGameFixture();database=fixture.database
  if(!(await database.query("SELECT to_regclass('public.question_groups') AS existing")).rows[0].existing) {
    await database.exec(await readFile(new URL('../migration-drafts/20261024160000_add_youtubers_category.sql',import.meta.url),'utf8'))
    await database.exec(await readFile(new URL('../migration-drafts/20261025010000_question_groups.sql',import.meta.url),'utf8'))
  }
  handler=createRoomHandler(fixture.config,{rateLimit:input=>fixture.rpc('rate','',input),action:(action,input)=>fixture.rpc('room',action,input),groupAction:rpc})
})
beforeEach(async()=>{
  await database.exec('DELETE FROM public.room_question_groups;DELETE FROM public.celebrity_question_groups;DELETE FROM public.host_question_history;DELETE FROM public.room_questions;DELETE FROM public.rooms;DELETE FROM public.game_image_assets;DELETE FROM public.celebrities;DELETE FROM public.hosts;DELETE FROM public.room_api_rate_limits;')
  await seedGameFixtures(database)
  await database.exec(`INSERT INTO public.celebrity_question_groups SELECT id,'${group}'::uuid FROM public.celebrities WHERE right(id::text,12)::bigint<=15;INSERT INTO public.celebrity_question_groups SELECT id,'${secondGroup}'::uuid FROM public.celebrities WHERE right(id::text,12)::bigint>15`)
})
after(async()=>fixture?.close())
test('eight groups preserve original categories and expose only host-aware counts',async()=>{
  const host=await identity();const result=await request('get-question-groups',{},host.headers)
  assert.equal(result.status,200);assert.equal(result.data.groups.length,8)
  assert.equal(result.data.groups.find(entry=>entry.id===group).available,15)
  assert.equal(result.data.groups.find(entry=>entry.id===group).selectable,true)
  assert.equal(result.data.groups.find(entry=>entry.slug==='taiwan-youtubers').selectable,false)
  assert.ok(!/hash|gw_|隔離測試人物|PRIVATE ANSWER|celebrity_id/.test(JSON.stringify(result)))
})
test('group selection creates derived categories atomically and retries do not create duplicate rooms',async()=>{
  const host=await identity();const input={groupIds:[group],requestKey:nonce()}
  const first=await request('create-room',input,host.headers);const repeated=await request('create-room',input,host.headers)
  assert.equal(first.status,200);assert.equal(first.data.room.id,repeated.data.room.id)
  assert.deepEqual(first.data.categories.map(entry=>entry.slug),['singers'])
  assert.equal((await database.query('SELECT count(*)::int AS total FROM public.room_question_groups')).rows[0].total,1)
  const changed=await request('create-room',{...input,groupIds:[secondGroup]},host.headers)
  assert.equal(changed.error.code,'IDEMPOTENCY_CONFLICT')
})
test('disabled or under15 groups fail before creating any room; mixed category and group input rejected',async()=>{
  const host=await identity()
  for(const groupIds of [[],[group,group],['20000000-0000-4000-8000-000000000001'],['20000000-0000-4000-8000-000000000007']]) {
    assert.notEqual((await request('create-room',{groupIds,requestKey:nonce()},host.headers)).status,200)
  }
  assert.equal((await request('create-room',{groupIds:[group],categoryIds:[],requestKey:nonce()},host.headers)).status,400)
  assert.equal((await database.query('SELECT count(*)::int AS total FROM public.rooms')).rows[0].total,0)
})
test('group-aware drawing completes exactly15 unique people without selecting another group; history disables that group',async()=>{
  const host=await identity();const created=await request('create-room',{groupIds:[group],requestKey:nonce()},host.headers)
  const input={host_hash:host.hash,room_token_hash:await hashToken('room',created.data.hostToken),room_code:created.data.room.code}
  let state=await fixture.rpc('game','start-game',input)
  for(let number=1;number<=15;number++) {
    assert.equal(state.question.number,number)
    state=await fixture.rpc('game','reveal-answer',{...input,question_id:state.question.id})
    if(number<15) state=await fixture.rpc('game','next-question',{...input,question_id:state.question.id})
  }
  await assert.rejects(fixture.rpc('game','next-question',{...input,question_id:state.question.id}),error=>error.code==='LAST_QUESTION')
  await fixture.rpc('game','finish-game',{...input,question_id:state.question.id})
  const stats=(await database.query('SELECT count(DISTINCT celebrity_id)::int AS people,max(right(celebrity_id::text,12)::bigint)::int AS largest FROM public.room_questions')).rows[0]
  assert.deepEqual(stats,{people:15,largest:15})
  const options=await request('get-question-groups',{},host.headers)
  assert.equal(options.data.groups.find(entry=>entry.id===group).available,0)
  assert.equal(options.data.groups.find(entry=>entry.id===secondGroup).available,15)
  const retry=await request('create-room',{groupIds:[group],requestKey:nonce()},host.headers)
  assert.equal(retry.error.code,'INSUFFICIENT_QUESTIONS')
  assert.equal((await request('get-question-groups',{},(await identity()).headers)).data.groups.find(entry=>entry.id===group).available,15)
})
test('Player and forged credentials cannot fetch host group options or create rooms',async()=>{
  assert.equal((await request('get-question-groups',{}, {'x-host-credential':`gw_host_${nonce()}`})).status,401)
  assert.equal((await request('get-question-groups',{})).status,401)
})
test('new tables and RPCs deny browser roles despite platform default grants',async()=>{
  for(const role of ['anon','authenticated']) {
    for(const table of ['question_groups','celebrity_question_groups','room_question_groups']) {
      assert.equal((await database.query(`SELECT has_table_privilege($1,$2,'SELECT') AS allowed`,[role,`public.${table}`])).rows[0].allowed,false)
    }
    await assert.rejects(database.transaction(async transaction=>{
      await transaction.exec(`SET LOCAL ROLE ${role}`)
      await transaction.query("SELECT public.room_group_action('get-question-groups','{}'::jsonb)")
    }),error=>error.code==='42501')
  }
  const functions=(await database.query("SELECT prosecdef,proconfig FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pronamespace WHERE nspname='public' AND proname IN ('room_group_action','game_engine_group_eligible')")).rows
  assert.ok(functions.every(entry=>!entry.prosecdef&&entry.proconfig.includes('search_path=""')))
})
test('group-aware seed is transactional, idempotent, verifies memberships and rolls back only its unused rows',async()=>{
  const directory=await mkdtemp('/tmp/gw-group-import-')
  const png=fixturePng()
  await writeFile(`${directory}/image.png`,png)
  const entries=Array.from({length:15},(_,index)=>({wikidataId:`Q990010${String(index).padStart(2,'0')}`,nameZh:`LOCAL GROUP IMPORT ONLY ${index}`,subjectType:'real_person',license:'CC0',restrictions:'',source:'https://commons.wikimedia.org/wiki/File:LOCAL_TEST_ONLY.png',imageUrl:'https://upload.wikimedia.org/LOCAL_TEST_ONLY.png',author:'LOCAL SYNTHETIC FIXTURE',attribution:'Synthetic fixture; not real rights approval',categoryIds:['10000000-0000-4000-8000-000000000002'],groupIds:[group],imagePath:'image.png',imageSha256:createHash('sha256').update(png).digest('hex'),approved:true,review:{rights:true,image:true,subject:true,reviewedBy:'LOCAL TEST ONLY',reviewedAt:'2026-10-25T00:00:00Z'}}))
  await writeFile(`${directory}/reviewed.json`,JSON.stringify({entries}))
  const receipt=await prepareQuestionImport(`${directory}/reviewed.json`,{idempotent:true})
  assert.equal(receipt.totalRows,60)
  const sql=await readFile(receipt.output,'utf8')
  await database.exec(sql);await database.exec(sql)
  await database.exec(await readFile(`${directory}/verify-import.sql`,'utf8'))
  assert.equal((await database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,45)
  await database.exec(await readFile(`${directory}/rollback-import.sql`,'utf8'))
  assert.equal((await database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total,30)
  await database.exec(sql)
  await database.exec(`DELETE FROM public.celebrity_question_groups WHERE celebrity_id=(SELECT id FROM public.celebrities WHERE wikidata_id='Q99001000')`)
  await assert.rejects(database.exec(sql),/differs/)
  await database.exec('ROLLBACK')
})
