import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { normalizeQuestionWebp } from './lib/question-images.mjs'
import { validateRendition, resolveCommonsRenditions } from './lib/commons-images.mjs'
import { identifyLicense } from './lib/question-license.mjs'
import { validateReviewedEntries, prepareQuestionImport } from './prepare-question-import.mjs'
import { prepareAthleteWebp } from './prepare-athlete-webp.mjs'
import { privateImageMime } from '../supabase/functions/game-engine/images.ts'
import { createGameFixture, fixturePng, seedGameFixtures, actor } from '../supabase/tests/game-fixture.mjs'
import { nonce, hashToken } from '../supabase/functions/room-system/crypto.ts'
import { inventoryAthleteImages } from './inventory-athlete-images.mjs'

const draft = new URL('../supabase/migration-drafts/20261024120000_game_image_formats.sql', import.meta.url)
const athlete = '10000000-0000-4000-8000-000000000003'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const imageEntry = () => ({ sourcePage: 'https://commons.wikimedia.org/wiki/File:LOCAL.jpg', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/LOCAL.jpg', sourceSha1: 'a'.repeat(40) })
const page = () => ({ title: 'File:LOCAL.jpg', lastrevid: 123, imageinfo: [{ sha1: 'a'.repeat(40), url: imageEntry().imageUrl, thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/LOCAL.jpg/683px-LOCAL.jpg', width: 5505, height: 8256, size: 17834001, thumbwidth: 683, thumbheight: 1024, timestamp: '2026-10-24T00:00:00Z', extmetadata: { Artist: { value: 'Synthetic author' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0/' } } }] })
const reviewed = (image, count = 69) => Array.from({ length: count }, (_, index) => ({
  wikidataId: `Q${99000000 + index}`, nameZh: `LOCAL TEST ONLY ${index}`, nameEn: '', license: 'CC BY-SA 4.0', restrictions: '',
  source: imageEntry().sourcePage, imageUrl: imageEntry().imageUrl, author: 'LOCAL TEST ONLY', attribution: 'Synthetic credit, not real rights approval',
  categoryIds: [athlete], imagePath: 'image.webp', imageSha256: digest(image), mimeType: 'image/webp', approved: true,
  review: { subject: true, image: true, rights: true, reviewedBy: 'LOCAL SYNTHETIC FIXTURE ONLY', reviewedAt: '2026-10-24T00:00:00Z' },
  rights: { author: 'LOCAL TEST ONLY', source: imageEntry().sourcePage, attribution: 'Synthetic credit, not real rights approval', licenseName: 'CC BY-SA', licenseVersion: '4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', derivativeLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', modifications: 'Metadata stripped; resized; WebP quality 82', originalNotices: 'Synthetic fixture only', evidenceUrl: 'https://commons.wikimedia.org/w/index.php?title=File:LOCAL.jpg&oldid=123', checkedAt: '2026-10-24T00:00:00Z', presentation: 'host-and-after-reveal', presentationReviewed: true },
}))

test('WebP is real quality82 VP8, oriented, proportional, <=1024px, metadata-free, decodable and never enlarged', async () => {
  const original = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#ad9971' } }).withExif({ IFD0: { Artist: 'SECRET ANSWER' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const image = await normalizeQuestionWebp(original)
  assert.equal(privateImageMime(image.webp), 'image/webp')
  const metadata = await sharp(image.webp).metadata()
  assert.equal(metadata.width, 512); assert.equal(metadata.height, 1024)
  assert.equal(image.quality, 82)
  assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined); assert.equal(metadata.xmp, undefined)
  assert.ok(image.webp.length <= 307200)
  assert.ok(!image.webp.includes(Buffer.from('SECRET ANSWER')))
  const small = await normalizeQuestionWebp(fixturePng())
  assert.deepEqual([small.width, small.height], [32, 32])
})

test('oversized Kyrie-sized original still fails closed; verified official rendition works without raising limits', async () => {
  const jpeg = await sharp(fixturePng()).jpeg().toBuffer()
  const frame = jpeg.indexOf(Buffer.from([255, 192]))
  assert.ok(frame > 0)
  jpeg.writeUInt16BE(8256, frame + 5); jpeg.writeUInt16BE(5505, frame + 7)
  await assert.rejects(normalizeQuestionWebp(jpeg), /pixel limit/i)
  const source = validateRendition(imageEntry(), page())
  assert.equal(source.originalWidth * source.originalHeight, 45449280)
  assert.equal(source.originalSha1, imageEntry().sourceSha1)
  const rendition = await sharp({ create: { width: 683, height: 1024, channels: 3, background: '#665544' } }).jpeg().toBuffer()
  assert.equal((await normalizeQuestionWebp(rendition)).height, 1024)
})

