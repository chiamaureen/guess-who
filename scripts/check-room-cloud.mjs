import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readEnvironment } from './check-supabase.mjs'
import { readSupabaseConfig } from '../src/lib/supabase-config.ts'

const projectRef = 'fgvajdnzrnptdjurhjfo'
if (process.argv.slice(2).join(' ') !== `--allow-test-writes --project-ref ${projectRef}`) {
  console.log('BLOCKED: explicit --allow-test-writes --project-ref approval target required. This script creates real Cloud test data.')
  process.exitCode = 2
} else {
  const config = readSupabaseConfig(await readEnvironment())
  assert.equal(config.url, `https://${projectRef}.supabase.co`)
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
  const base = 'http://127.0.0.1:5173/guess-who/'
  const origin = new URL(base).origin
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(4, 12)
  const label = `P5QA${stamp}`
  const artifacts = `/tmp/guess-who-phase5-cloud-${stamp}`
  const backup = join(homedir(), '.config', 'guess-who', `cloud-test-${stamp}.json`)
  await mkdir(artifacts, { recursive: true, mode: 0o700 })
  await writeFile(backup, '{}', { flag: 'wx', mode: 0o600 })
  const checks = []
  const pages = new Map()
  const snapshots = new Map()
  const receipts = []
  const extraIdentities = []
  const runtimeErrors = []
  const unexpectedResponses = []
  let stage = 'launch browser'
  let browser
  let firstRoom
  let secondRoom
  let invite
  let hostId
  let playerToken
  const nonce = () => randomBytes(32).toString('base64url')
  const contexts = []
  const roomCredentials = async (page, code) => page.evaluate(roomCode => {
    const room = JSON.parse(localStorage.getItem(`guess-who:v1:room:${roomCode}`))
    const host = JSON.parse(localStorage.getItem('guess-who:v1:host'))
    return room?.role === 'host' ? { 'x-host-credential': host.credential, 'x-room-token': room.token } : { 'x-player-session': room.token }
  }, code)
  async function checkpoint() {
    const sessions = []
    for (const [name, page] of pages) {
      try { sessions.push({ name, storage: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('guess-who:v1:')))) }) } catch {}
    }
    await writeFile(backup, JSON.stringify({ projectRef, label, sessions, extraIdentities, receipts }), { mode: 0o600 })
  }
  async function check(name, operation) {
    stage = name
    await operation()
    checks.push({ name, result: 'PASS' })
    await checkpoint()
  }
  async function api(action, input, credentials = {}, expectedStatus = 200) {
    const response = await fetch(`${config.url}/functions/v1/room-system/${action}`, { method: 'POST', headers: { Origin: origin, apikey: config.publishableKey, 'Content-Type': 'application/json', ...credentials }, body: JSON.stringify(input), redirect: 'error', signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, expectedStatus)
    const body = await response.json()
    if (expectedStatus === 200) { assert.ok(body.data); return body.data }
    assert.ok(body.error && typeof body.error.code === 'string')
    return body
  }
  async function pageFor(name) {
    const context = await browser.newContext({ viewport: { width: name === 'player' ? 375 : 1440, height: 1000 } })
    contexts.push(context)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    const page = await context.newPage()
    page.setDefaultTimeout(20000)
    page.on('pageerror', () => runtimeErrors.push('browser runtime error; raw details withheld'))
    page.on('response', async response => {
      if (!response.url().startsWith(`${config.url}/functions/v1/room-system/`)) return
      if (response.status() >= 500) unexpectedResponses.push({ status: response.status() })
      if (response.status() !== 200) return
      try {
        const body = await response.json()
        const data = body.data
        if (!data?.room || !data?.viewer) return
        snapshots.set(name, { room: data.room, viewer: data.viewer, players: data.players, categories: data.categories })
        const existing = receipts.find(room => room.id === data.room.id)
        if (existing) existing.status = data.room.status
        else receipts.push({ id: data.room.id, code: data.room.code, hostId: data.viewer.role === 'host' ? data.viewer.id : undefined, status: data.room.status })
      } catch {}
    })
    pages.set(name, page)
    return page
  }
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const host = await pageFor('host')
    const player = await pageFor('player')
    const manual = await pageFor('manual')
    await check('real Cloud categories and host multi-select create waiting room', async () => {
      await host.goto(`${base}#/host`)
      await host.getByRole('checkbox').nth(6).waitFor()
      assert.equal(await host.getByRole('checkbox').count(), 7)
      await host.getByRole('checkbox').nth(0).check()
      await host.getByRole('checkbox').nth(1).check()
      await host.getByRole('button', { name: '建立房間', exact: true }).click()
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
      firstRoom = new URL(host.url()).hash.split('/').at(-1)
      assert.match(firstRoom, /^[A-HJ-NP-Z2-9]{6}$/)
      hostId = await host.evaluate(() => JSON.parse(localStorage.getItem('guess-who:v1:host')).hostId)
      assert.equal(await host.locator('.category-tags li').count(), 2)
      assert.equal(await host.getByRole('button', { name: '開始遊戲（尚未開放）' }).isDisabled(), true)
    })
    await check('host refresh restores authorized control and original host identity', async () => {
      await host.reload()
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
      assert.equal(await host.evaluate(() => JSON.parse(localStorage.getItem('guess-who:v1:host')).hostId), hostId)
    })
    await check('invite contains only room code and opens real player join form', async () => {
      invite = await host.getByLabel('玩家邀請連結').inputValue()
      assert.equal(new URL(invite).hash, `#/room/${firstRoom}`)
      assert.ok(!/gw_|token|credential|session/i.test(invite))
      await host.getByRole('button', { name: '複製邀請連結' }).click()
      assert.equal(await host.evaluate(() => navigator.clipboard.readText()), invite)
      await player.goto(invite)
      await player.getByLabel('你的暱稱').fill(`${label}-A`)
      await player.getByRole('button', { name: '加入房間', exact: true }).click()
      await player.locator('.lobby-waiting').filter({ hasText: '等待主持人開始遊戲' }).waitFor()
      playerToken = await player.evaluate(code => JSON.parse(localStorage.getItem(`guess-who:v1:room:${code}`)).token, firstRoom)
    })
    await check('player refresh keeps same session without duplicate players', async () => {
      await player.reload()
      await player.locator('.lobby-waiting').filter({ hasText: '等待主持人開始遊戲' }).waitFor()
      assert.ok(await player.evaluate(({ code, token }) => JSON.parse(localStorage.getItem(`guess-who:v1:room:${code}`)).token === token, { code: firstRoom, token: playerToken }))
      assert.equal(await player.locator('.player-list li').count(), 1)
    })
    await check('second independent player joins by lowercase manual code', async () => {
      await manual.goto(`${base}#/join`)
      await manual.getByLabel('房間代碼', { exact: true }).fill(firstRoom.toLowerCase())
      await manual.getByLabel('你的暱稱').fill(`${label}-B`)
      await manual.getByRole('button', { name: '加入房間', exact: true }).click()
      await manual.locator('.lobby-waiting').filter({ hasText: '等待主持人開始遊戲' }).waitFor()
      await host.getByRole('button', { name: '重新整理名單' }).click()
      await host.getByText('名單已更新。').waitFor()
      assert.equal(await host.locator('.player-list li').count(), 2)
      assert.equal(await host.getByRole('button', { name: '請稍候 5 秒' }).isDisabled(), true)
    })
    await check('host identity persists across two rooms and close is server-persistent', async () => {
      await host.goto(`${base}#/host`)
      await host.getByRole('checkbox').nth(0).check()
      await host.getByRole('button', { name: '建立房間', exact: true }).click()
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
      secondRoom = new URL(host.url()).hash.split('/').at(-1)
      assert.notEqual(secondRoom, firstRoom)
      assert.equal(await host.evaluate(() => JSON.parse(localStorage.getItem('guess-who:v1:host')).hostId), hostId)
      await host.getByRole('button', { name: '關閉房間', exact: true }).click()
      await host.getByRole('button', { name: '確認關閉房間' }).click()
      await host.getByText('主持人已關閉房間，不能再加入。').waitFor()
      await host.reload()
      await host.getByText('主持人已關閉房間，不能再加入。').waitFor()
      await host.goto(invite)
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
    })
    await check('real API denies fake identity, player control and wrong room tokens', async () => {
      const hostHeaders = await roomCredentials(host, firstRoom)
      const playerHeaders = await roomCredentials(player, firstRoom)
      const wrongRoomHeaders = await roomCredentials(host, secondRoom)
      await api('close-room', { roomCode: firstRoom }, playerHeaders, 401)
      await api('get-room-state', { roomCode: firstRoom }, { 'x-host-credential': `gw_host_${nonce()}`, 'x-room-token': hostHeaders['x-room-token'] }, 401)
      await api('get-room-state', { roomCode: firstRoom }, { 'x-room-token': hostHeaders['x-room-token'] }, 401)
      await api('get-room-state', { roomCode: firstRoom }, wrongRoomHeaders, 403)
      await api('get-room-state', { roomCode: firstRoom, hostId, role: 'host' }, playerHeaders, 400)
      const bootstrapKey = nonce()
      const other = await api('host-session', { mode: 'bootstrap', bootstrapKey })
      extraIdentities.push({ ...other, bootstrapKey })
      await checkpoint()
      await api('close-room', { roomCode: firstRoom }, { 'x-host-credential': other.credential, 'x-room-token': hostHeaders['x-room-token'] }, 403)
      const resumed = await api('host-session', { mode: 'resume' }, { 'x-host-credential': hostHeaders['x-host-credential'] })
      assert.equal(resumed.hostId, hostId)
      const state = await api('get-room-state', { roomCode: firstRoom }, hostHeaders)
      assert.equal(state.room.status, 'waiting')
      assert.equal(state.players.length, 2)
      const serialized = JSON.stringify(state)
      for (const value of [...Object.values(hostHeaders), ...Object.values(playerHeaders)]) assert.ok(!serialized.includes(value))
      assert.ok(!/credential_hash|session_token_hash|host_token_hash|celebrity|history/.test(serialized))
    })
    await check('only own newly-created test player leaves; other player remains', async () => {
      await player.getByRole('button', { name: '離開房間' }).click()
      await player.waitForURL('**/#/join')
      await host.reload()
      await host.getByRole('heading', { name: '朋友，快來集合！' }).waitFor()
      assert.equal(await host.locator('.player-list li').count(), 1)
      await host.getByText(`${label}-B`, { exact: true }).waitFor()
    })
    await check('host closes original room; player reload sees finished and late join fails', async () => {
      await host.getByRole('button', { name: '關閉房間', exact: true }).click()
      await host.getByRole('button', { name: '確認關閉房間' }).click()
      await host.getByText('主持人已關閉房間，不能再加入。').waitFor()
      await manual.reload()
      await manual.getByText('主持人已關閉房間，不能再加入。').waitFor()
      await player.goto(invite)
      await player.getByLabel('你的暱稱').fill(`${label}-late`)
      await player.getByRole('button', { name: '加入房間', exact: true }).click()
      await player.getByRole('alert').filter({ hasText: '房間已關閉' }).waitFor()
    })
    await check('explicit revoke preserves closed rooms and never starts game engine', async () => {
      for (const identity of extraIdentities) await api('host-session', { mode: 'revoke', confirm: true }, { 'x-host-credential': identity.credential })
      await host.goto(`${base}#/host`)
      await host.locator('.identity-settings summary').click()
      await host.getByRole('button', { name: '撤銷此裝置主持人身分', exact: true }).click()
      await host.getByRole('button', { name: '確認撤銷身分', exact: true }).click()
      await host.getByText('舊主持人憑證已撤銷，下次建立房間會建立新身分。').waitFor()
      assert.equal(await host.evaluate(() => localStorage.getItem('guess-who:v1:host')), null)
      assert.equal(receipts.length, 2)
      assert.ok(receipts.every(room => room.status === 'finished'))
    })
    await check('real browser runtime and Cloud server responses have no unexpected errors', async () => {
      assert.equal(runtimeErrors.length, 0)
      assert.equal(unexpectedResponses.length, 0)
      for (const [name, page] of pages) await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true })
    })
  } catch {
    checks.push({ name: stage, result: 'FAIL', details: 'Stopped immediately; raw errors, response bodies and credentials withheld. No automatic cleanup or redeploy.' })
    process.exitCode = 1
  } finally {
    await checkpoint()
    const result = { projectRef, label, result: checks.some(check => check.result === 'FAIL') ? 'FAIL' : 'PASS', browser: browser?.version(), backend: 'real Supabase Cloud Edge Function and PostgreSQL; no fixture, no mock, no request redirection', checks, testRooms: receipts, retainedTestPlayers: [`${label}-B`], additionalTestHostIds: extraIdentities.map(identity => identity.hostId), runtimeErrors: runtimeErrors.length, unexpectedServerResponses: unexpectedResponses.length, privateSessionBackup: 'Outside Repository, owner-only; values withheld', artifacts }
    await writeFile(join(artifacts, 'results.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
    await Promise.all(contexts.map(context => context.close()))
    await browser?.close()
  }
}
