import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoomPolling, pollingInterval } from './room-polling'
import { realtimeEnabled } from './features'
import { readApiResponse, RoomApiError } from './room-api'
import type { RoomSnapshot } from '../types/realtime'

const snapshot = (number = 0, finished = false): RoomSnapshot => {
  const room = { id: 'room', code: 'ABC123', status: finished ? 'finished' as const : number ? 'playing' as const : 'waiting' as const, currentQuestion: number, totalQuestions: 15 as const, expiresAt: '2099-01-01T00:00:00Z' }
  const viewer = { id: 'player', role: 'player' as const }
  return { lobby: { room, viewer, players: [], categories: [] }, game: { room, viewer, question: number ? { id: `question-${number}`, number, revealed: false } : null } }
}
const fixture = (paused = false) => {
  const read = vi.fn(async (_previous: RoomSnapshot | null) => snapshot())
  const publish = vi.fn()
  const status = vi.fn()
  const sync = createRoomPolling({ read, snapshot: publish, status, paused })
  return { read, publish, status, sync }
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('MVP polling lifecycle', () => {
  it('disables Realtime by default and requires the exact opt-in flag', () => {
    expect(realtimeEnabled({})).toBe(false)
    expect(realtimeEnabled({ VITE_ENABLE_REALTIME: 'false' })).toBe(false)
    expect(realtimeEnabled({ VITE_ENABLE_REALTIME: 'TRUE' })).toBe(false)
    expect(realtimeEnabled({ VITE_ENABLE_REALTIME: 'true' })).toBe(true)
  })
  it('reads immediately, starts once, and uses a ten-second baseline instead of three seconds', async () => {
    const context = fixture()
    context.sync.start(); context.sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(context.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9999)
    expect(context.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(context.read).toHaveBeenCalledTimes(2)
    expect(context.read.mock.calls[1][0]).toEqual(snapshot())
    context.sync.close()
  })
  it('slows large rooms to leave a shared-source request budget for photos and manual operations', () => {
    const value = snapshot()
    value.lobby.players = Array.from({ length: 5 }, (_, index) => ({ id: `player-${index}`, nickname: 'QA', joinedAt: '2026-10-24T00:00:00Z' }))
    expect(pollingInterval(value)).toBe(20000)
    expect(pollingInterval(null)).toBe(10000)
  })
  it('does not overlap slow reads or spawn extra loops after repeated manual refresh', async () => {
    const context = fixture()
    let resolveRead!: (value: RoomSnapshot) => void
    context.read.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    for (let index = 0; index < 30; index++) context.sync.invalidate()
    await vi.advanceTimersByTimeAsync(60000)
    expect(context.read).toHaveBeenCalledTimes(1)
    resolveRead(snapshot()); await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10000)
    expect(context.read).toHaveBeenCalledTimes(2)
    context.sync.close()
  })
  it('never lets an older read overwrite a confirmed control response', async () => {
    const context = fixture()
    let resolveRead!: (value: RoomSnapshot) => void
    context.read.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    await context.sync.mutate(async () => snapshot(2))
    resolveRead(snapshot(1)); await vi.advanceTimersByTimeAsync(0)
    expect(context.publish.mock.calls.map(call => call[0].game.room.currentQuestion)).toEqual([2])
    context.sync.close()
  })
  it('waits until a mutation finishes before starting the next poll', async () => {
    const context = fixture()
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    let resolveMutation!: (value: RoomSnapshot) => void
    const pending = context.sync.mutate(() => new Promise(resolve => { resolveMutation = resolve }))
    await vi.advanceTimersByTimeAsync(40000)
    expect(context.read).toHaveBeenCalledTimes(1)
    resolveMutation(snapshot(1)); await pending
    await vi.advanceTimersByTimeAsync(10000)
    expect(context.read).toHaveBeenCalledTimes(2)
    context.sync.close()
  })
  it('honors Retry-After even when focus and manual refresh try to restart it', async () => {
    const context = fixture()
    context.read.mockRejectedValueOnce(new RoomApiError('RATE_LIMITED', 429, 'Wait', 37))
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    context.sync.invalidate(); context.sync.setPaused(true); context.sync.setPaused(false)
    await vi.advanceTimersByTimeAsync(37000)
    expect(context.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(context.read).toHaveBeenCalledTimes(2)
    context.sync.close()
  })
  it('backs off repeated network errors and resets backoff after a successful read', async () => {
    const context = fixture()
    context.read.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    context.sync.start(); await vi.advanceTimersByTimeAsync(10000)
    expect(context.read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(19999)
    expect(context.read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(context.read).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(10000)
    expect(context.read).toHaveBeenCalledTimes(4)
    context.sync.close()
  })
  it('pauses in the background/offline and resumes with one fresh read', async () => {
    const context = fixture(true)
    context.sync.start(); await vi.advanceTimersByTimeAsync(60000)
    expect(context.read).not.toHaveBeenCalled()
    context.sync.setPaused(false); await vi.advanceTimersByTimeAsync(0)
    expect(context.read).toHaveBeenCalledTimes(1)
    context.sync.setPaused(true); await vi.advanceTimersByTimeAsync(60000)
    expect(context.read).toHaveBeenCalledTimes(1)
    context.sync.setPaused(false); await vi.advanceTimersByTimeAsync(0)
    expect(context.read).toHaveBeenCalledTimes(2)
    context.sync.close()
  })
  it('stops when the room finishes and does not restart on focus or refresh', async () => {
    const context = fixture()
    context.read.mockResolvedValueOnce(snapshot(15, true))
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    context.sync.invalidate(); context.sync.reconnect(); context.sync.setPaused(false)
    await vi.advanceTimersByTimeAsync(600000)
    expect(context.read).toHaveBeenCalledTimes(1)
    expect(context.status).toHaveBeenCalledWith('stopped', expect.any(String))
    context.sync.close()
  })
  it.each([401, 403, 404, 410])('stops on terminal HTTP %s without clearing any session', async status => {
    const context = fixture()
    context.read.mockRejectedValueOnce(new RoomApiError('UNAUTHORIZED', status, 'Denied'))
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    context.sync.invalidate(); context.sync.reconnect(); await vi.advanceTimersByTimeAsync(600000)
    expect(context.read).toHaveBeenCalledTimes(1)
    expect(context.status).toHaveBeenCalledWith('unauthorized', expect.any(String))
    context.sync.close()
  })
  it('cleans up StrictMode timers and ignores reads completed after leaving', async () => {
    const first = fixture()
    first.sync.start(); first.sync.close(); await vi.advanceTimersByTimeAsync(0)
    expect(first.read).not.toHaveBeenCalled()
    const context = fixture()
    let resolveRead!: (value: RoomSnapshot) => void
    context.read.mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve }))
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    context.sync.close(); resolveRead(snapshot(1)); await vi.advanceTimersByTimeAsync(600000)
    expect(context.publish).not.toHaveBeenCalled()
    expect(context.read).toHaveBeenCalledTimes(1)
  })
  it('applies mutation throttling to subsequent reads without retrying writes', async () => {
    const context = fixture()
    context.sync.start(); await vi.advanceTimersByTimeAsync(0)
    const operation = vi.fn(async () => { throw new RoomApiError('RATE_LIMITED', 429, 'Wait', 50) })
    await expect(context.sync.mutate(operation)).rejects.toThrow('Wait')
    await vi.advanceTimersByTimeAsync(50000)
    expect(context.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(250)
    expect(context.read).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenCalledTimes(1)
    context.sync.close()
  })
  it.each(['37', 'Wed, 21 Oct 2099 07:28:00 GMT'])('parses HTTP Retry-After %s without exposing credentials', async header => {
    const response = new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), { status: 429, headers: { 'Retry-After': header } })
    const error = await readApiResponse(response).catch(value => value) as RoomApiError
    expect(error.status).toBe(429)
    expect(error.retryAfter).toBe(header === '37' ? 37 : Math.max(1, Math.ceil((Date.parse(header) - Date.now()) / 1000)))
  })
  it('preserves Retry-After when a gateway returns non-JSON HTTP 429', async () => {
    const error = await readApiResponse(new Response('Too many requests', { status: 429, headers: { 'Retry-After': '61' } })).catch(value => value) as RoomApiError
    expect(error.status).toBe(429)
    expect(error.retryAfter).toBe(61)
  })
  it('does not overflow the timer or immediately retry a distant Retry-After', async () => {
    const context = fixture()
    context.read.mockRejectedValueOnce(new RoomApiError('RATE_LIMITED', 429, 'Wait', 3000000))
    context.sync.start(); await vi.advanceTimersByTimeAsync(60000)
    expect(context.read).toHaveBeenCalledTimes(1)
    context.sync.close()
  })
})
