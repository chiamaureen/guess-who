import { readSupabaseConfig } from '../src/lib/supabase-config.ts'

try {
  const config = readSupabaseConfig(process.env)
  if (new URL(config.url).hostname !== 'fgvajdnzrnptdjurhjfo.supabase.co') throw new Error('WRONG_PROJECT')
  const origin = 'https://chiamaureen.github.io'
  const checks = []
  for (const service of ['room-system','game-engine']) {
    const path = service === 'room-system' ? 'get-room-state' : 'get-game-state'
    const endpoint = `${config.url}/functions/v1/${service}/${path}`
    const response = await fetch(endpoint, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'apikey,content-type,x-host-credential,x-room-token,x-player-session' }, redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (response.status !== 204 || response.headers.get('access-control-allow-origin') !== origin || !['x-host-credential','x-room-token','x-player-session'].every(header => response.headers.get('access-control-allow-headers')?.includes(header))) throw new Error('CORS_CHECK_FAILED')
    const rejected = await fetch(endpoint, { method: 'OPTIONS', headers: { origin: 'https://not-allowed.invalid' }, redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (rejected.status !== 403 || rejected.headers.has('access-control-allow-origin')) throw new Error('ORIGIN_NOT_REJECTED')
    checks.push({ service, allowedOrigin: origin, preflight: 204, untrustedOrigin: 403 })
  }
  console.log(JSON.stringify({ result: 'PASS', checks, databaseActionsExecuted: 0, changedSecrets: false },null,2))
} catch {
  console.error('FAIL/BLOCKED: expected project configuration, network or CORS validation unavailable. No data or Secret changes performed.')
  process.exitCode = 1
}
