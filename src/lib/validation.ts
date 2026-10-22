import type { JoinRoomInput } from '../types/game'

export function validateJoinRoom({ roomCode, nickname }: JoinRoomInput): string | null {
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return '請輸入 6 碼英文字母或數字的房間代碼。'
  if (!nickname.trim() || Array.from(nickname.trim()).length > 20) return '請輸入 1–20 個字的暱稱。'
  return null
}
