import assert from 'node:assert/strict'
import { before, after, beforeEach, test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createRoomHandler, RoomError, randomRoomCode } from '../functions/room-system/handler.ts'
import { hashToken, nonce, validNonce, validToken } from '../functions/room-system/crypto.ts'

const origin = 'http://localhost:5173'
const publishableKey = 'sb_publishable_fixture'
const signingKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
const actor = '10000000-0000-4000-8000-000000000001'
const singer = '10000000-0000-4000-8000-000000000002'
let database
let handler

async function rpc(name, parameters) {
  return database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE service_role')
    const sql = name === 'action' ? 'SELECT public.room_system_action($1, $2::jsonb) AS result' : 'SELECT public.room_system_rate_limit($1::jsonb) AS result'
    const values = name === 'action' ? [parameters.action, JSON.stringify(parameters.input)] : [JSON.stringify(parameters)]
    try { return (await transaction.query(sql, values)).rows[0].result }
    catch (error) { throw new RoomError(error.code === 'P0001' ? error.message : 'INTERNAL_ERROR') }
  })
}

async function request(action, input = {}, headers = {}, options = {}) {
  const response = await handler(new Request(`https://edge.invalid/functions/v1/room-system/${action}`, { method: 'POST', headers: { origin, apikey: publishableKey, 'content-type': 'application/json', ...headers }, body: JSON.stringify(input), ...options }))
  const body = response.status === 204 ? null : await response.json()
  return { response, body, data: body?.data }
}

async function host(bootstrapKey = nonce()) {
  const result = await request('host-session', { mode: 'bootstrap', bootstrapKey })
  assert.equal(result.response.status, 200)
  return { ...result.data, bootstrapKey }
}

async function room(identity, categoryIds = [actor, singer], requestKey = nonce()) {
  const result = await request('create-room', { categoryIds, requestKey }, { 'x-host-credential': identity.credential })
  assert.equal(result.response.status, 200)
  return { ...result.data, requestKey }
}

const hostHeaders = (identity, lobby) => ({ 'x-host-credential': identity.credential, 'x-room-token': lobby.hostToken })
const playerHeaders = session => ({ 'x-player-session': session })
const scalar = async (sql, parameters = []) => Object.values((await database.query(sql, parameters)).rows[0])[0]

before(async () => {
  database = new PGlite()
  await database.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;')
  const directory = new URL('../migrations/', import.meta.url)
  const migrations = (await readdir(directory)).filter(filename => filename.endsWith('.sql')).sort()
  for (const filename of migrations) await database.transaction(async transaction => transaction.exec(await readFile(new URL(filename, directory), 'utf8')))
  if (!migrations.includes('20261023093000_room_system.sql')) await database.transaction(async transaction => transaction.exec(await readFile(new URL('../migration-drafts/20261023093000_room_system.sql', import.meta.url), 'utf8')))
  await database.exec(await readFile(new URL('../seed.sql', import.meta.url), 'utf8'))
  handler = createRoomHandler({ origins: [origin], publishableKeys: [publishableKey], signingKey }, { rateLimit: scopes => rpc('rate', scopes), action: (action, input) => rpc('action', { action, input }) })
})

beforeEach(async () => { await database.exec('DELETE FROM public.room_api_rate_limits; DELETE FROM public.rooms; DELETE FROM public.hosts; UPDATE public.categories SET is_active = true;') })
after(async () => { await database?.close() })

test('anonymous bootstrap is idempotent, strongly generated, hashed and resumable without Supabase Auth', async () => {
  const identity = await host()
  const repeated = await host(identity.bootstrapKey)
  assert.ok(identity.credential === repeated.credential)
  assert.equal(identity.hostId, repeated.hostId)
  assert.ok(validToken(identity.credential, 'host'))
  assert.equal(await scalar('SELECT count(*)::int FROM public.hosts'), 1)
  assert.ok(await scalar('SELECT credential_hash FROM public.hosts') === await hashToken('host', identity.credential))
  const resumed = await request('host-session', { mode: 'resume' }, { 'x-host-credential': identity.credential })
  assert.equal(resumed.data.hostId, identity.hostId)
  assert.deepEqual(Object.keys(resumed.data), ['hostId'])
})

test('one host creates multiple rooms with multi-select categories and stable cross-room identity', async () => {
  const identity = await host()
  const first = await room(identity)
  const second = await room(identity, [actor])
  assert.notEqual(first.room.code, second.room.code)
  assert.equal(first.viewer.id, second.viewer.id)
  assert.equal(first.room.status, 'waiting')
  assert.equal(first.room.currentQuestion, 0)
  assert.equal(first.room.totalQuestions, 15)
  assert.equal(first.categories.length, 2)
  assert.ok(validToken(first.hostToken, 'room'))
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_categories'), 3)
  assert.equal(await scalar('SELECT count(*)::int FROM public.hosts'), 1)
})

