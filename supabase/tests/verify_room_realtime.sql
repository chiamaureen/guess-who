BEGIN READ ONLY;

DO $verify$
DECLARE
  role_name text;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.room_realtime_grants'::regclass) THEN RAISE EXCEPTION 'Realtime grant RLS missing'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(role_name,'public.room_realtime_grants','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(role_name,'public.room_realtime_grants','SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Private grant privileges exposed'; END IF;
    IF has_function_privilege(role_name,'public.room_realtime_grant(jsonb)','EXECUTE') OR has_function_privilege(role_name,'public.room_realtime_notify()','EXECUTE') THEN RAISE EXCEPTION 'Realtime privileged function exposed'; END IF;
    IF has_table_privilege(role_name,'public.room_questions','SELECT') OR has_table_privilege(role_name,'public.game_image_assets','SELECT') OR has_table_privilege(role_name,'public.celebrities','SELECT') THEN RAISE EXCEPTION 'Private game table exposed'; END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role','public.room_realtime_grant(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Missing backend grant privilege'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('room_realtime_grant','room_realtime_can_receive','room_realtime_notify')) <> 3 THEN RAISE EXCEPTION 'Missing or unexpected realtime function overload'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('room_realtime_grant','room_realtime_can_receive','room_realtime_notify') AND proconfig IS DISTINCT FROM ARRAY['search_path=""']) THEN RAISE EXCEPTION 'Unsafe realtime search_path'; END IF;
  IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.room_realtime_grant(jsonb)'::regprocedure) THEN RAISE EXCEPTION 'Grant RPC must be INVOKER'; END IF;
  IF NOT (SELECT prosecdef AND prorettype='boolean'::regtype FROM pg_catalog.pg_proc WHERE oid='public.room_realtime_can_receive(text)'::regprocedure) THEN RAISE EXCEPTION 'Unsafe authorization helper contract'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid='realtime.messages'::regclass AND polname IN ('guess_who_receive_guard','guess_who_no_client_broadcast') AND NOT polpermissive) <> 2 THEN RAISE EXCEPTION 'Missing restrictive broadcast guards'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgname IN ('room_realtime_room','room_realtime_players','room_realtime_questions') AND NOT tgisinternal AND tgenabled='O') <> 3 THEN RAISE EXCEPTION 'Missing realtime invalidation trigger'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE schemaname='public' AND tablename IN ('rooms','room_players','room_questions','game_image_assets','celebrities','room_realtime_grants')) THEN RAISE EXCEPTION 'Sensitive app table exposed in publication'; END IF;
END;
$verify$;

SELECT 'PASS' AS room_realtime_catalog_review;
ROLLBACK;
