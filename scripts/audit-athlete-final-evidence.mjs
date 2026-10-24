import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { publicMetadata, commonsQuery } from './lib/commons-images.mjs'

if (process.argv.length !== 3 || !/^[a-z0-9-]+$/.test(process.argv[2])) throw new Error('New local evidence directory name required')
const inventoryBytes = await readFile('data/question-bank/prepared/athletes-source-inventory-20261024/source-inventory-final.json')
const inventory = JSON.parse(inventoryBytes)
const candidates = inventory.entries.filter(entry => entry.status === 'PENDING').map(entry => ({
  name: entry.name, wikidataId: entry.wikidataId, group: entry.group,
  source: entry.existingSource || entry.alternatives.find(image => image.filename === 'Anthony Edwards Georgia (cropped).jpg')?.source,
}))
if (candidates.length !== 69 || new Set(candidates.map(entry => entry.wikidataId)).size !== 69 || candidates.some(entry => !entry.source || !/^Q[1-9]\d*$/.test(entry.wikidataId))) throw new Error('Final69 pending scope mismatch')
const directory = resolve('data/question-bank/prepared/athletes-local-review', process.argv[2])
await mkdir(directory, { mode: 0o700 })
const receipt = { checkedAt: new Date().toISOString(), scopeSha256: createHash('sha256').update(inventoryBytes).digest('hex'), total: candidates.length, approved: 0, cloudWrites: 0, failures: [], entries: candidates }
const save = () => writeFile(join(directory, 'source-evidence.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
await writeFile(join(directory, 'source-evidence.json'), JSON.stringify(receipt), { mode: 0o600, flag: 'wx' })
const fileKey = title => title.replaceAll('_', ' ').normalize('NFC')
for (let offset = 0; offset < candidates.length; offset += 10) {
  const batch = candidates.slice(offset, offset + 10)
  try {
    const result = await publicMetadata(commonsQuery({ titles: batch.map(entry => decodeURIComponent(new URL(entry.source).pathname.slice(6))).join('|'), prop: 'imageinfo|revisions', iiprop: 'url|extmetadata|sha1|timestamp', rvprop: 'ids|timestamp|content', rvslots: 'main' }))
    for (const entry of batch) {
      const title = decodeURIComponent(new URL(entry.source).pathname.slice(6))
      const page = result.query?.pages?.find(page => fileKey(page.title) === fileKey(title))
      entry.commons = page?.imageinfo?.[0] && page.revisions?.[0] ? { title: page.title, pageid: page.pageid, image: page.imageinfo[0], revision: page.revisions[0], evidenceUrl: `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(page.title)}&oldid=${page.revisions[0].revid}` } : null
    }
  } catch (error) {
    receipt.failures.push({ stage: 'commons', names: batch.map(entry => entry.name), reason: /^METADATA_HTTP_\d+$/.test(error.message) ? error.message : 'NETWORK_OR_METADATA_ERROR' })
    if (error.message === 'METADATA_HTTP_429') break
  }
  await save()
  await delay(1500)
}
for (let offset = 0; offset < candidates.length; offset += 35) {
  const batch = candidates.slice(offset, offset + 35)
  const url = new URL('https://www.wikidata.org/w/api.php')
  url.search = new URLSearchParams({ action: 'wbgetentities', ids: batch.map(entry => entry.wikidataId).join('|'), props: 'labels|descriptions|claims|sitelinks', languages: 'zh-tw|zh|en', format: 'json' })
  try {
    const result = await publicMetadata(url)
    for (const entry of batch) {
      const entity = result.entities?.[entry.wikidataId]
      entry.person = entity ? {
        revision: entity.lastrevid, labels: entity.labels, descriptions: entity.descriptions,
        images: entity.claims?.P18?.filter(claim => claim.rank !== 'deprecated').map(claim => claim.mainsnak?.datavalue?.value) ?? [],
        birthDates: entity.claims?.P569?.map(claim => claim.mainsnak?.datavalue?.value?.time) ?? [],
        occupations: entity.claims?.P106?.map(claim => claim.mainsnak?.datavalue?.value?.id) ?? [],
        wikipedia: { en: entity.sitelinks?.enwiki?.title ?? null, zh: entity.sitelinks?.zhwiki?.title ?? null },
      } : null
    }
  } catch { receipt.failures.push({ stage: 'wikidata', names: batch.map(entry => entry.name), reason: 'NETWORK_OR_METADATA_ERROR' }) }
  await save()
  await delay(1500)
}
await save()
console.log(JSON.stringify({ candidates: 69, commonsEvidence: candidates.filter(entry => entry.commons).length, personEvidence: candidates.filter(entry => entry.person).length, failures: receipt.failures.length, approved: 0, cloudWrites: 0 }))
