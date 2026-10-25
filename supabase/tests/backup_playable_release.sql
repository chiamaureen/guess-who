BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s';
SELECT jsonb_build_object(
  'checkedAt',transaction_timestamp(),'readOnly',current_setting('transaction_read_only'),
  'migrations',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
  'categories',(SELECT coalesce(jsonb_agg(to_jsonb(category) ORDER BY category.id),'[]'::jsonb) FROM public.categories AS category),
  'people',(SELECT coalesce(jsonb_agg(to_jsonb(person) ORDER BY person.id),'[]'::jsonb) FROM public.celebrities AS person),
  'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(member) ORDER BY member.celebrity_id,member.category_id),'[]'::jsonb) FROM public.celebrity_categories AS member),
  'assets',(SELECT coalesce(jsonb_agg(to_jsonb(asset) ORDER BY asset.id),'[]'::jsonb) FROM public.game_image_assets AS asset),
  'functions',(SELECT jsonb_agg(jsonb_build_object('signature',procedure.oid::regprocedure::text,'definition',pg_get_functiondef(procedure.oid),'acl',procedure.proacl) ORDER BY procedure.proname)
    FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public' AND (procedure.proname LIKE 'game_engine_%' OR procedure.proname LIKE 'room_system_%')),
  'imageConstraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid='public.game_image_assets'::regclass),
  'rooms',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',room.id,'digest',md5(to_jsonb(room)::text)) ORDER BY room.id),'[]'::jsonb) FROM public.rooms AS room),
  'questions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',question.id,'digest',md5(to_jsonb(question)::text)) ORDER BY question.id),'[]'::jsonb) FROM public.room_questions AS question),
  'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',history.id,'digest',md5(to_jsonb(history)::text)) ORDER BY history.id),'[]'::jsonb) FROM public.host_question_history AS history)
) AS backup;
ROLLBACK;
