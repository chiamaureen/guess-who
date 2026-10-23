import { describe, expect, it } from 'vitest'
import { validateJoinRoom } from './validation'

describe('room input', () => {
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
  it('rejects control and direction override characters', () => {
    for (const nickname of ['名\n字', '\u202e偽裝']) expect(validateJoinRoom({ roomCode: 'ABC123', nickname })).toBeTruthy()
  })
})
