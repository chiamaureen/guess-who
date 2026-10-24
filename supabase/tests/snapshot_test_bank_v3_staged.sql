BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'identity_key',identity_key,'wikidata_id',wikidata_id,'category_slug',category_slug,'group_slug',group_slug) ORDER BY id),'[]'::jsonb) AS staged
FROM public.question_bank_candidates;
ROLLBACK;
