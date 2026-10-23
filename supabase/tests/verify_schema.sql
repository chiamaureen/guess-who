BEGIN READ ONLY;

DO $verify$
DECLARE
  browser_role text;
  table_name text;
  active_count bigint;
  visible_count bigint;
BEGIN
  SELECT count(*) INTO active_count FROM public.categories WHERE is_active;
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', browser_role);
    SELECT count(*) INTO visible_count FROM public.categories;
    IF visible_count <> active_count OR EXISTS (SELECT 1 FROM public.categories WHERE NOT is_active) THEN
      RAISE EXCEPTION 'Category policy verification failed for %', browser_role;
    END IF;
    FOREACH table_name IN ARRAY ARRAY['celebrities', 'celebrity_categories', 'hosts', 'rooms', 'room_categories', 'room_players', 'room_questions', 'host_question_history'] LOOP
      BEGIN
        EXECUTE format('SELECT * FROM public.%I LIMIT 0', table_name);
        RAISE EXCEPTION 'Private table SELECT unexpectedly allowed: % / %', browser_role, table_name;
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
END;
$verify$;

WITH application_tables AS (
  SELECT relation.oid, relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
    AND relation.relname = ANY (ARRAY['categories', 'celebrities', 'celebrity_categories', 'hosts', 'rooms', 'room_categories', 'room_players', 'room_questions', 'host_question_history'])
), browser_privilege_violations AS (
  SELECT browser_role, table_name, operation
  FROM unnest(ARRAY['anon', 'authenticated']) AS browser_role
  CROSS JOIN application_tables
  CROSS JOIN LATERAL (SELECT relname AS table_name) AS names
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS operation
  WHERE pg_catalog.has_table_privilege(browser_role, oid, operation)
    AND NOT (relname = 'categories' AND operation = 'SELECT')
), service_privilege_violations AS (
  SELECT relname AS table_name, operation
  FROM application_tables
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS operation
  WHERE pg_catalog.has_table_privilege('service_role', oid, operation) <> (operation IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
)
SELECT jsonb_build_object(
  'server_version', current_setting('server_version'),
  'tables', (SELECT jsonb_agg(jsonb_build_object('name', relname, 'rls', relrowsecurity, 'force_rls', relforcerowsecurity) ORDER BY relname) FROM application_tables),
  'categories', (SELECT jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'active', is_active) ORDER BY slug) FROM public.categories),
  'browser_privilege_violations', (SELECT coalesce(jsonb_agg(to_jsonb(violations)), '[]'::jsonb) FROM browser_privilege_violations AS violations),
  'service_privilege_violations', (SELECT coalesce(jsonb_agg(to_jsonb(violations)), '[]'::jsonb) FROM service_privilege_violations AS violations),
  'policies', (SELECT jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'command', cmd, 'roles', roles, 'using', qual) ORDER BY tablename, policyname) FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT relname FROM application_tables)),
  'invalid_constraints', (SELECT coalesce(jsonb_agg(conname), '[]'::jsonb) FROM pg_catalog.pg_constraint WHERE conrelid IN (SELECT oid FROM application_tables) AND NOT convalidated),
  'indexes', (SELECT jsonb_agg(jsonb_build_object('name', indexrelid::regclass::text, 'valid', indisvalid, 'unique', indisunique) ORDER BY indexrelid::regclass::text) FROM pg_catalog.pg_index WHERE indrelid IN (SELECT oid FROM application_tables)),
  'trigger_helper', (SELECT jsonb_build_object('security_definer', prosecdef, 'anon_execute', pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'), 'authenticated_execute', pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')) FROM pg_catalog.pg_proc WHERE oid = 'public.guess_who_set_celebrity_updated_at()'::regprocedure),
  'realtime_exposed_tables', (SELECT coalesce(jsonb_agg(tablename), '[]'::jsonb) FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN (SELECT relname FROM application_tables)),
  'automatic_realtime_publication', EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime' AND puballtables) OR EXISTS (SELECT 1 FROM pg_catalog.pg_publication_namespace AS membership JOIN pg_catalog.pg_publication AS publication ON publication.oid = membership.pnpubid JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = membership.pnnspid WHERE publication.pubname = 'supabase_realtime' AND namespace.nspname = 'public')
) AS verification;

COMMIT;