test('create-room retries return the same room and control token, never partial category relationships', async () => {
  const identity = await host()
  const first = await room(identity)
  const repeated = await room(identity, [singer, actor], first.requestKey)
  assert.equal(repeated.room.id, first.room.id)
  assert.ok(first.hostToken === repeated.hostToken)
  assert.equal(await scalar('SELECT count(*)::int FROM public.rooms'), 1)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_categories'), 2)
  const mismatch = await request('create-room', { categoryIds: [actor], requestKey: first.requestKey }, { 'x-host-credential': identity.credential })
  assert.equal(mismatch.response.status, 409)
})

test('inactive or missing categories reject the complete create transaction', async () => {
  const identity = await host()
  await database.query('UPDATE public.categories SET is_active = false WHERE id = $1', [singer])
  for (const categoryIds of [[actor, singer], [actor, crypto.randomUUID()]]) {
    const result = await request('create-room', { categoryIds, requestKey: nonce() }, { 'x-host-credential': identity.credential })
    assert.equal(result.response.status, 400)
    assert.equal(result.body.error.code, 'INVALID_CATEGORIES')
  }
  assert.equal(await scalar('SELECT count(*)::int FROM public.rooms'), 0)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_categories'), 0)
})

test('room code generation uses an unbiased 32-character alphabet and handles database collisions by retrying', async () => {
  for (let index = 0; index < 100; index++) assert.match(randomRoomCode(), /^[A-HJ-NP-Z2-9]{6}$/)
  const identity = await host()
  let attempts = 0
  const collisionHandler = createRoomHandler({ origins: [origin], publishableKeys: [publishableKey], signingKey }, { rateLimit: async () => ({ allowed: true, retryAfter: 1 }), action: async (action, input) => { attempts++; if (attempts < 3) throw new RoomError('ROOM_CODE_COLLISION'); return rpc('action', { action, input }) } })
  const response = await collisionHandler(new Request('https://edge.invalid/create-room', { method: 'POST', headers: { origin, apikey: publishableKey, 'content-type': 'application/json', 'x-host-credential': identity.credential }, body: JSON.stringify({ categoryIds: [actor], requestKey: nonce() }) }))
  assert.equal(response.status, 200)
  assert.equal(attempts, 3)
  const actual = await room(identity)
  await assert.rejects(rpc('action', { action: 'create-room', input: { host_hash: await hashToken('host', identity.credential), room_token_hash: await hashToken('room', nonce()), room_code: actual.room.code, category_ids: [actor] } }), error => error.code === 'ROOM_CODE_COLLISION')
})

test('joining by code creates one anonymous player; same join key recovers exactly the same session', async () => {
  const lobby = await room(await host())
  const joinKey = nonce()
  const first = await request('join-room', { roomCode: lobby.room.code.toLowerCase(), nickname: ' 小明 ', joinKey })
  const repeated = await request('join-room', { roomCode: lobby.room.code, nickname: '小明', joinKey })
  assert.equal(first.response.status, 200)
  assert.equal(repeated.response.status, 200)
  assert.equal(first.data.viewer.id, repeated.data.viewer.id)
  assert.ok(first.data.playerSession === repeated.data.playerSession)
  assert.equal(first.data.players[0].nickname, '小明')
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_players'), 1)
  const restored = await request('get-room-state', { roomCode: lobby.room.code }, playerHeaders(first.data.playerSession))
  assert.equal(restored.data.viewer.id, first.data.viewer.id)
  assert.equal(restored.data.viewer.role, 'player')
})

test('host control and player list survive new state requests without browser-local game state', async () => {
  const identity = await host()
  const lobby = await room(identity)
  await request('join-room', { roomCode: lobby.room.code, nickname: '朋友', joinKey: nonce() })
  const restored = await request('get-room-state', { roomCode: lobby.room.code }, hostHeaders(identity, lobby))
  assert.equal(restored.response.status, 200)
  assert.equal(restored.data.viewer.role, 'host')
  assert.equal(restored.data.players.length, 1)
  const serialized = JSON.stringify(restored.body)
  assert.ok(!/credential|token|hash|name_zh|celebrity|history/i.test(serialized))
})

