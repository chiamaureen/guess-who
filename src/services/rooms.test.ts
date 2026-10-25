import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoomService } from './rooms'
import { invitationUrl, invokeRoomApi, parseLobby, RoomApiError } from '../lib/room-api'
import type { LobbyState } from '../types/game'

const credential = `gw_host_${'A'.repeat(43)}`
const hostToken = `gw_room_${'A'.repeat(43)}`
const playerSession = `gw_player_${'A'.repeat(43)}`
const hostId = '20000000-0000-4000-8000-000000000001'
const categoryId = '10000000-0000-4000-8000-000000000001'
const lobby = (role: 'host' | 'player' = 'host'): LobbyState => ({ room: { id: '30000000-0000-4000-8000-000000000001', code: 'ABC123', status: 'waiting', currentQuestion: 0, totalQuestions: 15, expiresAt: '2099-01-01T00:00:00Z' }, viewer: { role, id: role === 'host' ? hostId : '50000000-0000-4000-8000-000000000001' }, categories: [{ id: categoryId, name: '演員', slug: 'actors' }], players: [{ id: '50000000-0000-4000-8000-000000000001', nickname: '小明', joinedAt: '2026-10-23T00:00:00Z' }] })

function fixture() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  let queue: Promise<unknown> = Promise.resolve()
  const lock = <Result>(operation: () => Promise<Result>): Promise<Result> => { const result = queue.then(operation); queue = result.catch(() => undefined); return result }
  const api = vi.fn<typeof invokeRoomApi>(async (action, _input, headers = {}) => {
    if (action === 'host-session') return _input.mode === 'revoke' ? { revoked: true } : { hostId, credential }
    if (action === 'create-room') return { ...lobby(), hostToken }
    if (action === 'join-room') return { ...lobby('player'), playerSession }
    if (action === 'get-room-state') return { ...lobby(headers['x-player-session'] ? 'player' : 'host') }
    if (action === 'close-room') return { ...lobby(), room: { ...lobby().room, status: 'finished' } }
    return { left: true }
  })
  const options = { storage: () => storage, lock, api }
  return { values, api, options, service: createRoomService(options) }
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('room session persistence', () => {
  it('uses one persistent host identity for availability and retries the same group selection after response loss', async () => {
    const { service, api } = fixture()
    const original = api.getMockImplementation()!
    const groups = Array.from({ length: 8 }, (_, index) => ({ id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, categoryId, name: `Group ${index}`, slug: `group-${index}`, available: index === 0 ? 15 : 0, selectable: index === 0, reason: index === 0 ? '' : 'NOT READY' }))
    let lost = true
    api.mockImplementation(async (...args) => {
      if (args[0] === 'get-question-groups') return { groups }
      if (args[0] === 'create-room' && lost) { lost = false; throw new RoomApiError('NETWORK', 0, 'offline') }
      return original(...args)
    })
    expect(await service.questionGroups()).toEqual(groups)
    await expect(service.create([], [groups[0].id])).rejects.toThrow('offline')
    await service.create([], [groups[1].id])
    const requests = api.mock.calls.filter(([action]) => action === 'create-room')
    expect(requests[0][1]).toEqual(requests[1][1])
    expect(requests[0][1]).toMatchObject({ groupIds: [groups[0].id] })
    expect(requests[0][1]).not.toHaveProperty('categoryIds')
    expect(api.mock.calls.filter(([action]) => action === 'host-session')).toHaveLength(1)
  })
  it('rejects a group marked selectable without 15 eligible people', async () => {
    const { service, api } = fixture()
    const original = api.getMockImplementation()!
    api.mockImplementation(async (...args) => args[0] === 'get-question-groups' ? { groups: Array.from({ length: 8 }, (_, index) => ({ id: String(index), categoryId, name: 'Invalid group', slug: 'invalid', available: 0, selectable: true, reason: '' })) } : original(...args))
    await expect(service.questionGroups()).rejects.toThrow('題庫分組回應不正確')
  })
  it('reuses the same host across page/service recreation and never persists authoritative game state', async () => {
    const { service, options, api, values } = fixture()
    await service.create([categoryId])
    const refreshed = createRoomService(options)
    await refreshed.getState('ABC123')
    await refreshed.create([categoryId])
    expect(api.mock.calls.filter(([action]) => action === 'host-session')).toHaveLength(1)
    expect(api.mock.calls.find(([action]) => action === 'get-room-state')?.[2]).toEqual({ 'x-host-credential': credential, 'x-room-token': hostToken })
    expect([...values.values()].join('')).not.toContain('currentQuestion')
    expect([...values.values()].join('')).not.toContain('waiting')
  })
  it('serializes concurrent first-time creates without minting two hosts', async () => {
    const { options, api } = fixture()
    await Promise.all([createRoomService(options).create([categoryId]), createRoomService(options).create([categoryId])])
    expect(api.mock.calls.filter(([action]) => action === 'host-session')).toHaveLength(1)
  })
  it('coalesces concurrent submits from the same page into one create request', async () => {
    const { service, api } = fixture()
    await Promise.all([service.create([categoryId]), service.create([categoryId])])
    expect(api.mock.calls.filter(([action]) => action === 'create-room')).toHaveLength(1)
  })
  it('retries a lost create response with the original key and categories', async () => {
    const { service, api } = fixture()
    const normal = api.getMockImplementation()!
    let lost = true
    api.mockImplementation(async (...args) => { if (args[0] === 'create-room' && lost) { lost = false; throw new RoomApiError('NETWORK', 0, 'offline') }; return normal(...args) })
    await expect(service.create([categoryId])).rejects.toThrow('offline')
    expect(service.pendingCreation()?.categoryIds).toEqual([categoryId])
    await service.create(['different category selection'])
    const requests = api.mock.calls.filter(([action]) => action === 'create-room')
    expect(requests[0][1]).toEqual(requests[1][1])
    expect(service.pendingCreation()).toBeUndefined()
  })
  it('retries host bootstrap safely after response loss and does not silently replace a saved identity', async () => {
    const { service, api } = fixture()
    api.mockRejectedValueOnce(new RoomApiError('NETWORK', 0, 'offline'))
    await expect(service.create([categoryId])).rejects.toThrow('offline')
    await service.create([categoryId])
    const bootstraps = api.mock.calls.filter(([action]) => action === 'host-session')
    expect(bootstraps[0][1]).toEqual(bootstraps[1][1])
    api.mockRejectedValueOnce(new RoomApiError('UNAUTHORIZED', 401, 'revoked'))
    await expect(service.create([categoryId])).rejects.toThrow('revoked')
    expect(api.mock.calls.filter(([action]) => action === 'host-session')).toHaveLength(2)
  })
  it('recovers player session on refresh and duplicate join without adding a second player', async () => {
    const { service, options, api } = fixture()
    await service.join({ roomCode: 'abc123', nickname: ' 小明 ' })
    const refreshed = createRoomService(options)
    await refreshed.join({ roomCode: 'ABC123', nickname: '小明' })
    await refreshed.getState('ABC123')
    expect(api.mock.calls.filter(([action]) => action === 'join-room')).toHaveLength(1)
    expect(api.mock.calls.at(-1)?.[2]).toEqual({ 'x-player-session': playerSession })
  })
  it('retains a pending join key and nickname after a network failure', async () => {
    const { service, api } = fixture()
    api.mockRejectedValueOnce(new RoomApiError('NETWORK', 0, 'offline'))
    await expect(service.join({ roomCode: 'ABC123', nickname: '小明' })).rejects.toThrow('offline')
    await service.join({ roomCode: 'ABC123', nickname: '重新輸入' })
    expect(api.mock.calls[0][1]).toEqual(api.mock.calls[1][1])
  })
  it('leaves only the current player, clears the session and rejects browser-side host control', async () => {
    const { service, api } = fixture()
    await service.join({ roomCode: 'ABC123', nickname: '小明' })
    await expect(service.close('ABC123')).rejects.toThrow('只有主持人')
    await service.leave('ABC123')
    expect(service.hasSession('ABC123')).toBe(false)
    expect(api.mock.calls.at(-1)?.[2]).toEqual({ 'x-player-session': playerSession })
  })
  it('does not clear sessions on transient leave errors, but can safely discard revoked sessions', async () => {
    const { service, api } = fixture()
    await service.join({ roomCode: 'ABC123', nickname: '小明' })
    api.mockRejectedValueOnce(new RoomApiError('NETWORK', 0, 'offline'))
    await expect(service.leave('ABC123')).rejects.toThrow('offline')
    expect(service.hasSession('ABC123')).toBe(true)
    api.mockRejectedValueOnce(new RoomApiError('UNAUTHORIZED', 401, 'revoked'))
    await service.leave('ABC123')
    expect(service.hasSession('ABC123')).toBe(false)
  })
  it('does not mint credentials when storage is blocked or corrupted', async () => {
    const { options, api, values } = fixture()
    const blocked = createRoomService({ ...options, storage: () => { throw new Error('blocked') } })
    await expect(blocked.create([categoryId])).rejects.toThrow('儲存權限')
    values.set('guess-who:v1:host', '{broken')
    await expect(createRoomService(options).create([categoryId])).rejects.toThrow('不要直接建立新身分')
    expect(api).not.toHaveBeenCalled()
  })
  it('keeps identity when server revocation is refused, then clears it only after confirmed success', async () => {
    const { service, api, values } = fixture()
    await service.create([categoryId])
    api.mockRejectedValueOnce(new RoomApiError('ACTIVE_ROOMS', 409, 'active'))
    await expect(service.revokeHost()).rejects.toThrow('active')
    expect(values.has('guess-who:v1:host')).toBe(true)
    await service.revokeHost()
    expect(values.has('guess-who:v1:host')).toBe(false)
    expect(service.hasSession('ABC123')).toBe(false)
  })
})

