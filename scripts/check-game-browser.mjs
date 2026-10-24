import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { startBrowserFixture } from '../supabase/tests/browser-fixture.mjs'

const base=process.env.QA_BASE_URL ?? 'http://127.0.0.1:5177/guess-who/'
const origin=new URL(base).origin
const artifacts=process.env.QA_ARTIFACTS ?? '/tmp/guess-who-phase6-browser'
await mkdir(artifacts,{recursive:true})
let chromium
try {({chromium}=await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'))}
catch {console.log('BLOCKED: Playwright unavailable; no browser checks passed.');process.exitCode=2}
if(chromium) {
  const fixture=await startBrowserFixture({port:0,origin,gamePeople:30})
  let browser
  const contexts=[]
  const checks=[]
  const runtimeErrors=[]
  const playerPayloads=[]
  let reads=0
  let windowStarted=Date.now()
  let dropNext=true
  let code
  let invite
  let firstQuestion
  const check=async(name,operation)=>{
    if(reads>=18) {
      const wait=Math.max(0,61000-(Date.now()-windowStarted))
      if(wait) await new Promise(resolve=>setTimeout(resolve,wait))
      reads=0;windowStarted=Date.now()
    }
    try {await operation();checks.push({name,result:'PASS'})}
    catch {checks.push({name,result:'FAIL'});throw new Error('Browser check failed')}
  }
  const pageFor=async label=>{
    const context=await browser.newContext({viewport:{width:1440,height:1000}})
    contexts.push(context)
    await context.route(/^https:\/\/[a-z0-9]{20}\.supabase\.co\//,async route=>{
      const request=route.request()
      const url=new URL(request.url())
      if(url.pathname==='/rest/v1/categories') return route.fulfill({response:await route.fetch({url:`${fixture.url}/categories`,headers:{origin}})})
      if(!/^\/functions\/v1\/(room-system|game-engine)\//.test(url.pathname)) throw new Error('Unexpected external API call')
      if(/\/(get-room-state|get-game-state|get-question-image|get-realtime-ticket)$/.test(url.pathname)) reads++
      const headers={...request.headers(),origin,apikey:'sb_publishable_fixture'}
      delete headers.authorization
      const response=await route.fetch({url:`${fixture.url}${url.pathname}`,headers})
      if(label==='player' && url.pathname.endsWith('/get-game-state')) playerPayloads.push(await response.json())
      if(label==='host' && dropNext && url.pathname.endsWith('/next-question')) {dropNext=false;return route.abort('failed')}
      return route.fulfill({response})
    })
    const page=await context.newPage()
    page.setDefaultTimeout(90000)
    page.on('pageerror',()=>runtimeErrors.push('runtime error'))
    return page
  }
  try {
    browser=await chromium.launch({channel:'chrome',headless:true})
    const host=await pageFor('host')
    const player=await pageFor('player')
    await check('Host creates room with two categories; Player joins using code-only invitation',async()=>{
      await host.goto(`${base}#/host`)
      await host.getByRole('checkbox').nth(0).check();await host.getByRole('checkbox').nth(1).check()
      await host.getByRole('button',{name:'建立房間',exact:true}).click()
      await host.getByRole('button',{name:'開始遊戲',exact:true}).waitFor()
      invite=await host.getByLabel('玩家邀請連結').inputValue()
      code=new URL(invite).hash.split('/').at(-1)
      assert.ok(!/token|gw_|credential/.test(invite))
      await player.goto(invite)
      await player.getByLabel('你的暱稱').fill('Phase6 玩家')
      await player.getByRole('button',{name:'加入房間',exact:true}).click()
      await player.getByRole('region',{name:'遊戲區域'}).getByText('等待主持人開始遊戲，畫面將自動同步。',{exact:true}).waitFor()
    })
    await check('Host starts question1, sees name and private binary image; Player has no controls',async()=>{
      await host.getByRole('button',{name:'開始遊戲',exact:true}).click()
      await host.locator('.game-answer h3').waitFor()
      await host.waitForFunction(()=>document.querySelector('.game-photo img')?.naturalWidth===32)
      firstQuestion=await host.locator('.game-photo img').getAttribute('alt')
      assert.equal(firstQuestion,'第 1 題人物照片')
      assert.equal(await host.getByRole('button',{name:'下一題',exact:true}).isDisabled(),true)
      for(const name of ['開始遊戲','揭曉答案','下一題','提前結束遊戲','重置我的出題歷史']) assert.equal(await player.getByRole('button',{name,exact:true}).count(),0)
    })
    await check('Player manually retrieves photo but no hidden answer, source, metadata or celebrity ID',async()=>{
      await player.getByRole('button',{name:'重新取得遊戲狀態',exact:true}).click()
      await player.waitForFunction(()=>document.querySelector('.game-photo img')?.naturalWidth===32)
      assert.equal(await player.locator('.game-answer h3').count(),0)
      const payload=playerPayloads.at(-1).data
      assert.deepEqual(Object.keys(payload.question).sort(),['id','number','revealed'])
      assert.ok(!/隔離測試人物|SECRET-NAME|PRIVATE ANSWER|attribution|celebrity|history|hash|gw_/.test(JSON.stringify(payload)))
      assert.ok((await player.locator('.game-photo img').getAttribute('src')).startsWith('blob:'))
    })
    await check('Host reload keeps question1, answer, image and room control',async()=>{
      const answer=await host.locator('.game-answer h3').textContent()
      await host.reload()
      await host.locator('.game-answer h3').waitFor()
      assert.equal(await host.locator('.game-answer h3').textContent(),answer)
      assert.equal(await host.locator('.game-photo img').getAttribute('alt'),firstQuestion)
      assert.equal(await host.getByRole('button',{name:'揭曉答案',exact:true}).isEnabled(),true)
    })
    await check('Player reload keeps own session and question1 without revealing the name',async()=>{
      await player.reload();await player.locator('.game-photo img').waitFor()
      assert.equal(await player.locator('.game-photo img').getAttribute('alt'),firstQuestion)
      assert.equal(await player.locator('.game-answer h3').count(),0)
    })
    await check('Host reveal enables Next; Player obtains answer and attribution only after refresh',async()=>{
      await host.getByRole('button',{name:'揭曉答案',exact:true}).click()
      await host.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='下一題' && !button.disabled))
      await player.getByRole('button',{name:'重新取得遊戲狀態',exact:true}).click()
      await player.locator('.game-answer h3').waitFor()
      assert.equal(await player.locator('.game-answer h3').textContent(),await host.locator('.game-answer h3').textContent())
      assert.ok(playerPayloads.at(-1).data.question.attribution)
    })
    await check('revealed answer and same question survive both Host and Player reload',async()=>{
      const answer=await host.locator('.game-answer h3').textContent()
      for(const page of [host,player]) {
        await page.reload();await page.locator('.game-answer h3').waitFor()
        assert.equal(await page.locator('.game-answer h3').textContent(),answer)
        assert.equal(await page.locator('.game-photo img').getAttribute('alt'),'第 1 題人物照片')
      }
    })
    await check('lost Next HTTP response retries original question identity and advances only to question2',async()=>{
      await host.getByRole('button',{name:'下一題',exact:true}).click()
      await host.getByRole('alert').filter({hasText:'連線失敗'}).waitFor()
      await host.getByRole('button',{name:'下一題',exact:true}).click()
      await host.getByText('QUESTION 2 / 15 · 尚未揭曉',{exact:true}).waitFor()
      assert.equal(await host.getByRole('button',{name:'下一題',exact:true}).isDisabled(),true)
      const button=player.getByRole('button',{name:'重新取得遊戲狀態',exact:true})
      await button.waitFor();await button.click()
      await player.getByText('QUESTION 2 / 15 · 尚未揭曉',{exact:true}).waitFor()
      assert.equal(await player.locator('.game-answer h3').count(),0)
    })
    for(const width of [320,375,390,768,1024,1440]) for(const [page,label] of [[host,'host'],[player,'player']]) await check(`playing ${label} RWD ${width}px`,async()=>{
      await page.setViewportSize({width,height:1000})
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
      if([375,1440].includes(width)) await page.screenshot({path:`${artifacts}/${label}-${width}.png`,fullPage:true})
    })
    await check('early finish requires confirmation and hides the entire game panel for Host and Player',async()=>{
      await host.getByRole('button',{name:'提前結束遊戲',exact:true}).click()
      await host.getByRole('button',{name:'確認結束遊戲',exact:true}).click()
      for(const page of [host,player]) {
        await page.getByRole('heading',{name:'房間已結束',exact:true}).waitFor()
        assert.equal(await page.locator('.game-panel.lobby-panel').count(),0)
        assert.equal(await page.locator('.game-photo, .game-answer').count(),0)
      }
    })
    await check('finished panels stay hidden after reload; history reset remains available in a new waiting room',async()=>{
      for(const page of [host,player]) {
        await page.reload()
        await page.getByRole('heading',{name:'房間已結束',exact:true}).waitFor()
        assert.equal(await page.locator('.game-panel.lobby-panel').count(),0)
      }
      assert.equal(await player.locator('.self-label').count(),1)
      assert.equal(new URL(player.url()).hash,`#/room/${code}`)
      await host.goto(`${base}#/host`)
      await host.getByRole('checkbox').first().check()
      await host.getByRole('button',{name:'建立房間',exact:true}).click()
      await host.getByRole('button',{name:'重置我的出題歷史',exact:true}).click()
      await host.getByRole('button',{name:'確認重置我的歷史',exact:true}).click()
      await host.getByText('你的出題歷史已重置。',{exact:true}).waitFor()
      await player.reload()
      await player.getByRole('heading',{name:'房間已結束',exact:true}).waitFor()
      assert.equal(await player.locator('.game-panel.lobby-panel').count(),0)
    })
    await check('browser has no runtime errors',async()=>assert.deepEqual(runtimeErrors,[]))
  } catch {
    if(!checks.some(check=>check.result==='FAIL')) checks.push({name:'browser setup',result:'FAIL'})
    for(const [index,context] of contexts.entries()) for(const page of context.pages()) await page.screenshot({path:`${artifacts}/failure-${index}.png`,fullPage:true}).catch(()=>undefined)
  } finally {
    const results={browser:browser?.version(),backend:'real local Fetch handlers + isolated PostgreSQL fixtures, NOT Cloud',cloudRequests:0,passed:checks.filter(check=>check.result==='PASS').length,failed:checks.filter(check=>check.result==='FAIL'),checks,runtimeErrors,artifacts}
    await writeFile(`${artifacts}/results.json`,JSON.stringify(results,null,2))
    console.log(JSON.stringify({...results,checks:undefined},null,2))
    await Promise.all(contexts.map(context=>context.close()));await browser?.close();await fixture.close()
    if(results.failed.length) process.exitCode=1
  }
}
