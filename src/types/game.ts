export interface Category {
  id: string
  name: string
  englishName: string
  symbol: string
  description: string
  color: string
}

export interface JoinRoomInput {
  roomCode: string
  nickname: string
}

export const QUESTIONS_PER_GAME = 15
