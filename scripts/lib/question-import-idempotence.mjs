import { storedAttribution } from './question-license.mjs'

const quote = value => `'${String(value).replaceAll("'", "''")}'`
function block(body) {
  let tag='$import$'
  while (body.includes(tag)) tag=tag.replace('$','$_')
  return `DO ${tag}\nBEGIN\n${body}\nEND;\n${tag};`
}

export function exactImportedSubject(entry, subject) {
  const categories=[...new Set(entry.categoryIds)].toSorted()
  return `person.wikidata_id=${quote(entry.wikidataId)} AND person.name_zh=${quote(entry.nameZh)}
    AND person.name_en IS NOT DISTINCT FROM ${entry.nameEn ? quote(entry.nameEn) : 'NULL'}
    AND person.subject_type=${quote(entry.subjectType ?? 'real_person')} AND person.is_approved
    AND person.image_url=${quote(entry.imageUrl)} AND person.image_source=${quote(entry.source)}
    AND person.image_author=${quote(entry.author)} AND person.image_license=${quote(entry.license)}
    AND person.image_attribution=${quote(storedAttribution(entry))}
    AND (SELECT array_agg(category_id ORDER BY category_id) FROM public.celebrity_categories WHERE celebrity_id=person.id)=ARRAY[${categories.map(quote).join(',')}]::uuid[]
    AND (SELECT count(*) FROM public.game_image_assets WHERE celebrity_id=person.id AND is_approved)=1
    AND EXISTS (SELECT 1 FROM public.game_image_assets WHERE celebrity_id=person.id AND is_approved AND encode(sha256(png),'hex')=${quote(subject.imageSha256)})`
}

export function idempotentImportBlock(entry, subject, inserts) {
  return block(`IF EXISTS (SELECT 1 FROM public.celebrities WHERE wikidata_id=${quote(entry.wikidataId)}) THEN
  IF NOT EXISTS (SELECT 1 FROM public.celebrities AS person WHERE ${exactImportedSubject(entry,subject)}) THEN
    RAISE EXCEPTION 'Existing subject differs; never overwrite or approve it';
  END IF;
ELSE
${inserts.join('\n')}
END IF;`)
}

export function rollbackQuestionImport(entries, subjects) {
  return ['BEGIN;', "SET LOCAL lock_timeout='5s';", "SET LOCAL statement_timeout='120s';",
    'LOCK TABLE public.celebrities,public.celebrity_categories,public.game_image_assets IN SHARE ROW EXCLUSIVE MODE;',
    ...entries.map((entry,index)=>{
      const subject=subjects[index]
      return block(`IF EXISTS (SELECT 1 FROM public.celebrities WHERE id=${quote(subject.id)}::uuid) THEN
  IF NOT EXISTS (SELECT 1 FROM public.celebrities AS person WHERE person.id=${quote(subject.id)}::uuid AND ${exactImportedSubject(entry,subject)})
    OR (SELECT count(*) FROM public.game_image_assets WHERE celebrity_id=${quote(subject.id)}::uuid)<>1
    OR NOT EXISTS (SELECT 1 FROM public.game_image_assets WHERE id=${quote(subject.imageId)}::uuid AND celebrity_id=${quote(subject.id)}::uuid)
    OR EXISTS (SELECT 1 FROM public.room_questions WHERE celebrity_id=${quote(subject.id)}::uuid)
    OR EXISTS (SELECT 1 FROM public.host_question_history WHERE celebrity_id=${quote(subject.id)}::uuid) THEN
    RAISE EXCEPTION 'Imported subject changed or used; refuse rollback';
  END IF;
  DELETE FROM public.game_image_assets WHERE id=${quote(subject.imageId)}::uuid AND celebrity_id=${quote(subject.id)}::uuid;
  DELETE FROM public.celebrity_categories WHERE celebrity_id=${quote(subject.id)}::uuid;
  DELETE FROM public.celebrities WHERE id=${quote(subject.id)}::uuid;
END IF;`)
    }), 'COMMIT;', ''].join('\n')
}
