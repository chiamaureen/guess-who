import { readFile,mkdir,writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { publicMetadata,commonsQuery } from './lib/commons-images.mjs'
const group=process.argv[2]??'english-singers'
if(!['english-singers','athletes'].includes(group)) throw new Error('Unsupported source-review group')
const supplemental=process.argv.includes('--supplemental')
const final=process.argv.includes('--final')
const directory=`data/question-bank/prepared/phase9-pd-search-${group}-${final?'final':supplemental?'supplemental':'broad'}-20261025`
await mkdir(directory,{mode:0o700})
const bank=JSON.parse(await readFile('data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/candidates.json','utf8'))
const results=[]
const additions=(final?['Cyndi Lauper','Diana Ross','Demi Lovato']:['Stevie Wonder','Aretha Franklin','John Legend','Usher','James Taylor','Diana Ross','Paul McCartney','Bob Dylan']).map(name=>({identityKey:name.toLowerCase().replaceAll(' ','-'),nameZh:name,nameOriginal:name}))
for(const entry of supplemental||final?additions:bank.entries.filter(entry=>entry.group===group)) {
  const data=await publicMetadata(commonsQuery({generator:'search',gsrsearch:`"${entry.nameOriginal}" ${supplemental?'"White House" ':''}filetype:bitmap`,gsrnamespace:'6',gsrlimit:supplemental?'8':'20',prop:'imageinfo|revisions',iiprop:'url|size|sha1|extmetadata',rvprop:'ids|content',rvslots:'main'}))
  results.push({identityKey:entry.identityKey,name:entry.nameZh,qid:entry.wikidataId,pages:data.query?.pages??[],approved:false})
  await writeFile(`${directory}/sources.json`,JSON.stringify(results,null,2),{mode:0o600})
  console.log(JSON.stringify({name:entry.nameZh,pdCandidates:(data.query?.pages??[]).filter(page=>page.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value==='Public domain').map(page=>page.title)}))
  await delay(1500)
}
