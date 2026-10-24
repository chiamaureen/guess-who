import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixturePng } from '../supabase/tests/game-fixture.mjs'
import { startReviewServer } from './review-athlete-images.mjs'
import { confirmations } from './lib/athlete-image-review.mjs'

let chromium
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')) }
catch { console.log('BLOCKED: Playwright unavailable; no browser checks passed. Set PLAYWRIGHT_MODULE.'); process.exitCode = 2 }

if (chromium) {
  const names = Array.from({ length: 17 }, (_, index) => `LOCAL ATHLETE ${index + 1}`)
  const group = 'nba-active-instagram-35'
  const scope = { categorySlug: 'athletes', groups: [{ id: group, names, source: 'https://www.nba.com/players', note: 'LOCAL SYNTHETIC FIXTURE ONLY' }], identityWarnings: {} }
  const markdown = names.map((name, index) => `| ${group} | ${index + 1} | ${name} | Q${9000 + index} | ${index === 16 ? '缺候選' : `[來源頁](https://commons.wikimedia.org/wiki/File:Fixture_${index}.png)`} | Synthetic author | CC0 | 未審核 |`).join('\n')
  const manifest = { entries: names.slice(0, 16).map((name, index) => ({ name, group, wikidataId: `Q${9000 + index}`, source: `https://commons.wikimedia.org/wiki/File:Fixture_${index}.png`, imageUrl: `https://upload.wikimedia.org/Fixture_${index}.png`, licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', wikipediaSource: `https://www.wikidata.org/wiki/Q${9000 + index}` })) }
  const outputDirectory = await mkdtemp('/tmp/guess-who-review-browser-')
  const app = await startReviewServer({ markdown, scope, manifest, outputDirectory, port: 0, fetchImpl: async () => new Response(fixturePng(), { headers: { 'Content-Type': 'image/png' } }) })
  let browser
  const passed = []
  const check = async (name, operation) => { await operation(); passed.push(name) }
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const external = []
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== app.origin) { external.push(route.request().url()); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    const waitIdle = () => page.waitForFunction(() => !document.querySelector('#pending').disabled)
    const choose = async position => { await page.selectOption('#candidate', String(position)); await waitIdle() }
    const completeForm = async () => {
      await page.fill('[name=reviewer]', 'LOCAL TEST ONLY')
      await page.fill('[name=notes]', 'Synthetic UI test; not actual person or legal approval')
      await page.fill('[name=attributionPlan]', 'Synthetic CC0 fixture only')
      await page.fill('[name=evidenceCheckedOn]', new Date().toISOString().slice(0, 10))
      for (const field of confirmations) await page.check(`[name=${field}]`)
    }
    await check('desktop shows exactly one athlete with a decodable checked photograph', async () => {
      await page.goto(app.origin)
      await waitIdle()
      assert.equal(await page.locator('#candidate option').count(), 17)
      assert.equal(await page.locator('#photo img').count(), 1)
      assert.equal(await page.locator('#photo img').evaluate(image => image.complete && image.naturalWidth === 32), true)
    })
    await check('connectivity alone cannot approve', async () => {
      await page.click('#approve'); await waitIdle()
      assert.equal(app.store.snapshot().summary.APPROVED, 0)
      assert.match(await page.locator('#message').innerText(), /確認|填/)
    })
    await check('manual confirmations and evidence allow a fixture approval', async () => {
      await completeForm(); await page.click('#approve'); await waitIdle()
      assert.equal(app.store.snapshot().summary.APPROVED, 1)
    })
    await check('PENDING saves notes and removes approval', async () => {
      await page.fill('[name=notes]', 'Saved pending note')
      await page.click('#pending'); await waitIdle()
      assert.equal(app.store.snapshot().summary.APPROVED, 0)
      assert.equal(app.store.snapshot().entries[0].review.notes, 'Saved pending note')
    })
    await check('REJECT and notes survive browser reload', async () => {
      await page.fill('[name=notes]', 'Reject synthetic fixture for test')
      await page.click('#reject'); await waitIdle()
      await page.reload(); await waitIdle()
      assert.equal(app.store.snapshot().summary.REJECTED, 1)
      assert.equal(await page.inputValue('[name=notes]'), 'Reject synthetic fixture for test')
    })
    await check('missing-image athlete is navigable without fake photograph or approval', async () => {
      await choose(16)
      assert.equal(await page.locator('#photo').innerText(), 'MISSING_IMAGE')
      assert.equal(await page.locator('#photo img').count(), 0)
      await completeForm(); await page.click('#approve'); await waitIdle()
      assert.equal(app.store.snapshot().summary.MISSING_IMAGE, 1)
    })
    await check('edited localhost URL is blocked by server-side image host protection', async () => {
      await choose(1)
      await page.fill('[name=imageUrl]', 'https://127.0.0.1/private')
      await page.click('#pending'); await waitIdle()
      await page.click('#check'); await waitIdle()
      assert.match(await page.locator('#image-check').innerText(), /IMAGE_HOST_NOT_ALLOWED/)
      await page.fill('[name=imageUrl]', manifest.entries[1].imageUrl)
      await page.click('#pending'); await waitIdle()
      await page.click('#check'); await waitIdle()
    })
    await check('Google evidence cannot approve even with checked confirmations', async () => {
      await completeForm()
      await page.fill('[name=evidenceUrl]', 'https://www.google.com/search?q=photo')
      await page.click('#approve'); await waitIdle()
      assert.match(await page.locator('#message').innerText(), /Google/)
    })
    await check('fourteen valid unique approvals keep import preparation blocked', async () => {
      for (const entry of app.store.snapshot().entries.slice(0, 14)) {
        await app.store.checkEntry(entry.id)
        const current = app.store.snapshot().entries.find(person => person.id === entry.id)
        await app.store.save(entry.id, { ...current, action: 'APPROVE', revision: app.store.snapshot().revision, review: {
          ...Object.fromEntries(confirmations.map(key => [key, true])), reviewer: 'LOCAL TEST ONLY', notes: 'Synthetic threshold fixture', attributionPlan: 'Synthetic CC0 fixture', evidenceCheckedOn: new Date().toISOString().slice(0, 10),
        } })
      }
      await page.reload(); await waitIdle()
      assert.equal(app.store.snapshot().summary.APPROVED, 14)
      assert.match(await page.locator('#gate').innerText(), /尚需 1/)
    })
    await check('fifteenth manual UI approval enables preparation, not Cloud import', async () => {
      await choose(14); await completeForm(); await page.click('#approve'); await waitIdle()
      assert.equal(app.store.snapshot().summary.APPROVED, 15)
      assert.equal(app.store.snapshot().summary.metadataPreparationReady, true)
      assert.match(await page.locator('#gate').innerText(), /雲端匯入未授權/)
    })
    await check('JSON export contains evidence, dates and notes but no image bytes or cloud authorization', async () => {
      const output = JSON.parse(await readFile(join(outputDirectory, 'phase8-athletes-reviewed.json'), 'utf8'))
      assert.equal(output.summary.APPROVED, 15)
      assert.equal(output.summary.cloudImportAuthorized, false)
      assert.ok(output.entries[0].review.reviewedAt)
      assert.ok(output.entries[0].evidenceUrl)
      assert.ok(!JSON.stringify(output).includes('"buffer"'))
    })
    await check('fresh page prioritizes passed checks and keeps the selected person after an API response', async () => {
      const first = app.store.snapshot().entries[0]
      await app.store.save(first.id, { ...first, action: 'PENDING', revision: app.store.snapshot().revision, imageUrl: 'https://upload.wikimedia.org/Changed_fixture.png' })
      await page.reload(); await waitIdle()
      assert.match(await page.locator('#name').innerText(), /LOCAL ATHLETE 2$/)
      assert.match(await page.locator('#priority').innerText(), /14 位/)
      assert.equal(await page.locator('#source-link').getAttribute('href'), manifest.entries[1].source)
      await page.click('#next'); await waitIdle()
      assert.match(await page.locator('#name').innerText(), /LOCAL ATHLETE 3$/)
    })
    await check('mobile layout has no horizontal overflow', async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
      await page.screenshot({ path: join(outputDirectory, 'mobile-fixture.png'), fullPage: true })
    })
    await check('no browser errors or external/Supabase requests', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []) })
    console.log(JSON.stringify({ result: 'PASS', checks: passed.length, passed, fixtureOnly: true, outputDirectory }, null, 2))
  } catch (error) { console.error(JSON.stringify({ result: 'FAIL', passed: passed.length, error: error.message })); process.exitCode = 1 }
  finally { await browser?.close(); await app.close() }
}
