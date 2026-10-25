import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdtemp, chmod } from 'node:fs/promises'
import sharp from 'sharp'
import { privateImageMime } from '../supabase/functions/game-engine/images.ts'
import { nonce } from '../supabase/functions/room-system/crypto.ts'
import { readEnvironment } from './check-supabase.mjs'
import { readSupabaseConfig } from '../src/lib/supabase-config.ts'
import { gameVerificationSql } from './make-game-verification.mjs'

const project = 'fgvajdnzrnptdjurhjfo'
const argumentsList = process.argv.slice(2)
const liveDirectory = argumentsList.length === 6 && argumentsList[3] === '--first-playable' && argumentsList[4] === '--resume-game' && /^\/tmp\/guess-who-phase6-cloud-[A-Za-z0-9]+$/.test(argumentsList[5]) ? argumentsList[5] : undefined
const setupDirectory = argumentsList.length === 6 && argumentsList[3] === '--first-playable' && argumentsList[4] === '--resume-setup' && /^\/tmp\/guess-who-phase6-cloud-[A-Za-z0-9]+$/.test(argumentsList[5]) ? argumentsList[5] : undefined
const release = argumentsList[3] === '--first-playable' && (argumentsList.length === 4 || !!setupDirectory || !!liveDirectory)
const resumeDirectory = argumentsList.length === 5 && argumentsList[3] === '--resume-qa' && /^\/tmp\/guess-who-phase6-cloud-[A-Za-z0-9]+$/.test(argumentsList[4]) ? argumentsList[4] : undefined
if (argumentsList.slice(0, 3).join(' ') !== `--allow-test-writes --project-ref ${project}` || !(argumentsList.length === 3 || resumeDirectory || release)) {
  console.log('BLOCKED: explicit --allow-test-writes and fixed --project-ref required; this tool creates real Cloud QA data.')
  process.exitCode = 2
} else {
  await main(resumeDirectory,setupDirectory,liveDirectory)
}

