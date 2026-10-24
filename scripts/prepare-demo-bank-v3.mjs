import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { selectDemoBank, demoImageBlockers, summarizeDemoBank } from './lib/demo-bank-v3.mjs'
import { resolveCommonsRenditions, downloadCommonsImage, publicMetadata, commonsQuery, plainText } from './lib/commons-images.mjs'
import { normalizeQuestionWebp } from './lib/question-images.mjs'
import { privateImageMime } from '../supabase/functions/game-engine/images.ts'
import { identifyLicense } from './lib/question-license.mjs'
import sharp from 'sharp'

if (![4,5].includes(process.argv.length) || !/^[a-z0-9-]+$/.test(process.argv[3]) || process.argv.length===5 && process.argv[4]!=='--resume-technical') throw new Error('Full v3 manifest, output slug and optional --resume-technical required')
const resuming=process.argv[4]==='--resume-technical'
sharp.cache({ memory: 16, files: 0, items: 16 })
sharp.concurrency(1)
const root = await realpath('data/question-bank/prepared')
const directory = resolve(root, process.argv[3])
if (!resuming) {
  await mkdir(directory, { mode: 0o700 })
  await mkdir(join(directory,'images'), { mode: 0o700 })
}
const bank = JSON.parse(await readFile(process.argv[2], 'utf8'))
const scope = JSON.parse(await readFile('data/question-bank/test-bank-v3-demo-scope.json','utf8'))
const { selected, deferred } = selectDemoBank(bank, scope)
if (resuming) {
  const previous=JSON.parse(await readFile(join(directory,'demo-review.json'),'utf8'))
  if (previous.scope!==scope.id || previous.entries.length!==120 || previous.entries.some(entry=>entry.approved || entry.review?.reviewedBy || ['subject','image','rights','presentation'].some(field=>entry.review?.[field]))) throw new Error('NEVER_RESUME_OVER_REVIEW_DECISIONS')
  for (const entry of selected) {
    const prior=previous.entries.find(prior=>prior.id===entry.id && prior.wikidataId===entry.wikidataId && prior.image?.sourceSha1===entry.image?.sourceSha1)
    if (!prior) throw new Error('RESUME_IDENTITY_CHANGED')
    for (const field of ['sourceEvidence','technical','processing']) if (prior[field]) entry[field]=prior[field]
  }
}
const receipt = { scope: scope.id, preparedAt: new Date().toISOString(), status: 'PREPARING', approved: 0, cloudWrites: 0, entries: selected, failures: [] }
const save = async () => {
  await writeFile(join(directory,'demo-review.json'),JSON.stringify(receipt,null,2),{ mode: 0o600 })
  await writeFile(join(directory,'summary.json'),JSON.stringify({ groups: summarizeDemoBank(selected), deferred: deferred.length, failures: receipt.failures, cloudWrites: 0 },null,2),{ mode: 0o600 })
}
if (!resuming) await writeFile(join(directory,'deferred-60.json'),JSON.stringify({ status: 'PRESERVED_NOT_DELETED', entries: deferred },null,2),{ mode: 0o600, flag: 'wx' })
await save()
for (const entry of selected) {
  entry.demoBlockers = demoImageBlockers(entry)
  entry.review = { subject: false, image: false, rights: false, presentation: false, reviewedBy: null, reviewedAt: null }
  entry.approved = false
}
try {
  const candidates = selected.filter(entry => entry.image && !entry.sourceEvidence)
  for (let offset=0;offset<candidates.length;offset+=10) {
    const batch=candidates.slice(offset,offset+10)
    const titles=batch.map(entry=>decodeURIComponent(new URL(entry.image.source).pathname.slice('/wiki/'.length)))
    const data=await publicMetadata(commonsQuery({ titles: titles.join('|'), prop: 'revisions|info', rvprop: 'ids|content', rvslots: 'main' }))
    for (const entry of batch) {
      const title=decodeURIComponent(new URL(entry.image.source).pathname.slice('/wiki/'.length)).replaceAll('_',' ')
      const page=data.query?.pages?.find(page=>page.title.replaceAll('_',' ')===title)
      if (!page?.revisions?.[0]?.revid) throw new Error('SOURCE_EVIDENCE_MISSING')
      entry.sourceEvidence={ checkedAt: new Date().toISOString(), pageId: page.pageid, revision: page.revisions[0].revid, url: `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(page.title)}&oldid=${page.revisions[0].revid}`, wikitext: page.revisions[0].slots?.main?.content ?? '' }
    }
    await save()
    await delay(1500)
  }
  for (const entry of selected) {
    if (entry.technical?.status==='PASS') {
      const path=await realpath(resolve(directory,entry.technical.imagePath))
      if (!path.startsWith(directory+sep)) throw new Error('UNSAFE_LOCAL_ASSET')
      const bytes=await readFile(path)
      if (createHash('sha256').update(bytes).digest('hex')!==entry.technical.sha256 || privateImageMime(bytes)!=='image/webp') throw new Error('REUSED_ASSET_CHANGED')
      continue
    }
    if (entry.demoBlockers.length) { entry.technical={ status: 'BLOCKED', reasons: entry.demoBlockers }; continue }
    try {
      let webp, source, normalization
      if (entry.preparedAsset) {
        const path=await realpath(entry.preparedAsset.path)
        if (!path.startsWith(root+sep)) throw new Error('UNSAFE_LOCAL_ASSET')
        webp=await readFile(path)
        if (createHash('sha256').update(webp).digest('hex')!==entry.preparedAsset.sha256) throw new Error('REUSED_ASSET_CHANGED')
        source={ evidenceUrl: entry.image.evidenceUrl, author: entry.image.author, license: entry.image.license, licenseTermsUrl: entry.image.licenseUrl }
      } else {
        source=(await resolveCommonsRenditions([{ wikidataId: entry.wikidataId, sourcePage: entry.image.source, imageUrl: entry.image.imageUrl, sourceSha1: entry.image.sourceSha1 }])).get(entry.wikidataId)
        if (!identifyLicense(source.license,source.licenseTermsUrl) || !source.author?.trim() || source.metadata?.Restrictions?.value) throw new Error('LICENSE_CHANGED_REQUIRES_REVIEW')
        const bytes=await downloadCommonsImage(source.downloadUrl)
        normalization=await normalizeQuestionWebp(bytes)
        webp=normalization.webp
        source.renditionSha256=createHash('sha256').update(bytes).digest('hex')
        source.downloadedBytes=bytes.length
      }
      if (privateImageMime(webp)!=='image/webp' || webp.length>307200) throw new Error('INVALID_WEBP')
      const decoder=sharp(webp,{ limitInputPixels: 1048576,failOn: 'error' })
      const metadata=await decoder.metadata()
      await decoder.stats()
      if (Math.max(metadata.width,metadata.height)>1024 || metadata.exif || metadata.xmp || metadata.icc) throw new Error('UNSAFE_OUTPUT_METADATA')
      const filename=`${randomUUID()}.webp`
      await writeFile(join(directory,'images',filename),webp,{ mode: 0o600,flag: 'wx' })
      entry.technical={ status: 'PASS', reused: !!entry.preparedAsset, imagePath: `images/${filename}`, sha256: createHash('sha256').update(webp).digest('hex'), mime: 'image/webp', width: metadata.width,height: metadata.height, bytes: webp.length, quality: 82 }
      entry.processing={ ...source, metadata: undefined, originalNotices: plainText([source.metadata?.Credit?.value,source.metadata?.Attribution?.value,source.metadata?.UsageTerms?.value,source.metadata?.Restrictions?.value].filter(Boolean).join(' · ')), modifications: 'Proportional resize <=1024px without enlargement; EXIF orientation applied; metadata removed; WebP quality82. No crop or AI retouch. Existing source edits retained in evidence.' }
      console.log(JSON.stringify({ technicalWebp: selected.filter(entry=>entry.technical?.status==='PASS').length, approved: 0, cloudWrites: 0 }))
      await save()
      if (!entry.preparedAsset) await delay(2000)
    } catch (error) {
      entry.technical={ status: 'FAIL', reason: /^[A-Z_0-9]+$/.test(error.message)?error.message:'IMAGE_PROCESSING_FAILED' }
      throw error
    }
  }
  receipt.status='TECHNICAL_PREPARATION_COMPLETE_REVIEW_PENDING'
} catch (error) {
  receipt.status='BLOCKED'
  receipt.failures.push({ reason: /^[A-Z_0-9]+$/.test(error.message)?error.message:'SOURCE_OR_IMAGE_PROCESSING_FAILED' })
  process.exitCode=2
}
await save()
console.log(JSON.stringify({ status: receipt.status, groups: summarizeDemoBank(selected), deferred: deferred.length, failures: receipt.failures, cloudWrites: 0 }))
