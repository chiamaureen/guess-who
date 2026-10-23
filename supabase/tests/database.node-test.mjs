import assert from 'node:assert/strict'
import { before, after, beforeEach, afterEach, test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { differencePaths, isReviewedPlatformFunction, withoutTransaction } from '../../scripts/check-database-schema.mjs'

const names = ['categories', 'celebrities', 'celebrity_categories', 'hosts', 'rooms', 'room_categories', 'room_players', 'room_questions', 'host_question_history']
const firstColumns = { categories: 'id', celebrities: 'id', celebrity_categories: 'celebrity_id', hosts: 'id', rooms: 'id', room_categories: 'room_id', room_players: 'id', room_questions: 'id', host_question_history: 'id' }
const host = '20000000-0000-4000-8000-000000000001'
const otherHost = '20000000-0000-4000-8000-000000000002'
const room = '30000000-0000-4000-8000-000000000001'
const nextRoom = '30000000-0000-4000-8000-000000000002'
const otherRoom = '30000000-0000-4000-8000-000000000003'
const actor = '10000000-0000-4000-8000-000000000001'
const singer = '10000000-0000-4000-8000-000000000002'
const subject = '40000000-0000-4000-8000-000000000001'
const secondSubject = '40000000-0000-4000-8000-000000000002'
const migrationDirectory = new URL('../migrations/', import.meta.url)
const seed = await readFile(new URL('../seed.sql', import.meta.url), 'utf8')
const migrations = await Promise.all((await readdir(migrationDirectory)).filter(filename => filename.endsWith('.sql') && filename.split('_')[0] <= '20261023060000').sort().map(filename => readFile(new URL(filename, migrationDirectory), 'utf8')))
let database

async function scalar(sql, parameters = []) {
  return Object.values((await database.query(sql, parameters)).rows[0])[0]
}

async function rejectsSQL(sql, code) {
  await database.exec('SAVEPOINT expected_failure')
  let failure
  try {
    await database.exec(sql)
    await database.exec('SET CONSTRAINTS ALL IMMEDIATE')
  } catch (error) {
    failure = error
  }
  await database.exec('ROLLBACK TO SAVEPOINT expected_failure; RELEASE SAVEPOINT expected_failure; SET CONSTRAINTS ALL DEFERRED')
  assert.equal(failure?.code, code, `Expected SQLSTATE ${code}, received ${failure?.code ?? 'success'}`)
}

before(async () => {
  database = new PGlite()
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE ROLE table_owner_fixture NOLOGIN;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, table_owner_fixture;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  `)
  for (const migration of migrations) await database.transaction(transaction => transaction.exec(migration))
  await database.exec(seed)
  await database.exec(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'))
  console.log(`Database test engine: ${await scalar('SELECT version()')}`)
})

beforeEach(async () => { await database.exec('BEGIN') })
afterEach(async () => { await database.exec('ROLLBACK') })
after(async () => { await database?.close() })

test('schema contains exactly nine application tables, RLS and FORCE RLS on each', async () => {
  const tables = (await database.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname = 'public' AND relkind = 'r' ORDER BY relname")).rows
  assert.deepEqual(tables.map(table => table.relname), [...names].sort())
  assert.ok(tables.every(table => table.relrowsecurity && table.relforcerowsecurity))
})

test('seven canonical category seeds are repeatable and do not re-enable disabled categories', async () => {
  await database.exec(`UPDATE public.categories SET is_active = false WHERE slug = 'actors'`)
  await database.exec(seed)
  await database.exec(seed)
  assert.equal(await scalar('SELECT count(*)::int FROM public.categories'), 7)
  assert.deepEqual((await database.query('SELECT slug FROM public.categories ORDER BY slug')).rows.map(row => row.slug), ['actors', 'animated-characters', 'athletes', 'historical-figures', 'politicians', 'scientists', 'singers'])
  assert.equal(await scalar("SELECT is_active FROM public.categories WHERE slug = 'actors'"), false)
})

test('real people, fictional characters and multiple missing Wikidata IDs are supported', async () => {
  assert.equal(await scalar('SELECT count(*)::int FROM public.celebrities WHERE wikidata_id IS NULL'), 2)
  assert.equal(await scalar("SELECT count(DISTINCT subject_type)::int FROM public.celebrities"), 2)
  await rejectsSQL(`UPDATE public.celebrities SET subject_type = 'other' WHERE id = '${subject}'`, '23514')
  await rejectsSQL(`UPDATE public.celebrities SET wikidata_id = 'not-wikidata' WHERE id = '${subject}'`, '23514')
  await rejectsSQL(`UPDATE public.celebrities SET wikidata_id = 'Q9000003' WHERE id = '${subject}'`, '23505')
})

test('names, image source, author, license, attribution and HTTPS are required', async () => {
  for (const column of ['name_zh', 'image_author', 'image_license', 'image_attribution']) {
    await rejectsSQL(`UPDATE public.celebrities SET ${column} = ' ' WHERE id = '${subject}'`, '23514')
  }
  for (const column of ['image_url', 'image_source']) {
    await rejectsSQL(`UPDATE public.celebrities SET ${column} = 'http://assets.invalid/image' WHERE id = '${subject}'`, '23514')
  }
  await rejectsSQL(`UPDATE public.celebrities SET image_author = NULL WHERE id = '${subject}'`, '23502')
})

test('approval defaults to false and updated_at is maintained by a trigger', async () => {
  const inserted = (await database.query(`INSERT INTO public.celebrities (name_zh, subject_type, image_url, image_source, image_author, image_license, image_attribution) VALUES ('測試', 'fictional_character', 'https://assets.invalid/opaque.webp', 'https://source.invalid/test', 'author', 'license', 'attribution') RETURNING id, is_approved`)).rows[0]
  assert.equal(inserted.is_approved, false)
  await database.query("UPDATE public.celebrities SET name_en = $1, updated_at = created_at - interval '1 day' WHERE id = $2", ['Fixture', inserted.id])
  assert.equal(await scalar('SELECT updated_at >= created_at FROM public.celebrities WHERE id = $1', [inserted.id]), true)
})

test('many-to-many membership is unique and foreign keys reject missing identities', async () => {
  assert.equal(await scalar('SELECT count(*)::int FROM public.celebrity_categories WHERE celebrity_id = $1', [subject]), 2)
  await rejectsSQL(`INSERT INTO public.celebrity_categories VALUES ('${subject}', '${actor}')`, '23505')
  await rejectsSQL(`INSERT INTO public.room_categories VALUES ('${room}', gen_random_uuid())`, '23503')
  await rejectsSQL(`UPDATE public.rooms SET host_id = gen_random_uuid() WHERE id = '${room}'`, '23503')
  await rejectsSQL(`UPDATE public.rooms SET host_id = NULL WHERE id = '${room}'`, '23502')
})

test('host, room and player credentials require unique SHA-256 hex hashes', async () => {
  for (const [table, column] of [['hosts', 'credential_hash'], ['rooms', 'host_token_hash'], ['room_players', 'session_token_hash']]) {
    await rejectsSQL(`UPDATE public.${table} SET ${column} = 'raw-token'`, '23514')
  }
  await rejectsSQL(`UPDATE public.hosts SET credential_hash = repeat('a', 64) WHERE id = '${otherHost}'`, '23505')
  await rejectsSQL(`UPDATE public.rooms SET host_token_hash = repeat('1', 64) WHERE id = '${nextRoom}'`, '23505')
})

test('room codes and fixed 15-question bounds are enforced', async () => {
  for (const value of ['abc123', 'A!C123', 'AB12', 'ABC1234']) await rejectsSQL(`UPDATE public.rooms SET room_code = '${value}' WHERE id = '${room}'`, '23514')
  await rejectsSQL(`UPDATE public.rooms SET room_code = 'ROOM01' WHERE id = '${nextRoom}'`, '23505')
  await rejectsSQL(`UPDATE public.rooms SET total_questions = 14 WHERE id = '${room}'`, '23514')
  for (const value of [-1, 16]) await rejectsSQL(`UPDATE public.rooms SET current_question = ${value} WHERE id = '${room}'`, '23514')
  await rejectsSQL(`UPDATE public.rooms SET expires_at = created_at WHERE id = '${room}'`, '23514')
})

test('room status and lifecycle timestamps must form a consistent stored state', async () => {
  await rejectsSQL(`UPDATE public.rooms SET status = 'other' WHERE id = '${room}'`, '23514')
  await rejectsSQL(`UPDATE public.rooms SET status = 'playing' WHERE id = '${nextRoom}'`, '23514')
  await rejectsSQL(`UPDATE public.rooms SET status = 'waiting' WHERE id = '${room}'`, '23514')
  await rejectsSQL(`UPDATE public.rooms SET status = 'finished' WHERE id = '${room}'`, '23514')
  await database.query("UPDATE public.rooms SET status = 'finished', ended_at = clock_timestamp() WHERE id = $1", [nextRoom])
  assert.equal(await scalar('SELECT current_question FROM public.rooms WHERE id = $1', [nextRoom]), 0)
})

test('player nicknames enforce non-blank 1-20 character input', async () => {
  for (const value of [' ', '字'.repeat(21)]) await rejectsSQL(`UPDATE public.room_players SET nickname = '${value}'`, '23514')
  await database.query('UPDATE public.room_players SET nickname = $1', ['😀'.repeat(20)])
  assert.equal(await scalar('SELECT char_length(nickname) FROM public.room_players'), 20)
})

test('question numbers, unique room positions and same-room subject deduplication are enforced', async () => {
  for (const value of [0, 16]) await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${room}', ${value}, '${actor}', '${secondSubject}')`, '23514')
  await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${room}', 1, '${actor}', '${secondSubject}')`, '23505')
  await database.query('INSERT INTO public.room_categories VALUES ($1, $2)', [room, singer])
  await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${room}', 2, '${singer}', '${subject}')`, '23505')
  await rejectsSQL(`UPDATE public.room_questions SET revealed_at = created_at - interval '1 second'`, '23514')
})

