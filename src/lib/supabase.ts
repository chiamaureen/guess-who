import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './supabase-config.ts'
import type { SupabaseEnvironment } from './supabase-config.ts'

let client: SupabaseClient | undefined

export function getSupabaseClient(environment: SupabaseEnvironment = import.meta.env) {
  if (!client) {
    const { url, publishableKey } = readSupabaseConfig(environment)
    client = createClient(url, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  }

  return client
}
