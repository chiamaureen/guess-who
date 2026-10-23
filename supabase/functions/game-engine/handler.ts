import { deriveToken, hashToken, validToken } from '../room-system/crypto.ts'
import { readBody, RoomError } from '../room-system/handler.ts'
import type { Backend, HandlerConfig, RateLimitRequest } from '../room-system/handler.ts'

type Payload = Record<string, unknown>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const actions = ['start-game', 'get-game-state', 'get-question-image', 'reveal-answer', 'next-question', 'finish-game', 'reset-question-history']
const errors: Record<string, [number, string]> = {
  INVALID_INPUT: [400, '輸入格式不正確。'], UNAUTHORIZED: [401, '身分憑證無效，請重新驗證。'], FORBIDDEN: [403, '你沒有操作權限。'],
  ROOM_NOT_FOUND: [404, '找不到房間。'], ROOM_EXPIRED: [410, '房間已過期。'], INVALID_CATEGORIES: [400, '請至少選擇一個啟用分類。'],
  INSUFFICIENT_QUESTIONS: [409, '可用人物不足 15 位，請增加分類或在結束遊戲後手動重置歷史。'],
  ANSWER_NOT_REVEALED: [409, '請先揭曉答案。'], LAST_QUESTION: [409, '已到第 15 題，請結束遊戲。'],
  INVALID_STATE: [409, '目前遊戲狀態不允許此操作。'], STALE_STATE: [409, '遊戲狀態已更新，請重新取得狀態後操作。'],
  CONFIRM_REQUIRED: [400, '請明確確認重置自己的歷史。'], GAME_ACTIVE: [409, '請先結束進行中的遊戲，才能重置歷史。'],
  RATE_LIMITED: [429, '操作太頻繁，請稍後再試。'], INTERNAL_ERROR: [500, '遊戲服務暫時無法處理。'],
}

function ensure(condition: unknown): asserts condition { if (!condition) throw new RoomError('INVALID_INPUT') }

function safeState(data: Payload, host: boolean) {
  const room = data.room as Payload
  const question = data.question as Payload | null
  const viewer = data.viewer as Payload
  ensure(room && viewer && ['waiting', 'playing', 'finished'].includes(String(room.status)) && room.totalQuestions === 15)
  ensure(viewer.role === (host ? 'host' : 'player') && (question === null || question && typeof question.revealed === 'boolean'))
  return {
    room: { id: room.id, code: room.code, status: room.status, currentQuestion: room.currentQuestion, totalQuestions: 15, expiresAt: room.expiresAt },
    viewer: { role: viewer.role, id: viewer.id },
    question: question ? {
      id: question.id, number: question.number, revealed: question.revealed,
      ...(host || question.revealed === true ? { answer: question.answer, attribution: question.attribution ? {
        author: (question.attribution as Payload).author, license: (question.attribution as Payload).license,
        text: (question.attribution as Payload).text, source: (question.attribution as Payload).source,
      } : undefined } : {}),
    } : null,
    ...(host ? { historyRevision: data.historyRevision } : {}),
  }
}