test('questions require both a selected room category and matching subject membership', async () => {
  await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${room}', 2, '${singer}', '${secondSubject}')`, '23503')
  await database.query('DELETE FROM public.celebrity_categories WHERE celebrity_id = $1 AND category_id = $2', [secondSubject, actor])
  await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${room}', 2, '${actor}', '${secondSubject}')`, '23503')
})

test('host history deduplicates across rooms and validates its first room and recorded subject', async () => {
  await rejectsSQL(`INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id) VALUES ('${host}', '${subject}', '${room}')`, '23505')
  await rejectsSQL(`INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id) VALUES ('${otherHost}', '${subject}', '${room}')`, '23503')
  await rejectsSQL(`INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id) VALUES ('${host}', '${secondSubject}', '${room}')`, '23503')
  await database.query('INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ($1, 1, $2, $3)', [otherRoom, actor, subject])
  await database.query('INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id) VALUES ($1, $2, $3)', [otherHost, subject, otherRoom])
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history WHERE celebrity_id = $1', [subject]), 2)
})

test('room cleanup preserves host history while nulling only first_room_id', async () => {
  await database.query('DELETE FROM public.rooms WHERE id = $1', [room])
  await database.exec('SET CONSTRAINTS ALL IMMEDIATE')
  assert.deepEqual((await database.query('SELECT host_id, celebrity_id, first_room_id FROM public.host_question_history')).rows[0], { host_id: host, celebrity_id: subject, first_room_id: null })
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions WHERE room_id = $1', [room]), 0)
})

