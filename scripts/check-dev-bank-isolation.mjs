import assert from 'node:assert/strict'
import { createServer } from 'vite'

let server
try {
  server=await createServer({logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:true}})
  await server.listen()
  const address=server.httpServer.address()
  const origin=`http://127.0.0.1:${address.port}`
  assert.equal((await fetch(`${origin}/guess-who/`)).status,200)
  for(const path of ['/guess-who/data/question-bank/source-review.json','/guess-who/data/question-bank/prepared/review-20261023/reviewed-bank.json',`/guess-who/@fs/${process.cwd()}/data/question-bank/source-review.json`]) assert.equal((await fetch(origin+path)).status,403)
  console.log(JSON.stringify({result:'PASS',checks:['frontend index remains accessible','tracked review metadata blocked','private approved manifest blocked','absolute filesystem URL blocked'],cloudRequests:0},null,2))
} catch {
  console.error('FAIL/BLOCKED: local Vite listener or private question-bank isolation check unavailable; no Cloud access.')
  process.exitCode=1
} finally {await server?.close()}
