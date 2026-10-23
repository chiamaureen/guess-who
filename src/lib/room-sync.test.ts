import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoomSync } from './room-sync'
import { RoomApiError } from './room-api'
import type { RoomSnapshot } from '../types/realtime'

const roomId = '10000000-0000-4000-8000-000000000001'
const snapshot = (number = 0): RoomSnapshot => ({
  lobby: { room: { id: roomId, code: 'ABC123', status: number ? 'playing' : 'waiting', currentQuestion: number, totalQuestions: 15, expiresAt: '2099-01-01T00:00:00Z' }, viewer: { id: 'player', role: 'player' }, players: [], categories: [] },
  game: { room: { id: roomId, code: 'ABC123', status: number ? 'playing' : 'waiting', currentQuestion: number, totalQuestions: 15, expiresAt: '2099-01-01T00:00:00Z' }, viewer: { id: 'player', role: 'player' }, question: number ? { id: `question${number}`, number, revealed: false } : null },
})
const make = () => {
  const read = vi.fn(async () => snapshot())
  const ticket = vi.fn(async () => ({ topic: `gw-room:${roomId}`, accessToken: 'fixture-jwt', expiresAt: new Date(Date.now() + 300000).toISOString() }))
  const close = vi.fn()
  const states = vi.fn()
  const status = vi.fn()
  const callbacks: { message: (payload: unknown) => void; status: (value: string) => void; signal: AbortSignal }[] = []
  const connect = vi.fn(async (_ticket, message, connectionStatus, signal) => { callbacks.push({ message, status: connectionStatus, signal }); return { close } })
  const sync = createRoomSync({ read, ticket, connect, snapshot: states, status })
  return { sync, read, ticket, connect, close, states, status, callbacks }
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('room invalidation synchronization', () => {
  it('reads before subscribing and reads again after the subscription acknowledgement', async () => {
    const context = make()
    context.sync.start()
    expect(context.connect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(context.read).toHaveBeenCalledTimes(1)
    expect(context.connect).toHaveBeenCalledTimes(1)
    context.callbacks[0].status('SUBSCRIBED')
    await vi.advanceTimersByTimeAsync(1500)
    expect(context.read).toHaveBeenCalledTimes(2)
    context.sync.close()
  })
  it('coalesces duplicate hints, ignores forged state payloads, and never performs a game mutation', async () => {
    const context = make()
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    for (let index = 0; index < 100; index++) context.callbacks[0].message({ changed: true })
    context.callbacks[0].message({ changed: true, answer: 'FORGED' })
    context.callbacks[0].message({ room: { currentQuestion: 15 } })
    await vi.advanceTimersByTimeAsync(1500)
    expect(context.read).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(context.states.mock.calls)).not.toContain('FORGED')
    expect(context.states.mock.calls.at(-1)?.[0].game.room.currentQuestion).toBe(0)
    context.sync.close()
  })
  it('does not let a delayed read overwrite a newer server-confirmed mutation', async () => {
    const context = make()
    let resolveRead!: (value: RoomSnapshot) => void
    context.read.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    await context.sync.mutate(async () => snapshot(2))
    resolveRead(snapshot(1)); await vi.advanceTimersByTimeAsync(0)
    expect(context.states.mock.calls.map(call => call[0].game.room.currentQuestion)).toEqual([2])
    context.sync.close()
  })
  it('queues a trailing read when another notification arrives during an in-flight read', async () => {
    const context = make()
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    let resolveRead!: (value: RoomSnapshot) => void
    context.read.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
    context.sync.invalidate(); await vi.advanceTimersByTimeAsync(1500)
    context.sync.invalidate()
    resolveRead(snapshot(1)); await vi.advanceTimersByTimeAsync(1500)
    expect(context.read).toHaveBeenCalledTimes(3)
    context.sync.close()
  })
  it('reconnects with renewed authorization and refetches after rejoining', async () => {
    const context = make()
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    context.callbacks[0].status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(1500)
    context.callbacks[0].status('CHANNEL_ERROR'); await vi.advanceTimersByTimeAsync(1000)
    expect(context.connect).toHaveBeenCalledTimes(2)
    expect(context.close).toHaveBeenCalledTimes(1)
    context.callbacks[1].status('SUBSCRIBED'); await vi.advanceTimersByTimeAsync(1500)
    expect(context.read).toHaveBeenCalledTimes(3)
    context.sync.close()
  })
  it('automatically renews a five-minute lease without persisting its JWT', async () => {
    const context = make()
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(240000)
    expect(context.ticket).toHaveBeenCalledTimes(2)
    expect(context.connect).toHaveBeenCalledTimes(2)
    context.sync.close()
  })
  it('honors Retry-After and retries reads automatically without changing the H-01 limit', async () => {
    const context = make()
    context.read.mockRejectedValueOnce(new RoomApiError('RATE_LIMITED', 429, 'Wait', 37))
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(37000)
    expect(context.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(context.read).toHaveBeenCalledTimes(2)
    context.sync.close()
  })
  it('stops all subscriptions and retries when session authorization is revoked', async () => {
    const context = make()
    context.read.mockRejectedValueOnce(new RoomApiError('UNAUTHORIZED', 401, 'Revoked'))
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    context.sync.invalidate(); context.sync.reconnect()
    await vi.advanceTimersByTimeAsync(600000)
    expect(context.read).toHaveBeenCalledTimes(1)
    expect(context.connect).not.toHaveBeenCalled()
    expect(context.status).toHaveBeenCalledWith('unauthorized', expect.any(String))
    context.sync.close()
  })
  it('cleans up an asynchronous subscription and late read on unmount or StrictMode cleanup', async () => {
    const context = make()
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    context.sync.close()
    expect(context.callbacks[0].signal.aborted).toBe(true)
    context.callbacks[0].message({ changed: true }); context.callbacks[0].status('CHANNEL_ERROR')
    await vi.advanceTimersByTimeAsync(600000)
    expect(context.read).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
  })
  it('fails closed on a ticket for a different room and reports missing deployment without fake success', async () => {
    const context = make()
    context.ticket.mockResolvedValue({ topic: 'gw-room:wrong-room', accessToken: 'fixture', expiresAt: new Date(Date.now() + 300000).toISOString() })
    context.sync.start(); await vi.advanceTimersByTimeAsync(250)
    expect(context.connect).not.toHaveBeenCalled()
    expect(context.status).toHaveBeenCalledWith('unavailable', expect.any(String))
    expect(context.states).toHaveBeenCalledTimes(1)
    context.sync.close()
  })
})
