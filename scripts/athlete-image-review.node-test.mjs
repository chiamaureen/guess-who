import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { get } from 'node:http'
import { fixturePng } from '../supabase/tests/game-fixture.mjs'
import { parseCandidateMarkdown, reconcileCandidates, probeImage, maxImageBytes, applyReview, reviewSummary, approvalErrors, imageUrlAllowed, evidenceUrlAllowed, confirmations } from './lib/athlete-image-review.mjs'
import { createReviewStore, startReviewServer } from './review-athlete-images.mjs'
import { prioritizeCheckedCandidates } from '../tools/athlete-review/order.js'

export function reviewFixture(count = 2) {
  const names = Array.from({ length: count }, (_, index) => `LOCAL ATHLETE ${index + 1}`)
  const scope = { categorySlug: 'athletes', groups: [{ id: 'nba-active-instagram-35', names, source: 'https://www.nba.com/players', note: 'LOCAL SYNTHETIC REVIEW FIXTURE' }], identityWarnings: {} }
  const markdown = names.map((name, index) => `| nba-active-instagram-35 | ${index + 1} | ${name} | Q${9000 + index} | [來源頁](https://commons.wikimedia.org/wiki/File:Fixture_${index}.png) | Synthetic author | CC0 | 未審核 |`).join('\n')
  const manifest = { entries: names.map((name, index) => ({ name, group: 'nba-active-instagram-35', wikidataId: `Q${9000 + index}`, source: `https://commons.wikimedia.org/wiki/File:Fixture_${index}.png`, imageUrl: `https://upload.wikimedia.org/Fixture_${index}.png`, licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', wikipediaSource: `https://www.wikidata.org/wiki/Q${9000 + index}` })) }
  return { markdown, scope, manifest }
}

const imageResponse = () => new Response(fixturePng(), { status: 200, headers: { 'Content-Type': 'image/png' } })
const reviewInput = entry => ({
  ...Object.fromEntries(['imageUrl', 'sourcePage', 'personSource', 'rosterSource', 'wikidataId', 'author', 'license', 'licenseTermsUrl', 'evidenceUrl'].map(key => [key, entry[key]])),
  action: 'APPROVE', review: { ...Object.fromEntries(confirmations.map(key => [key, true])), reviewer: 'LOCAL TEST ONLY', notes: 'Synthetic identity and license fixture; not an actual approval', attributionPlan: 'Synthetic CC0 fixture only', evidenceCheckedOn: new Date().toISOString().slice(0, 10) },
})

test('review display prioritizes passed technical checks, then other images, then missing images without altering stored order', () => {
  const entries = [
    { id: 'missing', imageCheck: { status: 'NOT_CHECKED' } },
    { id: 'failed', imageUrl: 'https://upload.wikimedia.org/failed', imageCheck: { status: 'FAIL' } },
    { id: 'passed-first', imageCheck: { status: 'PASS' }, status: 'PENDING' },
    { id: 'pending', sourcePage: 'https://commons.wikimedia.org/wiki/File:Pending', imageCheck: { status: 'NOT_CHECKED' } },
    { id: 'passed-second', imageCheck: { status: 'PASS' }, status: 'PENDING' },
  ]
  const before = structuredClone(entries)
  assert.deepEqual(prioritizeCheckedCandidates(entries).map(entry => entry.id), ['passed-first', 'passed-second', 'failed', 'pending', 'missing'])
  assert.deepEqual(entries, before)
  assert.ok(prioritizeCheckedCandidates(entries).filter(entry => entry.imageCheck.status === 'PASS').every(entry => entry.status === 'PENDING'))
})

test('parses actual Markdown into124 candidates without trusting the ignored metadata as roster authority', async () => {
  const markdown = await readFile(new URL('../docs/phase8-athletes-v2-candidates.md', import.meta.url), 'utf8')
  const entries = parseCandidateMarkdown(markdown)
  assert.equal(entries.length, 124)
  assert.equal(entries.filter(entry => entry.sourcePage).length, 69)
  assert.equal(entries.filter(entry => entry.status === 'MISSING_IMAGE').length, 55)
  assert.ok(entries.every(entry => entry.category === 'athletes' && entry.status !== 'APPROVED'))
})

test('requires known groups, valid table shape and preserved scope membership', () => {
  const fixture = reviewFixture()
  assert.throws(() => parseCandidateMarkdown('not a table'), /EMPTY/)
  assert.throws(() => reconcileCandidates(fixture.markdown.replace('LOCAL ATHLETE 1', 'OTHER PERSON'), fixture.scope), /SCOPE/)
  assert.throws(() => reconcileCandidates(fixture.markdown + '\n' + fixture.markdown, fixture.scope), /DUPLICATE/)
})

test('mismatched image sidecar does not silently replace the documented person or source', () => {
  const fixture = reviewFixture()
  fixture.manifest.entries[0].wikidataId = 'Q1'
  const entries = reconcileCandidates(fixture.markdown, fixture.scope, fixture.manifest)
  assert.equal(entries[0].imageUrl, '')
  assert.equal(entries[0].wikidataId, 'Q9000')
})

test('duplicate normalized names and QIDs are flagged without merging ambiguous subjects', () => {
  const fixture = reviewFixture()
  const entries = reconcileCandidates(fixture.markdown.replace('Q9001', 'Q9000'), fixture.scope)
  assert.ok(entries.every(entry => entry.duplicateIssues.length === 1))
})

test('image requests reject localhost, credentials, ports, HTTP, unknown hosts and never make a request', async () => {
  let requests = 0
  for (const url of ['http://upload.wikimedia.org/a', 'https://127.0.0.1/a', 'https://upload.wikimedia.org:444/a', 'https://user:password@upload.wikimedia.org/a', 'https://upload.wikimedia.org.evil.invalid/a']) {
    assert.equal(imageUrlAllowed(url), false)
    assert.equal((await probeImage(url, async () => { requests++ })).check.reason, 'IMAGE_HOST_NOT_ALLOWED')
  }
  assert.equal(requests, 0)
})

test('GET verifies MIME, actual decodable pixels, byte size, SHA256 and disables redirects', async () => {
  const result = await probeImage('https://upload.wikimedia.org/test.png', async (url, options) => {
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal)
    return imageResponse()
  })
  assert.equal(result.check.status, 'PASS')
  assert.equal(result.check.width, 32)
  assert.equal(result.check.bytes, fixturePng().length)
  assert.match(result.check.sha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(result.buffer, fixturePng())
})

for (const status of [401, 403, 404, 429, 500]) test(`HTTP ${status} never passes image validation`, async () => {
  const result = await probeImage('https://upload.wikimedia.org/test.png', async () => new Response('', { status }))
  assert.equal(result.check.reason, `HTTP_${status}`)
})

test('HTML, SVG, MIME spoofing, invalid bytes and oversized header/body are rejected', async () => {
  for (const response of [
    new Response('<html>not an image</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('<svg></svg>', { headers: { 'Content-Type': 'image/svg+xml' } }),
    new Response(fixturePng(), { headers: { 'Content-Type': 'image/jpeg' } }),
    new Response('not png', { headers: { 'Content-Type': 'image/png' } }),
    new Response('big', { headers: { 'Content-Type': 'image/png', 'Content-Length': String(maxImageBytes + 1) } }),
    new Response(Buffer.alloc(maxImageBytes + 1), { headers: { 'Content-Type': 'image/png' } }),
  ]) assert.equal((await probeImage('https://upload.wikimedia.org/test.png', async () => response)).check.status, 'FAIL')
})

test('DNS and timeout are distinguished without echoing unsafe network details', async () => {
  const dns = await probeImage('https://upload.wikimedia.org/test.png', async () => { throw new Error('secret diagnostic', { cause: { code: 'ENOTFOUND' } }) })
  assert.equal(dns.check.reason, 'DNS_ERROR')
  const timeout = await probeImage('https://upload.wikimedia.org/test.png', async () => { throw new DOMException('secret diagnostic', 'TimeoutError') })
  assert.equal(timeout.check.reason, 'TIMEOUT')
  assert.ok(!JSON.stringify([dns, timeout]).includes('secret diagnostic'))
})

test('Google search and generic license pages are not image-specific rights evidence', () => {
  for (const url of ['https://www.google.com/search?q=test', 'https://images.google.com/a', 'https://www.google.com.tw/search?q=test', 'https://creativecommons.org/licenses/by/2.0/']) assert.equal(evidenceUrlAllowed(url), false)
  assert.equal(evidenceUrlAllowed('https://commons.wikimedia.org/wiki/File:Test.png'), true)
})

test('connectivity alone and incomplete manual fields cannot APPROVE', async () => {
  const fixture = reviewFixture()
  const entries = reconcileCandidates(fixture.markdown, fixture.scope, fixture.manifest)
  entries[0].imageCheck = (await probeImage(entries[0].imageUrl, async () => imageResponse())).check
  for (const key of confirmations) {
    const input = reviewInput(entries[0])
    input.review[key] = false
    assert.throws(() => applyReview(entries, entries[0].id, input), /確認/)
  }
  const noCheck = reconcileCandidates(fixture.markdown, fixture.scope, fixture.manifest)
  assert.throws(() => applyReview(noCheck, noCheck[0].id, reviewInput(noCheck[0])), /檢查/)
})

test('stale checks, changed URLs, missing/Google evidence and unknown rights block approval', async () => {
  const fixture = reviewFixture()
  const entries = reconcileCandidates(fixture.markdown, fixture.scope, fixture.manifest)
  entries[0].imageCheck = (await probeImage(entries[0].imageUrl, async () => imageResponse())).check
  for (const patch of [{ imageUrl: 'https://upload.wikimedia.org/new.png' }, { evidenceUrl: 'https://www.google.com/search?q=license' }, { author: '' }, { license: 'Unknown' }, { personSource: '' }]) {
    assert.throws(() => applyReview(entries, entries[0].id, { ...reviewInput(entries[0]), ...patch }))
  }
  const approved = applyReview(entries, entries[0].id, reviewInput(entries[0]))
  assert.equal(approved.status, 'APPROVED')
  assert.ok(approvalErrors(approved, Date.now() + 90000000).length > 0)
})

test('REJECT requires notes and PENDING preserves missing-image classification', () => {
  const fixture = reviewFixture()
  const entries = reconcileCandidates(fixture.markdown, fixture.scope, fixture.manifest)
  const input = reviewInput(entries[0])
  assert.throws(() => applyReview(entries, entries[0].id, { ...input, action: 'REJECT', review: { ...input.review, notes: '' } }), /原因/)
  assert.equal(applyReview(entries, entries[0].id, { ...input, action: 'REJECT' }).status, 'REJECTED')
  assert.equal(applyReview(entries, entries[0].id, { ...input, action: 'PENDING', imageUrl: '', sourcePage: '' }).status, 'MISSING_IMAGE')
})

test('minimum15 gate counts valid distinct reviewed QIDs only, never approves the actual corpus', async () => {
  const fixture = reviewFixture(15)
  let entries = reconcileCandidates(fixture.markdown, fixture.scope, fixture.manifest)
  assert.equal(reviewSummary(entries).metadataPreparationReady, false)
  for (const entry of entries) {
    entry.imageCheck = (await probeImage(entry.imageUrl, async () => imageResponse())).check
    const reviewed = applyReview(entries, entry.id, reviewInput(entry))
    entries = entries.map(previous => previous.id === entry.id ? reviewed : previous)
  }
  assert.equal(reviewSummary(entries.slice(0, 14)).metadataPreparationReady, false)
  assert.equal(reviewSummary(entries).metadataPreparationReady, true)
  assert.equal(reviewSummary(entries).cloudImportAuthorized, false)
  assert.equal(reviewSummary(entries).gameEngineCompatible, false)
  entries[14].wikidataId = entries[0].wikidataId
  assert.equal(reviewSummary(entries).metadataPreparationReady, false)
})

test('atomic output, revision guard, single-writer lock and restart preserve real review decisions', async () => {
  const outputDirectory = await mkdtemp('/tmp/guess-who-review-test-')
  const options = { ...reviewFixture(), outputDirectory, fetchImpl: async () => imageResponse() }
  const store = await createReviewStore(options)
  try {
    await assert.rejects(createReviewStore(options), /LOCKED/)
    const first = store.snapshot().entries[0]
    await store.checkEntry(first.id)
    await store.save(first.id, { ...reviewInput(first), revision: store.snapshot().revision })
    await assert.rejects(store.save(first.id, { ...reviewInput(first), revision: 0 }), /STALE/)
    const output = JSON.parse(await readFile(join(outputDirectory, 'phase8-athletes-reviewed.json'), 'utf8'))
    assert.equal(output.summary.APPROVED, 1)
    assert.ok(!JSON.stringify(output).includes('"buffer"'))
  } finally { await store.dispose() }
  const resumed = await createReviewStore(options)
  try { assert.equal(resumed.snapshot().summary.APPROVED, 1) } finally { await resumed.dispose() }
})

test('source changes refuse to overwrite an existing review file', async () => {
  const outputDirectory = await mkdtemp('/tmp/guess-who-review-source-')
  const options = { ...reviewFixture(), outputDirectory }
  const store = await createReviewStore(options)
  await store.dispose()
  await assert.rejects(createReviewStore({ ...options, markdown: options.markdown + '\n' }), /SOURCE_CHANGED/)
})

test('HTTP review server protects writes with Origin/session and exposes no repository filesystem', async () => {
  const app = await startReviewServer({ ...reviewFixture(), outputDirectory: await mkdtemp('/tmp/guess-who-review-http-'), fetchImpl: async () => imageResponse(), port: 0 })
  try {
    const state = await (await fetch(`${app.origin}/api/state`)).json()
    const post = headers => fetch(`${app.origin}/api/check`, { method: 'POST', headers, body: JSON.stringify({ id: state.entries[0].id }) })
    assert.equal((await post({ 'Content-Type': 'application/json' })).status, 403)
    assert.equal((await post({ 'Content-Type': 'application/json', Origin: 'https://evil.invalid', 'X-Review-Session': state.session })).status, 403)
    assert.equal((await post({ 'Content-Type': 'application/json', Origin: app.origin, 'X-Review-Session': state.session })).status, 200)
    const rawStatus = headers => new Promise((resolve, reject) => {
      get(`${app.origin}/api/state`, { headers }, response => { response.resume(); resolve(response.statusCode) }).on('error', reject)
    })
    assert.equal(await rawStatus({ Host: 'evil.invalid' }), 403)
    assert.equal(await rawStatus({ 'Sec-Fetch-Site': 'cross-site' }), 403)
    for (const path of ['/.env.local', '/AGENTS.md', '/data/question-bank/prepared', '/supabase/config.toml']) assert.equal((await fetch(app.origin + path)).status, 404)
    const exported = await (await fetch(`${app.origin}/api/export`)).json()
    assert.equal(exported.summary.APPROVED, 0)
    assert.equal((await fetch(app.origin)).headers.get('x-content-type-options'), 'nosniff')
  } finally { await app.close() }
})

test('batch stops at429 and does not create fake approvals or retry all remaining requests', async () => {
  let requests = 0
  const store = await createReviewStore({ ...reviewFixture(), outputDirectory: await mkdtemp('/tmp/guess-who-review-429-'), fetchImpl: async () => { requests++; return new Response('', { status: 429 }) } })
  try {
    await store.checkAll()
    assert.equal(requests, 1)
    assert.equal(store.snapshot().summary.APPROVED, 0)
    assert.equal(store.job.completed, 1)
    assert.equal(store.job.stoppedReason, 'HTTP_429_MANUAL_RETRY_REQUIRED')
    await assert.rejects(store.checkAll(), /RETRY_AFTER/)
    await assert.rejects(store.checkEntry(store.snapshot().entries[1].id), /RETRY_AFTER/)
    assert.equal(requests, 1)
  } finally { await store.dispose() }
})

test('429 Retry-After is retained for both numeric and HTTP-date headers', async () => {
  for (const retryAfter of ['120', new Date(Date.now() + 120000).toUTCString()]) {
    const result = await probeImage('https://upload.wikimedia.org/test.png', async () => new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }))
    assert.ok(Date.parse(result.check.retryAllowedAt) - Date.now() > 110000)
  }
})

test('failed duplicate approval leaves the existing review data unchanged', () => {
  const fixture = reviewFixture()
  const entries = reconcileCandidates(fixture.markdown, fixture.scope, fixture.manifest)
  const before = structuredClone(entries)
  assert.throws(() => applyReview(entries, entries[0].id, { ...reviewInput(entries[0]), wikidataId: entries[1].wikidataId }))
  assert.deepEqual(entries, before)
})