export function createGameHandler(config: HandlerConfig, backend: Backend) {
  if (!/^[0-9a-fA-F]{64}$/.test(config.signingKey) || /^(.)\1+$/.test(config.signingKey) || !config.publishableKeys.length || !config.origins.length || config.origins.some(origin => { const url = new URL(origin); return url.origin !== origin || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) })) throw new RoomError('SERVICE_UNAVAILABLE')
  return async (request: Request, connection?: { sourceAddress?: string }) => {
    const origin = request.headers.get('origin') ?? ''
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' })
    if (!config.origins.includes(origin)) return new Response('{"error":{"code":"FORBIDDEN"}}', { status: 403, headers })
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Headers', 'content-type, apikey, x-host-credential, x-room-token, x-player-session')
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set('Access-Control-Expose-Headers', 'Retry-After')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return new Response('{"error":{"code":"METHOD_NOT_ALLOWED"}}', { status: 405, headers })
    try {
      const action = new URL(request.url).pathname.split('/').filter(Boolean).at(-1) ?? ''
      ensure(actions.includes(action))
      let input: Payload = {}
      let bodyError: unknown
      try { input = await readBody(request) } catch (cause) { bodyError = cause }
      const host = request.headers.get('x-host-credential')
      const player = request.headers.get('x-player-session')
      const token = request.headers.get('x-room-token')
      const address = connection?.sourceAddress?.trim()
      const source = address && address.length <= 128 ? address : 'unavailable'
      const digest = await hashToken('rate-source', await deriveToken(config.signingKey, 'rate-source', source))
      const rateRequest: RateLimitRequest = { action: ['get-game-state', 'get-question-image'].includes(action) ? 'get-room-state' : 'close-room', bootstrap: false, source_bucket: Number.parseInt(digest.slice(0, 2), 16) }
      if (validToken(host, 'host')) rateRequest.host_hash = await hashToken('host', host)
      else if (validToken(player, 'player')) rateRequest.player_hash = await hashToken('player', player)
      if (typeof input.roomCode === 'string' && /^[a-zA-Z0-9]{6}$/.test(input.roomCode.trim())) rateRequest.room_code = input.roomCode.trim().toUpperCase()
      const rate = await backend.rateLimit(rateRequest)
      if (!rate.allowed) { headers.set('Retry-After', String(rate.retryAfter)); throw new RoomError('RATE_LIMITED') }
      if (!config.publishableKeys.includes(request.headers.get('apikey') ?? '')) throw new RoomError('UNAUTHORIZED')
      if (bodyError) throw bodyError
      if (host && !validToken(host, 'host') || player && !validToken(player, 'player') || token && !validToken(token, 'room') || !rate.authenticated) throw new RoomError('UNAUTHORIZED')
      ensure(!(host && player) && !(player && token))
      const readOnly = ['get-game-state', 'get-question-image'].includes(action)
      if (action === 'reset-question-history' ? !host || !!token : !((host && token) || readOnly && player)) throw new RoomError('FORBIDDEN')
      const allowed = action === 'reset-question-history' ? ['confirm', 'historyRevision'] : ['roomCode', ...(['get-question-image', 'reveal-answer', 'next-question', 'finish-game'].includes(action) ? ['questionId'] : [])]
      ensure(Object.keys(input).every(key => allowed.includes(key)))
      if (allowed.includes('questionId')) ensure(typeof input.questionId === 'string' && uuid.test(input.questionId))
      if (action === 'reset-question-history') ensure(input.confirm === true && typeof input.historyRevision === 'string' && /^[0-9a-f]{32}$/.test(input.historyRevision))
      else ensure(typeof input.roomCode === 'string' && /^[a-zA-Z0-9]{6}$/.test(input.roomCode.trim()))
      const result = await backend.action(action, {
        ...(host ? { host_hash: await hashToken('host', host) } : { player_hash: await hashToken('player', player!) }),
        ...(token ? { room_token_hash: await hashToken('room', token) } : {}),
        ...(action === 'reset-question-history' ? { confirm: true, history_revision: input.historyRevision } : { room_code: (input.roomCode as string).trim().toUpperCase() }),
        ...(allowed.includes('questionId') ? { question_id: input.questionId } : {}),
      })
      if (action === 'get-question-image') {
        ensure(typeof result?.png === 'string' && result.png.length <= 710000)
        const bytes = Uint8Array.from(atob(result.png.replace(/\s/g, '')), character => character.charCodeAt(0))
        headers.set('Content-Type', 'image/png')
        headers.set('Content-Disposition', 'inline; filename="photo.png"')
        return new Response(bytes, { status: 200, headers })
      }
      return new Response(JSON.stringify({ data: action === 'reset-question-history' ? { reset: result.reset === true } : safeState(result, !!host) }), { status: 200, headers })
    } catch (cause) {
      const code = cause instanceof RoomError && cause.code in errors ? cause.code : 'INTERNAL_ERROR'
      const [status, message] = errors[code]
      return new Response(JSON.stringify({ error: { code, message } }), { status, headers })
    }
  }
}
