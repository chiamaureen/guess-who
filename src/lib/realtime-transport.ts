import { readSupabaseConfig } from './supabase-config'
import type { RealtimeTicket } from '../types/realtime'
import type { SyncConnection } from './room-sync'

export async function connectRoomRealtime(ticket: RealtimeTicket, message: (payload: unknown) => void, status: (value: string) => void, signal: AbortSignal): Promise<SyncConnection> {
  const { createClient } = await import('@supabase/supabase-js')
  const config = readSupabaseConfig(import.meta.env)
  const client = createClient(config.url, config.publishableKey, { accessToken: async () => ticket.accessToken, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  let closed = false
  const channel = client.channel(ticket.topic, { config: { private: true, broadcast: { self: false, ack: false } } })
  const close = () => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', close)
    void client.removeChannel(channel).finally(() => client.realtime.disconnect())
  }
  signal.addEventListener('abort', close, { once: true })
  try {
    await client.realtime.setAuth(ticket.accessToken)
    if (signal.aborted) { close(); return { close } }
    channel.on('broadcast', { event: 'invalidate' }, event => { if (!closed) message(event.payload) })
      .subscribe(value => { if (!closed) status(value) })
    return { close }
  } catch (error) { close(); throw error }
}
