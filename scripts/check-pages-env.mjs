import { readSupabaseConfig } from '../src/lib/supabase-config.ts'

try {
  const config = readSupabaseConfig(process.env)
  if (new URL(config.url).hostname !== 'fgvajdnzrnptdjurhjfo.supabase.co') throw new Error('WRONG_PROJECT')
  if (process.env.VITE_ENABLE_REALTIME && process.env.VITE_ENABLE_REALTIME !== 'false') throw new Error('REALTIME_NOT_DEPLOYED')
  console.log('PASS: public Pages environment targets the expected project; key value withheld.')
} catch {
  console.error('BLOCKED: configure Actions variables VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the expected project, and keep VITE_ENABLE_REALTIME=false for the MVP. Backend secrets are forbidden.')
  process.exitCode = 1
}
