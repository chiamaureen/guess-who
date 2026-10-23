BEGIN READ ONLY;

SELECT jsonb_build_object(
  'server_version', current_setting('server_version'),
  'existing_application_relations', (
    SELECT COALESCE(jsonb_agg(relname ORDER BY relname), '[]'::jsonb)
    FROM pg_catalog.pg_class
    JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE nspname = 'public'
      AND relname IN ('categories', 'celebrities', 'celebrity_categories', 'hosts', 'rooms',
                      'room_categories', 'room_players', 'room_questions', 'host_question_history')
  ),
  'roles', (
    SELECT jsonb_agg(jsonb_build_object('role', rolname, 'bypass_rls', rolbypassrls))
    FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
  ),
  'realtime_automatic_publication', (
    SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime' AND puballtables)
      OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication_namespace
        JOIN pg_catalog.pg_publication ON pg_publication.oid = pnpubid
        JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pnnspid
        WHERE pubname = 'supabase_realtime' AND nspname = 'public'
      )
  )
) AS preflight;

COMMIT;
