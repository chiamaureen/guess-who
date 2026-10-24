import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { startBrowserFixture } from '../supabase/tests/browser-fixture.mjs'

const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5177/guess-who/'
const origin = new URL(base).origin
const artifacts = '/tmp/guess-who-phase9-polling-browser'
await mkdir(artifacts, { recursive: true, mode: 0o700 })
let chromium
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')) }
catch { console.log('BLOCKED: Playwright unavailable; no browser checks passed.'); process.exitCode = 2 }
if (chromium) {
  const fixture = await startBrowserFixture({ port: 0, origin, gamePeople: 15, legacyGameDto: true })
  const contexts = []
  const checks = []
  const errors = []
  const requestCounts = new Map()
  const reads = new Map()
  const throttle = new Map()
  const hiddenQuestions = new Set()
  const answers = new Set()
  let ticketRequests = 0
  let socketRequests = 0
  let rateLimits = 0
  let browser
  let stage = 'browser setup'
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  const check = async (name, operation) => { stage = name; console.log(JSON.stringify({ starting: name })); await operation(); checks.push({ name, result: 'PASS' }); console.log(JSON.stringify({ check: name, result: 'PASS' })) }
  const pageFor = async (label, width) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    contexts.push(context)
    requestCounts.set(label, 0); reads.set(label, [])
    await context.routeWebSocket('**', route => { socketRequests++; route.close() })
    await context.route(/^https:\/\/[a-z0-9]{20}\.supabase\.co\//, async route => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname === '/rest/v1/categories' ? '/categories' : url.pathname
      if (path !== '/categories' && !/^\/functions\/v1\/(room-system|game-engine)\//.test(path)) { errors.push('unexpected backend path'); return route.abort() }
      if (path.endsWith('/get-realtime-ticket')) { ticketRequests++; return route.fulfill({ status: 404, body: '{}' }) }
      requestCounts.set(label, requestCounts.get(label) + 1)
      const isState = /\/(get-room-state|get-game-state)$/.test(path)
      if (isState) reads.get(label).push(Date.now())
      const simulated = throttle.get(label)
      if (isState && simulated?.pending) {
        simulated.pending = false; simulated.deniedAt = Date.now()
        return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '12', 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Retry-After', 'Cache-Control': 'no-store' }, body: '{"error":{"code":"RATE_LIMITED"}}' })
      }
      const headers = { ...request.headers(), origin, apikey: 'sb_publishable_fixture' }
      delete headers.authorization
      const response = await route.fetch({ url: fixture.url + path, headers, timeout: 90000 })
      if (response.status() === 429) rateLimits++
      if (label !== 'host' && path.endsWith('/get-game-state') && response.status() === 200) {
        const data = (await response.json()).data
        assert.equal(data.players, undefined)
        assert.equal(data.categories, undefined)
        if (data.question && !data.question.revealed) {
          assert.deepEqual(Object.keys(data.question).sort(), ['id', 'number', 'revealed'])
          assert.ok(!/隔離測試人物|PRIVATE ANSWER|SECRET-NAME|credential|_hash|gw_|attribution|celebrity|historyRevision/.test(JSON.stringify(data)))
          hiddenQuestions.add(data.question.number)
        }
      }
      return route.fulfill({ response })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(120000)
    page.on('pageerror', () => errors.push('runtime error'))
    return { page, context }
  }
  const question = async (page, number, revealed) => {
    await page.getByText(`QUESTION ${number} / 15 · ${revealed ? '已揭曉' : '尚未揭曉'}`, { exact: true }).waitFor()
    await page.waitForFunction(() => (document.querySelector('.game-photo img')?.naturalWidth ?? 0) > 0)
  }
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const { page: host } = await pageFor('host', 1440)
    const { page: playerA } = await pageFor('playerA', 390)
    const { page: playerB, context: contextB } = await pageFor('playerB', 768)
    let invite
    const join = async (page, nickname) => {
      await page.goto(invite)
      await page.getByLabel('你的暱稱').fill(nickname)
      await page.getByRole('button', { name: '加入房間', exact: true }).click()
      await page.locator('[data-sync-status="connected"]').waitFor()
    }
    await check('Host and two Players join with Phase 6 DTO; waiting roster updates without manual refresh', async () => {
      await host.goto(`${base}#/host`)
      await host.getByRole('checkbox').first().check()
      await host.getByRole('button', { name: '建立房間', exact: true }).click()
      await host.locator('[data-sync-status="connected"]').waitFor()
      assert.ok((await host.locator('[data-sync-status]').textContent()).includes('Polling'))
      invite = await host.getByLabel('玩家邀請連結').inputValue()
      assert.ok(!/token|credential|gw_/.test(invite))
      await join(playerA, 'MVP-A'); await join(playerB, 'MVP-B')
      await host.locator('.player-list').getByText('MVP-B', { exact: true }).waitFor()
      assert.equal(await host.locator('.player-list li').count(), 2)
    })
    await check('Player leaves and rejoins; waiting roster follows automatically and leaving stops polling', async () => {
      await playerB.getByRole('button', { name: '離開房間' }).click()
      await playerB.waitForURL('**/#/join')
      const count = requestCounts.get('playerB')
      await host.waitForFunction(() => document.querySelectorAll('.player-list li').length === 1)
      await sleep(11000)
      assert.equal(requestCounts.get('playerB'), count)
      await join(playerB, 'MVP-B')
      await host.waitForFunction(() => document.querySelectorAll('.player-list li').length === 2)
    })
    await check('429 Retry-After blocks polls and then automatically recovers', async () => {
      const value = { pending: true }
      throttle.set('playerA', value)
      await playerA.locator('[data-sync-status="reconnecting"]').waitFor()
      await playerA.locator('[data-sync-status="connected"]').waitFor()
      const following = reads.get('playerA').find(time => time > value.deniedAt + 100)
      assert.ok(following - value.deniedAt >= 12000)
    })
    await check('background visibility pauses one loop and foreground resumes automatically', async () => {
      await playerB.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
      await sleep(1000)
      const count = reads.get('playerB').length
      await sleep(11000)
      assert.equal(reads.get('playerB').length, count)
      await playerB.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')) })
      await playerB.waitForFunction(() => document.querySelector('[data-sync-status]')?.getAttribute('data-sync-status') === 'connected')
    })
    await check('Host starts; both Players automatically load question1 and a protected PNG without an answer', async () => {
      await host.getByRole('button', { name: '開始遊戲', exact: true }).click()
      await question(host, 1, false)
      await Promise.all([question(playerA, 1, false), question(playerB, 1, false)])
      for (const page of [playerA, playerB]) assert.equal(await page.locator('.game-answer h3').count(), 0)
    })
    await check('Host and Player reload retain sessions, question1, answer isolation, and one active loop', async () => {
      const answer = await host.locator('.game-answer h3').textContent()
      await host.reload(); await playerA.reload()
      await Promise.all([question(host, 1, false), question(playerA, 1, false)])
      assert.equal(await host.locator('.game-answer h3').textContent(), answer)
      assert.equal(await playerA.locator('.game-answer h3').count(), 0)
      const before = reads.get('host').length
      await sleep(21000)
      assert.ok(reads.get('host').length - before <= 3)
    })
    for (let number = 1; number <= 15; number++) {
      await check(`question ${number}/15: no hidden Player answer, Host reveal, automatic Player answer and next image`, async () => {
        await Promise.all([question(host, number, false), question(playerA, number, false), question(playerB, number, false)])
        for (const page of [playerA, playerB]) assert.equal(await page.locator('.game-answer h3').count(), 0)
        const answer = await host.locator('.game-answer h3').textContent()
        assert.ok(answer); assert.ok(!answers.has(answer)); answers.add(answer)
        await host.getByRole('button', { name: '揭曉答案', exact: true }).click()
        await Promise.all([question(playerA, number, true), question(playerB, number, true)])
        for (const page of [playerA, playerB]) assert.equal(await page.locator('.game-answer h3').textContent(), answer)
        if (number === 3) {
          await contextB.setOffline(true)
        }
        if (number < 15) {
          await host.getByRole('button', { name: '下一題', exact: true }).click()
          await question(host, number + 1, false)
          if (number === 3) {
            const count = reads.get('playerB').length
            await sleep(11000)
            assert.equal(reads.get('playerB').length, count)
            await contextB.setOffline(false)
          }
        }
      })
    }
    await check('question16 is disabled; Finish reaches both Players and stops every polling loop', async () => {
      assert.equal(await host.getByRole('button', { name: '下一題', exact: true }).isDisabled(), true)
      await host.getByRole('button', { name: '結束遊戲', exact: true }).click()
      await host.getByRole('button', { name: '確認結束遊戲', exact: true }).click()
      await Promise.all([host, playerA, playerB].map(page => page.locator('[data-sync-status="stopped"]').waitFor()))
      await sleep(1000)
      const counts = [...reads.values()].map(values => values.length)
      await sleep(12000)
      assert.deepEqual([...reads.values()].map(values => values.length), counts)
    })
    await check('15 distinct local people, 15 revealed questions, and 15 retained C-mode history rows', async () => {
      const stats = await (await fetch(`${fixture.url}/test/game-stats`)).json()
      assert.deepEqual(stats, { questions: 15, distinct_people: 15, revealed: 15, history: 15 })
      assert.equal(answers.size, 15)
      assert.equal(hiddenQuestions.size, 15)
    })
    await check('mobile/tablet/desktop layout, no Phase 7 tickets, no WebSockets, no runtime errors', async () => {
      for (const page of [host, playerA, playerB]) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      assert.equal(ticketRequests, 0); assert.equal(socketRequests, 0); assert.deepEqual(errors, [])
    })
  } catch (error) {
    checks.push({ name: stage, result: 'FAIL', details: String(error.message).replace(/(?:gw_(?:host|room|player)|sb_publishable|sb_secret|sbp)_[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 600) })
  } finally {
    const results = { backend: 'LOCAL ONLY real handlers, isolated PGlite, legacy Phase 6 DTO; NOT Cloud or public Pages', passed: checks.filter(value => value.result === 'PASS').length, failed: checks.filter(value => value.result === 'FAIL'), checks, ticketRequests, socketRequests, observedRealLocal429: rateLimits, cloudRequests: 0, runtimeErrors: errors }
    await writeFile(`${artifacts}/results.json`, JSON.stringify(results, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ ...results, checks: undefined }, null, 2))
    await Promise.all(contexts.map(context => context.close())); await browser?.close(); await fixture.close()
    if (results.failed.length) process.exitCode = 1
  }
}
