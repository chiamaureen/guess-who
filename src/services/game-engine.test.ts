import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoomService } from './rooms'
import { parseGameState, loadGameImage, invokeGameApi } from '../lib/game-api'

const code = 'ABC123'
const credential = `gw_host_${'A'.repeat(43)}`
const token = `gw_room_${'A'.repeat(43)}`
const playerToken = `gw_player_${'A'.repeat(43)}`
const questionId = '70000000-0000-4000-8000-000000000001'
const state = (role: 'host' | 'player' = 'host', revealed = false) => ({ room: { id: 'room', code, status: 'playing', currentQuestion: 1, totalQuestions: 15, expiresAt: '2099-01-01T00:00:00Z' }, viewer: { role, id: 'viewer' }, question: { id: questionId, number: 1, revealed, ...(role === 'host' || revealed ? { answer: '正確姓名' } : {}) }, ...(role === 'host' ? { historyRevision: 'a'.repeat(32) } : {}) })
function fixture(role: 'host' | 'player' = 'host') {
  const values = new Map<string, string>([
    ['guess-who:v1:host', JSON.stringify({ hostId: 'viewer', credential })],
    [`guess-who:v1:room:${code}`, JSON.stringify({ role, token: role === 'host' ? token : playerToken })],
  ])
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } })
  const gameApi = vi.fn<typeof invokeGameApi>(async () => state(role))
  const imageApi = vi.fn<typeof loadGameImage>(async () => new Blob(['fixture'], { type: 'image/png' }))
  const options = { storage, gameApi, imageApi, lock: async <Result>(operation: () => Promise<Result>) => operation() }
  return { service: createRoomService(options), options, gameApi, imageApi, values }
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
describe('game engine session boundary', () => {
  it('loads a coherent lobby and game snapshot in one authenticated request without storing state', async () => {
    const { service, gameApi, values } = fixture()
    gameApi.mockResolvedValue({ ...state(), players: [], categories: [] })
    const result = await service.getSnapshot(code)
    expect(result.game.question?.number).toBe(1)
    expect(result.lobby.room.currentQuestion).toBe(1)
    expect(gameApi).toHaveBeenCalledTimes(1)
    expect([...values.values()].join('')).not.toContain('正確姓名')
  })
  it('loads the deployed Phase 6 DTO without requiring Phase 7 tickets or new fields', async () => {
    const context = fixture('player')
    const api = vi.fn(async () => ({ ...state('player'), categories: [], players: [] }))
    const service = createRoomService({ ...context.options, api })
    const value = await service.getPollingSnapshot(code, null)
    expect(api.mock.calls).toHaveLength(1)
    expect(context.gameApi).toHaveBeenCalledTimes(1)
    expect(value.game.question?.answer).toBeUndefined()
    expect(value.lobby.room).toEqual(value.game.room)
  })
  it('polls the waiting roster with one room API call without repeatedly requesting the game', async () => {
    const context = fixture('player')
    const waiting = { ...state('player'), room: { ...state('player').room, status: 'waiting', currentQuestion: 0 }, question: null }
    const api = vi.fn(async () => ({ ...waiting, categories: [], players: [{ id: 'new', nickname: '新玩家', joinedAt: '2026-10-24T00:00:00Z' }] }))
    const service = createRoomService({ ...context.options, api })
    const previous = { game: parseGameState(waiting), lobby: { ...parseGameState(waiting), categories: [], players: [] } }
    const value = await service.getPollingSnapshot(code, previous)
    expect(api).toHaveBeenCalledTimes(1)
    expect(value.lobby.players).toHaveLength(1)
    expect(context.gameApi).not.toHaveBeenCalled()
    expect(value.game.question).toBeNull()
  })
  it('detects start from the room API and obtains the first protected game state', async () => {
    const context = fixture('player')
    const api = vi.fn(async () => ({ ...state('player'), categories: [], players: [] }))
    const service = createRoomService({ ...context.options, api })
    const waiting = { ...state('player'), room: { ...state('player').room, status: 'waiting', currentQuestion: 0 }, question: null }
    const previous = { game: parseGameState(waiting), lobby: { ...parseGameState(waiting), categories: [], players: [] } }
    const value = await service.getPollingSnapshot(code, previous)
    expect(api).toHaveBeenCalledTimes(1)
    expect(context.gameApi).toHaveBeenCalledTimes(1)
    expect(value.game.question?.number).toBe(1)
    expect(value.game.question?.answer).toBeUndefined()
  })
  it('polls playing state with one existing game call, retaining only the opening roster', async () => {
    const context = fixture('player')
    const api = vi.fn(async () => ({ ...state('player'), categories: [], players: [] }))
    const service = createRoomService({ ...context.options, api })
    const previous = await service.getPollingSnapshot(code, null)
    api.mockClear(); context.gameApi.mockClear()
    context.gameApi.mockResolvedValue(state('player', true))
    const value = await service.getPollingSnapshot(code, previous)
    expect(context.gameApi).toHaveBeenCalledTimes(1)
    expect(api).not.toHaveBeenCalled()
    expect(value.game.question?.answer).toBe('正確姓名')
    expect(value.lobby.room).toEqual(value.game.room)
  })
  it('requests a short Realtime ticket with only existing headers and never trusts caller IDs', async () => {
    const context = fixture('player')
    const ticket = { topic: 'gw-room:10000000-0000-4000-8000-000000000001', accessToken: 'aaa.bbb.ccc', expiresAt: new Date(Date.now() + 240000).toISOString() }
    const api = vi.fn(async () => ticket)
    const service = createRoomService({ ...context.options, api })
    expect(await service.getRealtimeTicket(code)).toEqual(ticket)
    expect(api).toHaveBeenCalledWith('get-realtime-ticket', { roomCode: code }, { 'x-player-session': playerToken })
    await expect(service.controlSnapshot(code, 'start-game')).rejects.toThrow('只有主持人')
    expect([...context.values.values()].join('')).not.toContain('aaa.bbb.ccc')
  })
  it('restores Host state with existing host and room credentials, never stores questions or answers', async () => {
    const { service, options, gameApi, values } = fixture()
    await service.getGameState(code)
    await createRoomService(options).getGameState(code)
    expect(gameApi.mock.calls).toHaveLength(2)
    expect(gameApi.mock.calls[0]).toEqual(['get-game-state', { roomCode: code }, { 'x-host-credential': credential, 'x-room-token': token }])
    expect([...values.values()].join('')).not.toContain('正確姓名')
  })
  it('restores Player with only own session; cannot invoke mutations or reset', async () => {
    const { service, gameApi } = fixture('player')
    await service.getGameState(code)
    expect(gameApi.mock.calls[0]).toEqual(['get-game-state', { roomCode: code }, { 'x-player-session': playerToken }])
    await expect(service.controlGame(code, 'start-game')).rejects.toThrow('只有主持人')
    await expect(service.resetHistory(code, 'a'.repeat(32), true)).rejects.toThrow('只有主持人')
  })
  it('retries next using original question identity and does not invent a new question or request ID', async () => {
    const { service, gameApi } = fixture()
    await service.controlGame(code, 'next-question', questionId)
    await service.controlGame(code, 'next-question', questionId)
    expect(gameApi.mock.calls[0]).toEqual(gameApi.mock.calls[1])
    expect(gameApi.mock.calls[0][1]).toEqual({ roomCode: code, questionId })
  })
  it('history reset requires confirmation and sends only long-term credential and expected revision', async () => {
    const { service, gameApi } = fixture()
    await expect(service.resetHistory(code, 'a'.repeat(32), false)).rejects.toThrow('明確確認')
    await service.resetHistory(code, 'a'.repeat(32), true)
    expect(gameApi.mock.calls[0]).toEqual(['reset-question-history', { confirm: true, historyRevision: 'a'.repeat(32) }, { 'x-host-credential': credential }])
  })
  it('loads image through authenticated private API rather than answer-bearing remote URL', async () => {
    const { service, imageApi } = fixture('player')
    await service.getGameImage(code, questionId)
    expect(imageApi.mock.calls[0]).toEqual([code, questionId, { 'x-player-session': playerToken }])
  })
})
describe('game DTO and image contracts', () => {
  it('accepts WebP, legacy PNG and JPEG responses with format-specific size caps', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    for (const mime of ['image/webp', 'image/png', 'image/jpeg']) {
      fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(128), { headers: { 'content-type': mime } }))
      expect((await loadGameImage(code, questionId, { 'x-player-session': playerToken })).type).toBe(mime)
    }
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(307201), { headers: { 'content-type': 'image/webp' } }))
    await expect(loadGameImage(code, questionId, {})).rejects.toThrow('圖片大小')
  })
  it('strips hidden answer, attribution and history from unrevealed Player data', () => {
    const parsed = parseGameState({ ...state('player'), question: { ...state('player').question, answer: 'LEAK', attribution: { source: 'LEAK' } }, historyRevision: 'LEAK', token: 'LEAK' })
    expect(JSON.stringify(parsed)).not.toContain('LEAK')
  })
  it('retains revealed answer but rejects invalid progress, missing answers and mismatched questions', () => {
    expect(parseGameState(state('player', true)).question?.answer).toBe('正確姓名')
    expect(() => parseGameState({ ...state(), room: { ...state().room, currentQuestion: 16 } })).toThrow()
    expect(() => parseGameState({ ...state(), question: { ...state().question, number: 2 } })).toThrow()
    expect(() => parseGameState({ ...state('player'), question: { ...state('player').question, revealed: true } })).toThrow()
  })
  it('binary image requests keep credentials in headers, never URL or cookies, and reject wrong formats', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture')
    const fetchMock = vi.fn().mockResolvedValue(new Response('<svg>bad</svg>', { headers: { 'content-type': 'image/svg+xml' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(loadGameImage(code, questionId, { 'x-player-session': playerToken })).rejects.toThrow('圖片格式')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/game-engine/get-question-image')
    expect(url).not.toContain(playerToken)
    expect(options.credentials).toBe('omit')
    expect(options.redirect).toBe('error')
  })
})