test('history reset data strategy preserves completed questions and other hosts', async () => {
  await database.query("UPDATE public.rooms SET status = 'finished', ended_at = clock_timestamp() WHERE id = $1", [room])
  await database.query('INSERT INTO public.host_question_history (host_id, celebrity_id) VALUES ($1, $2)', [otherHost, secondSubject])
  await database.query('DELETE FROM public.host_question_history WHERE host_id = $1', [host])
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions WHERE room_id = $1', [room]), 1)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history WHERE host_id = $1', [otherHost]), 1)
})

test('distinct approved active subjects exclude host history across category overlaps', async () => {
  const count = await scalar(`SELECT count(DISTINCT subjects.id)::int FROM public.celebrities AS subjects JOIN public.celebrity_categories AS membership ON membership.celebrity_id = subjects.id JOIN public.categories AS categories ON categories.id = membership.category_id WHERE subjects.is_approved AND categories.is_active AND categories.slug IN ('actors', 'singers') AND NOT EXISTS (SELECT 1 FROM public.host_question_history AS history WHERE history.host_id = $1 AND history.celebrity_id = subjects.id)`, [host])
  assert.equal(count, 19)
  await database.exec(`UPDATE public.categories SET is_active = false WHERE slug IN ('actors', 'singers')`)
  assert.equal(await scalar(`SELECT count(DISTINCT subjects.id)::int FROM public.celebrities AS subjects JOIN public.celebrity_categories AS membership ON membership.celebrity_id = subjects.id JOIN public.categories AS categories ON categories.id = membership.category_id WHERE subjects.is_approved AND categories.is_active AND categories.slug IN ('actors', 'singers')`), 0)
})

