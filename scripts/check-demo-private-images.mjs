import assert from 'node:assert/strict'
import { readFile,realpath,writeFile } from 'node:fs/promises'
import { resolve,dirname,sep,join } from 'node:path'
import { createHash } from 'node:crypto'
import { createGameFixture,seedGameFixtures,actor } from '../supabase/tests/game-fixture.mjs'
import { storedAttribution,validateImageRights } from './lib/question-license.mjs'
import { nonce } from '../supabase/functions/room-system/crypto.ts'

if (process.argv.length!==3) throw new Error('Partial approved manifest required for local photo API QA')
const path=await realpath(process.argv[2])
const directory=dirname(path)
const manifest=JSON.parse(await readFile(path,'utf8'))
assert.equal(manifest.entries.length,2)
let verified=0
for (const photo of manifest.entries) {
  assert.equal(photo.approved,true)
  validateImageRights(photo)
  const imagePath=await realpath(resolve(directory,photo.imagePath))
  assert.ok(imagePath.startsWith(directory+sep))
  const bytes=await readFile(imagePath)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),photo.imageSha256)
  const fixture=await createGameFixture()
  try {
    if(!(await fixture.database.query("SELECT to_regprocedure('public.game_engine_image_valid(bytea)') AS existing")).rows[0].existing) await fixture.database.exec(await readFile(new URL('../supabase/migration-drafts/20261024120000_game_image_formats.sql',import.meta.url),'utf8'))
    await seedGameFixtures(fixture.database,15,bytes)
    await fixture.database.query('UPDATE public.celebrities SET image_author=$1,image_source=$2,image_license=$3,image_attribution=$4',[photo.author,photo.source,photo.license,storedAttribution(photo)])
    const call=async(action,input,headers={})=>{
      const handler=['host-session','create-room','join-room'].includes(action)?fixture.roomHandler:fixture.gameHandler
      return handler(new Request(`https://edge.invalid/${action}`,{method:'POST',headers:{origin:'http://localhost:5173',apikey:'sb_publishable_fixture','content-type':'application/json',...headers},body:JSON.stringify(input)}),{sourceAddress:'127.0.0.1'})
    }
    const json=async response=>{assert.equal(response.status,200);return(await response.json()).data}
    const host=await json(await call('host-session',{mode:'bootstrap',bootstrapKey:nonce()}))
    const lobby=await json(await call('create-room',{categoryIds:[actor],requestKey:nonce()},{'x-host-credential':host.credential}))
    const player=await json(await call('join-room',{roomCode:lobby.room.code,nickname:'Photo QA',joinKey:nonce()}))
    const hostHeaders={'x-host-credential':host.credential,'x-room-token':lobby.hostToken}
    const playerHeaders={'x-player-session':player.playerSession}
    const state=await json(await call('start-game',{roomCode:lobby.room.code},hostHeaders))
    assert.ok(state.question.answer&&state.question.attribution)
    const before=await json(await call('get-game-state',{roomCode:lobby.room.code},playerHeaders))
    assert.equal(before.question.answer,undefined);assert.equal(before.question.attribution,undefined)
    assert.ok(!JSON.stringify(before).includes(photo.author)&&!JSON.stringify(before).includes(photo.source))
    const input={roomCode:lobby.room.code,questionId:state.question.id}
    for (const headers of [hostHeaders,playerHeaders]) {
      const image=await call('get-question-image',input,headers)
      assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp')
      assert.equal(image.headers.get('content-disposition'),'inline; filename="photo.webp"')
      assert.equal(createHash('sha256').update(Buffer.from(await image.arrayBuffer())).digest('hex'),photo.imageSha256)
    }
    assert.notEqual((await call('get-question-image',input)).status,200)
    await json(await call('reveal-answer',input,hostHeaders))
    const after=await json(await call('get-game-state',{roomCode:lobby.room.code},playerHeaders))
    assert.equal(after.question.attribution.author,photo.author)
    assert.equal(JSON.parse(after.question.attribution.text).licenseVersion,photo.rights.licenseVersion)
    verified++
  } finally {await fixture.close()}
}
const receipt={result:'PASS',verifiedImages:verified,scope:'Actual two reviewed photo bytes/credits; 15 synthetic local identities per case, NOT120 real approved people or Cloud acceptance',cloudRequests:0,cloudWrites:0}
await writeFile(join(directory,'private-image-api-qa.json'),JSON.stringify(receipt,null,2),{mode:0o600})
console.log(JSON.stringify(receipt))
