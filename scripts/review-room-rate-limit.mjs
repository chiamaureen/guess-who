import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createRoomHandler, RoomError } from '../supabase/functions/room-system/handler.ts'
import { nonce } from '../supabase/functions/room-system/crypto.ts'

const database = new PGlite()
try {
  await database.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;')
  const directory = new URL('../supabase/migrations/', import.meta.url)
  const migrations = (await readdir(directory)).filter(filename => filename.endsWith('.sql')).sort()
  for (const filename of migrations) {
    if (filename === '20261025010000_question_groups.sql') await database.exec(await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8'))
    await database.transaction(transaction => readFile(new URL(filename, directory), 'utf8').then(sql => transaction.exec(sql)))
  }
  if (!migrations.includes('20261023093000_room_system.sql')) await database.exec(await readFile(new URL('../supabase/migration-drafts/20261023093000_room_system.sql', import.meta.url), 'utf8'))
  let actionCalls = 0
  const handler = createRoomHandler({ origins: ['http://localhost:5173'], publishableKeys: ['sb_publishable_review_fixture'], signingKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') }, {
    rateLimit: scopes => database.transaction(async transaction => {
      await transaction.exec('SET LOCAL ROLE service_role')
      return (await transaction.query('SELECT public.room_system_rate_limit($1::jsonb) AS result', [JSON.stringify(scopes)])).rows[0].result
    }),
    action: (action, input) => database.transaction(async transaction => {
      actionCalls++
      await transaction.exec('SET LOCAL ROLE service_role')
      try { return (await transaction.query('SELECT public.room_system_action($1, $2::jsonb) AS result', [action, JSON.stringify(input)])).rows[0].result }
      catch (error) { throw new RoomError(error.code === 'P0001' ? error.message : 'INTERNAL_ERROR') }
    }),
  })
  const send = () => handler(new Request('https://edge.invalid/functions/v1/room-system/create-room', { method: 'POST', headers: { origin: 'http://localhost:5173', apikey: 'sb_publishable_review_fixture', 'content-type': 'application/json', 'x-forwarded-for': 'fixed-review-ip', 'x-host-credential': `gw_host_${nonce()}` }, body: JSON.stringify({ categoryIds: ['10000000-0000-4000-8000-000000000001'], requestKey: nonce() }) }))
  for (let index = 0; index < 140; index++) await send()
  const count = async () => (await database.query('SELECT count(*)::int AS total FROM public.room_api_rate_limits')).rows[0].total
  const beforeRows = await count()
  const beforeActionCalls = actionCalls
  const statuses = []
  for (let index = 0; index < 20; index++) statuses.push((await send()).status)
  const afterRows = await count()
  const expectedRejections = statuses.every(status => status === 429)
  const additionalBusinessActions = actionCalls - beforeActionCalls
  const safe = expectedRejections && afterRows === beforeRows && additionalBusinessActions === 0
  console.log(JSON.stringify({ result: safe ? 'PASS' : 'FAIL', check: 'global rejection must not allocate untrusted new rate buckets', environment: 'isolated local PGlite; actual Fetch handler and SQL; synthetic credentials only', rejectedRequests: statuses.length, allStatuses429: expectedRejections, beforeRows, afterRows, additionalRows: afterRows - beforeRows, additionalBusinessActions, cloudRequests: 0 }, null, 2))
  if (!safe) process.exitCode = 1
} finally { await database.close() }
