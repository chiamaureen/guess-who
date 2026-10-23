export interface SupabaseEnvironment {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export class SupabaseConfigError extends Error {
  readonly code: 'MISSING_CONFIG' | 'PLACEHOLDER_CONFIG' | 'INVALID_URL' | 'INVALID_KEY'

  constructor(code: SupabaseConfigError['code'], message: string) {
    super(message)
    this.name = 'SupabaseConfigError'
    this.code = code
  }
}

export function readSupabaseConfig(environment: SupabaseEnvironment = {}) {
  const url = environment.VITE_SUPABASE_URL?.trim()
  const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) {
    throw new SupabaseConfigError('MISSING_CONFIG', 'Supabase 尚未設定：請填寫 .env.local 的 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY，並重新啟動 Vite。')
  }

  if ([url, publishableKey].some(value => /YOUR_|PROJECT_REF|PLACEHOLDER|CHANGEME|EXAMPLE|[<>]/i.test(value))) {
    throw new SupabaseConfigError('PLACEHOLDER_CONFIG', 'Supabase 設定仍含示意值：請從 Dashboard 複製真正的 Project URL 與 Publishable Key。')
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SupabaseConfigError('INVALID_URL', 'Supabase Project URL 格式錯誤。')
  }

  if (parsed.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
    || parsed.port || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new SupabaseConfigError('INVALID_URL', '請使用 Dashboard 提供的 HTTPS Project URL；本階段只接受標準 Supabase 雲端網域，不接受路徑、查詢參數或登入資訊。')
  }

  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new SupabaseConfigError('INVALID_KEY', '瀏覽器 Client 只接受 sb_publishable_ 開頭的 Publishable Key；不可使用 Secret Key、Service Role Key、密碼或 Access Token。')
  }

  return { url: parsed.origin, publishableKey }
}