test('player cannot close a room, impersonate host, use another player ID or leave somebody else', async () => {
  const identity = await host()
  const lobby = await room(identity)
  const first = await request('join-room', { roomCode: lobby.room.code, nickname: '甲', joinKey: nonce() })
  const second = await request('join-room', { roomCode: lobby.room.code, nickname: '乙', joinKey: nonce() })
  assert.equal((await request('close-room', { roomCode: lobby.room.code }, playerHeaders(first.data.playerSession))).response.status, 401)
  assert.equal((await request('get-room-state', { roomCode: lobby.room.code, role: 'host', hostId: identity.hostId }, playerHeaders(first.data.playerSession))).response.status, 400)
  assert.equal((await request('leave-room', { roomCode: lobby.room.code, playerId: second.data.viewer.id }, playerHeaders(first.data.playerSession))).response.status, 400)
  const left = await request('leave-room', { roomCode: lobby.room.code }, playerHeaders(first.data.playerSession))
  assert.equal(left.response.status, 200)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_players'), 1)
  assert.equal((await request('get-room-state', { roomCode: lobby.room.code }, playerHeaders(first.data.playerSession))).response.status, 401)
})

test('host credentials and room token are both required and cannot control another host room', async () => {
  const first = await host()
  const second = await host()
  const firstRoom = await room(first)
  const secondRoom = await room(second)
  assert.equal((await request('close-room', { roomCode: firstRoom.room.code }, { 'x-host-credential': first.credential })).response.status, 401)
  assert.equal((await request('close-room', { roomCode: firstRoom.room.code }, { 'x-room-token': firstRoom.hostToken })).response.status, 401)
  assert.equal((await request('close-room', { roomCode: secondRoom.room.code }, hostHeaders(first, firstRoom))).response.status, 403)
  assert.equal((await request('close-room', { roomCode: firstRoom.room.code }, hostHeaders(first, secondRoom))).response.status, 403)
  assert.equal((await request('close-room', { roomCode: firstRoom.room.code }, { 'x-host-credential': 'invalid' })).response.status, 401)
})

test('closed rooms cannot be joined or reopened; closing is idempotent and existing players see finished', async () => {
  const identity = await host()
  const lobby = await room(identity)
  const player = await request('join-room', { roomCode: lobby.room.code, nickname: '朋友', joinKey: nonce() })
  const closed = await request('close-room', { roomCode: lobby.room.code }, hostHeaders(identity, lobby))
  assert.equal(closed.data.room.status, 'finished')
  assert.equal(closed.data.room.currentQuestion, 0)
  assert.equal((await request('close-room', { roomCode: lobby.room.code }, hostHeaders(identity, lobby))).data.room.status, 'finished')
  assert.equal((await request('join-room', { roomCode: lobby.room.code, nickname: '晚到', joinKey: nonce() })).response.status, 410)
  assert.equal((await request('get-room-state', { roomCode: lobby.room.code }, playerHeaders(player.data.playerSession))).data.room.status, 'finished')
  const repeated = await room(identity, [actor, singer], lobby.requestKey)
  assert.equal(repeated.room.status, 'finished')
})

test('unknown rooms, expired rooms and invalid nicknames fail safely without creating players', async () => {
  assert.equal((await request('join-room', { roomCode: 'XXXXXX', nickname: '小明', joinKey: nonce() })).response.status, 404)
  const lobby = await room(await host())
  for (const nickname of ['', ' ', '字'.repeat(21), '名字\n控制', '\u202e偽裝']) assert.equal((await request('join-room', { roomCode: lobby.room.code, nickname, joinKey: nonce() })).response.status, 400)
  await database.query("UPDATE public.rooms SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1", [lobby.room.id])
  assert.equal((await request('join-room', { roomCode: lobby.room.code, nickname: '小明', joinKey: nonce() })).response.status, 410)
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_players'), 0)
})

test('revocation needs confirmation and no active rooms, and never deletes the host row or history', async () => {
  const identity = await host()
  const lobby = await room(identity)
  assert.equal((await request('host-session', { mode: 'revoke', confirm: false }, { 'x-host-credential': identity.credential })).response.status, 400)
  assert.equal((await request('host-session', { mode: 'revoke', confirm: true }, { 'x-host-credential': identity.credential })).response.status, 409)
  await request('close-room', { roomCode: lobby.room.code }, hostHeaders(identity, lobby))
  assert.equal((await request('host-session', { mode: 'revoke', confirm: true }, { 'x-host-credential': identity.credential })).response.status, 200)
  assert.equal((await request('host-session', { mode: 'resume' }, { 'x-host-credential': identity.credential })).response.status, 401)
  assert.equal(await scalar('SELECT count(*)::int FROM public.hosts'), 1)
  assert.equal(await scalar('SELECT count(*)::int FROM public.rooms'), 1)
})

