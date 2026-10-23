const encoder = new TextEncoder()

export function nonce() {
  return encode(crypto.getRandomValues(new Uint8Array(32)))
}

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function validNonce(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false
  try {
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), character => character.charCodeAt(0))
    return bytes.length === 32 && encode(bytes) === value
  } catch {
    return false
  }
}

export async function hashToken(purpose: string, token: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`guess-who:${purpose}:v1:${token}`)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function deriveToken(secret: string, purpose: string, input: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`guess-who:${purpose}:v1:${input}`))))
}

export function validToken(value: unknown, kind: 'host' | 'room' | 'player'): value is string {
  return typeof value === 'string' && value.startsWith(`gw_${kind}_`) && validNonce(value.slice(`gw_${kind}_`.length))
}
