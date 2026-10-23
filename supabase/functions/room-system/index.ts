import { createClient } from '@supabase/supabase-js'
import { createRoomHandler, RoomError } from './handler.ts'

let handler: ReturnType<typeof createRoomHandler> | undefined

function keys(name: string) {
  const raw = Deno.env.get(name)
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_CONFIG')
  return Object.values(parsed).filter((value): value is string => typeof value === 'string')
}

Deno.serve(async (request, connection) => {
  try {
    if (!handler) {
      const secret = keys('SUPABASE_SECRET_KEYS')[0] ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      const url = Deno.env.get('SUPABASE_URL')
      if (!url || !secret) throw new Error('INVALID_CONFIG')
      const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
      const call = async (name: string, input: Record<string, unknown>) => {
        const { data, error } = await client.rpc(name, input)
        if (error) throw new RoomError(error.code === 'P0001' ? error.message : 'INTERNAL_ERROR')
        return data
      }
      handler = createRoomHandler({ origins: (Deno.env.get('ROOM_SYSTEM_ALLOWED_ORIGINS') ?? '').split(',').map(value => value.trim()).filter(Boolean), signingKey: Deno.env.get('ROOM_SYSTEM_SIGNING_KEY') ?? '', publishableKeys: keys('SUPABASE_PUBLISHABLE_KEYS') }, {
        rateLimit: async input => {
          const result = await call('room_system_rate_limit', { p_request: input })
          if (typeof result?.allowed !== 'boolean' || typeof result?.authenticated !== 'boolean' || !Number.isInteger(result?.retryAfter) || result.retryAfter < 1) throw new Error('INVALID_RATE_RESPONSE')
          return result
        },
        action: (action, input) => call('room_system_action', { p_action: action, p_input: input }),
      })
    }
    let sourceAddress: string | undefined
    try { sourceAddress = connection?.remoteAddr?.hostname } catch {}
    return await handler(request, { sourceAddress })
  } catch {
    return new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: '房間服務尚未完成設定。' } }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  }
})
