import { RoomApiError } from './room-api'
import type { RealtimeTicket, RoomSnapshot, SyncStatus } from '../types/realtime'

export interface SyncConnection { close(): void }
export interface SyncOptions {
  read(): Promise<RoomSnapshot>
  ticket(): Promise<RealtimeTicket>
  connect(ticket: RealtimeTicket, message: (payload: unknown) => void, status: (value: string) => void, signal: AbortSignal): Promise<SyncConnection>
  snapshot(value: RoomSnapshot): void
  status(value: SyncStatus, message: string): void
}

export function createRoomSync(options: SyncOptions) {
  let disposed = false
  let reading = false
  let dirty = false
  let connecting = false
  let startedConnection = false
  let unauthorized = false
  let subscribed = false
  let roomId = ''
  let mutations = 0
  let epoch = 0
  let lastRead = -Infinity
  let blockedUntil = 0
  let attempt = 0
  let connection: SyncConnection | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let renewTimer: ReturnType<typeof setTimeout> | undefined
  const abort = new AbortController()
  const clear = () => { clearTimeout(timer); clearTimeout(reconnectTimer); clearTimeout(renewTimer); connection?.close(); connection = undefined }
  const terminal = (error: unknown) => error instanceof RoomApiError && [401, 403, 410].includes(error.status)
  const delay = (error: unknown) => error instanceof RoomApiError && error.status === 429 ? error.retryAfter * 1000 + 250 : Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5))
  const schedule = () => {
    if (disposed || unauthorized || reading || mutations || !dirty || timer) return
    timer = setTimeout(() => { timer = undefined; void read() }, Math.max(250, blockedUntil - Date.now(), lastRead + 1500 - Date.now()))
  }
  const invalidate = () => { if (!disposed && !unauthorized) { dirty = true; schedule() } }
  const denied = () => { unauthorized = true; clear(); dirty = false; startedConnection = true; options.status('unauthorized', '房間授權已失效，已停止即時訂閱。請重新驗證身分。') }
  const reconnect = (error?: unknown) => {
    if (disposed || unauthorized || reconnectTimer) return
    subscribed = false
    options.status('reconnecting', '連線中斷，正在自動恢復…')
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void open() }, delay(error))
  }
  const open = async () => {
    if (disposed || unauthorized || connecting) return
    connecting = true
    try {
      const ticket = await options.ticket()
      if (disposed) return
      if (ticket.topic !== `gw-room:${roomId}`) throw new RoomApiError('INVALID_REALTIME_TOPIC', 503, '即時同步房間不符。')
      connection?.close(); connection = undefined
      clearTimeout(renewTimer)
      const next = await options.connect(ticket, payload => {
        if (payload && typeof payload === 'object' && Object.keys(payload).length === 1 && (payload as { changed?: unknown }).changed === true) invalidate()
      }, status => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          subscribed = true
          clearTimeout(reconnectTimer); reconnectTimer = undefined; attempt = 0
          options.status('connected', '即時同步已連線')
          invalidate()
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) reconnect()
      }, abort.signal)
      if (disposed) { next.close(); return }
      connection = next
      const remaining = Date.parse(ticket.expiresAt) - Date.now()
      renewTimer = setTimeout(() => { void open() }, Math.max(1000, remaining > 90000 ? remaining - 60000 : remaining))
    } catch (error) {
      if (disposed) return
      if (terminal(error)) denied()
      else if (error instanceof RoomApiError && [400, 404, 503].includes(error.status)) options.status('unavailable', '即時同步尚未部署或授權設定不完整；目前仍可手動更新。')
      else reconnect(error)
    } finally { connecting = false }
  }
  const read = async () => {
    if (disposed || unauthorized || reading || mutations) return
    reading = true; dirty = false; lastRead = Date.now()
    const current = epoch
    try {
      const result = await options.read()
      if (disposed) return
      if (current === epoch) { roomId = result.lobby.room.id; options.snapshot(result) }
      else dirty = true
      if (subscribed) options.status('connected', '即時同步已連線')
      if (!startedConnection) { startedConnection = true; void open() }
    } catch (error) {
      if (disposed) return
      if (terminal(error)) denied()
      else { dirty = true; blockedUntil = Date.now() + delay(error); options.status('reconnecting', '無法更新狀態，將自動重試…') }
    } finally { reading = false; schedule() }
  }
  return {
    start() { options.status('connecting', '正在連接即時同步…'); invalidate() },
    invalidate,
    reconnect() { if (!disposed) { invalidate(); void open() } },
    async mutate(operation: () => Promise<RoomSnapshot>) {
      if (disposed || unauthorized) throw new RoomApiError('UNAUTHORIZED', 401, '房間授權已失效。')
      const current = ++epoch
      mutations++
      try {
        const result = await operation()
        if (!disposed && current === epoch) options.snapshot(result)
        else dirty = true
      } finally { mutations--; schedule() }
    },
    close() { disposed = true; epoch++; abort.abort(); clear() },
  }
}
