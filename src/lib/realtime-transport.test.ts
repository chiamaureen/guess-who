import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { connectRoomRealtime } from './realtime-transport'

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() }
  channel.on.mockReturnValue(channel)
  channel.subscribe.mockReturnValue(channel)
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => 'ok'), realtime: { setAuth: vi.fn(async () => undefined), disconnect: vi.fn() } }
  return { channel, client, createClient: vi.fn((..._arguments: unknown[]) => client) }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
const ticket = { topic: 'gw-room:10000000-0000-4000-8000-000000000001', accessToken: 'ephemeral-test-jwt', expiresAt: '2099-01-01T00:00:00Z' }
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture')
})
afterEach(() => vi.unstubAllEnvs())
it('uses a dedicated private channel and the custom JWT callback, never Host or Player bearer tokens', async () => {
  const controller = new AbortController()
  const connection = await connectRoomRealtime(ticket, vi.fn(), vi.fn(), controller.signal)
  const options = mocks.createClient.mock.calls[0]?.[2] as unknown as { accessToken: () => Promise<string>; auth: { persistSession: boolean } }
  expect(await options.accessToken()).toBe(ticket.accessToken)
  expect(options.auth.persistSession).toBe(false)
  expect(mocks.client.channel).toHaveBeenCalledWith(ticket.topic, { config: { private: true, broadcast: { self: false, ack: false } } })
  expect(mocks.channel.on).toHaveBeenCalledWith('broadcast', { event: 'invalidate' }, expect.any(Function))
  connection.close()
})
it('unsubscribes exactly once, disconnects, and ignores old callbacks after abort', async () => {
  const controller = new AbortController()
  const receive = vi.fn()
  const connection = await connectRoomRealtime(ticket, receive, vi.fn(), controller.signal)
  controller.abort(); connection.close()
  mocks.channel.on.mock.calls[0][2]({ payload: { changed: true } })
  await Promise.resolve()
  expect(mocks.client.removeChannel).toHaveBeenCalledTimes(1)
  expect(mocks.client.realtime.disconnect).toHaveBeenCalledTimes(1)
  expect(receive).not.toHaveBeenCalled()
})
it('does not subscribe when React cleanup has already aborted initialization', async () => {
  const controller = new AbortController()
  controller.abort()
  await connectRoomRealtime(ticket, vi.fn(), vi.fn(), controller.signal)
  expect(mocks.channel.subscribe).not.toHaveBeenCalled()
  expect(mocks.client.removeChannel).toHaveBeenCalledTimes(1)
})
it('cleans up initialization failures rather than leaking clients or abort listeners', async () => {
  mocks.client.realtime.setAuth.mockRejectedValueOnce(new Error('Setup failed'))
  await expect(connectRoomRealtime(ticket, vi.fn(), vi.fn(), new AbortController().signal)).rejects.toThrow('Setup failed')
  expect(mocks.client.removeChannel).toHaveBeenCalledTimes(1)
})
