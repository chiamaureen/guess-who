import type { RoomSession } from '../types/game'

export interface StoragePort {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function browserStorage(): StoragePort {
  if (typeof window === 'undefined') throw new Error('請在瀏覽器操作房間。')
  try {
    window.localStorage.setItem('guess-who:storage-check', '1')
    window.localStorage.removeItem('guess-who:storage-check')
    return window.localStorage
  } catch { throw new Error('無法安全保存房間身分，請允許此網站的本機儲存後再試。') }
}

export function randomRequestKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function sessionStore(storage: () => StoragePort) {
  const prefix = 'guess-who:v1:'
  const read = (key: string): unknown => {
    try { const value = storage().getItem(prefix + key); return value ? JSON.parse(value) : undefined }
    catch { throw new Error('無法讀取已保存的房間身分。請先確認儲存權限，不要直接建立新身分。') }
  }
  const write = (key: string, value: unknown) => {
    try { storage().setItem(prefix + key, JSON.stringify(value)) }
    catch { throw new Error('身分尚未成功保存，請保留此頁並重試，不要清除瀏覽器資料。') }
  }
  const remove = (key: string) => storage().removeItem(prefix + key)
  const getSession = (code: string): RoomSession | undefined => {
    const value = read(`room:${code}`)
    if (value === undefined) return undefined
    if (!value || typeof value !== 'object' || !('role' in value) || !('token' in value) || !['host', 'player'].includes(String(value.role)) || typeof value.token !== 'string' || !new RegExp(`^gw_${value.role === 'host' ? 'room' : 'player'}_[A-Za-z0-9_-]{43}$`).test(value.token)) throw new Error('房間憑證資料已損壞，請先清除此房間的本機 Session。')
    return value as RoomSession
  }
  const codes = () => {
    const value = read('rooms')
    if (value === undefined) return [] as string[]
    if (!Array.isArray(value) || !value.every(code => typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code))) throw new Error('房間索引已損壞，請檢查本機儲存。')
    return value as string[]
  }
  return {
    read, write, remove, getSession, codes,
    saveSession(code: string, session: RoomSession) { write(`room:${code}`, session); write('rooms', [...new Set([...codes(), code])]) },
    clearSession(code: string) { remove(`room:${code}`); remove(`join:${code}`); write('rooms', codes().filter(existing => existing !== code)) },
  }
}

export async function browserSessionLock<Result>(operation: () => Promise<Result>): Promise<Result> {
  if (typeof navigator === 'undefined' || !navigator.locks) throw new Error('此瀏覽器不支援安全的跨分頁身分鎖，請使用新版瀏覽器。')
  return navigator.locks.request('guess-who:session-store', operation)
}
