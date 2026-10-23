import assert from 'node:assert/strict'
import { before, after, beforeEach, test } from 'node:test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRealtimeFixture } from './realtime-fixture.mjs'
import { actor } from './game-fixture.mjs'
import { nonce, hashToken } from '../functions/room-system/crypto.ts'
import { signRealtimeTicket } from '../functions/room-system/realtime.ts'
import { createRoomHandler } from '../functions/room-system/handler.ts'

let fixture
const origin = 'http://localhost:5173'
const scalar = async sql => Object.values((await fixture.database.query(sql)).rows[0])[0]
const request = async (action, input, headers = {}, handler = fixture.roomHandler) => {
  const response = await handler(new Request(`https://edge.invalid/room-system/${action}`, { method: 'POST', headers: { origin, apikey: 'sb_publishable_fixture', 'content-type': 'application/json', ...headers }, body: JSON.stringify(input) }))
  const body = await response.json()
  return { status: response.status, data: body.data, error: body.error, headers: response.headers }
}
async function actors() {
  const host = (await request('host-session', { mode: 'bootstrap', bootstrapKey: nonce() })).data
  const room = (await request('create-room', { categoryIds: [actor], requestKey: nonce() }, { 'x-host-credential': host.credential })).data
  const player = (await request('join-room', { roomCode: room.room.code, nickname: 'Realtime QA', joinKey: nonce() })).data
  return { host, room, player, hostHeaders: { 'x-host-credential': host.credential, 'x-room-token': room.hostToken }, playerHeaders: { 'x-player-session': player.playerSession } }
}
before(async () => { fixture = await createRealtimeFixture() })
after(async () => { await fixture?.close() })
beforeEach(async () => { await fixture.database.exec('DELETE FROM public.host_question_history; DELETE FROM public.room_questions; DELETE FROM public.room_players; DELETE FROM public.rooms; DELETE FROM public.hosts; DELETE FROM public.room_api_rate_limits; DELETE FROM realtime.messages;') })

