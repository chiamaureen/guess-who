import assert from 'node:assert/strict'
import { readFile,writeFile,realpath } from 'node:fs/promises'
import { resolve,dirname,join,sep } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import { privateImageMime } from '../supabase/functions/game-engine/images.ts'
import { summarizeDemoBank } from './lib/demo-bank-v3.mjs'

if (process.argv.length!==3) throw new Error('Demo review manifest required')
const path=await realpath(process.argv[2])
const directory=dirname(path)
const bank=JSON.parse(await readFile(path,'utf8'))
assert.equal(bank.entries.length,120)
const deferred=JSON.parse(await readFile(join(directory,'deferred-60.json'),'utf8'))
assert.equal(deferred.entries.length,60)
assert.equal(new Set([...bank.entries,...deferred.entries].map(entry=>entry.id)).size,180)
const database=new PGlite()
try {
  const original=await readFile(new URL('../supabase/migrations/20261023120000_game_engine.sql',import.meta.url),'utf8')
  const formats=await readFile(new URL('../supabase/migration-drafts/20261024120000_game_image_formats.sql',import.meta.url),'utf8')
  await database.exec(original.split('CREATE TABLE public.game_image_assets')[0])
  await database.exec(formats.split('ALTER TABLE public.game_image_assets')[0]+'COMMIT;')
  let decoded=0,bytesTotal=0
  for (const group of new Set(bank.entries.map(entry=>entry.group))) {
    const cards=[]
    for (const [index,entry] of bank.entries.filter(entry=>entry.group===group).entries()) {
      const width=190,height=220
      const layers=[]
      if (entry.technical?.status==='PASS') {
        const assetPath=await realpath(resolve(directory,entry.technical.imagePath))
        assert.ok(assetPath.startsWith(directory+sep))
        assert.match(entry.technical.imagePath,/^images\/[0-9a-f-]{36}\.webp$/)
        const bytes=await readFile(assetPath)
        assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.technical.sha256)
        assert.equal(privateImageMime(bytes),'image/webp')
        assert.equal((await database.query('SELECT public.game_engine_webp_valid($1::bytea) AS valid',[bytes])).rows[0].valid,true)
        const decoder=sharp(bytes,{ limitInputPixels: 1048576,failOn: 'error' })
        const metadata=await decoder.metadata()
        await decoder.stats()
        assert.ok(!metadata.exif&&!metadata.icc&&!metadata.xmp&&!metadata.orientation)
        assert.equal(metadata.width,entry.technical.width); assert.equal(metadata.height,entry.technical.height)
        assert.ok(Math.max(metadata.width,metadata.height)<=1024&&bytes.length<=307200)
        const thumb=await sharp(bytes).resize({ width: 180,height: 175,fit: 'contain',background: '#ffffff' }).png().toBuffer()
        layers.push({ input: thumb,left: 5,top: 2 })
        decoded++; bytesTotal+=bytes.length
      }
      const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      const label=Buffer.from(`<svg width="190" height="40"><text x="4" y="14" font-size="12">${index+1}. ${escape(entry.nameZh)}</text><text x="4" y="31" font-size="10">${escape(entry.technical?.status??'NOT_PREPARED')}</text></svg>`)
      layers.push({ input: label,left: 0,top: 177 })
      const card=await sharp({ create: { width,height,channels: 3,background: '#ffffff' } }).composite(layers).png().toBuffer()
      cards.push({ input: card,left: index%5*width,top: Math.floor(index/5)*height })
    }
    const image=await sharp({ create: { width: 950,height: 660,channels: 3,background: '#dddddd' } }).composite(cards).png().toBuffer()
    await writeFile(join(directory,`contact-${group}.png`),image,{ mode: 0o600 })
  }
  const receipt={ result: 'PASS',scope: 'Technical validation only; not source or rights approval',decoded,databaseChecks: decoded,bytesTotal,selected: 120,deferred: 60,groups: summarizeDemoBank(bank.entries),cloudWrites: 0 }
  await writeFile(join(directory,'technical-verification.json'),JSON.stringify(receipt,null,2),{ mode: 0o600 })
  console.log(JSON.stringify(receipt))
} finally { await database.close() }
