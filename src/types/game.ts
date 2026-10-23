export interface Category {
  id: string
  name: string
  slug: string
}

export interface LobbyState {
  room: { id: string; code: string; status: 'waiting' | 'playing' | 'finished'; currentQuestion: number; totalQuestions: 15; expiresAt: string }
  categories: Category[]
  players: { id: string; nickname: string; joinedAt: string }[]
  viewer: { role: 'host' | 'player'; id: string }
}

export type RoomSession = { role: 'host' | 'player'; token: string }

export interface JoinRoomInput {
  roomCode: string
  nickname: string
}

export const QUESTIONS_PER_GAME = 15
