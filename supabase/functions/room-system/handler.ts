import { deriveToken, hashToken, nonce, validNonce, validToken } from './crypto.ts'

type Payload = Record<string, unknown>
export interface RateLimitRequest {
  action: string
  bootstrap: boolean
  source_bucket: number
  host_hash?: string
  player_hash?: string
  room_code?: string
}
export interface Backend {
  rateLimit(request: RateLimitRequest): Promise<{ allowed: boolean; authenticated: boolean; retryAfter: number }>
  action(action: string, input: Payload): Promise<Payload>
}
export interface HandlerConfig {
  origins: string[]
  publishableKeys: string[]
  signingKey: string
}

const errors: Record<string, [number, string]> = {
  INVALID_INPUT: [400, '輸入格式不正確。'], INVALID_CATEGORIES: [400, '請選擇有效且啟用的分類。'],
  UNAUTHORIZED: [401, '身分憑證無效或已撤銷，請重新加入。'], FORBIDDEN: [403, '你沒有這個房間的操作權限。'],
  ROOM_NOT_FOUND: [404, '找不到這個房間，請確認代碼。'], ROOM_EXPIRED: [410, '房間已過期，請重新建立房間。'], ROOM_CLOSED: [410, '房間已關閉，無法加入。'],
  ROOM_IN_PROGRESS: [409, '房間正在遊戲中，本階段不支援此操作。'], IDEMPOTENCY_CONFLICT: [409, '重試資料與原請求不同，請重設建立或加入操作。'],
  ROOM_LIMIT: [409, '同一主持人最多保留五個未過期房間，請先關閉舊房間。'], ROOM_FULL: [409, '房間已達 100 位玩家上限。'], ACTIVE_ROOMS: [409, '請先關閉所有進行中或等待中的房間，再撤銷身分。'],
  RATE_LIMITED: [429, '操作太頻繁，請稍後再試。'], SERVICE_UNAVAILABLE: [503, '房間服務尚未完成設定，請稍後再試。'], INTERNAL_ERROR: [500, '房間服務暫時無法處理，請稍後重試。'],
}

export class RoomError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

function assertInput(condition: unknown): asserts condition {
  if (!condition) throw new RoomError('INVALID_INPUT')
}

function fields(input: Payload, allowed: string[]) {
  assertInput(Object.keys(input).every(key => allowed.includes(key)))
}

function roomCode(value: unknown) {
  assertInput(typeof value === 'string' && /^[a-zA-Z0-9]{6}$/.test(value.trim()))
  return value.trim().toUpperCase()
}

function nickname(value: unknown) {
  assertInput(typeof value === 'string')
  const normalized = value.trim().normalize('NFC')
  assertInput(Array.from(normalized).length >= 1 && Array.from(normalized).length <= 20 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(normalized))
  return normalized
}

async function readBody(request: Request): Promise<Payload> {
  assertInput(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json')
  const reader = request.body?.getReader()
  assertInput(reader)
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 8192) { await reader.cancel(); throw new RoomError('INVALID_INPUT') }
    chunks.push(value)
  }
  const combined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(combined)) } catch { throw new RoomError('INVALID_INPUT') }
  assertInput(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  return parsed as Payload
}

export function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => alphabet[byte & 31]).join('')
}

function safeLobby(data: Payload) {
  const room = data.room as Payload
  const viewer = data.viewer as Payload
  assertInput(room && viewer && Array.isArray(data.categories) && Array.isArray(data.players))
  return {
    room: { id: room.id, code: room.code, status: room.status, currentQuestion: room.currentQuestion, totalQuestions: room.totalQuestions, expiresAt: room.expiresAt },
    categories: (data.categories as Payload[]).map(category => ({ id: category.id, name: category.name, slug: category.slug })),
    players: (data.players as Payload[]).map(player => ({ id: player.id, nickname: player.nickname, joinedAt: player.joinedAt })),
    viewer: { role: viewer.role, id: viewer.id },
  }
}