test('insufficient distinct inventory is detectable without automatic history reset', async () => {
  await database.query(`INSERT INTO public.host_question_history (host_id, celebrity_id) SELECT $1, id FROM public.celebrities WHERE is_approved ORDER BY id LIMIT 10 ON CONFLICT (host_id, celebrity_id) DO NOTHING`, [host])
  assert.equal(await scalar(`SELECT count(*)::int FROM public.celebrities AS subjects WHERE is_approved AND NOT EXISTS (SELECT 1 FROM public.host_question_history WHERE host_id = $1 AND celebrity_id = subjects.id)`, [host]), 10)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history WHERE host_id = $1', [host]), 10)
})

test('a cross-room history conflict rolls back the staged question and room progress', async () => {
  await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${nextRoom}', 1, '${actor}', '${subject}'); UPDATE public.rooms SET status = 'playing', current_question = 1, started_at = now() WHERE id = '${nextRoom}'; INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id) VALUES ('${host}', '${subject}', '${nextRoom}');`, '23505')
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions WHERE room_id = $1', [nextRoom]), 0)
  assert.equal(await scalar('SELECT current_question FROM public.rooms WHERE id = $1', [nextRoom]), 0)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history WHERE host_id = $1', [host]), 1)
})

for (const role of ['anon', 'authenticated']) {
  test(`${role} may read only active categories, never private subjects or credentials`, async () => {
    await database.exec("UPDATE public.categories SET is_active = false WHERE slug = 'actors'")
    await database.exec(`SET LOCAL ROLE ${role}`)
    assert.equal(await scalar('SELECT count(*)::int FROM public.categories'), 6)
    for (const name of names.filter(name => name !== 'categories')) await rejectsSQL(`SELECT * FROM public.${name}`, '42501')
  })

  test(`${role} cannot INSERT, UPDATE or DELETE on any application table`, async () => {
    await database.exec(`SET LOCAL ROLE ${role}`)
    for (const name of names) {
      await rejectsSQL(`INSERT INTO public.${name} DEFAULT VALUES`, '42501')
      await rejectsSQL(`UPDATE public.${name} SET ${firstColumns[name]} = ${firstColumns[name]}`, '42501')
      await rejectsSQL(`DELETE FROM public.${name}`, '42501')
    }
  })

  test(`${role} cannot execute the trigger helper as an RPC`, async () => {
    await database.exec(`SET LOCAL ROLE ${role}`)
    await rejectsSQL('SELECT public.guess_who_set_celebrity_updated_at()', '42501')
  })
}

