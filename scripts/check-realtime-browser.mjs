import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import WebSocket from 'ws'
import { startRealtimeBrowserFixture } from '../supabase/tests/realtime-browser-fixture.mjs'

const base = process.env.QA_BASE_URL ?? 'http://localhost:5173/guess-who/'
const origin = new URL(base).origin
const artifacts = '/tmp/guess-who-phase7-browser'
await mkdir(artifacts, { recursive: true, mode: 0o700 })
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
const fixture = await startRealtimeBrowserFixture(origin)
const contexts = []
const checks = []
const errors = []
const leases = new Map()
const playerPackets = []
const pages = []
let browser
let code
let stage = 'browser setup'
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const eventually = async operation => {
  const end = Date.now() + 90000
  while (Date.now() < end) { if (await operation()) return; await sleep(100) }
  throw new Error('Local browser condition not reached')
}
const check = async (name, operation) => { stage = name; console.log(JSON.stringify({ starting: name })); await operation(); checks.push({ name, result: 'PASS' }); console.log(JSON.stringify({ check: name, result: 'PASS' })) }
const pageFor = async name => {
  const context = await browser.newContext({ viewport: { width: name === 'host' ? 1440 : name === 'playerA' ? 390 : 768, height: 1000 } })
  contexts.push(context)
  await context.route(/^https:\/\/[a-z0-9]{20}\.supabase\.co\//, async route => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = { ...request.headers(), origin, apikey: 'sb_publishable_fixture' }
    delete headers.authorization
    const path = url.pathname === '/rest/v1/categories' ? '/categories' : url.pathname
    if (path !== '/categories' && !/^\/functions\/v1\/(room-system|game-engine)\//.test(path)) throw new Error('Unexpected external request')
    const response = await route.fetch({ url: fixture.url + path, headers, timeout: 90000 })
    if (url.pathname.endsWith('/get-realtime-ticket') && response.status() === 200) {
      const ticket = (await response.json()).data
      leases.set(name, { topic: ticket.topic, grantId: fixture.claims(ticket.accessToken).sub, accessToken: ticket.accessToken })
    }
    if (name.startsWith('player') && url.pathname.endsWith('/get-game-state') && response.status() === 200) {
      const data = (await response.json()).data
      if (data.question && !data.question.revealed) {
        assert.deepEqual(Object.keys(data.question).sort(), ['id', 'number', 'revealed'])
        assert.ok(!/隔離測試人物|PRIVATE ANSWER|SECRET-NAME|credential|_hash|gw_/.test(JSON.stringify(data)))
      }
      playerPackets.push({ question: data.question?.number ?? 0, revealed: data.question?.revealed ?? false, keys: data.question ? Object.keys(data.question) : [] })
    }
    await route.fulfill({ response })
  })
  await context.routeWebSocket('**', route => {
    if (!/^wss:\/\/[a-z0-9]{20}\.supabase\.co\/realtime\/v1\/websocket/.test(route.url())) { route.close(); return }
    const socket = new WebSocket(fixture.websocketUrl)
    const queued = []
    let closed = false
    route.onMessage(message => { if (socket.readyState === 1) socket.send(message); else if (!closed) queued.push(message) })
    route.onClose(() => { closed = true; if (socket.readyState === 1) socket.close(); else if (socket.readyState === 0) socket.terminate() })
    socket.on('open', () => { for (const message of queued) socket.send(message); queued.length = 0 })
    socket.on('message', (bytes, binary) => { if (!closed) route.send(binary ? bytes : bytes.toString()) })
    socket.on('close', () => { if (!closed) { closed = true; route.close({ code: 1000, reason: 'local fixture closed' }) } })
    socket.on('error', () => { if (!closed) { closed = true; route.close({ code: 1011, reason: 'local fixture unavailable' }) } })
  })
  const page = await context.newPage()
  pages.push(page)
  page.setDefaultTimeout(90000)
  page.on('pageerror', () => errors.push('runtime error'))
  return { page, context }
}
const waitQuestion = async (page, number, revealed) => {
  await page.getByText(`QUESTION ${number} / 15 · ${revealed ? '已揭曉' : '尚未揭曉'}`, { exact: true }).waitFor()
  await page.waitForFunction(() => (document.querySelector('.game-photo img')?.naturalWidth ?? 0) > 0, { timeout: 90000 })
}
const probe = async token => {
  const socket = new WebSocket(fixture.websocketUrl)
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  const reply = new Promise(resolve => socket.once('message', bytes => resolve(JSON.parse(bytes.toString()))))
  socket.send(JSON.stringify(['1', '1', `realtime:${leases.get('host').topic}`, 'phx_join', { config: { private: true }, access_token: token }]))
  const frame = await reply
  socket.close()
  return frame[4].status
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const { page: host } = await pageFor('host')
  const { page: playerA } = await pageFor('playerA')
  const { page: playerB, context: playerBContext } = await pageFor('playerB')
  let invite
  await check('Host creates room; first Player join automatically updates waiting-room list', async () => {
    await host.goto(`${base}#/host`)
    await host.getByRole('checkbox').first().check()
    await host.getByRole('button', { name: '建立房間', exact: true }).click()
    await host.locator('[data-sync-status="connected"]').waitFor({ timeout: 20000 })
    invite = await host.getByLabel('玩家邀請連結').inputValue()
    code = new URL(invite).hash.split('/').at(-1)
    await playerA.goto(invite)
    await playerA.getByLabel('你的暱稱').fill('P7-A')
    await playerA.getByRole('button', { name: '加入房間', exact: true }).click()
    await playerA.locator('[data-sync-status="connected"]').waitFor()
    await host.getByText('P7-A', { exact: true }).waitFor()
  })
  await check('Host and two independent Players subscribe; second Player joins, leaves and rejoins automatically', async () => {
    await playerB.goto(invite)
    await playerB.getByLabel('你的暱稱').fill('P7-B')
    await playerB.getByRole('button', { name: '加入房間', exact: true }).click()
    await playerB.locator('[data-sync-status="connected"]').waitFor()
    await host.getByText('P7-B', { exact: true }).waitFor()
    await playerA.getByText('P7-B', { exact: true }).waitFor()
    await eventually(() => fixture.members().length === 3)
    await playerB.getByRole('button', { name: '離開房間 →', exact: true }).click()
    await host.getByText('P7-B', { exact: true }).waitFor({ state: 'detached' })
    await playerA.getByText('P7-B', { exact: true }).waitFor({ state: 'detached' })
    await eventually(() => fixture.members().length === 2)
    await playerB.goto(invite)
    await playerB.getByLabel('你的暱稱').fill('P7-B')
    await playerB.getByRole('button', { name: '加入房間', exact: true }).click()
    await playerB.locator('[data-sync-status="connected"]').waitFor()
    await host.getByText('P7-B', { exact: true }).waitFor()
    await eventually(() => fixture.members().length === 3)
  })
  await check('Room Code, publishable key and forged JWT cannot subscribe to the private room', async () => {
    assert.equal(await probe(undefined), 'error')
    const parts = leases.get('playerA').accessToken.split('.')
    parts[1] = Buffer.from(JSON.stringify({ ...fixture.claims(leases.get('playerA').accessToken), rt_room: crypto.randomUUID() })).toString('base64url')
    assert.equal(await probe(parts.join('.')), 'error')
  })
  await check('Host Start automatically moves both Players to question1 with no hidden answer', async () => {
    await host.getByRole('button', { name: '開始遊戲', exact: true }).click()
    for (const page of [host, playerA, playerB]) await waitQuestion(page, 1, false)
    for (const page of [playerA, playerB]) assert.equal(await page.locator('.game-answer h3').count(), 0)
  })
  await check('reload resubscribes Host and Player, restores credentials and state, without duplicate live subscriptions', async () => {
    for (const page of [host, playerA]) {
      const before = await page.evaluate(code => localStorage.getItem(`guess-who:v1:room:${code}`), code)
      await page.reload()
      await page.locator('[data-sync-status="connected"]').waitFor()
      await waitQuestion(page, 1, false)
      assert.equal(await page.evaluate(code => localStorage.getItem(`guess-who:v1:room:${code}`), code), before)
    }
    await eventually(() => fixture.members().length === 3)
    assert.equal(new Set(fixture.members()).size, 3)
  })
  for (let number = 1; number <= 15; number++) await check(`question ${number}: Reveal and Next automatically update both Players`, async () => {
    if (number === 3) {
      const grant = leases.get('playerB').grantId
      fixture.pause(grant)
      await playerBContext.setOffline(true)
      await host.getByRole('button', { name: '揭曉答案', exact: true }).click()
      await waitQuestion(playerA, number, true)
      assert.equal(await playerB.locator('.game-answer h3').count(), 0)
      await sleep(2000)
      fixture.resume(grant)
      await playerBContext.setOffline(false)
      await playerB.evaluate(() => window.dispatchEvent(new Event('online')))
      await waitQuestion(playerB, number, true)
      await playerB.locator('[data-sync-status="connected"]').waitFor()
    } else {
      await host.getByRole('button', { name: '揭曉答案', exact: true }).click()
      for (const page of [playerA, playerB]) await waitQuestion(page, number, true)
    }
    const answer = await host.locator('.game-answer h3').textContent()
    for (const page of [playerA, playerB]) assert.equal(await page.locator('.game-answer h3').textContent(), answer)
    if (number === 5) {
      const before = Number((await fixture.database.query('SELECT current_question FROM public.rooms WHERE room_code=$1', [code])).rows[0].current_question)
      fixture.duplicate(leases.get('host').topic)
      await sleep(2000)
      assert.equal(Number((await fixture.database.query('SELECT current_question FROM public.rooms WHERE room_code=$1', [code])).rows[0].current_question), before)
    }
    if (number < 15) {
      await host.getByRole('button', { name: '下一題', exact: true }).click()
      for (const page of [host, playerA, playerB]) await waitQuestion(page, number + 1, false)
      for (const page of [playerA, playerB]) assert.equal(await page.locator('.game-answer h3').count(), 0)
    }
  })
  await check('Finish after question15 automatically closes both Player screens and preserves fifteen distinct history entries', async () => {
    await host.getByRole('button', { name: '結束遊戲', exact: true }).click()
    await host.getByRole('button', { name: '確認結束遊戲', exact: true }).click()
    for (const page of [host, playerA, playerB]) {
      await page.getByRole('heading', { name: '房間已結束', exact: true }).waitFor()
      assert.equal(await page.locator('.game-panel.lobby-panel').count(), 0)
    }
    const totals = (await fixture.database.query('SELECT count(*)::int AS total,count(DISTINCT celebrity_id)::int AS distinct_people FROM public.room_questions')).rows[0]
    assert.deepEqual(totals, { total: 15, distinct_people: 15 })
    assert.equal(Number((await fixture.database.query('SELECT count(*)::int AS total FROM public.host_question_history')).rows[0].total), 15)
  })
  await check('only constant private invalidation payloads, no leaked answers or browser runtime errors, and subscriptions clean up on exit', async () => {
    for (const event of fixture.broadcasts) { assert.deepEqual(event.payload, { changed: true }); assert.equal(event.private, true); assert.equal(event.event, 'invalidate') }
    assert.equal(errors.length, 0)
    assert.ok(playerPackets.some(packet => packet.question === 15))
    for (const page of [host, playerA, playerB]) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.goto(base)
    }
    await eventually(() => fixture.members().length === 0)
  })
} catch {
  checks.push({ name: stage, result: 'FAIL', details: 'Raw errors and fixture tokens withheld; no Cloud requests.' })
  console.log(JSON.stringify({ diagnostic: { requests: fixture.requests.slice(-15), joins: fixture.joins.slice(-10), statuses: await Promise.all(pages.map(page => page.locator('[data-sync-status]').textContent().catch(() => null))) } }))
  process.exitCode = 1
} finally {
  const result = { result: checks.some(check => check.result === 'FAIL') ? 'FAIL' : 'PASS', backend: 'Local real Edge handlers + isolated PGlite + local Phoenix/WebSocket protocol fixture, NOT Supabase Cloud Realtime', browser: browser?.version(), cloudRequests: 0, checks, broadcastMessages: fixture.broadcasts.length, rateLimitedRequests: fixture.requests.filter(request => request.status === 429).length, playerStateResponses: playerPackets.length, runtimeErrors: errors.length, artifacts }
  await writeFile(`${artifacts}/results.json`, JSON.stringify(result, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(result, null, 2))
  await Promise.all(contexts.map(context => context.close()))
  await browser?.close()
  await fixture.close()
}