test('invalid source, animation, oversize input and metadata-bearing fake WebP are refused', async () => {
  await assert.rejects(normalizeQuestionWebp(Buffer.from('not image')))
  await assert.rejects(normalizeQuestionWebp(Buffer.alloc(32 * 1024 * 1024 + 1)), /SOURCE_TOO_LARGE/)
  const image = (await normalizeQuestionWebp(fixturePng())).webp
  assert.equal(privateImageMime(Buffer.concat([image, Buffer.from('SECRET')])), null)
  const extended = Buffer.from(image); extended.write('VP8X', 12)
  assert.equal(privateImageMime(extended), null)
  const badDimensions = Buffer.from(image); badDimensions.writeUInt16LE(1025, 26)
  assert.equal(privateImageMime(badDimensions), null)
})

test('Commons provenance pins original SHA and file, rejects arbitrary thumbnail hosts and changed revisions', async () => {
  const original = page()
  assert.equal((await resolveCommonsRenditions([{ ...imageEntry(), wikidataId: 'Q1' }], async () => ({ query: { pages: [original] } }))).size, 1)
  const changed = page(); changed.imageinfo[0].sha1 = 'b'.repeat(40)
  assert.throws(() => validateRendition(imageEntry(), changed), /REVISION_CHANGED/)
  const unsafe = page(); unsafe.imageinfo[0].thumburl = 'https://127.0.0.1/SECRET'
  assert.throws(() => validateRendition(imageEntry(), unsafe), /UNSAFE_RENDITION/)
})

test('PD, CC0, BY and BY-SA versions are preserved; NC/ND/Attribution and misleading terms URLs are not approved', () => {
  for (const version of ['2.0', '2.5', '3.0', '4.0']) for (const kind of ['BY', 'BY-SA']) {
    const entry = reviewed(fixturePng(), 15)[0]
    entry.license = `CC ${kind} ${version}`
    Object.assign(entry.rights, { licenseName: `CC ${kind}`, licenseVersion: version, licenseUrl: `https://creativecommons.org/licenses/${kind.toLowerCase()}/${version}/`, derivativeLicenseUrl: `https://creativecommons.org/licenses/${kind.toLowerCase()}/${version}/` })
    assert.equal(validateReviewedEntries(Array.from({ length: 15 }, (_, index) => ({ ...entry, wikidataId: `Q${index + 1}` }))).length, 15)
  }
  assert.ok(identifyLicense('Public domain', ''))
  assert.ok(identifyLicense('CC0', 'https://creativecommons.org/publicdomain/zero/1.0/'))
  for (const name of ['Attribution', 'CC BY-NC 4.0', 'CC BY-ND 4.0', 'unknown']) assert.equal(identifyLicense(name, ''), null)
  assert.equal(identifyLicense('CC BY 4.0', 'https://google.com/search?q=license'), null)
})

test('incomplete author, evidence, ShareAlike, timing review or subject review block the entire import', () => {
  for (const change of [entry => { entry.rights.presentationReviewed = false }, entry => { entry.rights.derivativeLicenseUrl = '' }, entry => { entry.rights.author = '' }, entry => { entry.rights.evidenceUrl = 'https://google.com/search?q=license' }, entry => { entry.approved = false }, entry => { entry.review.subject = false }]) {
    const entries = reviewed(fixturePng(), 15)
    change(entries[0])
    assert.throws(() => validateReviewedEntries(entries))
  }
})

test('all124 receive an inventory status; empty and failed searches never imply approval', async () => {
  const snapshot = { entries: Array.from({ length: 124 }, (_, index) => ({ id: `${index}`, name: `LOCAL ONLY ${index}`, group: 'test', imageUrl: '', sourcePage: '' })) }
  const inventory = await inventoryAthleteImages(snapshot, { groups: [{ id: 'test', language: 'en' }] }, async () => ({ query: { pages: [] } }))
  assert.equal(inventory.entries.length, 124)
  assert.ok(inventory.entries.every(entry => !entry.approved && entry.status === 'MISSING_IMAGE'))
  assert.equal(inventory.cloudWrites, 0)
})

test('WebP staging stops on first decode failure and never approves or generates SQL', async () => {
  const entries = Array.from({ length: 69 }, (_, index) => ({ ...imageEntry(), wikidataId: `Q${index + 1}`, name: `LOCAL ONLY ${index}`, category: 'athletes' }))
  let requests = 0
  const result = await prepareAthleteWebp(entries, join(await mkdtemp('/tmp/gw-webp-stop-'), 'batch'), {
    resolveSources: async () => new Map(entries.map(entry => [entry.wikidataId, validateRendition(entry, page())])),
    download: async () => { requests++; return Buffer.from('broken image') },
  })
  assert.equal(requests, 1); assert.equal(result.failed, 1); assert.equal(result.converted, 0)
  assert.equal(result.cloudWrites, 0); assert.equal(result.status, 'BLOCKED')
})

