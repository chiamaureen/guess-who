import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.env.PG_BIN_DIR || !process.env.PG_DRIVER_MODULE) {
  console.log('BLOCKED: set PG_BIN_DIR and PG_DRIVER_MODULE to installed local test tools; no database URL is accepted.')
  process.exitCode = 2
} else {
  const { default: driver } = await import(pathToFileURL(process.env.PG_DRIVER_MODULE))
  const directory = await mkdtemp('/tmp/gw-h01-pg-')
  const data = join(directory, 'data')
  const execute = (name, parameters) => execFileSync(join(process.env.PG_BIN_DIR, name), parameters, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
  let started = false
  let pool
  const checks = []
  try {
    execute('initdb', ['-D', data, '-A', 'trust', '--no-locale', '--encoding=UTF8', '-U', 'postgres'])
    execute('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-o', `-h '' -k ${directory} -p 6543 -c max_connections=32`, '-w', 'start'])
    started = true
    pool = new driver.Pool({ host: directory, port: 6543, database: 'postgres', user: 'postgres', max: 20, connectionTimeoutMillis: 10000, options: '-c statement_timeout=10000 -c lock_timeout=8000' })
    await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;')
    const migrationsDirectory = new URL('../migrations/', import.meta.url)
    const migrations = (await readdir(migrationsDirectory)).filter(filename => filename.endsWith('.sql')).sort()
    for (const filename of migrations) {
      if(filename==='20261025010000_question_groups.sql') await pool.query(await readFile(new URL('../seed.sql',import.meta.url),'utf8'))
      await pool.query(await readFile(new URL(filename, migrationsDirectory), 'utf8'))
    }
    if (!migrations.includes('20261023093000_room_system.sql')) await pool.query(await readFile(new URL('../migration-drafts/20261023093000_room_system.sql', import.meta.url), 'utf8'))
    const version = (await pool.query('SHOW server_version')).rows[0].server_version
    const connected = await Promise.all(Array.from({ length: 20 }, () => pool.connect()))
    const processes = await Promise.all(connected.map(client => client.query('SELECT pg_backend_pid() AS pid')))
    const connections = new Set(processes.map(result => result.rows[0].pid)).size
    for (const client of connected) client.release()
    assert.ok(connections > 1)
    const rate = async input => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN; SET LOCAL ROLE service_role;')
        const result = await client.query('SELECT public.room_system_rate_limit($1::jsonb) AS result', [JSON.stringify(input)])
        await client.query('COMMIT')
        return result.rows[0].result
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    }
    const count = async () => (await pool.query('SELECT count(*)::int AS total FROM public.room_api_rate_limits')).rows[0].total
    const results = await Promise.all(Array.from({ length: 160 }, (_, index) => rate({ action: 'create-room', bootstrap: false, source_bucket: index, host_hash: index.toString(16).padStart(64, '0') })))
    assert.equal(results.filter(result => result.allowed).length, 120)
    assert.ok(results.every(result => !result.authenticated))
    assert.equal(await count(), 121)
    for (let index = 160; index < 180; index++) assert.equal((await rate({ action: 'create-room', bootstrap: false, source_bucket: index, host_hash: index.toString(16).padStart(64, '0') })).allowed, false)
    assert.equal(await count(), 121)
    checks.push({ name: 'parallel global admission and zero post-rejection allocations', result: 'PASS', requests: 180, admitted: 120, rateRows: 121 })
    await pool.query('DELETE FROM public.room_api_rate_limits')
    const sameSource = await Promise.all(Array.from({ length: 80 }, () => rate({ action: 'join-room', bootstrap: false, source_bucket: 0 })))
    assert.equal(sameSource.filter(result => result.allowed).length, 30)
    assert.equal(await count(), 2)
    assert.equal((await pool.query('SELECT min(request_count)::int AS total FROM public.room_api_rate_limits')).rows[0].total, 80)
    checks.push({ name: 'parallel source allowance without lost increments', result: 'PASS', requests: 80, admitted: 30 })
    await pool.query("DELETE FROM public.room_api_rate_limits; INSERT INTO public.hosts(credential_hash) VALUES (repeat('a',64))")
    const verified = await Promise.all(Array.from({ length: 80 }, (_, index) => rate({ action: 'create-room', bootstrap: false, source_bucket: index, host_hash: 'a'.repeat(64) })))
    assert.equal(verified.filter(result => result.allowed).length, 5)
    assert.ok(verified.every(result => result.authenticated))
    assert.equal(await count(), 82)
    checks.push({ name: 'parallel verified identity allowance across source buckets', result: 'PASS', requests: 80, admitted: 5 })
    await pool.query("UPDATE public.room_api_rate_limits SET window_started_at=now()-interval '20 minutes'; INSERT INTO public.room_api_rate_limits(scope_hash,window_started_at,request_count,updated_at) SELECT encode(sha256(convert_to('stale:'||value::text,'UTF8')),'hex'), now()-interval '25 hours',1,now()-interval '25 hours' FROM generate_series(1,150) AS value")
    const actions = ['host-session', 'create-room', 'join-room', 'get-room-state', 'leave-room', 'close-room']
    await Promise.all(Array.from({ length: 120 }, (_, index) => rate({ action: actions[index % actions.length], bootstrap: false, source_bucket: 255 })))
    assert.equal((await pool.query("SELECT count(*)::int AS total FROM public.room_api_rate_limits WHERE updated_at < now()-interval '24 hours'")).rows[0].total, 0)
    const recovered = await rate({ action: 'create-room', bootstrap: false, source_bucket: 0, host_hash: 'a'.repeat(64) })
    assert.equal(recovered.allowed, true)
    assert.equal(recovered.authenticated, true)
    checks.push({ name: 'expiry recovery and mixed-action concurrent cleanup without deadlocks', result: 'PASS', requests: 121 })
    console.log(JSON.stringify({ result: 'PASS', engine: version, connections, transport: 'private local Unix socket only; TCP disabled', cloudRequests: 0, checks, artifacts: directory }, null, 2))
  } catch {
    console.log(JSON.stringify({ result: 'FAIL', details: 'Isolated native PostgreSQL verification failed; raw data and errors withheld', completedChecks: checks, artifacts: directory }))
    process.exitCode = 1
  } finally {
    await pool?.end()
    if (started) execute('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
  }
}
