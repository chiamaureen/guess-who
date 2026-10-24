import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { publicMetadata, commonsQuery } from './lib/commons-images.mjs'

if (process.argv.length !== 3) throw new Error('Existing local final-review directory required')
const directory = resolve(process.argv[2])
const evidence = JSON.parse(await readFile(join(directory, 'source-evidence.json'), 'utf8'))
const result = { checkedAt: new Date().toISOString(), files: [], templates: [], wikipedia: null, failures: [], cloudWrites: 0 }
for (const name of ['紀政', '黃志雄', '陳詩欣']) {
  const entry = evidence.entries.find(entry => entry.name === name)
  try {
    const url = commonsQuery({ action: 'parse', oldid: String(entry.commons.revision.revid), prop: 'text' })
    const response = await publicMetadata(url)
    const html = response.parse?.text
    if (typeof html !== 'string') throw new Error('No rendered source')
    result.files.push({ name, revision: entry.commons.revision.revid, html, hasCcBySa30Grant: /creativecommons\.org\/licenses\/by-sa\/3\.0\//.test(html) })
  } catch { result.failures.push({ name, stage: 'rendered-license' }) }
}
try {
  const response = await publicMetadata(commonsQuery({ titles: 'User:DerHexer/licence2', prop: 'revisions', rvprop: 'ids|content', rvslots: 'main' }))
  result.templates = response.query?.pages ?? []
} catch { result.failures.push({ stage: 'author-license-template' }) }
try {
  const url = new URL('https://en.wikipedia.org/w/api.php')
  url.search = new URLSearchParams({ action: 'query', titles: 'Anthony Edwards (basketball)', prop: 'pageprops|extracts', exintro: '1', explaintext: '1', format: 'json', formatversion: '2' })
  result.wikipedia = await publicMetadata(url)
} catch { result.failures.push({ stage: 'anthony-wikipedia' }) }
await writeFile(join(directory, 'supplemental-evidence.json'), JSON.stringify(result, null, 2), { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ renderedGrants: result.files.map(entry => ({ name: entry.name, ccBySa30: entry.hasCcBySa30Grant })), templates: result.templates.length, wikipedia: Boolean(result.wikipedia), failures: result.failures.length, cloudWrites: 0 }))
