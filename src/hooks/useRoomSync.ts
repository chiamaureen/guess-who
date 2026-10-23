import { useEffect, useRef, useState } from 'react'
import { createRoomSync } from '../lib/room-sync'
import { connectRoomRealtime } from '../lib/realtime-transport'
import { roomService } from '../services/rooms'
import type { RoomSnapshot, SyncStatus } from '../types/realtime'

export function useRoomSync(code: string, enabled: boolean, onSnapshot: (value: RoomSnapshot) => void) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [status, setStatus] = useState<SyncStatus>('connecting')
  const [message, setMessage] = useState('正在取得最新遊戲狀態…')
  const current = useRef<ReturnType<typeof createRoomSync> | null>(null)
  useEffect(() => {
    setSnapshot(null)
    if (!enabled) return
    const sync = createRoomSync({ read: () => roomService.getSnapshot(code), ticket: () => roomService.getRealtimeTicket(code), connect: connectRoomRealtime,
      snapshot: value => { setSnapshot(value); onSnapshot(value) }, status: (value, text) => { setStatus(value); setMessage(text) } })
    current.current = sync
    const online = () => sync.reconnect()
    const visible = () => { if (document.visibilityState === 'visible') sync.invalidate() }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    sync.start()
    return () => { current.current = null; sync.close(); window.removeEventListener('online', online); document.removeEventListener('visibilitychange', visible) }
  }, [code, enabled, onSnapshot])
  return { snapshot, status, message,
    refresh: () => current.current?.invalidate(),
    mutate: async (operation: () => Promise<RoomSnapshot>) => { if (!current.current) throw new Error('房間尚未就緒。'); await current.current.mutate(operation) },
  }
}
