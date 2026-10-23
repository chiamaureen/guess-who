import assert from 'node:assert/strict'
import { before, after, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createGameFixture, seedGameFixtures, fixturePng, pngChunk, actor, singer, gameMigration } from './game-fixture.mjs'
import { hashToken, nonce } from '../functions/room-system/crypto.ts'
import { createGameHandler } from '../functions/game-engine/handler.ts'

let fixture
let database
const origin = 'http://localhost:5173'
const scalar = async (sql, values = []) => Object.values((await database.query(sql, values)).rows[0])[0]

async function request(action, input = {}, headers = {}, options = {}) {
  const handler = ['host-session','create-room','join-room'].includes(action) ? fixture.roomHandler : fixture.gameHandler
  const response = await handler(new Request(`https://edge.invalid/${action}`, { method: 'POST', headers: { origin, apikey: 'sb_publishable_fixture', 'content-type': 'application/json', ...headers }, body: JSON.stringify(input), ...options }), { sourceAddress: '127.0.0.1' })
  if (response.headers.get('content-type') === 'image/png') return { response, bytes: new Uint8Array(await response.arrayBuffer()) }
  const body = response.status === 204 ? null : await response.json()
  return { response, body, data: body?.data }
}
async function setup() {
  const host = (await request('host-session', { mode: 'bootstrap', bootstrapKey: nonce() })).data
  const lobby = (await request('create-room', { categoryIds: [actor,singer], requestKey: nonce() }, { 'x-host-credential': host.credential })).data
  const player = (await request('join-room', { roomCode: lobby.room.code, nickname: '測試玩家', joinKey: nonce() })).data
  return { host, lobby, player, headers: { 'x-host-credential': host.credential, 'x-room-token': lobby.hostToken }, playerHeaders: { 'x-player-session': player.playerSession }, code: lobby.room.code }
}
async function rpcInput(context, extra = {}) {
  return { host_hash: await hashToken('host', context.host.credential), room_token_hash: await hashToken('room', context.lobby.hostToken), room_code: context.code, ...extra }
}
async function start(context) {
  const result = await request('start-game', { roomCode: context.code }, context.headers)
  assert.equal(result.response.status, 200)
  return result.data
}
async function complete(context) {
  let state = await start(context)
  for (let number = 1; number <= 15; number++) {
    state = await fixture.rpc('game', 'reveal-answer', await rpcInput(context, { question_id: state.question.id }))
    if (number < 15) state = await fixture.rpc('game', 'next-question', await rpcInput(context, { question_id: state.question.id }))
  }
  return fixture.rpc('game', 'finish-game', await rpcInput(context, { question_id: state.question.id }))
}

before(async () => { fixture = await createGameFixture(); database = fixture.database })
beforeEach(async () => {
  await database.exec('DELETE FROM public.host_question_history; DELETE FROM public.room_questions; DELETE FROM public.rooms; DELETE FROM public.game_image_assets; DELETE FROM public.celebrities; DELETE FROM public.hosts; DELETE FROM public.room_api_rate_limits; UPDATE public.categories SET is_active=true;')
  await seedGameFixtures(database)
})
after(async () => { await fixture?.close() })

