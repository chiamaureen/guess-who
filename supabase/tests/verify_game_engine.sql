BEGIN TRANSACTION READ ONLY;

SELECT current_setting('server_version') AS postgres_version;

SELECT relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
FROM pg_catalog.pg_class AS relation JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
WHERE namespace.nspname='public' AND relation.relname='game_image_assets';

SELECT procedure.oid::regprocedure AS signature, procedure.prosecdef AS security_definer, procedure.proconfig,
  has_function_privilege('anon',procedure.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',procedure.oid,'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role',procedure.oid,'EXECUTE') AS service_execute
FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
WHERE namespace.nspname='public' AND procedure.proname IN ('game_engine_png_valid','game_engine_state','game_engine_action')
ORDER BY procedure.proname;

SELECT role_name,
  has_table_privilege(role_name,'public.game_image_assets','SELECT') AS can_select,
  has_table_privilege(role_name,'public.game_image_assets','INSERT') AS can_insert,
  has_table_privilege(role_name,'public.game_image_assets','UPDATE') AS can_update,
  has_table_privilege(role_name,'public.game_image_assets','DELETE') AS can_delete,
  has_table_privilege(role_name,'public.game_image_assets','TRUNCATE') AS can_truncate
FROM unnest(ARRAY['anon','authenticated','service_role']) AS role_name;

SELECT constraint_row.conname, constraint_row.convalidated, pg_catalog.pg_get_constraintdef(constraint_row.oid) AS definition
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.conrelid IN ('public.game_image_assets'::regclass,'public.room_questions'::regclass)
ORDER BY constraint_row.conname;

SELECT publication.pubname, publication.puballtables
FROM pg_catalog.pg_publication AS publication;
SELECT schemaname, tablename FROM pg_catalog.pg_publication_tables
WHERE schemaname='public' AND tablename IN ('game_image_assets','celebrities','room_questions','host_question_history');

DO $verify$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('game_engine_png_valid','game_engine_state','game_engine_action')) <> 3 THEN RAISE EXCEPTION 'Missing or unexpected game function overload'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'game_engine_%' AND (prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE') OR NOT has_function_privilege('service_role',oid,'EXECUTE'))) THEN RAISE EXCEPTION 'Unsafe game RPC privilege'; END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.game_image_assets'::regclass) THEN RAISE EXCEPTION 'Missing asset RLS'; END IF;
  IF has_table_privilege('anon','public.game_image_assets','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated','public.game_image_assets','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('service_role','public.game_image_assets','UPDATE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Unsafe asset grants'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.room_questions'::regclass AND conname='room_questions_game_image_fk' AND convalidated) THEN RAISE EXCEPTION 'Missing question image FK'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE schemaname='public' AND tablename IN ('game_image_assets','celebrities','room_questions','host_question_history')) THEN RAISE EXCEPTION 'Private game table in Realtime'; END IF;
END;
$verify$;

ROLLBACK;
