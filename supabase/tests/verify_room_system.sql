BEGIN READ ONLY;

WITH functions AS (
  SELECT procedure.oid, procedure.proname, procedure.prosecdef, procedure.proconfig
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public' AND procedure.proname IN ('room_system_action', 'room_system_lobby', 'room_system_rate_limit')
), private_tables AS (
  SELECT relation.oid, relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relkind = 'r'
    AND relation.relname IN ('celebrities', 'celebrity_categories', 'hosts', 'rooms', 'room_categories', 'room_players', 'room_questions', 'host_question_history', 'room_api_rate_limits')
)
SELECT jsonb_build_object(
  'server_version', current_setting('server_version'),
  'private_tables', (SELECT jsonb_agg(jsonb_build_object('name', relname, 'rls', relrowsecurity, 'force_rls', relforcerowsecurity) ORDER BY relname) FROM private_tables),
  'browser_safe', (SELECT count(*) = 9 AND bool_and(relrowsecurity AND relforcerowsecurity AND NOT pg_catalog.has_table_privilege('anon', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND NOT pg_catalog.has_table_privilege('authenticated', oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) FROM private_tables),
  'rpc_service_only', (SELECT count(*) = 3 AND bool_and(NOT prosecdef AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE') AND pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')) FROM functions),
  'functions', (SELECT jsonb_agg(jsonb_build_object('name', proname, 'security_definer', prosecdef, 'config', proconfig, 'anon_execute', pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'), 'authenticated_execute', pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'), 'service_execute', pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE')) ORDER BY proname) FROM functions),
  'realtime_exposed', (SELECT coalesce(jsonb_agg(tablename), '[]'::jsonb) FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN (SELECT relname FROM private_tables))
) AS verification;

COMMIT;
