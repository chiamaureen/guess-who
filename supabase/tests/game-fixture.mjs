import { readFile, readdir } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { PGlite } from '@electric-sql/pglite'
import { createRoomHandler, RoomError } from '../functions/room-system/handler.ts'
import { createGameHandler } from '../functions/game-engine/handler.ts'

export const gameMigration = new URL('../migrations/20261023120000_game_engine.sql', import.meta.url)
export const actor = '10000000-0000-4000-8000-000000000001'
export const singer = '10000000-0000-4000-8000-000000000002'

export function pngChunk(kind, bytes) {
    const body = Buffer.concat([Buffer.from(kind), bytes])
    let checksum = 0xffffffff
    for (const byte of body) {
      checksum ^= byte
      for (let bit = 0; bit < 8; bit++) checksum = checksum >>> 1 ^ (checksum & 1 ? 0xedb88320 : 0)
    }
    const length = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0)
    return Buffer.concat([length, body, crc])
}

export function fixturePng() {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2
  const rows = []
  for (let row = 0; row < 32; row++) {
    const pixels = Buffer.alloc(97)
    for (let column = 0; column < 32; column++) {
      const face = (column - 16) ** 2 + (row - 16) ** 2 < 160
      pixels.set(face ? [240, 205, 130] : [215, 240, 85], 1 + column * 3)
    }
    rows.push(pixels)
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0))])
}

export async function seedGameFixtures(database, count = 30, image = fixturePng()) {
  for (let index = 1; index <= count; index++) {
    const id = `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    await database.query(`INSERT INTO public.celebrities(id,name_zh,name_en,subject_type,image_url,image_source,image_author,image_license,image_attribution,is_approved)
      VALUES($1,$2,$3,'fictional_character','https://fixture.invalid/SECRET-NAME.png','https://fixture.invalid/SECRET-NAME','Original test code','CC0-1.0','LOCAL synthetic fixture only',true) ON CONFLICT DO NOTHING`, [id, `隔離測試人物 ${index}`, `PRIVATE ANSWER ${index}`])
    await database.query('INSERT INTO public.celebrity_categories(celebrity_id,category_id) VALUES($1,$2),($1,$3) ON CONFLICT DO NOTHING', [id, actor, singer])
    await database.query('INSERT INTO public.game_image_assets(celebrity_id,png,is_approved) VALUES($1,$2,true)', [id, image])
  }
}

export async function createGameFixture(origin = 'http://localhost:5173') {
  const database = new PGlite()
  await database.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;')
  await database.exec(await readFile(new URL('./realtime-platform.sql', import.meta.url), 'utf8'))
  const directory = new URL('../migrations/', import.meta.url)
  for (const filename of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) await database.exec(await readFile(new URL(filename, directory), 'utf8'))
  await database.exec(await readFile(new URL('../seed.sql', import.meta.url), 'utf8'))
  const rpc = async (kind, action, input) => database.transaction(async transaction => {
    await transaction.exec('SET LOCAL ROLE service_role')
    const sql = kind === 'rate' ? 'SELECT public.room_system_rate_limit($1::jsonb) AS data' : `SELECT public.${kind === 'game' ? 'game_engine_action' : 'room_system_action'}($1,$2::jsonb) AS data`
    try { return (await transaction.query(sql, kind === 'rate' ? [JSON.stringify(input)] : [action, JSON.stringify(input)])).rows[0].data }
    catch (error) { throw new RoomError(error.code === 'P0001' ? error.message : 'INTERNAL_ERROR') }
  })
  const signingKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
  const config = { origins: [origin], publishableKeys: ['sb_publishable_fixture'], signingKey }
  const rateLimit = input => rpc('rate', '', input)
  const roomHandler = createRoomHandler(config, { rateLimit, action: (action, input) => rpc('room', action, input) })
  const gameHandler = createGameHandler(config, { rateLimit, action: (action, input) => rpc('game', action, input) })
  return { database, rpc, roomHandler, gameHandler, config, close: () => database.close() }
}