test('durable rate limiting commits rejections independently, resets expired windows and never stores raw IP or tokens', async () => {
  const scopes = [{ hash: await hashToken('rate-fixture', nonce()), limit: 2, windowSeconds: 60 }]
  assert.equal((await rpc('rate', scopes)).allowed, true)
  assert.equal((await rpc('rate', scopes)).allowed, true)
  assert.equal((await rpc('rate', scopes)).allowed, false)
  assert.equal(await scalar('SELECT request_count FROM public.room_api_rate_limits'), 3)
  await database.exec("UPDATE public.room_api_rate_limits SET window_started_at = now() - interval '2 minutes'")
  assert.equal((await rpc('rate', scopes)).allowed, true)
  assert.equal(await scalar('SELECT request_count FROM public.room_api_rate_limits'), 1)
  const limited = createRoomHandler({ origins: [origin], publishableKeys: [publishableKey], signingKey }, { rateLimit: async () => ({ allowed: false, retryAfter: 30 }), action: async () => { throw new Error('must not execute') } })
  const response = await limited(new Request('https://edge.invalid/host-session', { method: 'POST', headers: { origin, apikey: publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'bootstrap', bootstrapKey: nonce() }) }))
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '30')
})

test('CORS preflight, method, publishable key, oversized input and unknown role fields are checked', async () => {
  assert.throws(() => createRoomHandler({ origins: ['http://unsafe.invalid'], publishableKeys: [publishableKey], signingKey }, { rateLimit: async () => ({ allowed: true, retryAfter: 1 }), action: async () => ({}) }))
  const preflight = await handler(new Request('https://edge.invalid/host-session', { method: 'OPTIONS', headers: { origin } }))
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
  assert.ok(preflight.headers.get('access-control-allow-headers').includes('x-room-token'))
  assert.equal((await handler(new Request('https://edge.invalid/host-session', { headers: { origin: 'https://evil.invalid' } }))).status, 403)
  assert.equal((await handler(new Request('https://edge.invalid/host-session', { headers: { origin } }))).status, 405)
  assert.equal((await request('host-session', {}, { apikey: 'invalid' })).response.status, 401)
  assert.equal((await request('host-session', { mode: 'bootstrap', bootstrapKey: nonce(), extra: 'x'.repeat(9000) })).response.status, 400)
  assert.equal((await request('host-session', { mode: 'bootstrap', bootstrapKey: nonce(), hostId: crypto.randomUUID() })).response.status, 400)
})

test('database RPC and rate table are default-deny for both browser roles despite broad defaults', async () => {
  const tables = (await database.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace WHERE nspname='public' AND relkind='r'")).rows
  assert.equal(tables.length, 10)
  assert.ok(tables.every(table => table.relrowsecurity && table.relforcerowsecurity))
  for (const role of ['anon', 'authenticated']) {
    for (const table of tables) {
      for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3)', [role, `public.${table.relname}`, operation]), table.relname === 'categories' && operation === 'SELECT')
      }
    }
    await assert.rejects(database.transaction(async transaction => { await transaction.exec(`SET LOCAL ROLE ${role}`); await transaction.exec('SELECT * FROM public.room_api_rate_limits') }), error => error.code === '42501')
    for (const sql of ["SELECT public.room_system_action('host-session', '{}'::jsonb)", "SELECT public.room_system_rate_limit('[]'::jsonb)", "SELECT public.room_system_lobby(gen_random_uuid(), 'host', gen_random_uuid())"]) {
      await assert.rejects(database.transaction(async transaction => { await transaction.exec(`SET LOCAL ROLE ${role}`); await transaction.exec(sql) }), error => error.code === '42501')
    }
  }
  assert.equal(await scalar("SELECT count(*)::int FROM pg_proc JOIN pg_namespace ON pg_namespace.oid=pronamespace WHERE nspname='public' AND prosecdef"), 0)
  const verification = await database.exec(await readFile(new URL('./verify_room_system.sql', import.meta.url), 'utf8'))
  assert.equal(verification.at(-2).rows[0].verification.browser_safe, true)
  assert.equal(verification.at(-2).rows[0].verification.rpc_service_only, true)
  assert.deepEqual(verification.at(-2).rows[0].verification.realtime_exposed, [])
})

test('credential encodings are canonical, separated by purpose and contain no room code authentication shortcut', async () => {
  const value = nonce()
  assert.ok(validNonce(value))
  assert.equal(validNonce('invalid'), false)
  assert.equal(validNonce('a'.repeat(43)), false)
  assert.ok(await hashToken('host', value) !== await hashToken('player', value))
  const identity = await host()
  const lobby = await room(identity)
  assert.equal((await request('get-room-state', { roomCode: lobby.room.code })).response.status, 401)
})

test('unexpected database errors are redacted and do not expose SQL or hashes', async () => {
  const broken = createRoomHandler({ origins: [origin], publishableKeys: [publishableKey], signingKey }, { rateLimit: async () => ({ allowed: true, retryAfter: 1 }), action: async () => { throw new Error('private database internals') } })
  const response = await broken(new Request('https://edge.invalid/host-session', { method: 'POST', headers: { origin, apikey: publishableKey, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'bootstrap', bootstrapKey: nonce() }) }))
  assert.equal(response.status, 500)
  assert.ok(!(await response.text()).includes('private database internals'))
})
