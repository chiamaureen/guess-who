import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { startBrowserFixture } from '../supabase/tests/browser-fixture.mjs'

const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5177/guess-who/'
const origin = new URL(base).origin
const artifacts = process.env.QA_ARTIFACTS ?? '/tmp/guess-who-phase5-qa'
await mkdir(artifacts, { recursive: true })
let chromium
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')) }
catch { console.log('BLOCKED: Playwright unavailable. Set PLAYWRIGHT_MODULE to an installed module; no browser checks passed.'); process.exitCode = 2 }

if (chromium) {
  const isolatedBackend = await startBrowserFixture({ port: 0, origin })
  const fixture = isolatedBackend.url
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const checks = []
  const runtimeErrors = []
  const blockedRequests = []
  const contexts = []
  let dropCreate = true
  let categoryMode = 'normal'
  let roomCode
  let invite
  let firstStateRequestAt
  const redact = message => message.replace(/(?:gw_(?:host|room|player)|sb_publishable|sb_secret|sbp)_[A-Za-z0-9_-]+/g, '[REDACTED]')
  async function check(name, operation) {
    try { await operation(); checks.push({ name, result: 'PASS' }) }
    catch (error) { checks.push({ name, result: 'FAIL', details: redact(error.message) }); throw new Error(`Browser verification stopped at ${name}`) }
  }
  async function context(label) {
    const value = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    contexts.push(value)
    await value.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    await value.route(/^https:\/\/[a-z0-9]{20}\.supabase\.co\//, async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/rest/v1/categories') {
        if (categoryMode === 'empty') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        if (categoryMode === 'error') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"fixture unavailable"}' })
        return route.fulfill({ response: await route.fetch({ url: `${fixture}/categories`, headers: { origin } }) })
      }
      if (url.pathname.startsWith('/functions/v1/room-system/')) {
        if (url.pathname.endsWith('/get-room-state') && firstStateRequestAt === undefined) firstStateRequestAt = Date.now()
        const headers = { ...request.headers(), origin, apikey: 'sb_publishable_fixture', 'x-forwarded-for': `fixture-${label}` }
        delete headers.authorization
        const response = await route.fetch({ url: `${fixture}${url.pathname}`, headers })
        if (dropCreate && url.pathname.endsWith('/create-room')) { dropCreate = false; return route.abort('failed') }
        return route.fulfill({ response })
      }
      blockedRequests.push(url.pathname)
      return route.abort('blockedbyclient')
    })
    const page = await value.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => runtimeErrors.push(redact(error.message)))
    return page
  }
  const stats = async () => (await fetch(`${fixture}/test/stats`)).json()
  try {
    assert.equal((await stats()).hosts, 0, 'Restart the isolated fixture before rerunning this suite')
    const host = await context('host')
    const player = await context('player')
    const manual = await context('manual')
    await check('homepage navigation and how-to-play hash return', async () => {
      await host.goto(`${base}#/`)
      await host.getByRole('navigation').getByRole('link', { name: '怎麼玩？' }).click()
      await host.waitForURL('**/#/#how-to-play')
      assert.equal(await host.getByRole('navigation').getByRole('link', { name: '怎麼玩？' }).getAttribute('aria-current'), 'location')
      await host.evaluate(() => window.scrollTo(0, 0))
      await host.waitForURL('**/#/')
      await host.getByRole('link', { name: '建立房間', exact: true }).click()
      await host.waitForURL('**/#/host')
    })
    await check('seven dynamic categories, multi-select and empty selection disabled', async () => {
      await host.getByRole('checkbox').nth(6).waitFor()
      assert.equal(await host.getByRole('checkbox').count(), 7)
      assert.equal(await host.getByRole('button', { name: '建立房間', exact: true }).isDisabled(), true)
      await host.getByRole('checkbox').nth(0).check()
      await host.getByRole('checkbox').nth(1).check()
      assert.equal(await host.getByRole('checkbox', { checked: true }).count(), 2)
    })
    await check('lost create response retries the same request and creates only one room', async () => {
      await host.getByRole('button', { name: '建立房間', exact: true }).click()
      await host.getByRole('button', { name: '確認上次建立結果' }).waitFor()
      assert.equal((await stats()).rooms, 1)
      await host.getByRole('button', { name: '確認上次建立結果' }).click()
      await host.waitForURL(/#\/room\/[A-Z0-9]{6}$/)
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
      roomCode = new URL(host.url()).hash.split('/').at(-1)
      assert.match(roomCode, /^[A-HJ-NP-Z2-9]{6}$/)
      assert.deepEqual(await stats(), { hosts: 1, rooms: 1, players: 0 })
      assert.equal(await host.locator('.category-tags li').count(), 2)
    })
    await check('host-only invitation contains code, never tokens or query parameters', async () => {
      invite = await host.getByLabel('玩家邀請連結').inputValue()
      const url = new URL(invite)
      assert.equal(url.pathname, '/guess-who/')
      assert.equal(url.search, '')
      assert.equal(url.hash, `#/room/${roomCode}`)
      assert.ok(!/gw_|token|credential|session/i.test(invite))
      await host.getByRole('button', { name: '複製邀請連結' }).click()
      await host.getByText('邀請連結已複製。').waitFor()
    })
    await check('host refresh restores server-authorized control, no fake start action', async () => {
      await host.reload()
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
      assert.equal(await host.getByRole('button', { name: '開始遊戲（尚未開放）' }).isDisabled(), true)
      assert.equal((await stats()).hosts, 1)
    })
    await check('invitation opens nickname form without creating a host or player', async () => {
      await player.goto(invite)
      assert.equal(await player.getByLabel('房間代碼', { exact: true }).inputValue(), roomCode)
      assert.equal(await player.getByRole('button', { name: '加入房間', exact: true }).getAttribute('data-magnetic-target'), null)
      assert.deepEqual(await stats(), { hosts: 1, rooms: 1, players: 0 })
    })
    await check('player joins via invitation and refresh restores the same session', async () => {
      await player.getByLabel('你的暱稱').fill('ABCDEFGHIJKLMNOPQRST')
      await player.getByRole('button', { name: '加入房間', exact: true }).click()
      await player.locator('.lobby-waiting').filter({ hasText: '等待主持人開始遊戲' }).waitFor()
      assert.equal(await player.getByRole('button', { name: '關閉房間', exact: true }).count(), 0)
      await player.reload()
      await player.locator('.lobby-waiting').filter({ hasText: '等待主持人開始遊戲' }).waitFor()
      assert.equal((await stats()).players, 1)
    })
    await check('manual join validates required nickname, malformed and missing room code', async () => {
      await manual.goto(`${base}#/join`)
      await manual.getByLabel('房間代碼', { exact: true }).fill(roomCode)
      await manual.getByRole('button', { name: '加入房間', exact: true }).click()
      assert.equal(await manual.getByLabel('你的暱稱').evaluate(input => input.validity.valueMissing), true)
      await manual.getByLabel('你的暱稱').fill('小明')
      await manual.getByLabel('房間代碼', { exact: true }).fill('BAD!23')
      await manual.getByRole('button', { name: '加入房間', exact: true }).click()
      await manual.getByRole('alert').filter({ hasText: '6 碼' }).waitFor()
      await manual.getByLabel('房間代碼', { exact: true }).fill('XXXXXX')
      await manual.getByRole('button', { name: '加入房間', exact: true }).click()
      await manual.getByRole('alert').filter({ hasText: '找不到這個房間' }).waitFor()
    })
    await check('manual code join and duplicate join retain one player per session', async () => {
      await manual.getByLabel('房間代碼', { exact: true }).fill(roomCode.toLowerCase())
      await manual.getByRole('button', { name: '加入房間', exact: true }).click()
      await manual.locator('.lobby-waiting').filter({ hasText: '等待主持人開始遊戲' }).waitFor()
      await manual.goto(`${base}#/join?code=${roomCode}`)
      await manual.getByLabel('你的暱稱').fill('小明')
      await manual.getByRole('button', { name: '加入房間', exact: true }).click()
      await manual.locator('.lobby-waiting').filter({ hasText: '等待主持人開始遊戲' }).waitFor()
      assert.equal((await stats()).players, 2)
    })
    await check('manual refresh updates host roster and is cooldown-limited', async () => {
      await host.getByRole('button', { name: '重新整理名單' }).click()
      await host.getByText('名單已更新。').waitFor()
      assert.equal(await host.locator('.player-list li').count(), 2)
      assert.equal(await host.getByRole('button', { name: '請稍候 5 秒' }).isDisabled(), true)
    })
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      for (const [page, route, name] of [[host, '', 'home'], [host, 'host', 'create'], [host, 'join', 'join'], [host, `room/${roomCode}`, 'host-lobby'], [player, `room/${roomCode}`, 'player-lobby']]) {
        await check(`RWD ${name} ${width}px`, async () => {
          await page.setViewportSize({ width, height: 1000 })
          await page.goto(`${base}#/${route}`, { waitUntil: 'networkidle' })
          if (route.startsWith('room/')) await page.locator('.lobby-grid').waitFor()
          if (route === 'host') await page.getByRole('checkbox').nth(6).waitFor()
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow')
          if ([375, 1440].includes(width)) await page.screenshot({ path: `${artifacts}/${name}-${width}.png`, fullPage: true })
        })
      }
      if (width === 375) {
        const sharedSourceWait = Math.max(0, 61000 - (Date.now() - firstStateRequestAt))
        if (sharedSourceWait) await new Promise(resolve => setTimeout(resolve, sharedSourceWait))
      }
    }
    await check('player can leave without deleting the room or another player', async () => {
      await player.getByRole('button', { name: '離開房間' }).click()
      await player.waitForURL('**/#/join')
      assert.deepEqual(await stats(), { hosts: 1, rooms: 1, players: 1 })
      await host.reload()
      await host.locator('.player-list li').waitFor()
      assert.equal(await host.locator('.player-list li').count(), 1)
    })
    await check('a new category appears without frontend schema or component changes', async () => {
      await fetch(`${fixture}/test/add-category`, { method: 'POST' })
      await host.goto(`${base}#/host`)
      await host.getByText('未來分類', { exact: true }).waitFor()
      assert.equal(await host.getByRole('checkbox').count(), 8)
    })
    await check('category empty and error states have no mock fallback and can retry', async () => {
      categoryMode = 'empty'
      await host.reload()
      await host.getByText('目前沒有可選分類，請稍後再試。').waitFor()
      assert.equal(await host.getByRole('button', { name: '建立房間', exact: true }).isDisabled(), true)
      categoryMode = 'error'
      await host.reload()
      await host.getByRole('button', { name: '重試讀取分類' }).waitFor()
      categoryMode = 'normal'
      await host.getByRole('button', { name: '重試讀取分類' }).click()
      await host.getByText('未來分類', { exact: true }).waitFor()
    })
    await check('cross-room host identity stays stable; second room can close safely', async () => {
      await host.getByRole('checkbox').nth(0).check()
      await host.getByRole('button', { name: '建立房間', exact: true }).click()
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
      assert.equal((await stats()).hosts, 1)
      assert.equal((await stats()).rooms, 2)
      await host.getByRole('button', { name: '關閉房間', exact: true }).click()
      await host.getByRole('button', { name: '確認關閉房間' }).click()
      await host.getByText('主持人已關閉房間，不能再加入。').waitFor()
      await host.goto(invite)
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
    })
    await check('forged local host flags and public host ID do not grant control', async () => {
      const attacker = await context('attacker')
      await attacker.goto(`${base}#/`)
      await attacker.evaluate(code => {
        localStorage.setItem('guess-who:v1:host', JSON.stringify({ hostId: '20000000-0000-4000-8000-000000000001', credential: `gw_host_${'A'.repeat(43)}` }))
        localStorage.setItem(`guess-who:v1:room:${code}`, JSON.stringify({ role: 'host', token: `gw_room_${'A'.repeat(43)}` }))
      }, roomCode)
      await attacker.goto(invite)
      await attacker.getByRole('heading', { name: '暫時無法進入房間' }).waitFor()
      assert.equal(await attacker.getByRole('button', { name: '關閉房間', exact: true }).count(), 0)
    })
    await check('host closure persists, existing players see finished and new joins fail', async () => {
      await host.getByRole('button', { name: '關閉房間', exact: true }).click()
      await host.getByRole('button', { name: '確認關閉房間' }).click()
      await host.getByText('主持人已關閉房間，不能再加入。').waitFor()
      await manual.reload()
      await manual.getByText('主持人已關閉房間，不能再加入。').waitFor()
      await player.goto(invite)
      await player.getByLabel('你的暱稱').fill('晚到的朋友')
      await player.getByRole('button', { name: '加入房間', exact: true }).click()
      await player.getByRole('alert').filter({ hasText: '房間已關閉' }).waitFor()
    })
    await check('host identity revocation is explicit and clears control only after server success', async () => {
      await host.goto(`${base}#/host`)
      await host.locator('.identity-settings summary').click()
      await host.getByRole('button', { name: '撤銷此裝置主持人身分', exact: true }).click()
      await host.getByRole('button', { name: '確認撤銷身分', exact: true }).click()
      await host.getByText('舊主持人憑證已撤銷，下次建立房間會建立新身分。').waitFor()
      assert.equal(await host.evaluate(() => localStorage.getItem('guess-who:v1:host') === null), true)
      assert.equal((await stats()).hosts, 1)
    })
    await check('runtime errors and unrecognized Supabase requests', async () => { assert.deepEqual(runtimeErrors, []); assert.deepEqual(blockedRequests, []) })
  } catch (error) {
    if (!checks.some(item => item.result === 'FAIL')) checks.push({ name: 'browser harness', result: 'FAIL', details: redact(error.message) })
    for (const [index, value] of contexts.entries()) for (const page of value.pages()) await page.screenshot({ path: `${artifacts}/failure-${index}.png`, fullPage: true }).catch(() => undefined)
  } finally {
    const result = { browser: browser.version(), backend: 'real Fetch handler + isolated PGlite; transport redirected locally; NOT Cloud or Deno runtime', passed: checks.filter(item => item.result === 'PASS').length, failed: checks.filter(item => item.result === 'FAIL'), checks, runtimeErrors, blockedRequests, artifacts }
    await writeFile(`${artifacts}/results.json`, JSON.stringify(result, null, 2))
    console.log(JSON.stringify({ browser: result.browser, backend: result.backend, passed: result.passed, failed: result.failed, artifacts }, null, 2))
    await Promise.all(contexts.map(value => value.close()))
    await browser.close()
    await isolatedBackend.close()
    if (result.failed.length) process.exitCode = 1
  }
}
