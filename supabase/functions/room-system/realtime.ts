type Grant = Record<string, unknown>
const encoder = new TextEncoder()
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const json = (value: unknown) => encode(encoder.encode(JSON.stringify(value)))

export async function signRealtimeTicket(rawKey: string, issuer: string, grant: Grant, now = Date.now()) {
  const key: JsonWebKey = JSON.parse(rawKey)
  if (key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256' || typeof (key as JsonWebKey & { kid?: string }).kid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test((key as JsonWebKey & { kid: string }).kid) || ![key.d, key.x, key.y].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value))) throw new Error('INVALID_REALTIME_KEY')
  const expiry = Math.floor(Date.parse(String(grant.expiresAt)) / 1000)
  const issued = Math.floor(now / 1000)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!uuid.test(String(grant.grantId)) || !uuid.test(String(grant.roomId)) || !Number.isFinite(expiry) || expiry <= issued || expiry > issued + 300 || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/auth\/v1$/.test(issuer)) throw new Error('INVALID_REALTIME_GRANT')
  const header = json({ alg: 'ES256', typ: 'JWT', kid: (key as JsonWebKey & { kid: string }).kid })
  const body = json({ iss: issuer, aud: 'authenticated', role: 'anon', sub: grant.grantId, rt_room: grant.roomId, iat: issued, exp: expiry })
  const signingKey = await crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(`${header}.${body}`))
  return { topic: `gw-room:${grant.roomId}`, accessToken: `${header}.${body}.${encode(new Uint8Array(signature))}`, expiresAt: new Date(expiry * 1000).toISOString() }
}
