import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { createRoomHandler, RoomError } from '../functions/room-system/handler.ts'
import { createGameHandler } from '../functions/game-engine/handler.ts'
import { seedGameFixtures } from './game-fixture.mjs'

export async function startBrowserFixture({ port = 8788, origin = 'http://127.0.0.1:5177', gamePeople = 0, legacyGameDto = false, imageFormat = 'png' } = {}) {
  const database = new PGlite()
  await database.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;')
  await database.exec(await readFile(new URL('./realtime-platform.sql', import.meta.url), 'utf8'))
  const directory = new URL('../migrations/', import.meta.url)
  const migrations = (await readdir(directory)).filter(filename => filename.endsWith('.sql')).sort()
  for (const filename of migrations) await database.transaction(async transaction => transaction.exec(await readFile(new URL(filename, directory), 'utf8')))
  if (!migrations.includes('20261023093000_room_system.sql')) await database.transaction(async transaction => transaction.exec(await readFile(new URL('../migration-drafts/20261023093000_room_system.sql', import.meta.url), 'utf8')))
  await database.exec(await readFile(new URL('../seed.sql', import.meta.url), 'utf8'))
  if (!['png', 'webp', 'jpeg'].includes(imageFormat)) throw new Error('Invalid local fixture format')
  if (imageFormat !== 'png') {
    await database.exec(await readFile(new URL('../migration-drafts/20261024120000_game_image_formats.sql', import.meta.url), 'utf8'))
    const { fixturePng } = await import('./game-fixture.mjs')
    const { normalizeQuestionWebp } = await import('../../scripts/lib/question-images.mjs')
    const { default: sharp } = await import('sharp')
    const image = imageFormat === 'webp' ? (await normalizeQuestionWebp(fixturePng())).webp : await sharp(fixturePng()).jpeg().toBuffer()
    if (gamePeople) await seedGameFixtures(database, gamePeople, image)
    const credit = JSON.stringify({ format: 'guess-who-image-rights-v1', attribution: 'LOCAL synthetic credit only', licenseVersion: '4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', derivativeLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', modifications: 'WebP resize and metadata removal', originalNotices: 'Synthetic fixture only', evidenceUrl: 'https://commons.wikimedia.org/w/index.php?title=File:SECRET-NAME.jpg&oldid=123', checkedAt: '2026-10-24' })
    await database.query('UPDATE public.celebrities SET image_license=$1,image_attribution=$2', ['CC BY-SA 4.0', credit])
  } else if (gamePeople) await seedGameFixtures(database, gamePeople)
  const signingKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  const rpc = (name, parameters) => database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE service_role')
    try {
      const sql = name === 'rate' ? 'SELECT public.room_system_rate_limit($1::jsonb) AS result' : `SELECT public.${name === 'game' ? 'game_engine_action' : 'room_system_action'}($1, $2::jsonb) AS result`
      const values = name === 'rate' ? [JSON.stringify(parameters)] : [parameters.action, JSON.stringify(parameters.input)]
      return (await transaction.query(sql, values)).rows[0].result
    } catch (error) { throw new RoomError(error.code === 'P0001' ? error.message : 'INTERNAL_ERROR') }
  })
  const handler = createRoomHandler({ origins: [origin], publishableKeys: ['sb_publishable_fixture'], signingKey }, { rateLimit: scopes => rpc('rate', scopes), action: (action, input) => rpc('action', { action, input }) })
  const gameHandler = createGameHandler({ origins: [origin], publishableKeys: ['sb_publishable_fixture'], signingKey }, { rateLimit: scopes => rpc('rate', scopes), action: (action, input) => rpc('game', { action, input }) })
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `http://127.0.0.1:${port}`)
      outgoing.setHeader('Content-Type', 'application/json')
      outgoing.setHeader('Cache-Control', 'no-store')
      outgoing.setHeader('Access-Control-Allow-Origin', origin)
      if (incoming.method === 'GET' && url.pathname === '/categories') {
        outgoing.end(JSON.stringify((await database.query('SELECT id, name, slug FROM public.categories WHERE is_active ORDER BY slug')).rows))
        return
      }
      if (incoming.method === 'GET' && url.pathname === '/test/stats') {
        outgoing.end(JSON.stringify((await database.query('SELECT (SELECT count(*)::int FROM public.hosts) AS hosts, (SELECT count(*)::int FROM public.rooms) AS rooms, (SELECT count(*)::int FROM public.room_players) AS players')).rows[0]))
        return
      }
      if (incoming.method === 'GET' && url.pathname === '/test/game-stats') {
        outgoing.end(JSON.stringify((await database.query('SELECT count(*)::int AS questions, count(DISTINCT celebrity_id)::int AS distinct_people, count(revealed_at)::int AS revealed, (SELECT count(*)::int FROM public.host_question_history) AS history FROM public.room_questions')).rows[0]))
        return
      }
      if (incoming.method === 'POST' && url.pathname === '/test/add-category') {
        await database.query("INSERT INTO public.categories (id,name,slug) VALUES ('10000000-0000-4000-8000-000000000008','未來分類','future-category') ON CONFLICT DO NOTHING")
        outgoing.end('{"ok":true}')
        return
      }
      let body = ''
      for await (const chunk of incoming) { body += chunk.toString(); if (Buffer.byteLength(body) > 8192) { outgoing.writeHead(413); outgoing.end('{}'); return } }
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value)
      const request = new Request(url, { method: incoming.method, headers, body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : body })
      let response = await (url.pathname.includes('/game-engine/') ? gameHandler : handler)(request, { sourceAddress: incoming.socket.remoteAddress })
      if (legacyGameDto && response.ok && url.pathname.includes('/game-engine/') && response.headers.get('content-type') === 'application/json') {
        const value = await response.json()
        delete value.data.players
        delete value.data.categories
        response = new Response(JSON.stringify(value), { status: response.status, headers: response.headers })
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.writeHead(500); outgoing.end('{"error":{"code":"FIXTURE_ERROR"}}') }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, close: async () => { await new Promise(resolve => server.close(resolve)); await database.close() } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startBrowserFixture()
  console.log('LOCAL-ONLY room test fixture ready at http://127.0.0.1:8788; isolated memory database, no Cloud credentials or writes.')
  process.on('SIGINT', async () => { await fixture.close(); process.exit(0) })
  process.on('SIGTERM', async () => { await fixture.close(); process.exit(0) })
}