test('default-deny RLS remains effective even if a table GRANT is accidentally added', async () => {
  await database.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON public.hosts, public.celebrities, public.room_questions TO anon; SET LOCAL ROLE anon')
  for (const name of ['hosts', 'celebrities', 'room_questions']) assert.equal(await scalar(`SELECT count(*)::int FROM public.${name}`), 0)
  await rejectsSQL("INSERT INTO public.hosts (credential_hash) VALUES (repeat('d', 64))", '42501')
  await database.exec('UPDATE public.hosts SET last_seen_at = clock_timestamp(); DELETE FROM public.hosts')
  await database.exec('RESET ROLE')
  assert.equal(await scalar('SELECT count(*)::int FROM public.hosts'), 2)
})

test('FORCE RLS also denies a non-bypass table owner', async () => {
  await database.exec('ALTER TABLE public.celebrities OWNER TO table_owner_fixture; SET LOCAL ROLE table_owner_fixture')
  assert.equal(await scalar('SELECT count(*)::int FROM public.celebrities'), 0)
})

test('service_role has only the intended table DML and may work behind server authorization', async () => {
  for (const name of names) assert.equal(await scalar("SELECT has_table_privilege('service_role', $1, 'TRUNCATE')", [`public.${name}`]), false)
  await database.exec('SET LOCAL ROLE service_role')
  for (const name of names) assert.ok(await scalar(`SELECT count(*)::int FROM public.${name}`) >= 0)
  await database.query('INSERT INTO public.room_players (room_id, nickname, session_token_hash) VALUES ($1, $2, $3)', [nextRoom, 'Server fixture', 'd'.repeat(64)])
  await database.query('UPDATE public.room_players SET nickname = $1 WHERE room_id = $2', ['Updated fixture', nextRoom])
  await database.query('DELETE FROM public.room_players WHERE room_id = $1', [nextRoom])
})

test('no views, security-definer RPCs or app Realtime publications expose answers', async () => {
  assert.equal(await scalar("SELECT count(*)::int FROM pg_views WHERE schemaname = 'public'"), 0)
  assert.equal(await scalar("SELECT count(*)::int FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pronamespace WHERE nspname = 'public' AND prosecdef"), 0)
  assert.equal(await scalar("SELECT count(*)::int FROM pg_publication_tables WHERE schemaname = 'public'"), 0)
})

test('reapplying an existing migration fails instead of silently overwriting tables', async () => {
  await rejectsSQL(migrations[0], '42P07')
  assert.equal(await scalar('SELECT count(*)::int FROM public.hosts'), 2)
})

test('unsafe automatic Realtime publications prevent migration before creating tables', async () => {
  for (const scope of ['ALL TABLES', 'TABLES IN SCHEMA public']) {
    await database.exec(`CREATE PUBLICATION supabase_realtime FOR ${scope}`)
    await rejectsSQL(migrations[0], 'P0001')
    await database.exec('DROP PUBLICATION supabase_realtime')
  }
})

test('the read-only deployment verification SQL checks actual browser roles and catalog permissions', async () => {
  const verification = await readFile(new URL('./verify_schema.sql', import.meta.url), 'utf8')
  const results = await database.exec(verification.replace(/^BEGIN READ ONLY;\s*/, '').replace(/COMMIT;\s*$/, ''))
  const report = results.at(-1).rows[0].verification
  assert.equal(report.tables.length, 9)
  assert.equal(report.categories.length, 7)
  assert.equal(report.browser_privilege_violations.length, 0)
  assert.equal(report.service_privilege_violations.length, 0)
  assert.equal(report.invalid_constraints.length, 0)
  assert.equal(report.realtime_exposed_tables.length, 0)
})

