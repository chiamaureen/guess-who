import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkSupabase, exitCodeFor } from './check-supabase.mjs'

const environment = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(32)}`,
}
const health = { name: 'GoTrue', version: 'v2.60.7', description: 'GoTrue is a user registration and authentication API' }
const initializeClient = () => ({ auth: {}, from() {} })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

test('fixture-only: missing settings are BLOCKED and make no request', async () => {
  const results = await checkSupabase({}, { fetchImpl: () => assert.fail('Must not request') })
  assert.equal(results.initialization.status, 'BLOCKED')
  assert.equal(results.connectivity.status, 'BLOCKED')
  assert.equal(exitCodeFor(results), 2)
})

test('fixture-only: invalid configuration fails without requesting or echoing credentials', async () => {
  const invalidKey = ['sb_secret', 'fixture-not-real'].join('_')
  const results = await checkSupabase({ ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: invalidKey }, { fetchImpl: () => assert.fail('Must not request') })
  assert.equal(results.initialization.status, 'FAIL')
  assert.equal(results.connectivity.status, 'BLOCKED')
  assert.equal(exitCodeFor(results), 1)
  assert.ok(!JSON.stringify(results).includes(invalidKey))
})

test('fixture-only: an HTTP 200 GoTrue response passes, uses apikey and blocks redirects', async () => {
  const results = await checkSupabase(environment, {
    initializeClient,
    fetchImpl: async (url, options) => {
      assert.equal(url, `${environment.VITE_SUPABASE_URL}/auth/v1/health`)
      assert.equal(options.method, 'GET')
      assert.equal(options.headers.apikey, environment.VITE_SUPABASE_PUBLISHABLE_KEY)
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      return json(health)
    },
  })
  assert.equal(results.initialization.status, 'PASS')
  assert.equal(results.connectivity.status, 'PASS')
  assert.equal(results.postgres.status, 'NOT TESTED')
  assert.equal(exitCodeFor(results), 0)
  assert.ok(!JSON.stringify(results).includes(environment.VITE_SUPABASE_PUBLISHABLE_KEY))
})

for (const status of [201, 204, 301, 401, 403, 404, 429, 500, 503]) {
  test(`fixture-only: HTTP ${status} never counts as cloud connectivity PASS`, async () => {
    const results = await checkSupabase(environment, { initializeClient, fetchImpl: async () => new Response(null, { status }) })
    assert.equal(results.initialization.status, 'PASS')
    assert.equal(results.connectivity.status, 'FAIL')
    assert.match(results.connectivity.details, new RegExp(`HTTP ${status}`))
    assert.equal(exitCodeFor(results), 1)
  })
}

for (const body of [{}, { ...health, name: 'Other' }, { ...health, version: '' }, { ...health, description: '' }]) {
  test(`fixture-only: HTTP 200 invalid health payload fails (${JSON.stringify(body)})`, async () => {
    const results = await checkSupabase(environment, { initializeClient, fetchImpl: async () => json(body) })
    assert.equal(results.connectivity.status, 'FAIL')
    assert.match(results.connectivity.details, /INVALID_RESPONSE/)
  })
}

test('fixture-only: HTTP 200 HTML is rejected', async () => {
  const results = await checkSupabase(environment, { initializeClient, fetchImpl: async () => new Response('<html>not health</html>') })
  assert.equal(results.connectivity.status, 'FAIL')
  assert.match(results.connectivity.details, /INVALID_RESPONSE/)
})

for (const [error, kind] of [
  [new TypeError('fixture', { cause: { code: 'ENOTFOUND' } }), 'DNS'],
  [new DOMException('fixture', 'TimeoutError'), 'TIMEOUT'],
  [new TypeError('fixture', { cause: { code: 'ECONNREFUSED' } }), 'NETWORK'],
]) {
  test(`fixture-only: ${kind} failure is classified without exposing the error`, async () => {
    const results = await checkSupabase(environment, { initializeClient, fetchImpl: async () => { throw error } })
    assert.equal(results.connectivity.status, 'FAIL')
    assert.match(results.connectivity.details, new RegExp(kind))
    assert.ok(!JSON.stringify(results).includes('fixture'))
  })
}

test('fixture-only: SDK failure is separate from a valid cloud health response', async () => {
  const results = await checkSupabase(environment, {
    initializeClient: () => { throw new Error(environment.VITE_SUPABASE_PUBLISHABLE_KEY) },
    fetchImpl: async () => json(health),
  })
  assert.equal(results.initialization.status, 'FAIL')
  assert.equal(results.connectivity.status, 'PASS')
  assert.equal(exitCodeFor(results), 1)
  assert.ok(!JSON.stringify(results).includes(environment.VITE_SUPABASE_PUBLISHABLE_KEY))
})
