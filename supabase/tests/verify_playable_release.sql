BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s';
DO $verify$
BEGIN
  IF (SELECT count(*) FROM public.categories WHERE slug IN ('actors','singers','athletes','politicians','scientists','historical-figures','animated-characters'))<>7
    OR (SELECT count(*) FROM public.question_groups)<>8 THEN RAISE EXCEPTION 'Original categories or eight groups missing'; END IF;
  IF (SELECT count(*) FROM public.celebrities WHERE wikidata_id IN ('Q76','Q22686') AND is_approved)<>2 THEN RAISE EXCEPTION 'Existing political figures changed'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN ('public.question_groups'::regclass,'public.celebrity_question_groups'::regclass,'public.room_question_groups'::regclass,'public.game_image_assets'::regclass) AND NOT (relrowsecurity AND relforcerowsecurity)) THEN RAISE EXCEPTION 'Private table RLS missing'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS role_name CROSS JOIN unnest(ARRAY['question_groups','celebrity_question_groups','room_question_groups','game_image_assets']) AS table_name WHERE has_table_privilege(role_name,'public.'||table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(role_name,'public.'||table_name,'SELECT,INSERT,UPDATE,REFERENCES')) THEN RAISE EXCEPTION 'Browser private-table privilege'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'game_engine_%' OR proname='room_group_action') AND (prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE') OR NOT has_function_privilege('service_role',oid,'EXECUTE'))) THEN RAISE EXCEPTION 'Unsafe game/group RPC'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE schemaname='public' AND tablename IN ('question_groups','celebrity_question_groups','room_question_groups','game_image_assets','room_questions','celebrities')) THEN RAISE EXCEPTION 'Private table in Realtime publication'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_image_assets WHERE NOT public.game_engine_image_valid(png)) THEN RAISE EXCEPTION 'Invalid image bytes'; END IF;
END;
$verify$;
SELECT grouping.slug,grouping.name,grouping.is_active AND category.is_active AS active,
  count(DISTINCT person.id) FILTER (WHERE person.is_approved AND EXISTS (SELECT 1 FROM public.game_image_assets WHERE celebrity_id=person.id AND is_approved))::integer AS eligible_new_host
FROM public.question_groups AS grouping JOIN public.categories AS category ON category.id=grouping.category_id
LEFT JOIN public.celebrity_question_groups AS member ON member.group_id=grouping.id
LEFT JOIN public.celebrity_categories AS category_member ON category_member.celebrity_id=member.celebrity_id AND category_member.category_id=grouping.category_id
LEFT JOIN public.celebrities AS person ON person.id=category_member.celebrity_id
GROUP BY grouping.id,category.is_active ORDER BY grouping.id;
ROLLBACK;
