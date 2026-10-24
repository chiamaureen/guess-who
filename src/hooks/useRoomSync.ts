import { useEffect, useRef, useState } from 'react'
import { createRoomSync } from '../lib/room-sync'
import { createRoomPolling } from '../lib/room-polling'
import { realtimeEnabled } from '../lib/features'
import { roomService } from '../services/rooms'
import type { RoomSnapshot, SyncStatus } from '../types/realtime'

export function useRoomSync(code: string, enabled: boolean, onSnapshot: (value: RoomSnapshot) => void) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [message, setMessage] = useState('正在取得最新遊戲狀態…')
  const current = useRef<ReturnType<typeof createRoomSync> | ReturnType<typeof createRoomPolling> | null>(null)
  const callback = useRef(onSnapshot)
  callback.current = onSnapshot
  useEffect(() => {
    setSnapshot(null)
    if (!enabled) return
    const callbacks = { snapshot: (value: RoomSnapshot) => { setSnapshot(value); callback.current(value) }, status: (value: SyncStatus, text: string) => { setStatus(value); setMessage(text) } }
    const polling = realtimeEnabled() ? null : createRoomPolling({ ...callbacks, read: previous => roomService.getPollingSnapshot(code, previous), paused: document.visibilityState !== 'visible' || !navigator.onLine })
    const sync = polling ?? createRoomSync({ ...callbacks, read: () => roomService.getSnapshot(code), ticket: () => roomService.getRealtimeTicket(code),
      connect: async (...args) => (await import('../lib/realtime-transport')).connectRoomRealtime(...args) })
    current.current = sync
    const visible = () => { if (polling) polling.setPaused(document.visibilityState !== 'visible' || !navigator.onLine); else if (document.visibilityState === 'visible') sync.invalidate() }
    const online = () => { visible(); sync.reconnect() }
    window.addEventListener('online', online)
    window.addEventListener('offline', visible)
    document.addEventListener('visibilitychange', visible)
    sync.start()
    return () => { current.current = null; sync.close(); window.removeEventListener('online', online); window.removeEventListener('offline', visible); document.removeEventListener('visibilitychange', visible) }
  }, [code, enabled])
  return { snapshot, status, message,
    refresh: () => current.current?.invalidate(),
    mutate: async (operation: () => Promise<RoomSnapshot>) => { if (!current.current) throw new Error('房間尚未就緒。'); await current.current.mutate(operation) },
  }
}