test('Host and Player receive room-scoped verified ES256 anon JWTs lasting at most five minutes', async () => {
  const context = await actors()
  for (const headers of [context.hostHeaders, context.playerHeaders]) {
    const result = await request('get-realtime-ticket', { roomCode: context.room.room.code }, headers)
    assert.equal(result.status, 200)
    assert.equal(await fixture.verify(result.data.accessToken), true)
    const claims = fixture.claims(result.data.accessToken)
    assert.equal(claims.role, 'anon')
    assert.ok(claims.exp - claims.iat <= 300)
    assert.ok(!/gw_|hash|credential|answer|name/i.test(JSON.stringify(claims)))
    assert.equal(await fixture.allowed(result.data.topic, claims), true)
  }
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_realtime_grants'), 2)
})
test('Room Code alone, fake credentials, wrong Room Token and other Host cannot obtain a grant', async () => {
  const context = await actors()
  for (const headers of [{}, { 'x-player-session': `gw_player_${nonce()}` }, { ...context.hostHeaders, 'x-room-token': `gw_room_${nonce()}` }]) {
    assert.ok([401, 403].includes((await request('get-realtime-ticket', { roomCode: context.room.room.code }, headers)).status))
  }
  const other = (await request('host-session', { mode: 'bootstrap', bootstrapKey: nonce() })).data
  assert.equal((await request('get-realtime-ticket', { roomCode: context.room.room.code }, { ...context.hostHeaders, 'x-host-credential': other.credential })).status, 403)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_realtime_grants'), 0)
})
test('ticket renewal reuses the unique verified identity row, not attacker-controlled credential counters', async () => {
  const context = await actors()
  const first = await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)
  const second = await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)
  assert.equal(fixture.claims(first.data.accessToken).sub, fixture.claims(second.data.accessToken).sub)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_realtime_grants'), 1)
})
test('client-supplied identities, roles, scope and expiry are rejected before grant issuance', async () => {
  const context = await actors()
  for (const extra of [{ hostId: context.host.hostId }, { role: 'host' }, { scope: 'all' }, { expiresAt: '2099-01-01' }]) {
    assert.equal((await request('get-realtime-ticket', { roomCode: context.room.room.code, ...extra }, context.playerHeaders)).status, 400)
  }
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_realtime_grants'), 0)
})
test('missing signing configuration fails closed before creating a grant', async () => {
  const context = await actors()
  let grants = 0
  const handler = createRoomHandler(fixture.config, { rateLimit: async () => ({ allowed: true, authenticated: true, retryAfter: 1 }), action: async () => ({}), realtimeGrant: async () => { grants++; return {} } })
  const missing = createRoomHandler({ ...fixture.config, realtimeSigningJwk: undefined }, { rateLimit: async () => ({ allowed: true, authenticated: true, retryAfter: 1 }), action: async () => ({}), realtimeGrant: async () => { grants++; return {} } })
  assert.ok(handler)
  assert.equal((await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.hostHeaders, missing)).status, 503)
  assert.equal(grants, 0)
})
test('private receive policy rejects no JWT, unrelated room, malformed or expired claims even with broad platform policies', async () => {
  const context = await actors()
  const ticket = (await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)).data
  const claims = fixture.claims(ticket.accessToken)
  assert.equal(await fixture.allowed(ticket.topic, {}), false)
  assert.equal(await fixture.allowed(`gw-room:${crypto.randomUUID()}`, claims), false)
  assert.equal(await fixture.allowed(ticket.topic, { ...claims, role: 'authenticated' }), false)
  assert.equal(await fixture.allowed(ticket.topic, { ...claims, exp: 1 }), false)
  assert.equal(await fixture.allowed(ticket.topic, { ...claims, exp: 'bad' }), false)
  assert.equal(await fixture.allowed(ticket.topic, { ...claims, sub: crypto.randomUUID() }), false)
})
test('valid members cannot insert or spoof private broadcasts, including under broad existing INSERT policy', async () => {
  const context = await actors()
  const ticket = (await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)).data
  await assert.rejects(fixture.database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE anon')
    await transaction.query("SELECT set_config('request.jwt.claims',$1,true),set_config('realtime.topic',$2,true)", [JSON.stringify(fixture.claims(ticket.accessToken)), ticket.topic])
    await transaction.query("INSERT INTO realtime.messages(topic,event,payload,private) VALUES($1,'invalidate','{\"changed\":true}',true)", [ticket.topic])
  }), error => error.code === '42501')
})
test('actual messages RLS filters other room rows and prevents spoofing by changing the topic setting', async () => {
  const context = await actors()
  const ticket = (await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)).data
  const otherTopic = `gw-room:${crypto.randomUUID()}`
  await fixture.database.query("INSERT INTO realtime.messages(topic,event,payload,private) VALUES($1,'invalidate','{\"changed\":true}',true)", [otherTopic])
  const topics = await fixture.database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE anon')
    await transaction.query("SELECT set_config('request.jwt.claims',$1,true),set_config('realtime.topic',$2,true)", [JSON.stringify(fixture.claims(ticket.accessToken)), ticket.topic])
    return (await transaction.query('SELECT topic FROM realtime.messages')).rows.map(row => row.topic)
  })
  assert.ok(topics.length > 0)
  assert.ok(topics.every(topic => topic === ticket.topic))
  await assert.rejects(fixture.database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE anon')
    await transaction.exec("SELECT set_config('realtime.topic','unrelated-public-topic',true)")
    await transaction.query("INSERT INTO realtime.messages(topic,event,payload,private) VALUES($1,'invalidate','{}',true)", [ticket.topic])
  }), error => error.code === '42501')
})
test('new grant table, grant RPC and all sensitive game tables remain inaccessible to browser roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['room_realtime_grants', 'celebrities', 'game_image_assets', 'room_questions', 'host_question_history']) await assert.rejects(fixture.database.transaction(async transaction => {
      await transaction.exec(`SET LOCAL ROLE ${role}`)
      await transaction.exec(`SELECT * FROM public.${table} LIMIT 1`)
    }), error => error.code === '42501')
    assert.equal((await fixture.database.query("SELECT has_function_privilege($1,'public.room_realtime_grant(jsonb)','EXECUTE') AS allowed", [role])).rows[0].allowed, false)
  }
})
test('player leave invalidates future private channel authorization without deleting any game history', async () => {
  const context = await actors()
  const ticket = (await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)).data
  assert.equal((await request('leave-room', { roomCode: context.room.room.code }, context.playerHeaders)).status, 200)
  assert.equal(await fixture.allowed(ticket.topic, fixture.claims(ticket.accessToken)), false)
  assert.equal((await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)).status, 401)
})
test('Host credential revocation invalidates grants; subscription secrets never become Host authority', async () => {
  const context = await actors()
  const ticket = (await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.hostHeaders)).data
  await request('close-room', { roomCode: context.room.room.code }, context.hostHeaders)
  await request('host-session', { mode: 'revoke', confirm: true }, { 'x-host-credential': context.host.credential })
  assert.equal(await fixture.allowed(ticket.topic, fixture.claims(ticket.accessToken)), false)
  assert.equal((await request('get-realtime-ticket', { roomCode: context.room.room.code }, { 'x-host-credential': ticket.accessToken, 'x-room-token': context.room.hostToken })).status, 401)
})
test('tampered JWTs and expired or oversized signing requests fail verification', async () => {
  const context = await actors()
  const ticket = (await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.hostHeaders)).data
  const parts = ticket.accessToken.split('.')
  parts[1] = Buffer.from(JSON.stringify({ ...fixture.claims(ticket.accessToken), rt_room: crypto.randomUUID() })).toString('base64url')
  assert.equal(await fixture.verify(parts.join('.')), false)
  await assert.rejects(signRealtimeTicket(fixture.config.realtimeSigningJwk, `${fixture.config.projectUrl}/auth/v1`, { grantId: crypto.randomUUID(), roomId: crypto.randomUUID(), expiresAt: new Date(Date.now() + 900000).toISOString() }))
})
test('room membership, start, reveal, next and finish triggers only send constant private invalidations', async () => {
  const context = await actors()
  const input = { room_code: context.room.room.code, host_hash: await hashToken('host', context.host.credential), room_token_hash: await hashToken('room', context.room.hostToken) }
  let state = await fixture.rpc('game', 'start-game', input)
  for (let number = 1; number <= 15; number++) {
    state = await fixture.rpc('game', 'reveal-answer', { ...input, question_id: state.question.id })
    if (number < 15) state = await fixture.rpc('game', 'next-question', { ...input, question_id: state.question.id })
  }
  await fixture.rpc('game', 'finish-game', { ...input, question_id: state.question.id })
  const messages = (await fixture.database.query('SELECT topic,event,payload,private FROM realtime.messages')).rows
  assert.ok(messages.length >= 45)
  for (const message of messages) {
    assert.equal(message.topic, `gw-room:${context.room.room.id}`)
    assert.equal(message.event, 'invalidate')
    assert.equal(message.private, true)
    assert.deepEqual(message.payload, { changed: true })
  }
  assert.equal(await scalar('SELECT count(DISTINCT celebrity_id)::int FROM public.room_questions'), 15)
})
test('rolled back game transaction also rolls back invalidation messages', async () => {
  const context = await actors()
  const before = await scalar('SELECT count(*)::int FROM realtime.messages')
  await assert.rejects(fixture.database.transaction(async transaction => {
    await transaction.query("UPDATE public.rooms SET status='finished',ended_at=now() WHERE id=$1", [context.room.room.id])
    throw new Error('rollback test')
  }))
  assert.equal(await scalar('SELECT count(*)::int FROM realtime.messages'), before)
})
test('H-01 global rejection of twenty distinct fake credentials creates no new buckets or grants', async () => {
  const context = await actors()
  const scope = createHash('sha256').update('guess-who:rate:v2:global:get-room-state:false').digest('hex')
  await fixture.database.query('INSERT INTO public.room_api_rate_limits(scope_hash,window_started_at,request_count,updated_at) VALUES($1,clock_timestamp(),600,clock_timestamp()) ON CONFLICT(scope_hash) DO UPDATE SET request_count=600,window_started_at=clock_timestamp()', [scope])
  const before = await scalar('SELECT count(*)::int FROM public.room_api_rate_limits')
  for (let index = 0; index < 20; index++) assert.equal((await request('get-realtime-ticket', { roomCode: context.room.room.code }, { 'x-player-session': `gw_player_${nonce()}`, 'x-forwarded-for': `203.0.113.${index}` })).status, 429)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_api_rate_limits'), before)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_realtime_grants'), 0)
})
test('grant expiry cleanup is bounded and performed only after verified authorization', async () => {
  const context = await actors()
  await fixture.database.query("INSERT INTO public.room_realtime_grants(room_id,viewer_id,viewer_role,credential_snapshot,expires_at) SELECT $1,gen_random_uuid(),'player',repeat('a',64),now()-interval '1 hour' FROM generate_series(1,240)", [context.room.room.id])
  assert.equal((await request('get-realtime-ticket', { roomCode: context.room.room.code }, context.playerHeaders)).status, 200)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_realtime_grants'), 141)
})
test('new SECURITY DEFINER helpers have empty search_path, bounded output and no grant-mint privilege for anon', async () => {
  const rows = (await fixture.database.query("SELECT proname,prosecdef,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'room_realtime_%' ORDER BY proname")).rows
  assert.equal(rows.length, 3)
  for (const row of rows) assert.deepEqual(row.proconfig, ['search_path=""'])
  assert.equal(rows.find(row => row.proname === 'room_realtime_grant').prosecdef, false)
  assert.equal(rows.find(row => row.proname === 'room_realtime_can_receive').prosecdef, true)
})
test('deployment read-only realtime verifier passes against the exact local draft', async () => {
  const results = await fixture.database.exec(await readFile(new URL('./verify_room_realtime.sql', import.meta.url), 'utf8'))
  assert.ok(results.some(result => result.rows?.some(row => row.room_realtime_catalog_review === 'PASS')))
})
