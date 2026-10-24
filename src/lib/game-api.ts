import { readApiResponse, requestRoomApi } from './room-api'
import type { GameState } from '../types/game-engine'

export function parseGameState(value: unknown): GameState {
  if (!value || typeof value !== 'object') throw new Error('遊戲資料格式錯誤。')
  const data = value as GameState
  const room = data.room
  const viewer = data.viewer
  const question = data.question
  if (!room || !viewer || !['host', 'player'].includes(viewer.role) || typeof viewer.id !== 'string' || !/^[A-Z0-9]{6}$/.test(room.code) || !['waiting', 'playing', 'finished'].includes(room.status) || room.totalQuestions !== 15 || !Number.isInteger(room.currentQuestion) || room.currentQuestion < 0 || room.currentQuestion > 15 || !Number.isFinite(Date.parse(room.expiresAt))) throw new Error('遊戲狀態格式錯誤。')
  if (question !== null && (!question || typeof question.id !== 'string' || !Number.isInteger(question.number) || question.number !== room.currentQuestion || typeof question.revealed !== 'boolean')) throw new Error('題目資料格式錯誤。')
  if ((room.currentQuestion === 0) !== (question === null)) throw new Error('題號與狀態不一致。')
  const canReadAnswer = viewer.role === 'host' || question?.revealed === true
  if (question && canReadAnswer && typeof question.answer !== 'string') throw new Error('答案資料格式錯誤。')
  if (viewer.role === 'host' && (typeof data.historyRevision !== 'string' || !/^[0-9a-f]{32}$/.test(data.historyRevision))) throw new Error('歷史資料格式錯誤。')
  return {
    room: { id: room.id, code: room.code, status: room.status, currentQuestion: room.currentQuestion, totalQuestions: 15, expiresAt: room.expiresAt },
    viewer: { id: viewer.id, role: viewer.role },
    question: question ? { id: question.id, number: question.number, revealed: question.revealed, ...(canReadAnswer ? { answer: question.answer, attribution: question.attribution } : {}) } : null,
    ...(viewer.role === 'host' ? { historyRevision: data.historyRevision } : {}),
  }
}

export async function invokeGameApi(action: string, input: Record<string, unknown>, credentials: Record<string, string>): Promise<Record<string, unknown>> {
  return readApiResponse(await requestRoomApi(action, input, credentials, 'game-engine'))
}

export async function loadGameImage(code: string, questionId: string, credentials: Record<string, string>): Promise<Blob> {
  const response = await requestRoomApi('get-question-image', { roomCode: code, questionId }, credentials, 'game-engine')
  if (!response.ok) await readApiResponse(response)
  const mime = response.headers.get('content-type')
  if (!mime || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('圖片格式錯誤。')
  const image = await response.blob()
  if (!image.size || image.size > (mime === 'image/webp' ? 307200 : 524288)) throw new Error('圖片大小無效。')
  return image
}
