import { readFile, writeFile, realpath } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const quote = value => `'${String(value).replaceAll("'", "''")}'`
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validateReviewedEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 15 || entries.length > 150) throw new Error('Require 15–150 reviewed subjects')
  const used = new Set()
  for (const entry of entries) {
    if (!entry || !/^Q[1-9][0-9]*$/.test(entry.wikidataId) || used.has(entry.wikidataId)) throw new Error('Duplicate or invalid subject')
    used.add(entry.wikidataId)
    if (entry.approved !== true || entry.review?.rights !== true || entry.review?.image !== true || entry.review?.subject !== true || !entry.review.reviewedBy?.trim() || !Number.isFinite(Date.parse(entry.review.reviewedAt))) throw new Error('Unreviewed subjects must never become usable')
    if (!['CC0', 'CC0 1.0', 'CC0-1.0', 'Public domain'].includes(entry.license) || entry.restrictions || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(entry.source) || !/^https:\/\/upload\.wikimedia\.org\//.test(entry.imageUrl)) throw new Error('Rights or provenance requires further review')
    if (!entry.nameZh?.trim() || !entry.author?.trim() || !entry.attribution?.trim() || !Array.isArray(entry.categoryIds) || !entry.categoryIds.length || !entry.categoryIds.every(category => uuid.test(category)) || typeof entry.imagePath !== 'string' || !/^[0-9a-f]{64}$/.test(entry.imageSha256)) throw new Error('Incomplete reviewed subject or image')
  }
  return entries
}

export async function prepareQuestionImport(manifest) {
  const path = await realpath(manifest)
  const directory = dirname(path)
  const entries = validateReviewedEntries(JSON.parse(await readFile(path, 'utf8')).entries)
  const database = new PGlite()
  const categories = [...new Set(entries.flatMap(entry => entry.categoryIds))]
  const subjects = []
  const statements = ['BEGIN;', "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '120s';",
    `DO $preflight$ BEGIN IF (SELECT count(*) FROM public.categories WHERE id IN (${categories.map(quote).join(',')}) AND is_active) <> ${categories.length} THEN RAISE EXCEPTION 'Required active categories missing'; END IF; IF EXISTS (SELECT 1 FROM public.celebrities WHERE wikidata_id IN (${entries.map(entry => quote(entry.wikidataId)).join(',')})) THEN RAISE EXCEPTION 'Duplicate bank subjects; inspect existing data, never overwrite'; END IF; END; $preflight$;`]
  try {
    const migration = await readFile(new URL('../supabase/migrations/20261023120000_game_engine.sql', import.meta.url), 'utf8')
    await database.exec(migration.split('CREATE TABLE public.game_image_assets')[0])
    for (const entry of entries) {
      const imagePath = await realpath(resolve(directory, entry.imagePath))
      if (!imagePath.startsWith(directory + sep)) throw new Error('Image must be inside manifest directory')
      const png = await readFile(imagePath)
      if (createHash('sha256').update(png).digest('hex') !== entry.imageSha256 || !(await database.query('SELECT public.game_engine_png_valid($1::bytea) AS valid', [png])).rows[0].valid) throw new Error('Unsafe or changed PNG')
      const id = crypto.randomUUID()
      const imageId = crypto.randomUUID()
      statements.push(`INSERT INTO public.celebrities(id,wikidata_id,name_zh,name_en,subject_type,image_url,image_source,image_author,image_license,image_attribution,is_approved) VALUES(${quote(id)},${quote(entry.wikidataId)},${quote(entry.nameZh)},${entry.nameEn ? quote(entry.nameEn) : 'NULL'},'real_person',${quote(entry.imageUrl)},${quote(entry.source)},${quote(entry.author)},${quote(entry.license)},${quote(entry.attribution)},true);`)
      for (const category of new Set(entry.categoryIds)) statements.push(`INSERT INTO public.celebrity_categories(celebrity_id,category_id) VALUES(${quote(id)},${quote(category)});`)
      statements.push(`INSERT INTO public.game_image_assets(id,celebrity_id,png,is_approved) VALUES(${quote(imageId)},${quote(id)},decode(${quote(png.toString('base64'))},'base64'),true);`)
      subjects.push({ id, wikidataId: entry.wikidataId, imageId, imageSha256: entry.imageSha256, categoryIds: [...new Set(entry.categoryIds)] })
    }
    statements.push('COMMIT;')
    const output = resolve(directory, 'reviewed-import.sql')
    const sql = statements.join('\n') + '\n'
    const expected = subjects.map(subject => `(${quote(subject.id)}::uuid,${quote(subject.wikidataId)},${quote(subject.imageId)}::uuid,${quote(subject.imageSha256)},ARRAY[${subject.categoryIds.toSorted().map(quote).join(',')}]::uuid[])`).join(',\n')
    const matched = `WITH expected(celebrity_id,wikidata_id,image_id,png_sha256,category_ids) AS (VALUES ${expected}) SELECT count(*)::integer FROM expected JOIN public.celebrities AS celebrity ON celebrity.id=expected.celebrity_id AND celebrity.wikidata_id=expected.wikidata_id AND celebrity.is_approved JOIN public.game_image_assets AS asset ON asset.id=expected.image_id AND asset.celebrity_id=celebrity.id AND asset.is_approved AND encode(sha256(asset.png),'hex')=expected.png_sha256 AND public.game_engine_png_valid(asset.png) WHERE (SELECT array_agg(category.id ORDER BY category.id) FROM public.celebrity_categories AS membership JOIN public.categories AS category ON category.id=membership.category_id AND category.is_active WHERE membership.celebrity_id=celebrity.id)=expected.category_ids`
    const verification = `BEGIN READ ONLY;\nSET LOCAL statement_timeout = '120s';\nDO $verify$ DECLARE matched integer; BEGIN SELECT (${matched}) INTO matched; IF matched <> ${entries.length} THEN RAISE EXCEPTION 'Imported subject, approval, image digest or category verification failed'; END IF; END; $verify$;\nSELECT ${entries.length} AS expected_subjects, (${matched}) AS verified_subjects;\nROLLBACK;\n`
    await writeFile(output, sql, { mode: 0o600, flag: 'wx' })
    await writeFile(resolve(directory, 'verify-import.sql'), verification, { mode: 0o600, flag: 'wx' })
    const receipt = { reviewedSubjects: entries.length, categoryRelationships: subjects.reduce((count, subject) => count + subject.categoryIds.length, 0), imageAssets: entries.length, sqlSha256: createHash('sha256').update(sql).digest('hex'), subjects }
    await writeFile(resolve(directory, 'import-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' })
    return { output, ...receipt, cloudWrites: 0 }
  } finally { await database.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Manifest path required')
    console.log(JSON.stringify({ result: 'PASS', ...await prepareQuestionImport(process.argv[2]) }))
  } catch {
    console.error('BLOCKED: reviewed manifest, rights, safe PNGs or unique output failed validation. No Cloud request or database write performed.')
    process.exitCode = 2
  }
}
