import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createGameFixture } from '../supabase/tests/game-fixture.mjs'
import { hashToken, nonce } from '../supabase/functions/room-system/crypto.ts'
import { gameVerificationSql } from './make-game-verification.mjs'

if (process.argv.length!==3) {
  console.log('BLOCKED: provide the reviewed-bank.json path; tool uses isolated local PostgreSQL only.')
  process.exitCode=2
} else {
  const path=resolve(process.argv[2])
  const bank=JSON.parse(await readFile(path,'utf8'))
  const fixture=await createGameFixture()
  const names=bank.entries.map(entry=>entry.nameZh)
  const checks=[]
  try {
    await fixture.database.exec(await readFile(resolve(dirname(path),'reviewed-import.sql'),'utf8'))
    await fixture.database.exec(await readFile(resolve(dirname(path),'verify-import.sql'),'utf8'))
    checks.push('Real reviewed image SQL and read-only receipt verification')
    const hostHash=await hashToken('host',`gw_host_${nonce()}`)
    const roomHash=await hashToken('room',`gw_room_${nonce()}`)
    const playerHash=await hashToken('player',`gw_player_${nonce()}`)
    const host=await fixture.rpc('room','host-session',{mode:'bootstrap',host_hash:hostHash})
    const lobby=await fixture.rpc('room','create-room',{host_hash:hostHash,room_token_hash:roomHash,room_code:'BANK01',category_ids:bank.entries[0].categoryIds})
    await fixture.rpc('room','join-room',{room_code:'BANK01',player_hash:playerHash,nickname:'LOCAL corpus review'})
    const input={host_hash:hostHash,room_token_hash:roomHash,room_code:lobby.room.code}
    let state=await fixture.rpc('game','start-game',input)
    for(let number=1;number<=15;number++) {
      assert.equal(state.question.number,number)
      const hidden=await fixture.rpc('game','get-game-state',{player_hash:playerHash,room_code:'BANK01'})
      assert.deepEqual(Object.keys(hidden.question).sort(),['id','number','revealed'])
      for(const name of names) assert.ok(!JSON.stringify(hidden).includes(name))
      const refreshed=await fixture.rpc('game','get-game-state',input)
      assert.equal(refreshed.question.id,state.question.id)
      const image=await fixture.rpc('game','get-question-image',{player_hash:playerHash,room_code:'BANK01',question_id:state.question.id})
      assert.ok(Buffer.from(image.png,'base64').length<=131072)
      state=await fixture.rpc('game','reveal-answer',{...input,question_id:state.question.id})
      const revealed=await fixture.rpc('game','get-game-state',{player_hash:playerHash,room_code:'BANK01'})
      assert.equal(revealed.question.answer,state.question.answer)
      if(number<15) state=await fixture.rpc('game','next-question',{...input,question_id:state.question.id})
    }
    state=await fixture.rpc('game','finish-game',{...input,question_id:state.question.id})
    assert.equal(state.room.status,'finished')
    const summary=(await fixture.database.query('SELECT count(*)::int AS questions,count(DISTINCT celebrity_id)::int AS distinct_people FROM public.room_questions')).rows[0]
    assert.equal(summary.questions,15);assert.equal(summary.distinct_people,15)
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.host_question_history WHERE host_id=$1',[host.hostId])).rows[0].total,15)
    await fixture.database.exec(gameVerificationSql('BANK01'))
    checks.push('15 real approved photos, hidden/revealed player DTO, Host refresh, progress, finish, distinct history and read-only game verifier')
    await fixture.rpc('room','create-room',{host_hash:hostHash,room_token_hash:roomHash.replace(/^./,roomHash.startsWith('a')?'b':'a'),room_code:'BANK02',category_ids:bank.entries[0].categoryIds})
    const secondToken=roomHash.replace(/^./,roomHash.startsWith('a')?'b':'a')
    await assert.rejects(fixture.rpc('game','start-game',{host_hash:hostHash,room_token_hash:secondToken,room_code:'BANK02'}),error=>error.code==='INSUFFICIENT_QUESTIONS')
    await fixture.rpc('game','reset-question-history',{host_hash:hostHash,confirm:true,history_revision:state.historyRevision})
    assert.equal((await fixture.database.query('SELECT count(*)::int AS total FROM public.room_questions')).rows[0].total,15)
    await fixture.rpc('game','start-game',{host_hash:hostHash,room_token_hash:secondToken,room_code:'BANK02'})
    checks.push('C mode second game refused until explicit own-history reset; original questions retained')
    console.log(JSON.stringify({result:'PASS',environment:'isolated PGlite + real reviewed photos + actual private RPC, NOT Cloud or full browser/HTTP rate test',subjects:bank.entries.length,checks,cloudWrites:0},null,2))
  } catch {
    console.log(JSON.stringify({result:'FAIL',checks,details:'Local reviewed-bank verification failed; no Cloud changes or credential output'}));process.exitCode=1
  } finally {await fixture.close()}
}
