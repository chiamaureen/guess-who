import { readSupabaseConfig } from './supabase-config'
import type { LobbyState } from '../types/game'

export class RoomApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status }
}

const messages: Record<string, string> = {
  INVALID_INPUT: '輸入格式不正確。', INVALID_CATEGORIES: '分類已停用或不存在，請重新選擇。', UNAUTHORIZED: '身分憑證已失效，請重新加入或明確撤銷舊主持人身分。',
  FORBIDDEN: '你沒有這個房間的操作權限。', ROOM_NOT_FOUND: '找不到這個房間，請確認代碼。', ROOM_EXPIRED: '房間已過期，請重新建立房間。', ROOM_CLOSED: '房間已關閉，無法加入。',
  ROOM_IN_PROGRESS: '房間正在遊戲中，本階段不支援此操作。', ROOM_LIMIT: '請先關閉舊房間，同一主持人最多保留五間未過期房間。', ROOM_FULL: '房間已滿，請聯絡主持人。',
  RATE_LIMITED: '操作太頻繁，請稍候再試。', ACTIVE_ROOMS: '請先關閉所有進行中或等待中的房間，再撤銷身分。', IDEMPOTENCY_CONFLICT: '上次請求尚待確認，請使用原本資料重試。',
}

export async function invokeRoomApi(action: string, input: Record<string, unknown>, credentials: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const config = readSupabaseConfig(import.meta.env)
  let response: Response
  try {
    response = await fetch(`${config.url}/functions/v1/room-system/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.publishableKey, ...credentials }, body: JSON.stringify(input), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) })
  } catch { throw new RoomApiError('NETWORK', 0, '房間服務尚未部署、連線失敗或逾時；請保留本頁，稍後重試同一筆操作。') }
  let body: { data?: Record<string, unknown>; error?: { code?: string } }
  try { body = await response.json() } catch { throw new RoomApiError('INVALID_RESPONSE', response.status, '房間服務回應無法識別，請稍後重試。') }
  if (!response.ok || !body.data || typeof body.data !== 'object') {
    const code = body.error?.code ?? 'SERVICE_UNAVAILABLE'
    throw new RoomApiError(code, response.status, messages[code] ?? '房間服務尚未部署或暫時無法使用，請稍後重試。')
  }
  return body.data
}

export function parseLobby(value: unknown): LobbyState {
  if (!value || typeof value !== 'object') throw new Error('房間資料格式錯誤。')
  const data = value as LobbyState
  if (!data.room || typeof data.room.id !== 'string' || !/^[A-Z0-9]{6}$/.test(data.room.code) || !['waiting', 'playing', 'finished'].includes(data.room.status) || data.room.totalQuestions !== 15 || !Number.isInteger(data.room.currentQuestion) || data.room.currentQuestion < 0 || data.room.currentQuestion > 15 || !Number.isFinite(Date.parse(data.room.expiresAt)) || !data.viewer || !['host', 'player'].includes(data.viewer.role) || typeof data.viewer.id !== 'string' || !Array.isArray(data.categories) || !Array.isArray(data.players) || !data.categories.every(category => typeof category.id === 'string' && typeof category.name === 'string' && typeof category.slug === 'string') || !data.players.every(player => typeof player.id === 'string' && typeof player.nickname === 'string' && typeof player.joinedAt === 'string')) throw new Error('房間資料格式錯誤，請重新整理。')
  return { room: { id: data.room.id, code: data.room.code, status: data.room.status, currentQuestion: data.room.currentQuestion, totalQuestions: 15, expiresAt: data.room.expiresAt }, categories: data.categories.map(category => ({ id: category.id, name: category.name, slug: category.slug })), players: data.players.map(player => ({ id: player.id, nickname: player.nickname, joinedAt: player.joinedAt })), viewer: { id: data.viewer.id, role: data.viewer.role } }
}

export function invitationUrl(code: string, baseUrl: string, origin: string) {
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('房間代碼格式錯誤。')
  const url = new URL(baseUrl, origin)
  url.hash = `/room/${code}`
  return url.href
}
