import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { startBrowserFixture } from '../supabase/tests/browser-fixture.mjs'

const base = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5192/guess-who/'
const origin = new URL(base).origin
const realPhoto = process.env.QA_REAL_PHOTO === 'true'
const artifacts = realPhoto ? '/tmp/guess-who-final-review-photo-browser' : '/tmp/guess-who-webp-credits-browser'
const checks = []
let browser
let fixture
const contexts = []
let expectedWidth = 32
let expectedImageDigest = ''
try {
  let chromium
  try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')) }
  catch { throw new Error('BROWSER_TOOL_UNAVAILABLE') }
  await mkdir(artifacts, { recursive: true })
  fixture = await startBrowserFixture({ port: 0, origin, gamePeople: 15, imageFormat: 'webp' })
  if (realPhoto) {
    const receiptPath = await realpath('data/question-bank/prepared/athletes-webp-20261024/webp-preparation.json')
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    const photo = receipt.entries.find(photo => photo.name === 'Stephen Curry')
    const imagePath = await realpath(resolve(dirname(receiptPath), photo.imagePath))
    assert.ok(imagePath.startsWith(dirname(receiptPath) + sep))
    const bytes = await readFile(imagePath)
    expectedImageDigest = createHash('sha256').update(bytes).digest('hex')
    assert.equal(expectedImageDigest, photo.imageSha256)
    expectedWidth = photo.width
    await fixture.database.query('UPDATE public.game_image_assets SET png=$1', [bytes])
    const text = JSON.stringify({ format: 'guess-who-image-rights-v1', attribution: photo.attribution, licenseVersion: '4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', derivativeLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', modifications: 'WebP resize and metadata removal', originalNotices: photo.originalNotices, evidenceUrl: photo.evidenceUrl, checkedAt: photo.checkedAt })
    await fixture.database.query('UPDATE public.celebrities SET image_author=$1,image_source=$2,image_license=$3,image_attribution=$4', [photo.author, photo.source, photo.license, text])
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const hiddenPayloads = []
  const imageTypes = []
  const errors = []
  const check = async (name, operation) => { await operation(); checks.push(name) }
  const pageFor = async (role, width) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    contexts.push(context)
    await context.route('**/*', async route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin === origin) return route.continue()
      if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url.origin)) return route.abort()
      const destination = url.pathname === '/rest/v1/categories' ? `${fixture.url}/categories` : `${fixture.url}${url.pathname}`
      assert.ok(url.pathname === '/rest/v1/categories' || /^\/functions\/v1\/(room-system|game-engine)\//.test(url.pathname))
      const headers = { ...request.headers(), origin, apikey: 'sb_publishable_fixture' }
      delete headers.authorization
      const response = await route.fetch({ url: destination, headers })
      if (url.pathname.endsWith('/get-question-image') && response.ok()) {
        imageTypes.push(response.headers()['content-type'])
        if (realPhoto) assert.equal(createHash('sha256').update(await response.body()).digest('hex'), expectedImageDigest)
      }
      if (role === 'player' && url.pathname.endsWith('/get-game-state') && response.ok()) {
        const payload = await response.json()
        if (payload.data.question && !payload.data.question.revealed) hiddenPayloads.push(payload)
      }
      return route.fulfill({ response })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(45000)
    page.on('pageerror', () => errors.push('runtime error'))
    return page
  }
  const host = await pageFor('host', 1440)
  const player = await pageFor('player', 375)
  let invite
  await check('Host creates and mobile Player joins an isolated room', async () => {
    await host.goto(`${base}#/host`)
    await host.getByRole('checkbox').first().check()
    await host.getByRole('button', { name: '建立房間', exact: true }).click()
    await host.getByRole('button', { name: '開始遊戲', exact: true }).waitFor()
    invite = await host.getByLabel('玩家邀請連結').inputValue()
    await player.goto(invite)
    await player.getByLabel('你的暱稱').fill('WebP LOCAL ONLY')
    await player.getByRole('button', { name: '加入房間', exact: true }).click()
    await player.getByText('等待主持人開始遊戲，畫面將自動同步。', { exact: true }).waitFor()
  })
  await check('real controlled image response is WebP and both browsers decode a neutral Blob URL', async () => {
    await host.getByRole('button', { name: '開始遊戲', exact: true }).click()
    await host.waitForFunction(width => document.querySelector('.game-photo img')?.naturalWidth === width, expectedWidth)
    await player.getByRole('button', { name: '重新取得遊戲狀態', exact: true }).click()
    await player.waitForFunction(width => document.querySelector('.game-photo img')?.naturalWidth === width, expectedWidth)
    assert.ok(imageTypes.length >= 2 && imageTypes.every(mime => mime === 'image/webp'))
    assert.match(await player.locator('.game-photo img').getAttribute('src'), /^blob:/)
  })
  await check('Host can inspect full credits; unrevealed Player receives neither answer nor licensing metadata', async () => {
    assert.ok(hiddenPayloads.length > 0)
    for (const payload of hiddenPayloads) assert.ok(!/SECRET-NAME|attribution|license|author|source|隔離測試人物/.test(JSON.stringify(payload)))
    assert.equal(await player.locator('.image-credits').count(), 0)
    await host.locator('.image-credits summary').click()
    assert.equal(await host.getByRole('link', { name: '授權條款 4.0', exact: true }).getAttribute('href'), 'https://creativecommons.org/licenses/by-sa/4.0/')
  })
  await check('revealed Player sees version, modifications, same-license link and evidence', async () => {
    await host.getByRole('button', { name: '揭曉答案', exact: true }).click()
    await player.locator('.image-credits summary').waitFor()
    await player.locator('.image-credits summary').click()
    await player.getByText('圖片處理：WebP resize and metadata removal', { exact: true }).waitFor()
    assert.ok(await player.getByRole('link', { name: '處理後圖片沿用授權' }).getAttribute('href'))
    assert.ok(await player.getByRole('link', { name: '授權證據' }).getAttribute('href'))
  })
  await check('credits and photo fit mobile and desktop viewports', async () => {
    for (const [page, label] of [[host, 'host'], [player, 'player']]) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: `${artifacts}/${label}.png`, fullPage: true })
    }
  })
  await check('Host and Player reload retain revealed question and decode the protected WebP again', async () => {
    for (const page of [host, player]) {
      await page.reload()
      await page.waitForFunction(width => document.querySelector('.game-photo img')?.naturalWidth === width, expectedWidth)
      await page.getByText('QUESTION 1 / 15 · 已揭曉', { exact: true }).waitFor()
    }
  })
  await check('no browser runtime errors', async () => assert.deepEqual(errors, []))
  console.log(JSON.stringify({ result: 'PASS', checks: checks.length, photo: realPhoto ? 'Real pending Stephen Curry bytes; synthetic local identities, NOT bank approval' : 'Synthetic', cloudRequests: 0, artifacts }))
} catch (error) {
  console.log(JSON.stringify({ result: error.message === 'BROWSER_TOOL_UNAVAILABLE' ? 'BLOCKED' : 'FAIL', completedChecks: checks.length, cloudRequests: 0, artifacts }))
  process.exitCode = 1
} finally {
  await mkdir(artifacts, { recursive: true })
  await writeFile(`${artifacts}/results.json`, JSON.stringify({ checks, passed: checks.length, complete: checks.length === 7, cloudRequests: 0 }, null, 2))
  await Promise.all(contexts.map(context => context.close()))
  await browser?.close()
  await fixture?.close()
}
