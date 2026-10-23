import { readFile, readdir } from 'node:fs/promises'
import { createGameFixture, seedGameFixtures } from './game-fixture.mjs'
import { createRoomHandler, RoomError } from '../functions/room-system/handler.ts'

export const realtimeDraft = new URL('../migration-drafts/20261023180000_room_realtime.sql', import.meta.url)

export async function createRealtimeFixture(origin = 'http://localhost:5173', people = 30) {
  const fixture = await createGameFixture(origin)
  const database = fixture.database
  if (!(await readdir(new URL('../migrations/', import.meta.url))).includes('20261023180000_room_realtime.sql')) await database.exec(await readFile(realtimeDraft, 'utf8'))
  await seedGameFixtures(database, people)
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const privateJwk = { ...await crypto.subtle.exportKey('jwk', pair.privateKey), kid: 'local-realtime-fixture', alg: 'ES256' }
  const config = { ...fixture.config, projectUrl: 'https://abcdefghijklmnopqrst.supabase.co', realtimeSigningJwk: JSON.stringify(privateJwk) }
  const grant = input => database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE service_role')
    try { return (await transaction.query('SELECT public.room_realtime_grant($1::jsonb) AS data', [JSON.stringify(input)])).rows[0].data }
    catch (error) { throw new RoomError(error.code === 'P0001' ? error.message : 'INTERNAL_ERROR') }
  })
  const roomHandler = createRoomHandler(config, { rateLimit: input => fixture.rpc('rate', '', input), action: (action, input) => fixture.rpc('room', action, input), realtimeGrant: grant })
  const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  const verify = async token => {
    try {
      const parts = token.split('.')
      const header = JSON.parse(Buffer.from(parts[0], 'base64url'))
      const body = claims(token)
      return parts.length === 3 && header.alg === 'ES256' && header.kid === privateJwk.kid && body.iss === `${config.projectUrl}/auth/v1` && body.role === 'anon' && body.aud === 'authenticated' && body.exp > Date.now() / 1000 && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(parts.slice(0, 2).join('.')))
    } catch { return false }
  }
  const allowed = (topic, body) => database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE anon')
    await transaction.query("SELECT set_config('request.jwt.claims',$1,true),set_config('realtime.topic',$2,true)", [JSON.stringify(body), topic])
    return (await transaction.query('SELECT public.room_realtime_can_receive($1) AS allowed', [topic])).rows[0].allowed
  })
  return { ...fixture, config, roomHandler, grant, privateJwk, claims, verify, allowed }
}
