import { RoomApiError } from './room-api'
import type { RoomSnapshot, SyncStatus } from '../types/realtime'

export const POLLING_INTERVAL_MS = 10000

export function pollingInterval(snapshot: RoomSnapshot | null) {
  return Math.max(POLLING_INTERVAL_MS, Math.ceil(((snapshot?.lobby.players.length ?? 0) + 1) * 60000 / 18))
}

export function createRoomPolling(options: {
  read(previous: RoomSnapshot | null): Promise<RoomSnapshot>
  snapshot(value: RoomSnapshot): void
  status(value: SyncStatus, message: string): void
  paused?: boolean
}) {
  let disposed = false
  let started = false
  let stopped = false
  let unauthorized = false
  let paused = options.paused ?? false
  let reading = false
  let mutations = 0
  let epoch = 0
  let attempts = 0
  let blockedUntil = 0
  let lastRead = -Infinity
  let due = 0
  let previous: RoomSnapshot | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => { clearTimeout(timer); timer = undefined }
  const schedule = () => {
    if (!started || disposed || stopped || unauthorized || paused || reading || mutations || timer) return
    timer = setTimeout(() => { timer = undefined; if (Date.now() < Math.max(due, blockedUntil)) schedule(); else void read() }, Math.min(2147483647, Math.max(0, due - Date.now(), blockedUntil - Date.now())))
  }
  const publish = (value: RoomSnapshot) => {
    previous = value
    stopped = value.lobby.room.status === 'finished'
    options.snapshot(value)
    options.status(stopped ? 'stopped' : 'connected', stopped ? '房間已結束，已停止自動更新。' : `自動更新中（約每 ${Math.ceil(pollingInterval(value) / 1000)} 秒）；目前使用 Polling。`)
  }
  const failure = (error: unknown) => {
    if (error instanceof RoomApiError && [401, 403, 404, 410].includes(error.status)) {
      unauthorized = true
      cancel()
      options.status('unauthorized', '房間已關閉、過期或授權失效，已停止自動更新。請重新驗證身分。')
      return
    }
    const backoff = Math.min(60000, POLLING_INTERVAL_MS * 2 ** Math.min(attempts++, 3))
    const retry = error instanceof RoomApiError && error.status === 429 ? error.retryAfter * 1000 + 250 : 0
    blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(backoff, retry))
    options.status('reconnecting', '暫時無法更新或操作太頻繁，將依限流等待後自動重試…')
  }
  const read = async () => {
    if (disposed || stopped || unauthorized || paused || reading || mutations) return
    reading = true
    lastRead = Date.now()
    const current = epoch
    try {
      const value = await options.read(previous)
      if (disposed) return
      if (current === epoch) { publish(value); attempts = 0 }
    } catch (error) { if (!disposed && current === epoch) failure(error) }
    finally {
      reading = false
      due = Date.now() + pollingInterval(previous)
      schedule()
    }
  }
  const invalidate = () => {
    if (disposed || stopped || unauthorized) return
    due = Math.min(due, Math.max(Date.now(), lastRead + POLLING_INTERVAL_MS))
    cancel()
    schedule()
  }
  return {
    start() { if (started || disposed) return; started = true; options.status('connecting', '正在取得最新房間狀態…'); schedule() },
    invalidate,
    reconnect: invalidate,
    setPaused(value: boolean) { paused = value; cancel(); if (!paused) invalidate() },
    async mutate(operation: () => Promise<RoomSnapshot>) {
      if (disposed || unauthorized) throw new RoomApiError('UNAUTHORIZED', 401, '房間授權已失效。')
      const current = ++epoch
      mutations++
      cancel()
      try {
        const value = await operation()
        if (!disposed && current === epoch) { publish(value); attempts = 0 }
      } catch (error) { if (!disposed && current === epoch && error instanceof RoomApiError && error.status === 429) failure(error); throw error }
      finally { mutations--; due = Date.now() + pollingInterval(previous); schedule() }
    },
    close() { disposed = true; epoch++; cancel() },
  }
}