async function main(resumeDirectory,setupDirectory,liveDirectory) {
  const config = readSupabaseConfig(await readEnvironment())
  assert.equal(config.url, `https://${project}.supabase.co`)
  assert.equal((await readFile('supabase/.temp/project-ref', 'utf8')).trim(), project)
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright')
  const base = release ? 'https://chiamaureen.github.io/guess-who/' : 'http://localhost:5173/guess-who/'
  const origin = new URL(base).origin
  const artifacts = await mkdtemp('/tmp/guess-who-phase6-cloud-')
  await chmod(artifacts, 0o700)
  const recoveryDirectory=resumeDirectory??setupDirectory??liveDirectory
  const previous = recoveryDirectory ? JSON.parse(await readFile(`${recoveryDirectory}/results.json`, 'utf8')) : undefined
  const savedSessions = recoveryDirectory ? JSON.parse(await readFile(`${recoveryDirectory}/sessions.json`, 'utf8')).sessions : []
  if(liveDirectory) {
    assert.equal(previous.project,project)
    assert.equal(previous.result,'FAIL')
    assert.equal(previous.roomCodes.length,1)
    assert.ok(previous.completedQuestions>0&&previous.completedQuestions<15)
    assert.equal(previous.runtimeOrSecurityErrors,0)
    assert.equal(previous.questions.length,previous.completedQuestions)
    assert.ok(['host','player'].every(name=>savedSessions.some(session=>session.name===name)))
    assert.match(previous.roomCodes[0],/^[A-HJ-NP-Z2-9]{6}$/)
  }
  if(setupDirectory) {
    assert.equal(previous.project,project)
    assert.equal(previous.result,'FAIL')
    assert.equal(previous.completedQuestions,0)
    assert.equal(previous.roomCodes.length,0)
    assert.ok(savedSessions.some(session=>session.name==='host'&&session.storage['guess-who:v1:host-bootstrap']))
    assert.ok(savedSessions.every(session=>Object.keys(session.storage).every(key=>['guess-who:v1:host-bootstrap','guess-who:v1:host'].includes(key))))
  }
  if (resumeDirectory) {
    assert.equal(previous.project, project)
    assert.equal(previous.result, 'FAIL')
    assert.equal(previous.completedQuestions, 0)
    assert.equal(previous.roomCodes.length, 1)
    assert.match(previous.roomCodes[0], /^[A-HJ-NP-Z2-9]{6}$/)
    assert.ok(['host', 'player'].every(name => savedSessions.some(session => session.name === name)))
  }
  const label = previous?.label ?? `P6QA${new Date().toISOString().replace(/\D/g, '').slice(4, 14)}`
  const reviewed = JSON.parse(await readFile(release ? 'data/question-bank/prepared/phase9-english-release-v2-20261025/reviewed-bank.json' : 'data/question-bank/prepared/review-20261023/reviewed-bank.json', 'utf8')).entries
  const approvedImages = new Map(reviewed.map(entry => [entry.imageSha256, entry]))
  const names = new Set(reviewed.map(entry => entry.nameZh))
  const category = release ? '10000000-0000-4000-8000-000000000002' : '10000000-0000-4000-8000-000000000004'
  const selectedGroup = '20000000-0000-4000-8000-000000000003'
  const states = new Map()
  const images = new Map([['host', new Map()], ['player', new Map()]])
  const imageResponses = new Map([['host', new Map()], ['player', new Map()]])
  const pending = new Set()
  const errors = []
  const checks = liveDirectory ? previous.checks.filter(check=>check.result==='PASS') : []
  const questions = liveDirectory ? [...previous.questions] : []
  const pages = new Map()
  const contexts = []
  const roomCodes = []
  const consoleMessages = []
  const counters = { reads: 0, writes: 0 }
  const cli = promisify(execFile)
  let browser
  let stage = 'read-only baseline'
  let baseline
  let database
  let firstRoom
  let secondRoom
  let hostId
  let resumedQuestion
  let windowStarted = Date.now()
  let pauses = 0
  let rateResponses = 0
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  const count = action => counters[['get-room-state', 'get-game-state', 'get-question-image'].includes(action) ? 'reads' : 'writes']++
  const pause = async () => {
    console.log(JSON.stringify({ progress: 'Respecting Cloud rate limits; waiting 61 seconds', completedQuestions: questions.length }))
    await sleep(61000)
    counters.reads = 0; counters.writes = 0; windowStarted = Date.now(); pauses++
  }
  const pace = async (reads = 0, writes = 0) => {
    if (Date.now() - windowStarted >= 61000) { counters.reads = 0; counters.writes = 0; windowStarted = Date.now() }
    if (counters.reads + reads > 22 || counters.writes + writes > 22) await pause()
  }
  const checkpoint = async () => {
    const sessions = []
    for (const [name, page] of pages) {
      try { sessions.push({ name, storage: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('guess-who:v1:')))) }) } catch {}
    }
    await writeFile(`${artifacts}/sessions.json`, JSON.stringify({ project, label, sessions }), { mode: 0o600 })
  }
  const settle = async () => {
    while (pending.size) await Promise.all([...pending])
    assert.equal(errors.length, 0)
  }
  const check = async (name, operation) => {
    stage = name
    await operation()
    await settle()
    checks.push({ name, result: 'PASS' })
    await checkpoint()
  }
  const query = async (name, sql) => {
    const file = `${artifacts}/${name}.sql`
    await writeFile(file, sql, { mode: 0o600, flag: 'wx' })
    const { stdout } = await cli('npx', ['--no-install', 'supabase', 'db', 'query', '--linked', '--project-ref', project, '--file', file], { timeout: 150000, maxBuffer: 1048576 })
    return JSON.parse(stdout).rows
  }
  const credentials = async (page, code) => page.evaluate(roomCode => {
    const session = JSON.parse(localStorage.getItem(`guess-who:v1:room:${roomCode}`))
    const host = JSON.parse(localStorage.getItem('guess-who:v1:host'))
    return session.role === 'host' ? { 'x-host-credential': host.credential, 'x-room-token': session.token } : { 'x-player-session': session.token }
  }, code)
  const api = async (service, action, input, page, code, status = 200, errorCode) => {
    const read = ['get-room-state', 'get-game-state', 'get-question-image'].includes(action)
    await pace(read ? 1 : 0, read ? 0 : 1)
    const savedHeaders = await credentials(page, code)
    const headers = action === 'create-room' ? { 'x-host-credential': savedHeaders['x-host-credential'] } : savedHeaders
    for (let attempt = 0; attempt < 2; attempt++) {
      count(action)
      const response = await fetch(`${config.url}/functions/v1/${service}/${action}`, { method: 'POST', headers: { Origin: origin, apikey: config.publishableKey, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input), redirect: 'error', signal: AbortSignal.timeout(30000) })
      if (response.status === 429 && attempt === 0) {
        rateResponses++
        const seconds = Number(response.headers.get('Retry-After'))
        assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 600)
        await sleep(Math.max(61000, (seconds + 1) * 1000))
        counters.reads = 0; counters.writes = 0; windowStarted = Date.now()
        continue
      }
      assert.equal(response.status, status)
      const body = await response.json()
      if (errorCode) assert.equal(body.error?.code, errorCode)
      return body.data ?? body
    }
    throw new Error('Rate-limited API did not complete')
  }
  const inspect = async (name, response) => {
    const path = new URL(response.url()).pathname
    if (!path.startsWith('/functions/v1/')) return
    assert.ok(response.status() < 500)
    if (response.status() === 429) { rateResponses++; if (release) return; throw new Error('Unexpected browser rate limit; no automatic control retry') }
    if (!path.startsWith('/functions/v1/game-engine/') || response.status() !== 200) return
    if (path.endsWith('/get-question-image')) {
      const headers = response.headers()
      assert.equal(headers['content-type'], release ? 'image/webp' : 'image/png')
      assert.equal(headers['cache-control'], 'no-store')
      assert.equal(headers['content-disposition'], release ? 'inline; filename="photo.webp"' : 'inline; filename="photo.png"')
      const questionId = response.request().postDataJSON().questionId
      imageResponses.get(name).set(questionId, true)
    } else {
      const data = (await response.json()).data
      assert.ok(data?.room && data?.question !== undefined)
      assert.ok(!/gw_|credential|secret|token|_hash/i.test(JSON.stringify(data)))
      assert.equal(data.viewer.role, name)
      if (name === 'player' && data.question && !data.question.revealed) {
        assert.deepEqual(Object.keys(data.question).sort(), ['id', 'number', 'revealed'])
        assert.ok(!('historyRevision' in data))
        for (const entry of reviewed) assert.ok(!JSON.stringify(data).includes(entry.nameZh))
      }
      const previousState=states.get(name)
      if (release && previousState?.question && data.question && (previousState.question.number>data.question.number || previousState.question.id===data.question.id && previousState.question.revealed && !data.question.revealed || previousState.room.status==='finished' && data.room.status!=='finished')) return
      states.set(name, data)
    }
  }
  const pageFor = async name => {
    const context = await browser.newContext({ viewport: { width: name === 'host' ? 1440 : 390, height: 1000 } })
    contexts.push(context)
    const saved=savedSessions.find(session=>session.name===name)
    if (saved) await context.addInitScript(({storage,origin}) => {
      if (location.origin !== origin || localStorage.getItem('guess-who:qa-imported')) return
      for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value)
      localStorage.setItem('guess-who:qa-imported', '1')
    }, {storage:saved.storage,origin})
    const page = await context.newPage()
    page.setDefaultTimeout(release ? 120000 : 45000)
    page.on('pageerror', () => errors.push('browser runtime error'))
    page.on('console', message => consoleMessages.push(message.text()))
    page.on('request', request => { if (request.method() === 'POST' && request.url().startsWith(`${config.url}/functions/v1/`)) count(new URL(request.url()).pathname.split('/').at(-1)) })
    page.on('response', response => {
      if (!response.url().startsWith(config.url)) return
      const operation = inspect(name, response).catch(() => errors.push('Cloud response security, image or server validation failed'))
      pending.add(operation); operation.finally(() => pending.delete(operation))
    })
    pages.set(name, page)
    return page
  }
  const waitQuestion = async (page, number, revealed) => {
    await page.getByText(`QUESTION ${number} / 15 · ${revealed ? '已揭曉' : '尚未揭曉'}`, { exact: true }).waitFor()
    await page.locator(`.game-photo img[alt="第 ${number} 題人物照片"]`).waitFor()
    await page.waitForFunction(() => (document.querySelector('.game-photo img')?.naturalWidth ?? 0) > 0)
    await settle()
    const name = pages.get('host') === page ? 'host' : 'player'
    const questionId = states.get(name).question.id
    assert.ok(imageResponses.get(name).has(questionId))
    const bytes = Buffer.from(await page.evaluate(async () => {
      const source = document.querySelector('.game-photo img').src
      if (!source.startsWith('blob:')) throw new Error('Private image must use a Blob URL')
      return Array.from(new Uint8Array(await (await fetch(source)).arrayBuffer()))
    }))
    const digest = createHash('sha256').update(bytes).digest('hex')
    const expected = approvedImages.get(digest)
    assert.ok(expected && bytes.length <= (release ? 307200 : 131072))
    if(release) {
      assert.equal(privateImageMime(bytes),'image/webp')
      const metadata=await sharp(bytes).metadata()
      await sharp(bytes).stats()
      assert.ok(Math.max(metadata.width,metadata.height)<=1024)
      assert.ok(!metadata.exif&&!metadata.icc&&!metadata.xmp&&!metadata.orientation)
      images.get(name).set(questionId,digest)
      return
    }
    const chunks = []
    let offset = 8
    while (offset < bytes.length) { const size = bytes.readUInt32BE(offset); chunks.push(bytes.toString('ascii', offset + 4, offset + 8)); offset += size + 12 }
    assert.equal(offset, bytes.length)
    assert.deepEqual(chunks, ['IHDR', 'IDAT', 'IEND'])
    const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    assert.equal(decoded.info.width, expected.imageWidth)
    assert.equal(decoded.info.height, expected.imageHeight)
    images.get(name).set(questionId, digest)
  }
  const refreshPlayer = async (page, number, revealed) => {
    if(release) { await page.bringToFront(); await waitQuestion(page,number,revealed); return }
    await pace(3)
    const button = page.getByRole('button', { name: '重新取得遊戲狀態', exact: true })
    await button.waitFor()
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === '重新取得遊戲狀態' && !button.disabled))
    await button.click()
    await waitQuestion(page, number, revealed)
  }
  const reloadBoth = async (host, player, number, revealed, finished = false) => {
    const questionId = states.get('host').question.id
    for (const [name, page] of [['host', host], ['player', player]]) {
      await pace(8)
      const before = await credentials(page, firstRoom)
      await page.reload()
      if (finished) {
        await page.locator('[data-sync-status="stopped"]').waitFor()
        assert.equal(await page.locator('.game-panel.lobby-panel').count(), 0)
      } else await waitQuestion(page, number, revealed)
      assert.deepEqual(await credentials(page, firstRoom), before)
      assert.equal(states.get(name).question.id, questionId)
      assert.equal(states.get(name).question.revealed, revealed)
    }
  }
  try {
    const tables = ['categories', 'celebrities', 'celebrity_categories', 'game_image_assets', 'hosts', 'rooms', 'room_categories', 'room_players', 'room_questions', 'host_question_history', ...(release?['question_groups','celebrity_question_groups','room_question_groups']:[])]
    const countsSql = tables.map(table => `'${table}',(SELECT count(*) FROM public.${table})`).join(',')
    await check('read-only target, bank and existing-data baseline', async () => {
      baseline = (await query('baseline', `BEGIN READ ONLY; SELECT jsonb_build_object(${countsSql}) AS counts, (SELECT count(DISTINCT celebrity.id) FROM public.celebrities AS celebrity JOIN public.celebrity_categories AS membership ON membership.celebrity_id=celebrity.id JOIN public.categories AS category ON category.id=membership.category_id AND category.is_active WHERE category.id='${category}' AND celebrity.is_approved AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id=celebrity.id AND asset.is_approved)) AS eligible; ROLLBACK;`))[0]
      assert.equal(Number(baseline.eligible), 15)
      if(setupDirectory||liveDirectory) baseline=previous.baseline
    })
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const host = await pageFor('host')
    const player = await pageFor('player')
    if(liveDirectory) await check('resume same authorized QA room and sessions; verify immutable earlier question/image receipts; no reset or new room',async()=>{
      firstRoom=previous.roomCodes[0]
      roomCodes.push(firstRoom)
      for(const page of [host,player]) await page.goto(`${base}#/room/${firstRoom}`)
      await host.getByRole('region',{name:'遊戲區域'}).waitFor()
      const current=await api('game-engine','get-game-state',{roomCode:firstRoom},host,firstRoom)
      assert.equal(current.room.status,'playing')
      assert.ok(current.question.number===previous.completedQuestions+1)
      assert.equal(current.question.revealed,true)
      resumedQuestion=current.question.number
      const prior=await query('resumed-questions',`BEGIN READ ONLY; SELECT question.id,question.question_number AS number,question.revealed_at IS NOT NULL AS revealed,encode(sha256(asset.png),'hex') AS image_sha256 FROM public.room_questions AS question JOIN public.rooms AS room ON room.id=question.room_id JOIN public.game_image_assets AS asset ON asset.id=question.game_image_id WHERE room.room_code='${firstRoom}' ORDER BY question.question_number; ROLLBACK;`)
      assert.equal(prior.length,resumedQuestion)
      for(const row of prior) {
        assert.ok(approvedImages.has(row.image_sha256))
        assert.equal(row.revealed,true)
        if(row.number<=previous.completedQuestions) {
          assert.equal(previous.questions[row.number-1].id,row.id)
          images.get('host').set(row.id,row.image_sha256)
          images.get('player').set(row.id,row.image_sha256)
        }
      }
      await waitQuestion(host,resumedQuestion,true)
      await refreshPlayer(player,resumedQuestion,true)
      assert.equal(states.get('host').question.id,states.get('player').question.id)
      assert.equal(states.get('host').question.answer,states.get('player').question.answer)
      assert.equal(images.get('host').get(current.question.id),images.get('player').get(current.question.id))
      assert.ok(previous.distinctHostImages>=resumedQuestion&&previous.distinctPlayerImages>=resumedQuestion)
      questions.push({id:current.question.id,number:resumedQuestion,hiddenPlayerKeys:['id','number','revealed'],hostAndPlayerImage:'PASS',revealedAnswerMatches:true,resumedAfterReveal:true,priorProof:'Prior run reached the protected reveal only after its unrevealed DTO/image assertions; interrupted before final question checkpoint. Earlier PASS receipts retained, failed attempt remains in original file.'})
      hostId=await host.evaluate(()=>JSON.parse(localStorage.getItem('guess-who:v1:host')).hostId)
      assert.equal(await player.evaluate(()=>localStorage.getItem('guess-who:v1:host')),null)
      await host.getByRole('button',{name:'下一題',exact:true}).click()
      await waitQuestion(host,resumedQuestion+1,false)
    })
    else if (resumeDirectory) await check('resume only existing authorized QA Host and Player at unrevealed question1; no new identity or first room', async () => {
      firstRoom = previous.roomCodes[0]
      roomCodes.push(firstRoom)
      for (const page of [host, player]) await page.goto(`${base}#/room/${firstRoom}`)
      await waitQuestion(host, 1, false)
      await waitQuestion(player, 1, false)
      assert.equal(states.get('host').room.status, 'playing')
      hostId = await host.evaluate(() => JSON.parse(localStorage.getItem('guess-who:v1:host')).hostId)
      assert.equal(await player.evaluate(() => localStorage.getItem('guess-who:v1:host')), null)
    })
    else await check(`new anonymous Host creates ${release ? 'English-singers group' : 'political-only'} room; independent Player joins via invitation`, async () => {
      await host.goto(`${base}#/host`)
      const selection = host.getByRole('checkbox', { name: release ? /英語歌手/ : '政治人物' })
      await selection.waitFor()
      if(release) {
        assert.equal(await host.getByRole('checkbox').count(),8)
        assert.equal(await host.locator('input[type=checkbox]:disabled').count(),7)
        assert.equal(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      }
      await selection.check()
      assert.equal(await host.getByRole('checkbox', { checked: true }).count(), 1)
      await host.getByRole('button', { name: '建立房間', exact: true }).click()
      await host.getByRole('button', { name: '開始遊戲', exact: true }).waitFor()
      firstRoom = new URL(host.url()).hash.split('/').at(-1)
      assert.match(firstRoom, /^[A-HJ-NP-Z2-9]{6}$/)
      roomCodes.push(firstRoom)
      hostId = await host.evaluate(() => JSON.parse(localStorage.getItem('guess-who:v1:host')).hostId)
      const invite = await host.getByLabel('玩家邀請連結').inputValue()
      assert.equal(new URL(invite).hash, `#/room/${firstRoom}`)
      assert.ok(!/gw_|credential|token|session/i.test(invite))
      await player.goto(invite)
      await player.getByLabel('你的暱稱').fill(`${label}-P`)
      await player.getByRole('button', { name: '加入房間', exact: true }).click()
      await player.getByRole('region', { name: '遊戲區域' }).getByText(release ? '等待主持人開始遊戲，畫面將自動同步。' : '等待主持人開始遊戲，請手動更新狀態。', { exact: true }).waitFor()
      if(release) {
        await host.getByText(`${label}-P`,{exact:true}).waitFor()
        assert.equal(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      }
      assert.equal(await player.evaluate(() => localStorage.getItem('guess-who:v1:host')), null)
    })
    if(!liveDirectory) await check('Player cannot start; Host starts actual question1 with private answer', async () => {
      await api('game-engine', 'start-game', { roomCode: firstRoom }, player, firstRoom, 403, 'FORBIDDEN')
      if (!resumeDirectory) {
        await pace(2, 1)
        await host.getByRole('button', { name: '開始遊戲', exact: true }).click()
        await waitQuestion(host, 1, false)
      }
      assert.equal(states.get('host').room.status, 'playing')
      const state = await api('game-engine', 'get-game-state', { roomCode: firstRoom }, host, firstRoom)
      assert.ok(names.has(state.question.answer))
    })
    for (let number = liveDirectory ? resumedQuestion+1 : 1; number <= 15; number++) {
      await check(`question ${number}: private images, answer isolation, reveal and progress`, async () => {
        await waitQuestion(host, number, false)
        await refreshPlayer(player, number, false)
        const state = states.get('host')
        const question = state.question
        assert.ok(names.has(question.answer))
        assert.equal(states.get('player').question.id, question.id)
        assert.equal(await player.locator('.game-answer h3').count(), 0)
        assert.equal(await player.getByRole('button', { name: '揭曉答案', exact: true }).count(), 0)
        assert.equal(images.get('host').get(question.id), images.get('player').get(question.id))
        assert.ok(images.get('host').has(question.id))
        assert.ok(!questions.some(previous => previous.id === question.id))
        if (number === 1) {
          await api('game-engine', 'next-question', { roomCode: firstRoom, questionId: question.id }, host, firstRoom, 409, 'ANSWER_NOT_REVEALED')
          for (const action of ['reveal-answer', 'next-question', 'finish-game']) await api('game-engine', action, { roomCode: firstRoom, questionId: question.id }, player, firstRoom, 403, 'FORBIDDEN')
          await reloadBoth(host, player, number, false)
        }
        await pace(0, 1)
        await host.getByRole('button', { name: '揭曉答案', exact: true }).click()
        await waitQuestion(host, number, true)
        await refreshPlayer(player, number, true)
        assert.equal(states.get('player').question.answer, question.answer)
        assert.equal(await player.locator('.game-answer h3').textContent(), question.answer)
        assert.ok(states.get('player').question.attribution?.source)
        if (number === 1) await reloadBoth(host, player, number, true)
        questions.push({ id: question.id, number, hiddenPlayerKeys: ['id', 'number', 'revealed'], hostAndPlayerImage: 'PASS', revealedAnswerMatches: true })
        if (number < 15) {
          await pace(2, 1)
          await host.getByRole('button', { name: '下一題', exact: true }).click()
          await waitQuestion(host, number + 1, false)
          if (number === 1) {
            const duplicate = await api('game-engine', 'next-question', { roomCode: firstRoom, questionId: question.id }, host, firstRoom)
            assert.equal(duplicate.question.number, 2)
            assert.equal(duplicate.question.id, states.get('host').question.id)
            await api('game-engine', 'reveal-answer', { roomCode: firstRoom, questionId: question.id }, host, firstRoom, 409, 'STALE_STATE')
          }
        }
      })
      console.log(JSON.stringify({ progress: 'Question passed', number, total: 15 }))
      if (number === 8) await pause()
    }
    await check('question15 cannot advance to16; Host finishes and closes first room', async () => {
      assert.equal(await host.getByRole('button', { name: '下一題', exact: true }).isDisabled(), true)
      const questionId = states.get('host').question.id
      await api('game-engine', 'next-question', { roomCode: firstRoom, questionId }, host, firstRoom, 409, 'LAST_QUESTION')
      await pace(0, 1)
      await host.getByRole('button', { name: '結束遊戲', exact: true }).click()
      await host.getByRole('button', { name: '確認結束遊戲', exact: true }).click()
      await host.getByRole('heading', { name: '房間已結束', exact: true }).waitFor()
      assert.equal(await host.locator('.game-panel.lobby-panel').count(), 0)
      await reloadBoth(host, player, 15, true, true)
      assert.equal(states.get('host').room.status, 'finished')
      assert.equal(states.get('player').room.status, 'finished')
      const closed = await api('room-system', 'close-room', { roomCode: firstRoom }, host, firstRoom)
      assert.equal(closed.room.status, 'finished')
      assert.equal(new Set(images.get('host').values()).size, 15)
      assert.equal(new Set(images.get('player').values()).size, 15)
    })
    if(release) await check('same Host sees exhausted group disabled; direct grouped creation rejected before creating another room; history never reset',async()=>{
      await pace(3,1)
      await host.goto(`${base}#/host`)
      const selection=host.getByRole('checkbox',{name:/英語歌手/})
      await selection.waitFor()
      assert.equal(await selection.isDisabled(),true)
      assert.equal(await host.getByRole('button',{name:'建立房間',exact:true}).isDisabled(),true)
      const rejected=await api('room-system','create-room',{groupIds:[selectedGroup],requestKey:nonce()},host,firstRoom,409,'INSUFFICIENT_QUESTIONS')
      assert.equal(rejected.error.code,'INSUFFICIENT_QUESTIONS')
    })
    else await check('same Host second political room cannot start; close waiting room without resetting history', async () => {
      await pace(5, 2)
      await host.goto(`${base}#/host`)
      await host.getByRole('checkbox', { name: '政治人物' }).check()
      await host.getByRole('button', { name: '建立房間', exact: true }).click()
      await host.getByRole('button', { name: '開始遊戲', exact: true }).waitFor()
      secondRoom = new URL(host.url()).hash.split('/').at(-1)
      assert.match(secondRoom, /^[A-HJ-NP-Z2-9]{6}$/)
      assert.notEqual(secondRoom, firstRoom)
      roomCodes.push(secondRoom)
      assert.equal(await host.evaluate(() => JSON.parse(localStorage.getItem('guess-who:v1:host')).hostId), hostId)
      await pace(0, 1)
      const rejected = host.waitForResponse(response => response.url().endsWith('/game-engine/start-game') && response.status() === 409)
      await host.getByRole('button', { name: '開始遊戲', exact: true }).click()
      assert.equal((await (await rejected).json()).error.code, 'INSUFFICIENT_QUESTIONS')
      await host.getByRole('alert').filter({ hasText: '可用人物不足 15 位' }).waitFor()
      assert.equal(states.get('host').room.currentQuestion, 0)
      assert.equal(states.get('host').room.status, 'waiting')
      await pace(0, 1)
      await host.getByRole('button', { name: '關閉房間', exact: true }).click()
      await host.getByRole('button', { name: '確認關閉房間', exact: true }).click()
      await host.getByText('主持人已關閉房間，不能再加入。', { exact: true }).waitFor()
      await pace(5)
      await host.reload()
      await host.getByText('主持人已關閉房間，不能再加入。', { exact: true }).waitFor()
    })
    await check('Cloud read-only questions, distinct people, history and exact permitted row deltas', async () => {
      const first = await query('first-game-verifier', gameVerificationSql(firstRoom))
      assert.equal(Number(first[0].questions), 15)
      assert.equal(Number(first[0].distinct_people), 15)
      assert.equal(Number(first[0].host_history_count), 15)
      const deltas = release ? {hosts:1,rooms:1,room_categories:1,room_question_groups:1,room_players:1,room_questions:15,host_question_history:15} : previous ? { rooms: 1, room_categories: 1, room_questions: 14, host_question_history: 14 } : { hosts: 1, rooms: 2, room_categories: 2, room_players: 1, room_questions: 15, host_question_history: 15 }
      const guards = tables.map(table => `IF (SELECT count(*) FROM public.${table}) <> ${Number(baseline.counts[table]) + (deltas[table] ?? 0)} THEN RAISE EXCEPTION 'Unexpected ${table} row count'; END IF;`).join('\n')
      const second = await query('final-integrity', release ? `BEGIN READ ONLY; DO $verify$ BEGIN ${guards} END; $verify$; SELECT jsonb_build_object(${countsSql}) AS counts; ROLLBACK;` : `BEGIN READ ONLY; DO $verify$ DECLARE first_room public.rooms; second_room public.rooms; BEGIN SELECT * INTO STRICT first_room FROM public.rooms WHERE room_code='${firstRoom}'; SELECT * INTO STRICT second_room FROM public.rooms WHERE room_code='${secondRoom}'; IF first_room.host_id <> second_room.host_id OR second_room.status <> 'finished' OR second_room.current_question <> 0 OR second_room.ended_at IS NULL OR first_room.ended_at IS NULL THEN RAISE EXCEPTION 'QA room ownership, close or second-room progress mismatch'; END IF; IF EXISTS (SELECT 1 FROM public.room_questions WHERE room_id=second_room.id) THEN RAISE EXCEPTION 'Refused game still created questions'; END IF; ${guards} END; $verify$; SELECT jsonb_build_object(${countsSql}) AS counts; ROLLBACK;`)
      database = { firstGame: first[0], finalCounts: second[0].counts, permittedDeltas: deltas, result: 'PASS' }
    })
    await check('no credentials in browser console and no runtime/server/security failures', async () => {
      for (const [pageName, page] of pages) {
        const header = await credentials(page, pageName === 'host' && !release ? secondRoom : firstRoom)
        for (const value of Object.values(header)) assert.ok(!consoleMessages.some(message => message.includes(value)))
      }
      assert.equal(errors.length, 0)
    })
  } catch (cause) {
    const locations=String(cause?.stack??'').split('\n').filter(line=>/^\s+at .*check-game-cloud\.mjs:\d+:\d+\)?$/.test(line)).map(line=>line.match(/check-game-cloud\.mjs:\d+:\d+/)[0])
    const countMismatch=String(cause?.stderr??'').match(/Unexpected (categories|celebrities|celebrity_categories|game_image_assets|hosts|rooms|room_categories|room_players|room_questions|host_question_history|question_groups|celebrity_question_groups|room_question_groups) row count/)
    checks.push({ name: stage, result: 'FAIL', failureType:cause?.name,locations, ...(countMismatch?{reason:'GLOBAL_ROW_COUNT_MISMATCH',table:countMismatch[1]}:{}), details: 'Stopped; raw errors, bodies, answers and credentials withheld. No reset, cleanup, alternate write or redeploy.' })
    for(const [name,page] of pages) {
      await page.screenshot({path:`${artifacts}/${name}-failure.png`,fullPage:true}).catch(()=>undefined)
      const diagnostic=await page.evaluate(()=>({visibility:document.visibilityState,online:navigator.onLine,sync:document.querySelector('[data-sync-status]')?.getAttribute('data-sync-status'),question:Array.from(document.querySelectorAll('.eyebrow')).map(node=>node.textContent).find(text=>text.includes('QUESTION')),imageLoaded:!!document.querySelector('.game-photo img')?.naturalWidth})).catch(()=>({unavailable:true}))
      await writeFile(`${artifacts}/${name}-diagnostic.json`,JSON.stringify(diagnostic),{mode:0o600})
    }
    process.exitCode = 1
  } finally {
    await checkpoint().catch(() => undefined)
    const result = { project, label, result: checks.some(check => check.result === 'FAIL') ? 'FAIL' : 'PASS', completedAt: new Date().toISOString(), browser: browser?.version(), backend: 'Real Supabase Cloud Edge Functions and PostgreSQL; actual Host/Player Chrome contexts; no fixture, mock, interception or request redirection', resumedFrom: recoveryDirectory, baseline, roomCodes, completedQuestions: questions.length, distinctHostImages: new Set(images.get('host').values()).size, distinctPlayerImages: new Set(images.get('player').values()).size, checks, questions, database, rateLimitPauses: pauses, rateLimitResponses: rateResponses, runtimeOrSecurityErrors: errors.length, credentials: 'Only owner-private temporary sessions.json; never printed or stored in Repository', artifacts }
    await writeFile(`${artifacts}/results.json`, JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ ...result, questions: undefined }, null, 2))
    await Promise.all(contexts.map(context => context.close()))
    await browser?.close()
  }
}
