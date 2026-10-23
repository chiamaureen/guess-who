import type { LobbyState } from './game'
import type { GameState } from './game-engine'

export interface RoomSnapshot {
  lobby: LobbyState
  game: GameState
}
export interface RealtimeTicket {
  topic: string
  accessToken: string
  expiresAt: string
}
export type SyncStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'unauthorized'
