import { readFile,mkdir,writeFile } from 'node:fs/promises'
import { randomUUID,createHash } from 'node:crypto'
import sharp from 'sharp'
import { downloadCommonsImage,publicMetadata } from './lib/commons-images.mjs'
import { normalizeQuestionWebp } from './lib/question-images.mjs'

const root='data/question-bank/prepared/phase9-english-pd-20261025'
const extra='data/question-bank/prepared/phase9-english-pd-extra-20261025'
const output='data/question-bank/prepared/phase9-english-release-v2-20261025'
await mkdir(`${output}/images`,{recursive:true,mode:0o700})
const entries=[...JSON.parse(await readFile(`${root}/pending.json`)).entries.filter(entry=>entry.identityKey!=='whitney-houston'),...JSON.parse(await readFile(`${extra}/pending.json`)).entries]
entries.find(entry=>entry.identityKey==='aretha-franklin').wikidataId='Q125121'
const crops={
  beyonce:{left:5,top:28,width:108,height:290},
  'justin-timberlake':{left:430,top:270,width:115,height:250},
  'katy-perry':{left:210,top:50,width:180,height:330},
  'sam-smith':{left:40,top:200,width:250,height:430},
  'paul-mccartney':{left:650,top:110,width:330,height:470},
  'bob-dylan':{left:0,top:65,width:295,height:350},
}
const identities=new URL('https://www.wikidata.org/w/api.php')
identities.search=new URLSearchParams({action:'wbgetentities',format:'json',ids:entries.map(entry=>entry.wikidataId).join('|'),props:'labels|descriptions|sitelinks',languages:'mul|en|zh|zh-tw',sitefilter:'enwiki|zhwiki'})
const evidence=await publicMetadata(identities)
await writeFile(`${output}/identity-evidence.json`,JSON.stringify({checkedAt:new Date().toISOString(),entities:evidence.entities},null,2),{mode:0o600,flag:'wx'})
for(const entry of entries) {
  if(evidence.entities?.[entry.wikidataId]?.sitelinks?.enwiki?.title!==entry.nameEn) throw new Error(`Identity evidence mismatch: ${entry.identityKey}`)
  const inputRoot=entry.identityKey==='cyndi-lauper'?extra:root
  let normalized
  if(crops[entry.identityKey]) {
    const source=await downloadCommonsImage(entry.imageUrl)
    if(createHash('sha1').update(source).digest('hex')!==entry.rendition.originalSha1) throw new Error('Source changed')
    const crop=crops[entry.identityKey]
    const horizontal=entry.rendition.originalWidth/entry.technical.width
    const vertical=entry.rendition.originalHeight/entry.technical.height
    const region={left:Math.round(crop.left*horizontal),top:Math.round(crop.top*vertical),width:Math.round(crop.width*horizontal),height:Math.round(crop.height*vertical)}
    const pixels=await sharp(source,{limitInputPixels:40000000,failOn:'error'}).extract(region).png().toBuffer()
    normalized=await normalizeQuestionWebp(pixels)
    entry.processing={cropOriginalPixels:region,originalSha1:entry.rendition.originalSha1,source:'Original government photograph; named source caption/position. No facial recognition, retouch or AI.'}
  } else normalized={webp:await readFile(`${inputRoot}/${entry.imagePath}`),...entry.technical}
  entry.imagePath=`images/${randomUUID()}.webp`
  entry.imageSha256=createHash('sha256').update(normalized.webp).digest('hex')
  entry.technical={width:normalized.width,height:normalized.height,bytes:normalized.webp.length,quality:82,mimeType:'image/webp'}
  await sharp(normalized.webp,{limitInputPixels:1048576,failOn:'error'}).stats()
  await writeFile(`${output}/${entry.imagePath}`,normalized.webp,{mode:0o600,flag:'wx'})
  entry.approved=false
}
await writeFile(`${output}/pending.json`,JSON.stringify({entries},null,2),{mode:0o600,flag:'wx'})
console.log(JSON.stringify({subjects:entries.length,approved:0,status:'PENDING_FINAL_VISUAL_AND_RIGHTS_REVIEW'}))