test('incremental format draft retains old PNG, accepts WebP/JPEG, denies metadata and browser roles, no grant expansion', async () => {
  const fixture = await createGameFixture()
  try {
    await fixture.database.exec(await readFile(draft, 'utf8'))
    await fixture.database.query("INSERT INTO public.celebrities(id,wikidata_id,name_zh,subject_type,image_url,image_source,image_author,image_license,image_attribution,is_approved) VALUES('99999999-0000-4000-8000-000000000001','Q999','OLD POLITICAL FIXTURE','real_person','https://fixture.invalid/old.png','https://fixture.invalid/source','Original synthetic author','CC0','Legacy credit',true)")
    await fixture.database.query("INSERT INTO public.celebrity_categories VALUES('99999999-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004')")
    await fixture.database.query("INSERT INTO public.game_image_assets(celebrity_id,png,is_approved) VALUES('99999999-0000-4000-8000-000000000001',$1,true)", [fixturePng()])
    const images = [fixturePng(), (await normalizeQuestionWebp(fixturePng())).webp, await sharp(fixturePng()).jpeg().toBuffer()]
    for (const image of images) assert.equal((await fixture.database.query('SELECT public.game_engine_image_valid($1::bytea) AS valid', [image])).rows[0].valid, true)
    const exif = await sharp(fixturePng()).withExif({ IFD0: { Artist: 'SECRET' } }).jpeg().toBuffer()
    assert.equal((await fixture.database.query('SELECT public.game_engine_image_valid($1::bytea) AS valid', [exif])).rows[0].valid, false)
    for (const role of ['anon', 'authenticated']) {
      const privileges = (await fixture.database.query(`SELECT has_table_privilege($1,'public.game_image_assets','SELECT') AS read, has_function_privilege($1,'public.game_engine_image_valid(bytea)','EXECUTE') AS execute`, [role])).rows[0]
      assert.deepEqual(privileges, { read: false, execute: false })
    }
    const security = (await fixture.database.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.game_engine_image_valid(bytea)'::regprocedure")).rows[0]
    assert.equal(security.prosecdef, false); assert.deepEqual(security.proconfig, ['search_path=""'])
  } finally { await fixture.close() }
})

test('existing controlled image endpoint still serves real PNG and metadata-free JPEG without exposing source names', async () => {
  for (const [mime, image] of [['image/png', fixturePng()], ['image/jpeg', await sharp(fixturePng()).jpeg().toBuffer()]]) {
    const fixture = await createGameFixture()
    try {
      await fixture.database.exec(await readFile(draft, 'utf8'))
      await seedGameFixtures(fixture.database, 15, image)
      const hostHash = await hashToken('host', `gw_host_${nonce()}`)
      const roomHash = await hashToken('room', `gw_room_${nonce()}`)
      const player = `gw_player_${nonce()}`
      const playerHash = await hashToken('player', player)
      await fixture.rpc('room', 'host-session', { mode: 'bootstrap', host_hash: hostHash })
      const input = { host_hash: hostHash, room_token_hash: roomHash, room_code: 'LEGACY' }
      await fixture.rpc('room', 'create-room', { ...input, category_ids: [actor] })
      await fixture.rpc('room', 'join-room', { room_code: 'LEGACY', player_hash: playerHash, nickname: 'LOCAL ONLY' })
      const state = await fixture.rpc('game', 'start-game', input)
      const response = await fixture.gameHandler(new Request('https://edge.invalid/get-question-image', { method: 'POST', headers: { origin: fixture.config.origins[0], apikey: fixture.config.publishableKeys[0], 'x-player-session': player, 'content-type': 'application/json' }, body: JSON.stringify({ roomCode: 'LEGACY', questionId: state.question.id }) }), { sourceAddress: '127.0.0.1' })
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), mime)
      assert.ok(!JSON.stringify([...response.headers]).includes('SECRET-NAME'))
      assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(image))
    } finally { await fixture.close() }
  }
})

