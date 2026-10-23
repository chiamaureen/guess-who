BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, public;

WITH application_tables AS (
  SELECT relation.*
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = ANY (ARRAY['categories', 'celebrities', 'celebrity_categories', 'hosts', 'rooms', 'room_categories', 'room_players', 'room_questions', 'host_question_history'])
), columns AS (
  SELECT relation.relname, attribute.*, defaults.adbin, defaults.adrelid
  FROM application_tables AS relation
  JOIN pg_attribute AS attribute ON attribute.attrelid = relation.oid
  LEFT JOIN pg_attrdef AS defaults ON defaults.adrelid = relation.oid AND defaults.adnum = attribute.attnum
  WHERE attribute.attnum > 0 AND NOT attribute.attisdropped
), browser_roles AS (
  SELECT unnest(ARRAY['anon', 'authenticated']) AS role_name
)
SELECT jsonb_build_object(
  'server_version', current_setting('server_version'),
  'schema', jsonb_build_object(
    'tables', (SELECT jsonb_agg(jsonb_build_object('name', relname, 'kind', relkind, 'rls', relrowsecurity, 'force_rls', relforcerowsecurity) ORDER BY relname) FROM application_tables),
    'columns', (SELECT jsonb_agg(jsonb_build_object('table', relname, 'position', attnum, 'name', attname, 'type', format_type(atttypid, atttypmod), 'not_null', attnotnull, 'default', pg_get_expr(adbin, adrelid), 'identity', attidentity, 'generated', attgenerated) ORDER BY relname, attnum) FROM columns),
    'constraints', (SELECT jsonb_agg(jsonb_build_object('table', relation.relname, 'name', constraint_row.conname, 'type', constraint_row.contype, 'definition', pg_get_constraintdef(constraint_row.oid), 'valid', constraint_row.convalidated, 'deferrable', constraint_row.condeferrable, 'deferred', constraint_row.condeferred) ORDER BY relation.relname, constraint_row.conname) FROM pg_constraint AS constraint_row JOIN application_tables AS relation ON relation.oid = constraint_row.conrelid WHERE constraint_row.contype <> 'n'),
    'indexes', (SELECT jsonb_agg(jsonb_build_object('table', relation.relname, 'name', index_relation.relname, 'definition', pg_get_indexdef(index_row.indexrelid), 'valid', index_row.indisvalid, 'unique', index_row.indisunique, 'primary', index_row.indisprimary) ORDER BY relation.relname, index_relation.relname) FROM pg_index AS index_row JOIN application_tables AS relation ON relation.oid = index_row.indrelid JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid),
    'table_privileges', (SELECT jsonb_agg(jsonb_build_object('role', role_name, 'table', relname, 'operation', operation, 'allowed', has_table_privilege(role_name, oid, operation)) ORDER BY role_name, relname, operation) FROM application_tables CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role_name CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS operation),
    'public_table_grants', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', relation.relname, 'operation', acl.privilege_type) ORDER BY relation.relname, acl.privilege_type), '[]'::jsonb) FROM application_tables AS relation CROSS JOIN LATERAL aclexplode(relation.relacl) AS acl WHERE acl.grantee = 0),
    'unexpected_column_grants', (SELECT coalesce(jsonb_agg(jsonb_build_object('role', role_name, 'table', relname, 'column', attname, 'operation', operation) ORDER BY role_name, relname, attname, operation), '[]'::jsonb) FROM columns CROSS JOIN browser_roles CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS operation WHERE has_column_privilege(role_name, attrelid, attnum, operation) AND NOT (relname = 'categories' AND operation = 'SELECT')),
    'policies', (SELECT jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'command', cmd, 'permissive', permissive, 'roles', (SELECT jsonb_agg(role_name ORDER BY role_name) FROM unnest(roles) AS role_name), 'using', qual, 'check', with_check) ORDER BY tablename, policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT relname FROM application_tables)),
    'triggers', (SELECT jsonb_agg(jsonb_build_object('table', relation.relname, 'name', trigger_row.tgname, 'enabled', trigger_row.tgenabled, 'definition', pg_get_triggerdef(trigger_row.oid)) ORDER BY relation.relname, trigger_row.tgname) FROM pg_trigger AS trigger_row JOIN application_tables AS relation ON relation.oid = trigger_row.tgrelid WHERE NOT trigger_row.tgisinternal),
    'helper', (SELECT jsonb_build_object('name', proname, 'arguments', pg_get_function_identity_arguments(function_row.oid), 'return_type', pg_get_function_result(function_row.oid), 'language', language.lanname, 'security_definer', prosecdef, 'config', proconfig, 'source_md5', md5(prosrc), 'anon_execute', has_function_privilege('anon', function_row.oid, 'EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated', function_row.oid, 'EXECUTE'), 'service_execute', has_function_privilege('service_role', function_row.oid, 'EXECUTE')) FROM pg_proc AS function_row JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace JOIN pg_language AS language ON language.oid = function_row.prolang WHERE namespace.nspname = 'public' AND function_row.proname = 'guess_who_set_celebrity_updated_at' AND function_row.pronargs = 0)
  ),
  'public_functions', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', function_row.proname, 'arguments', pg_get_function_identity_arguments(function_row.oid), 'return_type', pg_get_function_result(function_row.oid), 'owner', pg_get_userbyid(function_row.proowner), 'config', function_row.proconfig, 'source_md5', md5(function_row.prosrc), 'event_triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', evtname, 'event', evtevent, 'enabled', evtenabled, 'tags', evttags) ORDER BY evtname), '[]'::jsonb) FROM pg_event_trigger WHERE evtfoid = function_row.oid), 'security_definer', function_row.prosecdef, 'anon_execute', has_function_privilege('anon', function_row.oid, 'EXECUTE'), 'authenticated_execute', has_function_privilege('authenticated', function_row.oid, 'EXECUTE')) ORDER BY function_row.proname, function_row.oid), '[]'::jsonb) FROM pg_proc AS function_row JOIN pg_namespace AS namespace ON namespace.oid = function_row.pronamespace WHERE namespace.nspname = 'public'),
  'browser_schema_create', (SELECT jsonb_agg(jsonb_build_object('role', role_name, 'allowed', has_schema_privilege(role_name, 'public', 'CREATE')) ORDER BY role_name) FROM browser_roles),
  'public_views', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', relation.relname, 'kind', relation.relkind, 'anon_select', has_table_privilege('anon', relation.oid, 'SELECT'), 'authenticated_select', has_table_privilege('authenticated', relation.oid, 'SELECT')) ORDER BY relation.relname), '[]'::jsonb) FROM pg_class AS relation JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND relation.relkind IN ('v', 'm')),
  'realtime_tables', (SELECT coalesce(jsonb_agg(tablename ORDER BY tablename), '[]'::jsonb) FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename IN (SELECT relname FROM application_tables))
) AS catalog;

COMMIT;
