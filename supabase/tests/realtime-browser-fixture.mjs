import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { createRealtimeFixture } from './realtime-fixture.mjs'

export async function startRealtimeBrowserFixture(origin) {
  const fixture = await createRealtimeFixture(origin)
  const clients = new Set()
  const blocked = new Set()
  const broadcasts = []
  const requests = []
  const joins = []
  let cursor = 0
  const send = (client, topic, event, payload, reference = null, joinReference = null) => {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify(client.version === 1 ? { join_ref: joinReference, ref: reference, topic, event, payload } : [joinReference, reference, topic, event, payload]))
  }
  const flush = async () => {
    const rows = (await fixture.database.query('SELECT * FROM realtime.messages WHERE id>$1 ORDER BY id', [cursor])).rows
    for (const row of rows) {
      cursor = Math.max(cursor, Number(row.id))
      broadcasts.push({ topic: row.topic, event: row.event, payload: row.payload, private: row.private })
      for (const client of clients) if (client.topics.has(`realtime:${row.topic}`)) send(client, `realtime:${row.topic}`, 'broadcast', { type: 'broadcast', event: row.event, payload: row.payload })
    }
  }
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, 'http://fixture.invalid')
      if (url.pathname === '/categories') {
        outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin })
        outgoing.end(JSON.stringify((await fixture.database.query('SELECT id,name,slug FROM public.categories WHERE is_active ORDER BY slug')).rows))
        return
      }
      let body = ''
      for await (const chunk of incoming) { body += chunk.toString(); if (Buffer.byteLength(body) > 8192) throw new Error('Request too large') }
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value)
      const request = new Request(url, { method: incoming.method, headers, body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : body })
      const response = await (url.pathname.includes('/game-engine/') ? fixture.gameHandler : fixture.roomHandler)(request, { sourceAddress: incoming.socket.remoteAddress })
      requests.push({ action: url.pathname.split('/').at(-1), status: response.status, ...(response.status >= 400 ? { code: (await response.clone().json()).error?.code } : {}) })
      await flush()
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    } catch { outgoing.writeHead(500, { 'Content-Type': 'application/json' }); outgoing.end('{"error":{"code":"FIXTURE_ERROR"}}') }
  })
  const sockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => sockets.handleUpgrade(request, socket, head, websocket => sockets.emit('connection', websocket)))
  sockets.on('connection', socket => {
    const client = { socket, topics: new Set(), claims: undefined, expiry: undefined, version: 2 }
    clients.add(client)
    socket.on('message', async bytes => {
      try {
        const frame = JSON.parse(bytes.toString())
        client.version = Array.isArray(frame) ? 2 : 1
        const [joinReference, reference, topic, event, payload] = Array.isArray(frame) ? frame : [frame.join_ref, frame.ref, frame.topic, frame.event, frame.payload]
        const reply = (status, response = {}) => send(client, topic, 'phx_reply', { status, response }, reference, joinReference)
        if (event === 'heartbeat') { reply('ok'); return }
        if (event === 'phx_leave') { client.topics.delete(topic); reply('ok'); return }
        if (event === 'phx_join' || event === 'access_token') {
          const token = payload.access_token
          const valid = await fixture.verify(token)
          const claims = valid ? fixture.claims(token) : undefined
          const allowed = claims && !blocked.has(claims.sub) && await fixture.allowed(topic.replace(/^realtime:/, ''), claims)
          joins.push({ event, version: client.version, validJwt: valid, allowed: !!allowed, private: payload.config?.private })
          if (!allowed || event === 'phx_join' && payload.config?.private !== true) { reply('error', { reason: 'Unauthorized private channel' }); return }
          client.claims = claims
          clearTimeout(client.expiry)
          client.expiry = setTimeout(() => socket.close(1000, 'expired'), Math.max(1, claims.exp * 1000 - Date.now()))
          client.topics.add(topic)
          reply('ok', { postgres_changes: [] })
          return
        }
        reply('error', { reason: 'Client broadcasts are forbidden' })
      } catch { socket.close(1008, 'Invalid frame') }
    })
    socket.on('close', () => { clearTimeout(client.expiry); clients.delete(client) })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const url = `http://127.0.0.1:${server.address().port}`
  return { ...fixture, url, websocketUrl: url.replace('http:', 'ws:') + '/realtime/v1/websocket?apikey=sb_publishable_fixture&vsn=2.0.0', broadcasts, requests, joins,
    members: () => [...clients].filter(client => client.topics.size).map(client => client.claims.sub),
    duplicate(topic, count = 20) { for (let index = 0; index < count; index++) for (const client of clients) if (client.topics.has(`realtime:${topic}`)) send(client, `realtime:${topic}`, 'broadcast', { type: 'broadcast', event: 'invalidate', payload: { changed: true } }) },
    pause(grantId) { blocked.add(grantId); for (const client of clients) if (client.claims?.sub === grantId) client.socket.close(1001, 'local simulated outage') },
    resume(grantId) { blocked.delete(grantId) },
    close: async () => { for (const client of clients) { clearTimeout(client.expiry); client.socket.terminate() } await new Promise(resolve => sockets.close(resolve)); await new Promise(resolve => server.close(resolve)); await fixture.close() },
  }
}