test('a room with 15 questions cannot accept a sixteenth question or another copy of a position', async () => {
  await database.query(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) SELECT $1, subject_number, $2, ('40000000-0000-4000-8000-' || lpad(subject_number::text, 12, '0'))::uuid FROM generate_series(2, 15) AS subjects(subject_number)`, [room, actor])
  await database.exec('SET CONSTRAINTS ALL IMMEDIATE')
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions WHERE room_id = $1', [room]), 15)
  await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${room}', 16, '${actor}', '40000000-0000-4000-8000-000000000016')`, '23514')
  await rejectsSQL(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ('${room}', 15, '${actor}', '40000000-0000-4000-8000-000000000016')`, '23505')
})

test('database-only deterministic three-room fixture stores 45 distinct subjects, not a game-engine E2E test', async () => {
  await database.exec(`
    INSERT INTO public.celebrities (id, name_zh, subject_type, image_url, image_source, image_author, image_license, image_attribution, is_approved)
    SELECT ('60000000-0000-4000-8000-' || lpad(subject_number::text, 12, '0'))::uuid, '三場測試' || subject_number::text, 'fictional_character', 'https://assets.invalid/opaque.webp', 'https://source.invalid/fixture', 'Fixture author', 'Fixture license', 'Fixture attribution', true
    FROM generate_series(1, 45) AS subjects(subject_number);
    INSERT INTO public.celebrity_categories (celebrity_id, category_id)
    SELECT subjects.id, categories.id FROM public.celebrities AS subjects CROSS JOIN public.categories AS categories
    WHERE subjects.id::text LIKE '60000000-%' AND categories.slug IN ('actors', 'singers');
  `)
  for (const gameNumber of [1, 2, 3]) {
    const gameId = `70000000-0000-4000-8000-${String(gameNumber).padStart(12, '0')}`
    await database.query('INSERT INTO public.rooms (id, room_code, host_id, host_token_hash) VALUES ($1, $2, $3, $4)', [gameId, `GAME0${gameNumber}`, host, String(gameNumber + 3).repeat(64)])
    await database.query('INSERT INTO public.room_categories SELECT $1, id FROM public.categories WHERE slug IN ($2, $3)', [gameId, 'actors', 'singers'])
    await database.query(`INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) SELECT $1, question_number, CASE WHEN question_number % 2 = 0 THEN $2::uuid ELSE $3::uuid END, ('60000000-0000-4000-8000-' || lpad((question_number + $4::int)::text, 12, '0'))::uuid FROM generate_series(1, 15) AS questions(question_number)`, [gameId, actor, singer, (gameNumber - 1) * 15])
    await database.query('INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id) SELECT $1, celebrity_id, room_id FROM public.room_questions WHERE room_id = $2', [host, gameId])
    await database.query("UPDATE public.rooms SET status = 'finished', current_question = 15, started_at = now(), ended_at = now() WHERE id = $1", [gameId])
  }
  await database.exec('SET CONSTRAINTS ALL IMMEDIATE')
  const counts = (await database.query("SELECT count(*)::int AS questions, count(DISTINCT celebrity_id)::int AS subjects FROM public.room_questions WHERE room_id::text LIKE '70000000-%'")).rows[0]
  assert.deepEqual(counts, { questions: 45, subjects: 45 })
  assert.equal(await scalar("SELECT count(*)::int FROM public.host_question_history WHERE host_id = $1 AND celebrity_id::text LIKE '60000000-%'", [host]), 45)
})

test('database-only history reset permits a subject in a new room without erasing the old question', async () => {
  await database.query("UPDATE public.rooms SET status = 'finished', ended_at = clock_timestamp() WHERE id = $1", [room])
  await database.query('DELETE FROM public.host_question_history WHERE host_id = $1', [host])
  await database.query('INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ($1, 1, $2, $3)', [nextRoom, actor, subject])
  await database.query('INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id) VALUES ($1, $2, $3)', [host, subject, nextRoom])
  await database.exec('SET CONSTRAINTS ALL IMMEDIATE')
  assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions WHERE celebrity_id = $1', [subject]), 2)
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history WHERE host_id = $1 AND celebrity_id = $2', [host, subject]), 1)
})

test('schema alone does not implement the future engine or automatic per-question history writing', async () => {
  await database.query('INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id) VALUES ($1, 1, $2, $3)', [nextRoom, actor, secondSubject])
  await database.exec('SET CONSTRAINTS ALL IMMEDIATE')
  assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history WHERE host_id = $1 AND celebrity_id = $2', [host, secondSubject]), 0)
  assert.equal(await scalar('SELECT current_question FROM public.rooms WHERE id = $1', [nextRoom]), 0)
  await database.query("UPDATE public.rooms SET status = 'finished', ended_at = clock_timestamp() WHERE id = $1", [room])
  await database.query("UPDATE public.rooms SET status = 'playing', ended_at = NULL WHERE id = $1", [room])
  assert.equal(await scalar('SELECT status FROM public.rooms WHERE id = $1', [room]), 'playing')
})

test('catalog comparison covers columns, constraints, indexes, grants, policies and trigger source without exposing rows', async () => {
  const results = await database.exec(withoutTransaction(await readFile(new URL('./schema_catalog.sql', import.meta.url), 'utf8')))
  const catalog = results.at(-1).rows[0].catalog
  assert.equal(catalog.schema.tables.length, 9)
  assert.equal(catalog.schema.constraints.filter(constraint => constraint.type === 'p').length, 9)
  assert.equal(catalog.schema.table_privileges.length, 189)
  assert.deepEqual(catalog.schema.unexpected_column_grants, [])
  assert.deepEqual(catalog.schema.public_table_grants, [])
  assert.deepEqual(catalog.public_views, [])
  assert.equal(catalog.public_functions.length, 1)
  assert.equal(catalog.schema.helper.security_definer, false)
  assert.equal(catalog.schema.helper.anon_execute, false)
  assert.equal(catalog.schema.helper.authenticated_execute, false)
  const changed = structuredClone(catalog.schema)
  changed.columns[0].not_null = !changed.columns[0].not_null
  changed.constraints[0].definition = 'unexpected definition'
  changed.indexes[0].valid = false
  changed.helper.source_md5 = 'changed'
  assert.deepEqual(differencePaths(catalog.schema, changed), ['schema.columns.0.not_null', 'schema.constraints.0.definition', 'schema.helper.source_md5', 'schema.indexes.0.valid'])
  assert.deepEqual(differencePaths(catalog.schema, JSON.parse(JSON.stringify(catalog.schema))), [])
})

test('platform event-trigger exception requires reviewed source, type, owner, search_path and trigger configuration', () => {
  const reviewed = { name: 'rls_auto_enable', arguments: '', return_type: 'event_trigger', owner: 'postgres', security_definer: true, source_md5: 'c44fb229ea8a6b0afd04a0a33261c16c', config: ['search_path=pg_catalog'], event_triggers: [{ name: 'ensure_rls', event: 'ddl_command_end', enabled: 'O', tags: ['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'] }] }
  assert.equal(isReviewedPlatformFunction(reviewed), true)
  assert.equal(isReviewedPlatformFunction({ ...reviewed, event_triggers: [{ enabled: 'O', event: 'ddl_command_end', name: 'ensure_rls', tags: ['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'] }] }), true)
  for (const change of [{ name: 'unreviewed' }, { arguments: 'sql text' }, { return_type: 'jsonb' }, { owner: 'anon' }, { security_definer: false }, { source_md5: 'modified' }, { config: ['search_path=public'] }, { event_triggers: [] }]) {
    assert.equal(isReviewedPlatformFunction({ ...reviewed, ...change }), false)
  }
})
