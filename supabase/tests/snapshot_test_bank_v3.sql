BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';

SELECT jsonb_build_object(
  'projectRef','fgvajdnzrnptdjurhjfo',
  'environment','cloud-read-only-export',
  'checkedAt',clock_timestamp(),
  'categories',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'is_active',is_active) ORDER BY slug),'[]'::jsonb) FROM public.categories),
  'celebrities',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',person.id,'wikidata_id',person.wikidata_id,'name_zh',person.name_zh,'name_en',person.name_en,'is_approved',person.is_approved,
    'categories',(SELECT coalesce(jsonb_agg(category.slug ORDER BY category.slug),'[]'::jsonb) FROM public.celebrity_categories AS membership JOIN public.categories AS category ON category.id=membership.category_id WHERE membership.celebrity_id=person.id),
    'approved_assets',(SELECT count(*) FROM public.game_image_assets AS asset WHERE asset.celebrity_id=person.id AND asset.is_approved)
  ) ORDER BY person.id),'[]'::jsonb) FROM public.celebrities AS person),
  'stagingExists',to_regclass('public.question_bank_candidates') IS NOT NULL
) AS snapshot;

ROLLBACK;
