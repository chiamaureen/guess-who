import type { LobbyState } from './game'

export interface GameQuestion {
  id: string
  number: number
  revealed: boolean
  answer?: string
  attribution?: { author: string; license: string; text: string; source: string }
}
export interface GameState {
  room: LobbyState['room']
  viewer: LobbyState['viewer']
  question: GameQuestion | null
  historyRevision?: string
}
export type GameAction = 'start-game' | 'reveal-answer' | 'next-question' | 'finish-game'