describe('room API contracts', () => {
  it('builds GitHub Pages invitations with only a room code', () => {
    expect(invitationUrl('ABC123', '/guess-who/', 'https://chiamaureen.github.io')).toBe('https://chiamaureen.github.io/guess-who/#/room/ABC123')
    expect(() => invitationUrl('bad', '/guess-who/', 'https://chiamaureen.github.io')).toThrow()
  })
  it('rejects invalid lobby responses and strips unexpected secret or answer fields', () => {
    expect(() => parseLobby({})).toThrow()
    expect(() => parseLobby({ ...lobby(), room: { ...lobby().room, totalQuestions: 16 } })).toThrow()
    expect(JSON.stringify(parseLobby({ ...lobby(), token_hash: 'not allowed', answer: 'not allowed' }))).not.toContain('not allowed')
  })
  it('uses explicit credentials, no cookies, no redirects and sanitized API errors', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefghijklmnopqrst.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'private SQL internals' } }), { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(invokeRoomApi('close-room', { roomCode: 'ABC123' }, { 'x-room-token': hostToken })).rejects.toThrow('沒有這個房間')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).not.toContain(hostToken)
    expect(options.credentials).toBe('omit')
    expect(options.redirect).toBe('error')
    expect(options.headers['x-room-token']).toBe(hostToken)
  })
})
