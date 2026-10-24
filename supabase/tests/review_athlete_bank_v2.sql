BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';

SELECT jsonb_build_object(
  'categories', (SELECT jsonb_agg(jsonb_build_object('slug', category.slug, 'is_active', category.is_active) ORDER BY category.slug) FROM public.categories AS category),
  'politicians', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'wikidata_id', celebrity.wikidata_id, 'name_zh', celebrity.name_zh, 'name_en', celebrity.name_en, 'is_approved', celebrity.is_approved,
    'categories', (SELECT jsonb_agg(category.slug ORDER BY category.slug) FROM public.celebrity_categories AS membership JOIN public.categories AS category ON category.id = membership.category_id WHERE membership.celebrity_id = celebrity.id),
    'question_references', (SELECT count(*) FROM public.room_questions AS question WHERE question.celebrity_id = celebrity.id),
    'history_references', (SELECT count(*) FROM public.host_question_history AS history WHERE history.celebrity_id = celebrity.id),
    'private_images', (SELECT count(*) FROM public.game_image_assets AS asset WHERE asset.celebrity_id = celebrity.id)
  ) ORDER BY celebrity.wikidata_id), '[]'::jsonb) FROM public.celebrities AS celebrity WHERE EXISTS (SELECT 1 FROM public.celebrity_categories AS membership JOIN public.categories AS category ON category.id = membership.category_id WHERE membership.celebrity_id = celebrity.id AND category.slug = 'politicians')),
  'existing_subjects', (SELECT coalesce(jsonb_agg(jsonb_build_object('wikidata_id', celebrity.wikidata_id, 'name_zh', celebrity.name_zh) ORDER BY celebrity.wikidata_id), '[]'::jsonb) FROM public.celebrities AS celebrity),
  'counts', jsonb_build_object(
    'categories', (SELECT count(*) FROM public.categories), 'celebrities', (SELECT count(*) FROM public.celebrities),
    'memberships', (SELECT count(*) FROM public.celebrity_categories), 'images', (SELECT count(*) FROM public.game_image_assets),
    'rooms', (SELECT count(*) FROM public.rooms), 'questions', (SELECT count(*) FROM public.room_questions),
    'history', (SELECT count(*) FROM public.host_question_history),
    'playing_rooms', (SELECT count(*) FROM public.rooms WHERE status = 'playing'),
    'eligible_athletes', (SELECT count(DISTINCT celebrity.id) FROM public.celebrities AS celebrity JOIN public.celebrity_categories AS membership ON membership.celebrity_id = celebrity.id JOIN public.categories AS category ON category.id = membership.category_id WHERE category.slug = 'athletes' AND category.is_active AND celebrity.is_approved AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id = celebrity.id AND asset.is_approved))
  ),
  'foreign_keys', (SELECT jsonb_agg(jsonb_build_object('table', constraint_row.conrelid::regclass::text, 'name', constraint_row.conname, 'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid)) ORDER BY constraint_row.conrelid::regclass::text, constraint_row.conname) FROM pg_catalog.pg_constraint AS constraint_row WHERE constraint_row.contype = 'f' AND constraint_row.confrelid IN ('public.celebrities'::regclass, 'public.celebrity_categories'::regclass, 'public.game_image_assets'::regclass))
) AS impact;

ROLLBACK;
