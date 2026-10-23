import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSupabaseConfig, SupabaseConfigError } from './supabase-config'

const environment = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(32)}`,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('public Supabase configuration', () => {
  it('normalizes a valid cloud URL without exposing credentials', () => {
    expect(readSupabaseConfig({ ...environment, VITE_SUPABASE_URL: `${environment.VITE_SUPABASE_URL}/` })).toEqual({
      url: environment.VITE_SUPABASE_URL,
      publishableKey: environment.VITE_SUPABASE_PUBLISHABLE_KEY,
    })
  })

  it.each([
    {},
    { VITE_SUPABASE_URL: environment.VITE_SUPABASE_URL },
    { ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: ' ' },
    { ...environment, VITE_SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co' },
    { ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: 'YOUR_PUBLISHABLE_KEY' },
  ])('rejects missing or placeholder configuration', values => {
    expect(() => readSupabaseConfig(values)).toThrow(SupabaseConfigError)
  })

  it.each([
    'http://abcdefghijklmnopqrst.supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co.attacker.invalid',
    'https://abcdefghijklmnopqrst.supabase.co/path',
    'https://abcdefghijklmnopqrst.supabase.co?key=value',
    'https://abcdefghijklmnopqrst.supabase.co#fragment',
    'https://user:password@abcdefghijklmnopqrst.supabase.co',
    'not a URL',
  ])('rejects unsafe or invalid project URL %s', url => {
    expect(() => readSupabaseConfig({ ...environment, VITE_SUPABASE_URL: url })).toThrow(SupabaseConfigError)
  })

  it.each(['sb_secret_', 'sbp_', 'eyJ', 'service_role_'])('rejects non-publishable credential type %s without echoing it', prefix => {
    const invalidKey = `${prefix}fixture-not-a-real-credential`
    try {
      readSupabaseConfig({ ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: invalidKey })
      expect.fail('Invalid credentials must be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(SupabaseConfigError)
      expect((error as Error).message).not.toContain(invalidKey)
    }
  })
})

describe('lazy shared Supabase client', () => {
  it('can be imported without configuration and only errors when explicitly requested', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const { getSupabaseClient } = await import('./supabase')
    expect(() => getSupabaseClient()).toThrow('Supabase 尚未設定')
  })

  it('initializes one SDK client from Vite env without network, sessions or URL token detection', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', environment.VITE_SUPABASE_URL)
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', environment.VITE_SUPABASE_PUBLISHABLE_KEY)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { getSupabaseClient } = await import('./supabase')
    const client = getSupabaseClient()
    expect(getSupabaseClient()).toBe(client)
    expect(client.auth).toBeDefined()
    expect(typeof client.from).toBe('function')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
