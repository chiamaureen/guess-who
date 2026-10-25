import { readFile, writeFile, realpath } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { identifyLicense, storedAttribution, validateImageRights } from './lib/question-license.mjs'
import sharp from 'sharp'
import { privateImageMime } from '../supabase/functions/game-engine/images.ts'
import { idempotentImportBlock, rollbackQuestionImport } from './lib/question-import-idempotence.mjs'

const quote = value => `'${String(value).replaceAll("'", "''")}'`
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function validateReviewedEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 15 || entries.length > 150) throw new Error('Require 15–150 reviewed subjects')
  const used = new Set()
  for (const entry of entries) {
    if (!entry || !/^Q[1-9][0-9]*$/.test(entry.wikidataId) || used.has(entry.wikidataId)) throw new Error('Duplicate or invalid subject')
    used.add(entry.wikidataId)
    if (entry.approved !== true || entry.review?.rights !== true || entry.review?.image !== true || entry.review?.subject !== true || !entry.review.reviewedBy?.trim() || !Number.isFinite(Date.parse(entry.review.reviewedAt))) throw new Error('Unreviewed subjects must never become usable')
    if (!identifyLicense(entry.license, entry.rights?.licenseUrl) || entry.restrictions || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(entry.source) || !/^https:\/\/upload\.wikimedia\.org\//.test(entry.imageUrl)) throw new Error('Rights or provenance requires further review')
    validateImageRights(entry)
    if (entry.subjectType && !['real_person','fictional_character'].includes(entry.subjectType)) throw new Error('Invalid subject type')
    if (entry.subjectType === 'fictional_character' && (entry.rights?.characterRightsReviewed !== true || !entry.rights.characterRightsBasis?.trim() || !/^https:\/\//.test(entry.rights.characterRightsEvidenceUrl ?? ''))) throw new Error('Character copyright requires independent review evidence')
    if (entry.groupIds !== undefined && (!Array.isArray(entry.groupIds) || entry.groupIds.length < 1 || entry.groupIds.length > 8 || !entry.groupIds.every(group => uuid.test(group)) || new Set(entry.groupIds).size !== entry.groupIds.length)) throw new Error('Invalid question groups')
    if (!entry.nameZh?.trim() || !entry.author?.trim() || !entry.attribution?.trim() || !Array.isArray(entry.categoryIds) || !entry.categoryIds.length || !entry.categoryIds.every(category => uuid.test(category)) || typeof entry.imagePath !== 'string' || !/^[0-9a-f]{64}$/.test(entry.imageSha256)) throw new Error('Incomplete reviewed subject or image')
  }
  return entries
}

export async function prepareQuestionImport(manifest, { idempotent = false } = {}) {
  const path = await realpath(manifest)
  const directory = dirname(path)
  const entries = validateReviewedEntries(JSON.parse(await readFile(path, 'utf8')).entries)
  const database = new PGlite()
  const categories = [...new Set(entries.flatMap(entry => entry.categoryIds))]
  const subjects = []
  const groups = [...new Set(entries.flatMap(entry => entry.groupIds ?? []))]
  let needsFormats = false
  const statements = ['BEGIN;', "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '120s';",
    ...(idempotent ? ['LOCK TABLE public.celebrities,public.celebrity_categories,public.game_image_assets IN SHARE ROW EXCLUSIVE MODE;'] : []),
    `DO $preflight$ BEGIN IF (SELECT count(*) FROM public.categories WHERE id IN (${categories.map(quote).join(',')}) AND is_active) <> ${categories.length} THEN RAISE EXCEPTION 'Required active categories missing'; END IF; ${idempotent ? '' : `IF EXISTS (SELECT 1 FROM public.celebrities WHERE wikidata_id IN (${entries.map(entry => quote(entry.wikidataId)).join(',')})) THEN RAISE EXCEPTION 'Duplicate bank subjects; inspect existing data, never overwrite'; END IF;`} END; $preflight$;`]
  if (groups.length) {
    statements.push('LOCK TABLE public.question_groups,public.celebrity_question_groups IN SHARE ROW EXCLUSIVE MODE;')
    statements.push(`DO $groups$ BEGIN IF (SELECT count(*) FROM public.question_groups WHERE id IN (${groups.map(quote).join(',')}) AND is_active)<>${groups.length} THEN RAISE EXCEPTION 'Required question groups missing or inactive'; END IF; END; $groups$;`)
  }
  try {
    const migration = await readFile(new URL('../supabase/migrations/20261023120000_game_engine.sql', import.meta.url), 'utf8')
    await database.exec(migration.split('CREATE TABLE public.game_image_assets')[0])
    const formats = await readFile(new URL('../supabase/migration-drafts/20261024120000_game_image_formats.sql', import.meta.url), 'utf8')
    await database.exec(formats.split('ALTER TABLE public.game_image_assets')[0] + 'COMMIT;')
    for (const entry of entries) {
      const imagePath = await realpath(resolve(directory, entry.imagePath))
      if (!imagePath.startsWith(directory + sep)) throw new Error('Image must be inside manifest directory')
      const png = await readFile(imagePath)
      const mime = privateImageMime(png)
      if (createHash('sha256').update(png).digest('hex') !== entry.imageSha256 || !mime || entry.mimeType && entry.mimeType !== mime || !(await database.query('SELECT public.game_engine_image_valid($1::bytea) AS valid', [png])).rows[0].valid) throw new Error('Unsafe or changed image')
      if (mime !== 'image/png' && !entry.rights) throw new Error('New formats require complete structured rights evidence')
      const decoder = sharp(png, { limitInputPixels: 2560000, failOn: 'error' })
      const metadata = await decoder.metadata()
      await decoder.stats()
      if (metadata.exif || metadata.icc || metadata.xmp || (metadata.pages ?? 1) !== 1) throw new Error('Image metadata or animation is prohibited')
      needsFormats ||= mime !== 'image/png'
      const id = crypto.randomUUID()
      const imageId = crypto.randomUUID()
      const inserts=[`INSERT INTO public.celebrities(id,wikidata_id,name_zh,name_en,subject_type,image_url,image_source,image_author,image_license,image_attribution,is_approved) VALUES(${quote(id)},${quote(entry.wikidataId)},${quote(entry.nameZh)},${entry.nameEn ? quote(entry.nameEn) : 'NULL'},${quote(entry.subjectType ?? 'real_person')},${quote(entry.imageUrl)},${quote(entry.source)},${quote(entry.author)},${quote(entry.license)},${quote(storedAttribution(entry))},true);`]
      for (const category of new Set(entry.categoryIds)) inserts.push(`INSERT INTO public.celebrity_categories(celebrity_id,category_id) VALUES(${quote(id)},${quote(category)});`)
      for (const group of entry.groupIds ?? []) inserts.push(`INSERT INTO public.celebrity_question_groups(celebrity_id,group_id) SELECT ${quote(id)},id FROM public.question_groups WHERE id=${quote(group)} AND category_id IN (${entry.categoryIds.map(quote).join(',')});\nDO $group_member$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.celebrity_question_groups WHERE celebrity_id=${quote(id)} AND group_id=${quote(group)}) THEN RAISE EXCEPTION 'Group/category mismatch'; END IF; END; $group_member$;`)
      inserts.push(`INSERT INTO public.game_image_assets(id,celebrity_id,png,is_approved) VALUES(${quote(imageId)},${quote(id)},decode(${quote(png.toString('base64'))},'base64'),true);`)
      subjects.push({ id, wikidataId: entry.wikidataId, imageId, imageSha256: entry.imageSha256, attributionSha256: createHash('sha256').update(storedAttribution(entry)).digest('hex'), author: entry.author, license: entry.license, source: entry.source, mimeType: mime, categoryIds: [...new Set(entry.categoryIds)], ...(entry.groupIds ? { groupIds: entry.groupIds } : {}) })
      statements.push(...(idempotent ? [idempotentImportBlock(entry,subjects.at(-1),inserts)] : inserts))
    }
    statements.push('COMMIT;')
    const output = resolve(directory, 'reviewed-import.sql')
    const sql = statements.join('\n') + '\n'
    const expected = subjects.map(subject => `(${quote(subject.id)}::uuid,${quote(subject.wikidataId)},${quote(subject.imageId)}::uuid,${quote(subject.imageSha256)},${quote(subject.attributionSha256)},${quote(subject.author)},${quote(subject.license)},${quote(subject.source)},ARRAY[${subject.categoryIds.toSorted().map(quote).join(',')}]::uuid[])`).join(',\n')
    const matched = `WITH expected(celebrity_id,wikidata_id,image_id,png_sha256,credit_sha256,author,license,source,category_ids) AS (VALUES ${expected}) SELECT count(*)::integer FROM expected JOIN public.celebrities AS celebrity ON ${idempotent ? '' : 'celebrity.id=expected.celebrity_id AND '}celebrity.wikidata_id=expected.wikidata_id AND celebrity.is_approved AND celebrity.image_author=expected.author AND celebrity.image_license=expected.license AND celebrity.image_source=expected.source AND encode(sha256(convert_to(celebrity.image_attribution,'UTF8')),'hex')=expected.credit_sha256 JOIN public.game_image_assets AS asset ON ${idempotent ? '' : 'asset.id=expected.image_id AND '}asset.celebrity_id=celebrity.id AND asset.is_approved AND encode(sha256(asset.png),'hex')=expected.png_sha256 AND public.${needsFormats ? 'game_engine_image_valid' : 'game_engine_png_valid'}(asset.png) WHERE (SELECT array_agg(category.id ORDER BY category.id) FROM public.celebrity_categories AS membership JOIN public.categories AS category ON category.id=membership.category_id AND category.is_active WHERE membership.celebrity_id=celebrity.id)=expected.category_ids`
    const groupPairs=entries.flatMap(entry=>(entry.groupIds??[]).map(group=>`(${quote(entry.wikidataId)},${quote(group)}::uuid)`))
    const groupVerification=groupPairs.length ? `DO $verify_groups$ BEGIN IF (WITH expected(wikidata_id,group_id) AS (VALUES ${groupPairs.join(',')}) SELECT count(*) FROM expected JOIN public.celebrities AS person USING(wikidata_id) JOIN public.celebrity_question_groups AS member ON member.celebrity_id=person.id AND member.group_id=expected.group_id)<>${groupPairs.length} THEN RAISE EXCEPTION 'Imported group membership verification failed'; END IF; END; $verify_groups$;\n` : ''
    const verification = `BEGIN READ ONLY;\nSET LOCAL statement_timeout = '120s';\nDO $verify$ DECLARE matched integer; BEGIN SELECT (${matched}) INTO matched; IF matched <> ${entries.length} THEN RAISE EXCEPTION 'Imported subject, approval, image digest or category verification failed'; END IF; END; $verify$;\n${groupVerification}SELECT ${entries.length} AS expected_subjects, (${matched}) AS verified_subjects;\nROLLBACK;\n`
    await writeFile(output, sql, { mode: 0o600, flag: 'wx' })
    await writeFile(resolve(directory, 'verify-import.sql'), verification, { mode: 0o600, flag: 'wx' })
    await writeFile(resolve(directory, 'rollback-import.sql'), rollbackQuestionImport(entries,subjects), { mode: 0o600, flag: 'wx' })
    const categoryRelationships = subjects.reduce((count, subject) => count + subject.categoryIds.length, 0)
    const groupRelationships = subjects.reduce((count, subject) => count + (subject.groupIds?.length ?? 0), 0)
    const receipt = { reviewedSubjects: entries.length, categoryRelationships, groupRelationships, imageAssets: entries.length, totalRows: entries.length * 2 + categoryRelationships + groupRelationships, idempotent, requiresImageFormatsMigration: needsFormats, sqlSha256: createHash('sha256').update(sql).digest('hex'), subjects }
    await writeFile(resolve(directory, 'import-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' })
    return { output, ...receipt, cloudWrites: 0 }
  } finally { await database.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (![3,4].includes(process.argv.length) || process.argv.length === 4 && process.argv[3] !== '--idempotent') throw new Error('Manifest path and optional --idempotent required')
    console.log(JSON.stringify({ result: 'PASS', ...await prepareQuestionImport(process.argv[2], { idempotent: process.argv[3] === '--idempotent' }) }))
  } catch {
    console.error('BLOCKED: reviewed manifest, rights, safe images or unique output failed validation. No Cloud request or database write performed.')
    process.exitCode = 2
  }
}
