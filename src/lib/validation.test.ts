import { describe, expect, it } from 'vitest'
import { validateJoinRoom } from './validation'
import { roomService } from '../services/rooms'

describe('room preview input', () => {
  it('accepts a six-character room code and a trimmed nickname', () => {
    expect(validateJoinRoom({ roomCode: 'ABC123', nickname: ' 小明 ' })).toBeNull()
  })
  it('rejects invalid codes and empty or long nicknames', () => {
    for (const roomCode of ['ABC', 'abcdef', 'ABC!23', 'ABC1234']) {
      expect(validateJoinRoom({ roomCode, nickname: '小明' })).toBeTruthy()
    }
    for (const nickname of ['', '  ', '字'.repeat(21)]) {
      expect(validateJoinRoom({ roomCode: 'ABC123', nickname })).toBeTruthy()
    }
  })
  it('counts emoji as characters', () => {
    expect(validateJoinRoom({ roomCode: 'ABC123', nickname: '😀'.repeat(20) })).toBeNull()
  })
  it('requires a category and explicitly reports preview-only behavior', async () => {
    await expect(roomService.createPreview([])).rejects.toThrow('至少')
    await expect(roomService.createPreview(['music'])).resolves.toContain('尚未建立真實房間')
    await expect(roomService.joinPreview({ roomCode: 'ABC123', nickname: '小明' })).resolves.toContain('尚未連線')
  })
})
