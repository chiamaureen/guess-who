import { mkdir,readFile,writeFile } from 'node:fs/promises'
import { randomUUID,createHash } from 'node:crypto'
import { publicMetadata,commonsQuery,resolveCommonsRenditions,downloadCommonsImage,plainText } from './lib/commons-images.mjs'
import { normalizeQuestionWebp } from './lib/question-images.mjs'

const supplement=process.argv.includes('--supplement')
const directory=`data/question-bank/prepared/phase9-english-pd${supplement?'-extra':''}-20261025`
let selected=[
  ['beyonce','File:Eyonce and Jay Z at White House (cropped).JPG'],
  ['lady-gaga','File:Lady Gaga at the White House in 2023 (3).jpg'],
  ['justin-timberlake','File:Justin Timberlake and Steve Cropper performing at the White House.jpg'],
  ['katy-perry',"File:Barack Obama comments on Katy Perry's shoes while greeting the singer and her grandmother, Ann Hudson, 2012.jpg"],
  ['selena-gomez','File:Selena Gomez at White House.jpg'],
  ['sam-smith','File:Sam Smith performs at the Respect for Marriage Act bill signing (52651190884).jpg'],
  ['olivia-rodrigo','File:P20210714AS-1907 (51418861050) (cropped).jpg'],
  ['whitney-houston','File:Whitney Houston Welcome Home Heroes 1 cropped.jpg'],
  ['michael-jackson','File:Michael Jackson with the Reagans (2x3 cropped).jpg'],
  ['elton-john','File:Elton John 2022.jpg'],
  ['mariah-carey','File:Mariah Carey Library of Congress 2023 1 Cropped 2.png'],
  ['stevie-wonder','File:Stevie Wonder performs (cropped).jpg','史提夫·汪達','Stevie Wonder','Q714'],
  ['aretha-franklin','File:Aretha Franklin, The Gospel Tradition In Performance at the White House, 2015 (cut).jpg','艾瑞莎·弗蘭克林','Aretha Franklin','Q125121'],
  ['paul-mccartney','File:Paul McCartney in The White House.jpg','保羅·麥卡尼','Paul McCartney','Q2599'],
  ['bob-dylan','File:President Barack Obama presents American musician Bob Dylan with a Medal of Freedom (cropped).jpg','巴布·狄倫','Bob Dylan','Q392'],
]
if(supplement) selected=[['cyndi-lauper','File:P20221213CS-0334 (52650425712).jpg','辛蒂·露波','Cyndi Lauper','Q1545']]
await mkdir(`${directory}/images`,{recursive:true,mode:0o700})
const bank=JSON.parse(await readFile('data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/candidates.json','utf8'))
const entries=[]
for(const [identityKey,title,nameZh,nameEn,wikidataId] of selected) {
  const person=bank.entries.find(entry=>entry.identityKey===identityKey)??{nameZh,nameOriginal:nameEn,wikidataId}
  if(!person.wikidataId) throw new Error(`Missing identity: ${identityKey}`)
  const metadata=await publicMetadata(commonsQuery({titles:title,prop:'imageinfo|revisions',iiprop:'url|size|sha1|extmetadata',rvprop:'ids|content',rvslots:'main'}))
  const page=metadata.query.pages[0]
  const info=page.imageinfo?.[0]
  if(!info || info.extmetadata?.LicenseShortName?.value!=='Public domain') throw new Error(`Not public domain: ${title}`)
  const source=`https://commons.wikimedia.org/wiki/${encodeURIComponent(title).replaceAll('%3A',':')}`
  const rendition=(await resolveCommonsRenditions([{sourcePage:source,imageUrl:info.url,sourceSha1:info.sha1,wikidataId:person.wikidataId}])).get(person.wikidataId)
  const original=await downloadCommonsImage(rendition.downloadUrl)
  const output=await normalizeQuestionWebp(original)
  const imagePath=`images/${randomUUID()}.webp`
  await writeFile(`${directory}/${imagePath}`,output.webp,{mode:0o600})
  entries.push({identityKey,wikidataId:person.wikidataId,nameZh:person.nameZh,nameEn:person.nameOriginal,group:'english-singers',
    approved:false,source,imageUrl:info.url,author:plainText(info.extmetadata.Artist?.value),license:'Public domain',
    description:plainText(info.extmetadata.ImageDescription?.value),restrictions:plainText(info.extmetadata.Restrictions?.value),
    sourceEvidence:{checkedAt:new Date().toISOString(),revision:page.revisions?.[0]?.revid,wikitext:page.revisions?.[0]?.slots?.main?.content,metadata:info.extmetadata},
    rendition,imagePath,imageSha256:createHash('sha256').update(output.webp).digest('hex'),technical:{width:output.width,height:output.height,quality:output.quality,bytes:output.webp.length}})
  await writeFile(`${directory}/pending.json`,JSON.stringify({entries},null,2),{mode:0o600})
  console.log(JSON.stringify({identityKey,status:'PENDING_VISUAL_AND_SOURCE_REVIEW',bytes:output.webp.length}))
}
