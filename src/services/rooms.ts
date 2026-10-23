import { invokeRoomApi, parseLobby, RoomApiError } from '../lib/room-api'
import { browserSessionLock, browserStorage, randomRequestKey, sessionStore } from '../lib/room-storage'
import type { StoragePort } from '../lib/room-storage'
import { validateJoinRoom } from '../lib/validation'
import type { Category, JoinRoomInput, LobbyState, RoomSession } from '../types/game'
import { invokeGameApi, loadGameImage, parseGameState } from '../lib/game-api'
import type { GameAction } from '../types/game-engine'

type Api = typeof invokeRoomApi
type Lock = <Result>(operation: () => Promise<Result>) => Promise<Result>
type HostIdentity = { hostId: string; credential: string }
type PendingCreation = { requestKey: string; categoryIds: string[] }

export function createRoomService(options: { storage?: () => StoragePort; lock?: Lock; api?: Api; gameApi?: typeof invokeGameApi; imageApi?: typeof loadGameImage } = {}) {
  const store = sessionStore(options.storage ?? browserStorage)
  const locked = options.lock ?? browserSessionLock
  const api = options.api ?? invokeRoomApi
  const gameApi = options.gameApi ?? invokeGameApi
  let creation: Promise<LobbyState> | undefined
  const gameReads = new Map<string, Promise<ReturnType<typeof parseGameState>>>()
  const hostIdentity = (): HostIdentity | undefined => {
    const value = store.read('host') as HostIdentity | undefined
    if (value === undefined) return undefined
    if (!value || typeof value.hostId !== 'string' || typeof value.credential !== 'string' || !/^gw_host_[A-Za-z0-9_-]{43}$/.test(value.credential)) throw new Error('主持人身分資料已損壞，請先確認本機儲存，勿直接重建身分。')
    return value
  }
  const pendingCreation = (): PendingCreation | undefined => {
    const value = store.read('create') as PendingCreation | undefined
    if (value !== undefined && (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.requestKey) || !Array.isArray(value.categoryIds) || !value.categoryIds.every(id => typeof id === 'string'))) throw new Error('建立房間的重試資料已損壞，請檢查本機儲存。')
    return value
  }
  const credentials = (session: RoomSession): Record<string, string> => {
    if (session.role === 'player') return { 'x-player-session': session.token }
    const host = hostIdentity()
    if (!host) throw new RoomApiError('UNAUTHORIZED', 401, '此裝置的主持人身分已遺失，無法恢復控制權。')
    return { 'x-host-credential': host.credential, 'x-room-token': session.token }
  }
  const loadState = async (code: string) => {
    const session = store.getSession(code)
    if (!session) throw new RoomApiError('UNAUTHORIZED', 401, '尚未加入這個房間。')
    return parseLobby(await api('get-room-state', { roomCode: code }, credentials(session)))
  }
  const gameCredentials = (code: string, hostOnly = false) => {
    const session = store.getSession(code)
    if (!session || hostOnly && session.role !== 'host') throw new RoomApiError('FORBIDDEN', 403, '只有主持人可以控制遊戲。')
    return credentials(session)
  }
  const ensureHost = async () => {
    const existing = hostIdentity()
    if (existing) return existing
    let bootstrapKey = store.read('host-bootstrap')
    if (bootstrapKey === undefined) { bootstrapKey = randomRequestKey(); store.write('host-bootstrap', bootstrapKey) }
    if (typeof bootstrapKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(bootstrapKey)) throw new Error('主持人建立請求資料已損壞。')
    const result = await api('host-session', { mode: 'bootstrap', bootstrapKey })
    if (typeof result.hostId !== 'string' || typeof result.credential !== 'string' || !/^gw_host_[A-Za-z0-9_-]{43}$/.test(result.credential)) throw new Error('主持人身分回應不正確。')
    const identity = { hostId: result.hostId, credential: result.credential }
    store.write('host', identity)
    store.remove('host-bootstrap')
    return identity
  }
  return {
    pendingCreation,
    savedCodes: () => store.codes(),
    hasSession: (code: string) => !!store.getSession(code),
    getState: loadState,
    async getGameState(code: string) {
      const pending = gameReads.get(code)
      if (pending) return pending
      const request = gameApi('get-game-state', { roomCode: code }, gameCredentials(code)).then(parseGameState).finally(() => { gameReads.delete(code) })
      gameReads.set(code, request)
      return request
    },
    controlGame(code: string, action: GameAction, questionId?: string) {
      return locked(async () => parseGameState(await gameApi(action, { roomCode: code, ...(questionId ? { questionId } : {}) }, gameCredentials(code, true))))
    },
    getGameImage(code: string, questionId: string) {
      return (options.imageApi ?? loadGameImage)(code, questionId, gameCredentials(code))
    },
    resetHistory(code: string, historyRevision: string, confirm: boolean) {
      return locked(async () => {
        if (!confirm) throw new Error('請明確確認重置歷史。')
        const headers = gameCredentials(code, true)
        await gameApi('reset-question-history', { confirm: true, historyRevision }, { 'x-host-credential': headers['x-host-credential'] })
      })
    },
    async categories(): Promise<Category[]> {
      const { getSupabaseClient } = await import('../lib/supabase')
      const { data, error } = await getSupabaseClient().from('categories').select('id,name,slug').eq('is_active', true).order('slug')
      if (error || !data) throw new Error('無法讀取分類，請確認 Supabase 設定或稍後重試。')
      return data
    },
    create(categoryIds: string[]) {
      if (creation) return creation
      creation = locked(async () => {
        if (!categoryIds.length && !pendingCreation()) throw new Error('請至少選擇一個人物分類。')
        const host = await ensureHost()
        const pending = pendingCreation() ?? { requestKey: randomRequestKey(), categoryIds: [...categoryIds].sort() }
        store.write('create', pending)
        try {
          const result = await api('create-room', { categoryIds: pending.categoryIds, requestKey: pending.requestKey }, { 'x-host-credential': host.credential })
          const state = parseLobby(result)
          if (state.viewer.role !== 'host' || state.viewer.id !== host.hostId || typeof result.hostToken !== 'string' || !/^gw_room_[A-Za-z0-9_-]{43}$/.test(result.hostToken)) throw new Error('主持人控制權回應不正確。')
          store.saveSession(state.room.code, { role: 'host', token: result.hostToken })
          store.remove('create')
          return state
        } catch (error) {
          if (error instanceof RoomApiError && ['INVALID_CATEGORIES', 'ROOM_LIMIT'].includes(error.code)) store.remove('create')
          throw error
        }
      }).finally(() => { creation = undefined })
      return creation
    },
    join(input: JoinRoomInput) {
      return locked(async () => {
        const normalized = { roomCode: input.roomCode.trim().toUpperCase(), nickname: input.nickname.trim().normalize('NFC') }
        const error = validateJoinRoom(normalized)
        if (error) throw new Error(error)
        if (store.getSession(normalized.roomCode)) {
          try { return await loadState(normalized.roomCode) }
          catch (cause) { if (cause instanceof RoomApiError && cause.status === 401) store.clearSession(normalized.roomCode); throw cause }
        }
        const pendingKey = `join:${normalized.roomCode}`
        const existing = store.read(pendingKey) as { joinKey: string; nickname: string } | undefined
        const pending = existing ?? { joinKey: randomRequestKey(), nickname: normalized.nickname }
        if (!pending || !/^[A-Za-z0-9_-]{43}$/.test(pending.joinKey) || typeof pending.nickname !== 'string') throw new Error('加入房間的重試資料已損壞。')
        store.write(pendingKey, pending)
        try {
          const result = await api('join-room', { roomCode: normalized.roomCode, nickname: pending.nickname, joinKey: pending.joinKey })
          const state = parseLobby(result)
          if (state.viewer.role !== 'player' || typeof result.playerSession !== 'string' || !/^gw_player_[A-Za-z0-9_-]{43}$/.test(result.playerSession)) throw new Error('玩家 Session 回應不正確。')
          store.saveSession(state.room.code, { role: 'player', token: result.playerSession })
          store.remove(pendingKey)
          return state
        } catch (cause) {
          if (cause instanceof RoomApiError && cause.code !== 'IDEMPOTENCY_CONFLICT' && [400, 404, 409, 410].includes(cause.status)) store.remove(pendingKey)
          throw cause
        }
      })
    },
    close(code: string) {
      return locked(async () => {
        const session = store.getSession(code)
        if (!session || session.role !== 'host') throw new RoomApiError('FORBIDDEN', 403, '只有主持人可以關閉房間。')
        return parseLobby(await api('close-room', { roomCode: code }, credentials(session)))
      })
    },
    leave(code: string) {
      return locked(async () => {
        const session = store.getSession(code)
        if (!session || session.role !== 'player') throw new Error('沒有可離開的玩家 Session。')
        try { await api('leave-room', { roomCode: code }, credentials(session)) }
        catch (cause) { if (!(cause instanceof RoomApiError) || ![401, 410].includes(cause.status)) throw cause }
        store.clearSession(code)
      })
    },
    revokeHost() {
      return locked(async () => {
        const host = hostIdentity()
        if (host) {
          try { await api('host-session', { mode: 'revoke', confirm: true }, { 'x-host-credential': host.credential }) }
          catch (cause) { if (!(cause instanceof RoomApiError) || cause.status !== 401) throw cause }
        }
        for (const code of store.codes()) if (store.getSession(code)?.role === 'host') store.clearSession(code)
        store.remove('host'); store.remove('host-bootstrap'); store.remove('create')
      })
    },
    forgetRoom(code: string) { return locked(async () => { store.clearSession(code) }) },
  }
}

export const roomService = createRoomService()
