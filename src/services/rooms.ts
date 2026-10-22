import type { JoinRoomInput } from '../types/game'
import { validateJoinRoom } from '../lib/validation'

export interface RoomService {
  createPreview(categoryIds: string[]): Promise<string>
  joinPreview(input: JoinRoomInput): Promise<string>
}

export const roomService: RoomService = {
  async createPreview(categoryIds) {
    if (!categoryIds.length) throw new Error('請至少選擇一個人物分類。')
    return `已選擇 ${categoryIds.length} 個分類！目前為介面預覽，尚未建立真實房間。`
  },
  async joinPreview(input) {
    const error = validateJoinRoom(input)
    if (error) throw new Error(error)
    return `${input.nickname.trim()}，資料格式正確！目前為介面預覽，尚未連線至房間 ${input.roomCode}。`
  },
}
