import { execFileSync } from 'node:child_process'
import { readEnvironment } from './check-supabase.mjs'
import { readSupabaseConfig } from '../src/lib/supabase-config.ts'

const repository='chiamaureen/guess-who'
const base=`https://api.github.com/repos/${repository}`
const mode=process.argv[2]
if(!['--check','--dispatch','--status','--runs'].includes(mode)) throw new Error('Explicit --check, --dispatch COMMIT, --runs COMMIT or --status RUN_ID required')
try {
  const raw=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',stdio:['pipe','pipe','ignore'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})
  const password=raw.split('\n').find(line=>line.startsWith('password='))?.slice(9)
  if(!password) throw new Error('GITHUB_AUTH_UNAVAILABLE')
  const api=async(path,options={})=>{
    const response=await fetch(`${base}${path}`,{...options,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${password}`,'X-GitHub-Api-Version':'2022-11-28',...(options.body?{'Content-Type':'application/json'}:{})}})
    if(!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`)
    return response.status===204?null:response.json()
  }
  if(mode==='--runs') {
    const sha=process.argv[3]
    if(!/^[0-9a-f]{40}$/.test(sha??'')) throw new Error('INVALID_COMMIT')
    const runs=await api(`/actions/workflows/pages.yml/runs?event=workflow_dispatch&head_sha=${sha}&per_page=5`)
    console.log(JSON.stringify({runs:runs.workflow_runs.map(run=>({id:run.id,sha:run.head_sha,status:run.status,conclusion:run.conclusion,url:run.html_url}))}))
  } else if(mode==='--status') {
    const runId=process.argv[3]
    if(!/^\d+$/.test(runId??'')) throw new Error('INVALID_RUN_ID')
    const run=await api(`/actions/runs/${runId}`)
    const jobs=await api(`/actions/runs/${runId}/jobs`)
    console.log(JSON.stringify({id:run.id,sha:run.head_sha,status:run.status,conclusion:run.conclusion,url:run.html_url,jobs:jobs.jobs.map(job=>({name:job.name,status:job.status,conclusion:job.conclusion}))}))
    if(run.status==='completed'&&run.conclusion!=='success') process.exitCode=1
  } else {
    const config=readSupabaseConfig(await readEnvironment())
    const repo=await api('')
    const pages=await api('/pages')
    const variables=await api('/actions/variables')
    const workflow=await api('/actions/workflows/pages.yml')
    const branch=await api('/git/ref/heads/main')
    if(repo.private||pages.build_type!=='workflow'||pages.cname||pages.html_url!=='https://chiamaureen.github.io/guess-who/'||workflow.state!=='active'
      ||variables.variables.find(variable=>variable.name==='VITE_SUPABASE_URL')?.value!==config.url
      ||variables.variables.find(variable=>variable.name==='VITE_SUPABASE_PUBLISHABLE_KEY')?.value!==config.publishableKey) throw new Error('PAGES_CONFIGURATION_MISMATCH')
    if(mode==='--check') console.log(JSON.stringify({result:'PASS',repository,remoteCommit:branch.object.sha,url:pages.html_url,variables:['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY'],secretValues:'WITHHELD',cloudWrites:0}))
    else {
      const sha=process.argv[3]
      const local=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
      if(!/^[0-9a-f]{40}$/.test(sha??'')||sha!==local||sha!==branch.object.sha) throw new Error('UNREVIEWED_OR_UNPUSHED_COMMIT')
      const dispatched=await api('/actions/workflows/pages.yml/dispatches',{method:'POST',body:JSON.stringify({ref:'main'})})
      console.log(JSON.stringify({result:'DISPATCHED',sha,runId:dispatched?.workflow_run_id,url:pages.html_url,next:'Inspect workflow runs; do not dispatch again if the run is not immediately visible.'}))
    }
  }
} catch(error) {
  console.error(`BLOCKED: ${/^GITHUB_HTTP_\d+$|^[A-Z_]+$/.test(error.message)?error.message:'GitHub authorization or release preflight failed; credentials redacted'}`)
  process.exitCode=2
}
