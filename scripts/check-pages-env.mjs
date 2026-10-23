import { readSupabaseConfig } from '../src/lib/supabase-config.ts'

try {
  const config = readSupabaseConfig(process.env)
  if (new URL(config.url).hostname !== 'fgvajdnzrnptdjurhjfo.supabase.co') throw new Error('WRONG_PROJECT')
  console.log('PASS: public Pages environment targets the expected project; key value withheld.')
} catch {
  console.error('BLOCKED: configure repository Actions variables VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for the expected project. Backend secrets are forbidden.')
  process.exitCode = 1
}