export function createRoomHandler(config: HandlerConfig, backend: Backend) {
  if (!/^[0-9a-fA-F]{64}$/.test(config.signingKey) || /^(.)\1+$/.test(config.signingKey) || !config.publishableKeys.length || !config.origins.length || config.origins.some(origin => { const url = new URL(origin); return url.origin !== origin || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) })) throw new RoomError('SERVICE_UNAVAILABLE')
  return async (request: Request, connection?: { sourceAddress?: string }) => {
    const origin = request.headers.get('origin') ?? ''
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' })
    if (!config.origins.includes(origin)) return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: '這個網站來源不被允許。' } }), { status: 403, headers })
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', 'content-type, apikey, x-host-credential, x-room-token, x-player-session')
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Expose-Headers', 'Retry-After')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: '僅支援 POST。' } }), { status: 405, headers })
    try {
      const action = new URL(request.url).pathname.split('/').filter(Boolean).at(-1) ?? ''
      assertInput(['host-session', 'create-room', 'join-room', 'get-room-state', 'leave-room', 'close-room'].includes(action))
      let input: Payload = {}
      let bodyError: unknown
      try { input = await readBody(request) } catch (error) { bodyError = error }
      const host = request.headers.get('x-host-credential')
      const roomToken = request.headers.get('x-room-token')
      const player = request.headers.get('x-player-session')
      const bootstrap = action === 'host-session' && input.mode === 'bootstrap'
      const address = connection?.sourceAddress?.trim()
      const source = address && address.length <= 128 ? address : 'unavailable'
      const sourceHash = await hashToken('rate-source', await deriveToken(config.signingKey, 'rate-source', source))
      const rateRequest: RateLimitRequest = { action, bootstrap, source_bucket: Number.parseInt(sourceHash.slice(0, 2), 16) }
      if (validToken(host, 'host')) rateRequest.host_hash = await hashToken('host', host)
      else if (validToken(player, 'player')) rateRequest.player_hash = await hashToken('player', player)
      if (typeof input.roomCode === 'string' && /^[a-zA-Z0-9]{6}$/.test(input.roomCode.trim())) rateRequest.room_code = input.roomCode.trim().toUpperCase()
      const rate = await backend.rateLimit(rateRequest)
      if (!rate.allowed) { headers.set('Retry-After', String(rate.retryAfter)); throw new RoomError('RATE_LIMITED') }
      if (!config.publishableKeys.includes(request.headers.get('apikey') ?? '')) throw new RoomError('UNAUTHORIZED')
      if (bodyError) throw bodyError
      if (host && !validToken(host, 'host') || roomToken && !validToken(roomToken, 'room') || player && !validToken(player, 'player')) throw new RoomError('UNAUTHORIZED')
      assertInput(!(host && player) && !(player && roomToken))
      if (!rate.authenticated) throw new RoomError('UNAUTHORIZED')
      const credentials: Payload = host ? { host_hash: await hashToken('host', host) } : player ? { player_hash: await hashToken('player', player) } : {}
      if (roomToken) credentials.room_token_hash = await hashToken('room', roomToken)
      let data: Payload
      if (action === 'host-session') {
        fields(input, ['mode', 'bootstrapKey', 'confirm'])
        if (bootstrap) {
          assertInput(!host && !player && !roomToken && validNonce(input.bootstrapKey))
          const credential = `gw_host_${await deriveToken(config.signingKey, 'host', input.bootstrapKey)}`
          const result = await backend.action(action, { mode: 'bootstrap', host_hash: await hashToken('host', credential) })
          data = { hostId: result.hostId, credential }
        } else {
          if (!host || player || roomToken) throw new RoomError('UNAUTHORIZED')
          assertInput(input.mode === 'resume' || input.mode === 'revoke' && input.confirm === true)
          const result = await backend.action(action, { ...credentials, mode: input.mode, revoke_hash: input.mode === 'revoke' ? await hashToken('revoked', nonce()) : undefined })
          data = input.mode === 'revoke' ? { revoked: result.revoked } : { hostId: result.hostId }
        }
      } else if (action === 'create-room') {
        fields(input, ['categoryIds', 'requestKey'])
        if (!host || roomToken || player) throw new RoomError('UNAUTHORIZED')
        assertInput(validNonce(input.requestKey) && Array.isArray(input.categoryIds) && input.categoryIds.length >= 1 && input.categoryIds.length <= 32 && input.categoryIds.every(value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) && new Set(input.categoryIds).size === input.categoryIds.length)
        const controlToken = `gw_room_${await deriveToken(host, 'room', input.requestKey)}`
        let result: Payload | undefined
        for (let attempt = 0; attempt < 8; attempt++) {
          try { result = await backend.action(action, { ...credentials, category_ids: input.categoryIds, room_token_hash: await hashToken('room', controlToken), room_code: randomRoomCode() }); break }
          catch (error) { if (!(error instanceof RoomError) || error.code !== 'ROOM_CODE_COLLISION') throw error }
        }
        if (!result) throw new RoomError('INTERNAL_ERROR')
        data = { ...safeLobby(result), hostToken: controlToken }
      } else if (action === 'join-room') {
        fields(input, ['roomCode', 'nickname', 'joinKey'])
        assertInput(!host && !roomToken && !player && validNonce(input.joinKey))
        const code = roomCode(input.roomCode)
        const session = `gw_player_${await deriveToken(config.signingKey, 'player', `${code}:${input.joinKey}`)}`
        const result = await backend.action(action, { room_code: code, nickname: nickname(input.nickname), player_hash: await hashToken('player', session) })
        data = { ...safeLobby(result), playerSession: session }
      } else {
        fields(input, ['roomCode'])
        if (action === 'close-room' && (!host || !roomToken) || action === 'leave-room' && !player || action === 'get-room-state' && !(host && roomToken || player)) throw new RoomError('UNAUTHORIZED')
        const result = await backend.action(action, { ...credentials, room_code: roomCode(input.roomCode) })
        data = action === 'leave-room' ? { left: result.left } : safeLobby(result)
      }
      return new Response(JSON.stringify({ data }), { status: 200, headers })
    } catch (cause) {
      const code = cause instanceof RoomError && cause.code in errors ? cause.code : 'INTERNAL_ERROR'
      const [status, message] = errors[code]
      return new Response(JSON.stringify({ error: { code, message } }), { status, headers })
    }
  }
}