test('Host starts exactly question 1 and all state persists in PostgreSQL', async () => {
  const context = await setup(); const state = await start(context)
  assert.equal(state.room.status,'playing'); assert.equal(state.question.number,1); assert.equal(state.question.revealed,false)
  assert.match(state.question.answer,/隔離測試人物/)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions'),1)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),1)
})
test('Player cannot start, reveal, advance, finish or reset history', async () => {
  const context = await setup(); const state = await start(context)
  for (const action of ['start-game','reveal-answer','next-question','finish-game','reset-question-history']) {
    const result = await request(action,{ roomCode:context.code,questionId:state.question.id,confirm:true },context.playerHeaders)
    assert.equal(result.response.status,403)
  }
})
test('14 distinct people in overlapping categories cannot satisfy the 15-person minimum', async () => {
  await database.exec("UPDATE public.celebrities SET is_approved=false WHERE right(id::text,12)::bigint > 14")
  const context=await setup(); const result=await request('start-game',{roomCode:context.code},context.headers)
  assert.equal(result.body.error.code,'INSUFFICIENT_QUESTIONS')
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions'),0)
  assert.equal(await scalar('SELECT status FROM public.rooms'),'waiting')
})
test('15 distinct people with overlapping memberships are enough; inactive, unreviewed or missing images are excluded', async () => {
  const context=await setup()
  await database.exec("DELETE FROM public.game_image_assets WHERE right(celebrity_id::text,12)::bigint > 15; UPDATE public.categories SET is_active=false WHERE slug='singers'")
  await start(context)
})
test('missing usable images or all disabled categories prevent starting', async () => {
  const context=await setup()
  await database.exec('DELETE FROM public.game_image_assets')
  assert.equal((await request('start-game',{roomCode:context.code},context.headers)).body.error.code,'INSUFFICIENT_QUESTIONS')
  await database.exec('UPDATE public.categories SET is_active=false')
  assert.equal((await request('start-game',{roomCode:context.code},context.headers)).body.error.code,'INVALID_CATEGORIES')
})
test('Player JSON contains no unrevealed answer, celebrity ID, source, filename, attribution or history', async () => {
  const context=await setup(); await start(context)
  const result=await request('get-game-state',{roomCode:context.code},context.playerHeaders)
  assert.deepEqual(Object.keys(result.data.question).sort(),['id','number','revealed'])
  assert.ok(!/隔離測試人物|PRIVATE ANSWER|SECRET-NAME|celebrity|history|attribution|license|image_url|hash|gw_/.test(JSON.stringify(result.body)))
})
test('Host reveals; Player then sees answer and licensed attribution', async () => {
  const context=await setup(); const state=await start(context)
  await request('reveal-answer',{roomCode:context.code,questionId:state.question.id},context.headers)
  const result=await request('get-game-state',{roomCode:context.code},context.playerHeaders)
  assert.equal(result.data.question.revealed,true); assert.equal(result.data.question.answer,state.question.answer)
  assert.equal(result.data.question.attribution.license,'CC0-1.0')
})
test('Next is refused until revealed and duplicate next retries never skip a question', async () => {
  const context=await setup(); const state=await start(context); const input={roomCode:context.code,questionId:state.question.id}
  assert.equal((await request('next-question',input,context.headers)).body.error.code,'ANSWER_NOT_REVEALED')
  await request('reveal-answer',input,context.headers)
  const next=await request('next-question',input,context.headers)
  assert.equal(next.data.question.number,2)
  const repeated=await request('next-question',input,context.headers)
  assert.equal(repeated.data.question.id,next.data.question.id)
  assert.equal((await request('reveal-answer',input,context.headers)).body.error.code,'STALE_STATE')
})
test('15 questions are distinct, category-first drawing persists memberships and no question16 is allowed', async () => {
  const context=await setup(); const state=await complete(context)
  assert.equal(state.room.currentQuestion,15); assert.equal(state.room.status,'finished')
  assert.equal(await scalar('SELECT count(DISTINCT celebrity_id)::int FROM public.room_questions'),15)
  assert.equal(await scalar('SELECT count(DISTINCT question_number)::int FROM public.room_questions'),15)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),15)
  await assert.rejects(fixture.rpc('game','next-question',await rpcInput(context,{question_id:state.question.id})),error=>error.code==='INVALID_STATE')
})
test('question15 while playing rejects question16 with LAST_QUESTION', async () => {
  const context=await setup(); let state=await start(context)
  for(let number=1;number<=15;number++) {
    state=await fixture.rpc('game','reveal-answer',await rpcInput(context,{question_id:state.question.id}))
    if(number<15) state=await fixture.rpc('game','next-question',await rpcInput(context,{question_id:state.question.id}))
  }
  await assert.rejects(fixture.rpc('game','next-question',await rpcInput(context,{question_id:state.question.id})),error=>error.code==='LAST_QUESTION')
})
test('Host and Player refresh reconstruct the same question, bytes, reveal and control from server state', async () => {
  const context=await setup(); const state=await start(context)
  const image=await request('get-question-image',{roomCode:context.code,questionId:state.question.id},context.playerHeaders)
  assert.equal(image.response.status,200); assert.deepEqual(Buffer.from(image.bytes),fixturePng())
  assert.equal(image.response.headers.get('content-disposition'),'inline; filename="photo.png"')
  assert.equal(image.response.headers.get('cache-control'),'no-store')
  for(const headers of [context.headers,context.playerHeaders]) {
    const refreshed=await request('get-game-state',{roomCode:context.code},headers)
    assert.equal(refreshed.data.question.id,state.question.id); assert.equal(refreshed.data.question.revealed,false)
  }
  const repeated=await start(context); assert.equal(repeated.question.id,state.question.id)
})
test('early finish preserves history and does not reveal an unrevealed answer to Player', async () => {
  const context=await setup(); const state=await start(context)
  await request('finish-game',{roomCode:context.code,questionId:state.question.id},context.headers)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),1)
  const player=await request('get-game-state',{roomCode:context.code},context.playerHeaders)
  assert.equal(player.data.room.status,'finished'); assert.equal('answer' in player.data.question,false)
})
test('second full game excludes the first 15; a different Host has independent history', async () => {
  const context=await setup(); await complete(context)
  const second=(await request('create-room',{categoryIds:[actor],requestKey:nonce()},{'x-host-credential':context.host.credential})).data
  const next={...context,lobby:second,code:second.room.code,headers:{...context.headers,'x-room-token':second.hostToken}}
  await complete(next)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),30)
  await start(await setup())
  assert.equal(await scalar('SELECT count(DISTINCT host_id)::int FROM public.host_question_history'),2)
})
test('15-person corpus blocks second game until explicit own-history reset; questions are never deleted', async () => {
  await database.exec("DELETE FROM public.game_image_assets WHERE right(celebrity_id::text,12)::bigint > 15")
  const context=await setup(); const finished=await complete(context)
  const second=(await request('create-room',{categoryIds:[actor],requestKey:nonce()},{'x-host-credential':context.host.credential})).data
  const next={...context,lobby:second,code:second.room.code,headers:{...context.headers,'x-room-token':second.hostToken}}
  assert.equal((await request('start-game',{roomCode:next.code},next.headers)).body.error.code,'INSUFFICIENT_QUESTIONS')
  const reset=await request('reset-question-history',{confirm:true,historyRevision:finished.historyRevision},{'x-host-credential':context.host.credential})
  assert.equal(reset.data.reset,true); assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions'),15)
  await start(next)
})
test('history reset requires explicit confirmation and refuses all playing rooms including expired games', async () => {
  const context=await setup(); const state=await start(context)
  const headers={'x-host-credential':context.host.credential}
  assert.equal((await request('reset-question-history',{historyRevision:state.historyRevision},headers)).response.status,400)
  assert.equal((await request('reset-question-history',{confirm:true,historyRevision:state.historyRevision},headers)).body.error.code,'GAME_ACTIVE')
  await database.exec("UPDATE public.rooms SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day'")
  assert.equal((await request('reset-question-history',{confirm:true,historyRevision:state.historyRevision},headers)).body.error.code,'GAME_ACTIVE')
  assert.equal((await request('finish-game',{roomCode:context.code,questionId:state.question.id},context.headers)).response.status,200)
})
test('reset only affects authenticated Host and stale confirmation cannot delete newer history', async () => {
  const first=await setup(); let state=await start(first)
  state=(await request('finish-game',{roomCode:first.code,questionId:state.question.id},first.headers)).data
  const other=await setup(); await start(other)
  assert.equal((await request('reset-question-history',{confirm:true,historyRevision:state.historyRevision,hostId:other.host.hostId},{'x-host-credential':first.host.credential})).response.status,400)
  assert.equal((await request('reset-question-history',{confirm:true,historyRevision:state.historyRevision},{'x-host-credential':first.host.credential})).response.status,200)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history WHERE host_id=$1',[other.host.hostId]),1)
  assert.equal((await request('reset-question-history',{confirm:true,historyRevision:state.historyRevision},{'x-host-credential':first.host.credential})).body.error.code,'STALE_STATE')
})
test('wrong Host, wrong room token, missing credentials and forged IDs cannot bypass authorization', async () => {
  const context=await setup(); const other=await setup()
  for(const headers of [{},other.headers,{'x-host-credential':context.host.credential,'x-room-token':other.lobby.hostToken},{'x-player-session':`gw_player_${nonce()}`}]) {
    assert.ok([401,403].includes((await request('start-game',{roomCode:context.code},headers)).response.status))
  }
  assert.equal((await request('start-game',{roomCode:context.code,hostId:context.host.hostId,role:'host'},context.headers)).response.status,400)
})
test('direct private RPC still verifies ownership, room token and player read-only rights', async () => {
  const context=await setup(); const other=await setup()
  await assert.rejects(fixture.rpc('game','start-game',await rpcInput(context,{room_token_hash:await hashToken('room',other.lobby.hostToken)})),error=>error.code==='FORBIDDEN')
  await assert.rejects(fixture.rpc('game','start-game',{player_hash:await hashToken('player',context.player.playerSession),room_code:context.code}),error=>error.code==='FORBIDDEN')
  await assert.rejects(fixture.rpc('game','start-game',await rpcInput(context,{role:'host'})),error=>error.code==='INVALID_INPUT')
  await assert.rejects(fixture.rpc('game','start-game',{room_code:context.code}),error=>error.code==='UNAUTHORIZED')
})
test('first draw rollback leaves waiting room, null start timestamp and zero consumed history', async () => {
  const context=await setup()
  await database.exec("CREATE FUNCTION public.fixture_fail_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER fixture_fail_history BEFORE INSERT ON public.host_question_history FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_history()")
  try {
    assert.equal((await request('start-game',{roomCode:context.code},context.headers)).response.status,500)
    assert.equal(await scalar("SELECT status='waiting' AND current_question=0 AND started_at IS NULL FROM public.rooms"),true)
    assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions'),0)
    assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),0)
  } finally {await database.exec('DROP TRIGGER fixture_fail_history ON public.host_question_history; DROP FUNCTION public.fixture_fail_history()')}
})
test('failed inventory change and transaction errors roll back question, history and progress together', async () => {
  const context=await setup(); const state=await start(context)
  await request('reveal-answer',{roomCode:context.code,questionId:state.question.id},context.headers)
  await database.exec('UPDATE public.celebrities SET is_approved=false')
  assert.equal((await request('next-question',{roomCode:context.code,questionId:state.question.id},context.headers)).body.error.code,'INSUFFICIENT_QUESTIONS')
  assert.equal(await scalar('SELECT current_question FROM public.rooms'),1)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),1)
  await database.exec('UPDATE public.celebrities SET is_approved=true')
  const input=await rpcInput(context,{question_id:state.question.id})
  await assert.rejects(database.transaction(async transaction=>{
    await transaction.query('SELECT public.game_engine_action($1,$2::jsonb)',['next-question',JSON.stringify(input)])
    throw new Error('force rollback after complete draw')
  }))
  assert.equal(await scalar('SELECT current_question FROM public.rooms'),1)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions'),1)
})
test('same-room queued duplicate requests do not skip; native multi-connection tests run separately', async () => {
  const context=await setup(); const state=await start(context)
  await request('reveal-answer',{roomCode:context.code,questionId:state.question.id},context.headers)
  const input=await rpcInput(context,{question_id:state.question.id})
  const results=await Promise.all(Array.from({length:12},()=>fixture.rpc('game','next-question',input)))
  assert.equal(new Set(results.map(result=>result.question.id)).size,1)
  assert.equal(await scalar('SELECT current_question FROM public.rooms'),2)
})
test('new private assets, RPCs and legacy answer tables are inaccessible to browser roles', async () => {
  for(const role of ['anon','authenticated']) {
    for(const table of ['game_image_assets','celebrities','room_questions','host_question_history']) await assert.rejects(database.transaction(async transaction=>{await transaction.exec(`SET LOCAL ROLE ${role}`);await transaction.query(`SELECT * FROM public.${table} LIMIT 0`)}),error=>error.code==='42501')
    for(const sql of ["SELECT public.game_engine_action('start-game','{}')","SELECT public.game_engine_state(null,'host',null)","SELECT public.game_engine_png_valid(''::bytea)"]) await assert.rejects(database.transaction(async transaction=>{await transaction.exec(`SET LOCAL ROLE ${role}`);await transaction.exec(sql)}),error=>error.code==='42501')
  }
  assert.equal(await scalar("SELECT bool_and(NOT prosecdef AND proconfig=ARRAY['search_path=\"\"']) FROM pg_proc WHERE proname LIKE 'game_engine_%'"),true)
  assert.equal(await scalar("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.game_image_assets'::regclass"),true)
  assert.equal(await scalar("SELECT has_table_privilege('service_role','public.game_image_assets','UPDATE')"),false)
})
test('metadata, SVG, trailing data and bad geometry are rejected; immutable referenced images cannot be replaced', async () => {
  const png=fixturePng()
  const metadata=Buffer.concat([png.subarray(0,33),pngChunk('tEXt',Buffer.from('Description\0SECRET-NAME')),png.subarray(33)])
  for(const invalid of [metadata,Buffer.alloc(524289),Buffer.from('<svg>answer</svg>'),Buffer.concat([png,Buffer.from('secret')]),Buffer.from(png).fill(0,16,20),Buffer.from(png).fill(0,29,33)]) assert.equal(await scalar('SELECT public.game_engine_png_valid($1::bytea)',[invalid]),false)
  const context=await setup(); await start(context)
  await assert.rejects(database.query('DELETE FROM public.game_image_assets WHERE id=(SELECT game_image_id FROM public.room_questions LIMIT 1)'),error=>['23503','23001'].includes(error.code))
  const image=await request('get-question-image',{roomCode:context.code,questionId:crypto.randomUUID()},context.playerHeaders)
  assert.equal(image.body.error.code,'STALE_STATE')
})
test('Edge DTO re-filters malicious backend answers and CORS, source and errors remain safe', async () => {
  const context=await setup(); await start(context)
  const original=(await request('get-game-state',{roomCode:context.code},context.playerHeaders)).data
  const gate=[]
  const handler=createGameHandler(fixture.config,{rateLimit:async input=>{gate.push(input);return {allowed:true,authenticated:true,retryAfter:1}},action:async()=>({...original,question:{...original.question,answer:'LEAK',attribution:{source:'LEAK'},celebrityId:'LEAK'},hash:'LEAK'})})
  const response=await handler(new Request('https://edge.invalid/get-game-state',{method:'POST',headers:{origin,apikey:'sb_publishable_fixture','content-type':'application/json',...context.playerHeaders,'x-forwarded-for':'spoofed'},body:JSON.stringify({roomCode:context.code})}),{sourceAddress:'127.0.0.1'})
  assert.ok(!(await response.text()).includes('LEAK'))
  assert.equal(gate[0].action,'get-room-state'); assert.ok(!JSON.stringify(gate).includes(context.player.playerSession))
  assert.equal((await request('get-game-state',{}, {},{method:'OPTIONS',body:undefined})).response.status,204)
  assert.equal((await request('get-game-state',{}, {origin:'https://evil.invalid'})).response.status,403)
})
test('game actions retain H-01 fixed scopes; fake rotating tokens do not allocate independent buckets', async () => {
  const before=await scalar('SELECT count(*)::int FROM public.room_api_rate_limits')
  for(let index=0;index<140;index++) await request('start-game',{roomCode:'ABC123'},{'x-host-credential':`gw_host_${nonce()}`,'x-room-token':`gw_room_${nonce()}`})
  const capped=await scalar('SELECT count(*)::int FROM public.room_api_rate_limits')
  assert.equal(capped-before,2)
  for(let index=0;index<20;index++) assert.equal((await request('start-game',{roomCode:'ABC123'},{'x-host-credential':`gw_host_${nonce()}`})).response.status,429)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_api_rate_limits'),capped)
})
test('game migration is additive, deployed migrations stay pinned, no realtime or external image fetching is introduced', async () => {
  const {createHash}=await import('node:crypto')
  for(const [name,digest] of [['20261023060000_create_guess_who_schema.sql','8f5e0ed648794c09ced3b9d221b32ce070bf3b73f936d2f4bbe5b2834bdca07c'],['20261023093000_room_system.sql','d4917bd4d103b537a575e87d78e100dda4bf71b0b3865525b3b26954f76ad10f']]) assert.equal(createHash('sha256').update(await readFile(new URL(`../migrations/${name}`,import.meta.url))).digest('hex'),digest)
  const sql=await readFile(gameMigration,'utf8')
  assert.ok(!/SECURITY DEFINER|CREATE POLICY|ALTER PUBLICATION|TRUNCATE|DROP TABLE/.test(sql))
  await database.exec(await readFile(new URL('./verify_game_engine.sql',import.meta.url),'utf8'))
})
