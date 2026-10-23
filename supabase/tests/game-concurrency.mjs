import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { actor, gameDraft, seedGameFixtures } from './game-fixture.mjs'

if (!process.env.PG_BIN_DIR || !process.env.PG_DRIVER_MODULE) {
  console.log('BLOCKED: PG_BIN_DIR and PG_DRIVER_MODULE must reference installed local PostgreSQL tools. Cloud database URLs are not accepted.')
  process.exitCode=2
} else {
  const { default: driver }=await import(pathToFileURL(process.env.PG_DRIVER_MODULE))
  const directory=await mkdtemp('/tmp/gw-game-pg-')
  const data=join(directory,'data')
  const execute=(name,args)=>execFileSync(join(process.env.PG_BIN_DIR,name),args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000})
  let pool
  let started=false
  const checks=[]
  try {
    execute('initdb',['-D',data,'-A','trust','--no-locale','--encoding=UTF8','-U','postgres'])
    execute('pg_ctl',['-D',data,'-l',join(directory,'server.log'),'-o',`-h '' -k ${directory} -p 6543 -c max_connections=32`,'-w','start'])
    started=true
    pool=new driver.Pool({host:directory,port:6543,database:'postgres',user:'postgres',max:20,connectionTimeoutMillis:10000,options:'-c statement_timeout=15000 -c lock_timeout=12000'})
    await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;')
    const migrations=new URL('../migrations/',import.meta.url)
    for(const file of (await readdir(migrations)).filter(name=>name.endsWith('.sql')).sort()) await pool.query(await readFile(new URL(file,migrations),'utf8'))
    await pool.query(await readFile(gameDraft,'utf8'))
    await pool.query(await readFile(new URL('../seed.sql',import.meta.url),'utf8'))
    await seedGameFixtures(pool,45)
    const version=(await pool.query('SHOW server_version')).rows[0].server_version
    const clients=await Promise.all(Array.from({length:20},()=>pool.connect()))
    const pids=await Promise.all(clients.map(client=>client.query('SELECT pg_backend_pid() AS pid')))
    const connections=new Set(pids.map(result=>result.rows[0].pid)).size
    clients.forEach(client=>client.release())
    assert.equal(connections,20)
    const call=async (rpc,action,input)=>{
      const client=await pool.connect()
      try {
        await client.query('BEGIN; SET LOCAL ROLE service_role')
        const result=await client.query(`SELECT public.${rpc}($1,$2::jsonb) AS data`,[action,JSON.stringify(input)])
        await client.query('COMMIT')
        return result.rows[0].data
      } catch(error) {await client.query('ROLLBACK');throw error}
      finally {client.release()}
    }
    const hostHash='a'.repeat(64)
    const roomHash='b'.repeat(64)
    await call('room_system_action','host-session',{mode:'bootstrap',host_hash:hostHash})
    const room=await call('room_system_action','create-room',{host_hash:hostHash,room_token_hash:roomHash,room_code:'GAME01',category_ids:[actor]})
    const input={host_hash:hostHash,room_token_hash:roomHash,room_code:room.room.code}
    const game=(action,extra={})=>call('game_engine_action',action,{...input,...extra})
    const scalar=async sql=>Object.values((await pool.query(sql)).rows[0])[0]
    const starts=await Promise.all(Array.from({length:20},()=>game('start-game')))
    assert.equal(new Set(starts.map(state=>state.question.id)).size,1)
    assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions'),1)
    checks.push({name:'20 parallel starts create exactly question1 and one history row',result:'PASS'})
    const questionId=starts[0].question.id
    const denied=await Promise.allSettled(Array.from({length:20},()=>game('next-question',{question_id:questionId})))
    assert.ok(denied.every(result=>result.status==='rejected' && result.reason.message==='ANSWER_NOT_REVEALED'))
    checks.push({name:'20 parallel unrevealed next requests all refused',result:'PASS'})
    await Promise.all(Array.from({length:20},()=>game('reveal-answer',{question_id:questionId})))
    const next=await Promise.all(Array.from({length:20},()=>game('next-question',{question_id:questionId})))
    assert.equal(new Set(next.map(state=>state.question.id)).size,1)
    assert.ok(next.every(state=>state.question.number===2 && !state.question.revealed))
    assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),2)
    checks.push({name:'parallel reveal and 20 duplicate next calls consume only one new person',result:'PASS'})
    await assert.rejects(game('reveal-answer',{question_id:questionId}),error=>error.message==='STALE_STATE')
    await pool.query("CREATE FUNCTION public.fixture_fail_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure after question insert'; END $$; CREATE TRIGGER fixture_fail_history BEFORE INSERT ON public.host_question_history FOR EACH ROW EXECUTE FUNCTION public.fixture_fail_history()")
    await game('reveal-answer',{question_id:next[0].question.id})
    await assert.rejects(game('next-question',{question_id:next[0].question.id}))
    assert.equal(await scalar('SELECT current_question FROM public.rooms'),2)
    assert.equal(await scalar('SELECT count(*)::int FROM public.room_questions'),2)
    assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),2)
    await pool.query('DROP TRIGGER fixture_fail_history ON public.host_question_history; DROP FUNCTION public.fixture_fail_history()')
    checks.push({name:'injected failure between question and history rolls back the entire draw',result:'PASS'})
    const finishes=await Promise.all(Array.from({length:20},()=>game('finish-game',{question_id:next[0].question.id})))
    assert.ok(finishes.every(state=>state.room.status==='finished'))
    assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),2)
    checks.push({name:'20 duplicate finishes preserve all used history',result:'PASS'})
    await call('room_system_action','create-room',{host_hash:hostHash,room_token_hash:'c'.repeat(64),room_code:'GAME02',category_ids:[actor]})
    const raced=await Promise.allSettled([
      call('game_engine_action','reset-question-history',{host_hash:hostHash,confirm:true,history_revision:finishes[0].historyRevision}),
      call('game_engine_action','start-game',{host_hash:hostHash,room_token_hash:'c'.repeat(64),room_code:'GAME02'}),
    ])
    assert.equal(raced[1].status,'fulfilled')
    if(raced[0].status==='fulfilled') assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),1)
    else {assert.equal(raced[0].reason.message,'GAME_ACTIVE');assert.equal(await scalar('SELECT count(*)::int FROM public.host_question_history'),3)}
    checks.push({name:'reset versus start is serialized, cannot erase an active game history',result:'PASS'})
    console.log(JSON.stringify({result:'PASS',engine:version,connections,cloudRequests:0,transport:'private Unix socket; TCP disabled',checks,artifacts:directory},null,2))
  } catch(error) {
    console.log(JSON.stringify({result:'FAIL',details:'Isolated local PostgreSQL test failed; no credentials or raw SQL data logged',code:error.code,completedChecks:checks,artifacts:directory},null,2));process.exitCode=1
  } finally {await pool?.end();if(started)execute('pg_ctl',['-D',data,'-m','fast','-w','stop'])}
}