test('69 synthetic reviewed WebPs produce exactly207 transaction rows; actual15-question private flow and C history remain intact', async () => {
  const fixture = await createGameFixture()
  const directory = await mkdtemp('/tmp/gw-webp-import-')
  const image = (await normalizeQuestionWebp(fixturePng())).webp
  const entries = reviewed(image)
  const manifest = join(directory, 'reviewed.json')
  await writeFile(join(directory, 'image.webp'), image)
  await writeFile(manifest, JSON.stringify({ entries }))
  const prepared = await prepareQuestionImport(manifest)
  assert.deepEqual([prepared.reviewedSubjects, prepared.categoryRelationships, prepared.imageAssets, prepared.totalRows], [69, 69, 69, 207])
  assert.equal(prepared.requiresImageFormatsMigration, true)
  try {
    await fixture.database.exec(await readFile(draft, 'utf8'))
    const sql = await readFile(prepared.output, 'utf8')
    assert.ok(!/UPDATE |DELETE |UPSERT|ON CONFLICT/.test(sql))
    const broken = sql.replace('COMMIT;', "INSERT INTO public.game_image_assets(celebrity_id,png) SELECT id,decode('00','hex') FROM public.celebrities LIMIT 1;\nCOMMIT;")
    await assert.rejects(fixture.database.exec(broken))
    await fixture.database.exec('ROLLBACK')
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.celebrities')).rows[0].total, 0)
    await fixture.database.exec(sql)
    await fixture.database.exec(await readFile(join(directory, 'verify-import.sql'), 'utf8'))
    await assert.rejects(fixture.database.exec(sql), /Duplicate bank subjects/)
    await fixture.database.exec('ROLLBACK')
    const hostToken = `gw_host_${nonce()}`, roomToken = `gw_room_${nonce()}`, playerToken = `gw_player_${nonce()}`
    const input = { host_hash: await hashToken('host', hostToken), room_token_hash: await hashToken('room', roomToken), room_code: 'WEBP01' }
    const host = await fixture.rpc('room', 'host-session', { mode: 'bootstrap', host_hash: input.host_hash })
    await fixture.rpc('room', 'create-room', { ...input, category_ids: [athlete] })
    const playerInput = { player_hash: await hashToken('player', playerToken), room_code: input.room_code }
    await fixture.rpc('room', 'join-room', { ...playerInput, nickname: 'LOCAL ONLY' })
    const call = (action, headers, body) => fixture.gameHandler(new Request(`https://edge.invalid/${action}`, { method: 'POST', headers: { origin: fixture.config.origins[0], apikey: fixture.config.publishableKeys[0], 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), { sourceAddress: '127.0.0.1' })
    let state = await fixture.rpc('game', 'start-game', input)
    const hiddenResponse = await call('get-game-state', { 'x-player-session': playerToken }, { roomCode: 'WEBP01' })
    assert.equal(hiddenResponse.status, 200)
    assert.ok(!/LOCAL TEST|attribution|license|source|author|hash/.test(await hiddenResponse.text()))
    const response = await call('get-question-image', { 'x-player-session': playerToken }, { roomCode: 'WEBP01', questionId: state.question.id })
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/webp')
    assert.equal(response.headers.get('content-disposition'), 'inline; filename="photo.webp"')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(image))
    const forbidden = await call('get-question-image', { 'x-player-session': `gw_player_${nonce()}` }, { roomCode: 'WEBP01', questionId: state.question.id })
    assert.equal(forbidden.status, 401)
    for (let number = 1; number <= 15; number++) {
      assert.equal(state.question.number, number)
      const hidden = await fixture.rpc('game', 'get-game-state', playerInput)
      assert.deepEqual(Object.keys(hidden.question).sort(), ['id', 'number', 'revealed'])
      assert.equal((await fixture.rpc('game', 'get-game-state', input)).question.id, state.question.id)
      state = await fixture.rpc('game', 'reveal-answer', { ...input, question_id: state.question.id })
      const visible = await fixture.rpc('game', 'get-game-state', playerInput)
      assert.equal(visible.question.answer, state.question.answer)
      assert.equal(JSON.parse(visible.question.attribution.text).licenseName, 'CC BY-SA')
      if (number < 15) state = await fixture.rpc('game', 'next-question', { ...input, question_id: state.question.id })
    }
    await assert.rejects(fixture.rpc('game', 'next-question', { ...input, question_id: state.question.id }), error => error.code === 'LAST_QUESTION')
    await fixture.rpc('game', 'finish-game', { ...input, question_id: state.question.id })
    const history = (await fixture.database.query('SELECT count(*)::int AS total, count(DISTINCT celebrity_id)::int AS distinct_people FROM public.host_question_history WHERE host_id=$1', [host.hostId])).rows[0]
    assert.deepEqual(history, { total: 15, distinct_people: 15 })
    const second = { ...input, room_code: 'WEBP02', room_token_hash: await hashToken('room', `gw_room_${nonce()}`) }
    await fixture.rpc('room', 'create-room', { ...second, category_ids: [athlete] })
    await fixture.rpc('game', 'start-game', second)
    assert.equal((await fixture.database.query('SELECT count(DISTINCT celebrity_id)::int AS total FROM public.host_question_history WHERE host_id=$1', [host.hostId])).rows[0].total, 16)
  } finally { await fixture.close() }
})
