BEGIN READ ONLY;
SELECT jsonb_build_object(
  'messages_rls',(SELECT jsonb_build_object('rls',relation.relrowsecurity,'force_rls',relation.relforcerowsecurity) FROM pg_catalog.pg_class AS relation WHERE relation.oid='realtime.messages'::regclass),
  'privileges',(SELECT jsonb_agg(jsonb_build_object('role',role_name,'schema_usage',has_schema_privilege(role_name,'realtime','USAGE'),'can_select',has_table_privilege(role_name,'realtime.messages','SELECT'),'can_insert',has_table_privilege(role_name,'realtime.messages','INSERT'))) FROM unnest(ARRAY['anon','authenticated','service_role']) AS role_name),
  'policies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check) ORDER BY policyname),'[]') FROM pg_catalog.pg_policies WHERE schemaname='realtime' AND tablename='messages'),
  'published_app_tables',(SELECT coalesce(jsonb_agg(tablename ORDER BY tablename),'[]') FROM pg_catalog.pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public')
) AS review;
ROLLBACK;
