BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

DO $verify$
DECLARE
  browser_role text;
  denied boolean;
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid='public.game_image_assets'::regclass) THEN
    RAISE EXCEPTION 'Private image RLS missing';
  END IF;
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(browser_role,'public.game_image_assets','SELECT') OR has_any_column_privilege(browser_role,'public.game_image_assets','SELECT') THEN
      RAISE EXCEPTION 'Browser image read privilege detected';
    END IF;
    denied := false;
    EXECUTE format('SET LOCAL ROLE %I',browser_role);
    BEGIN
      EXECUTE 'SELECT png FROM public.game_image_assets LIMIT 1';
    EXCEPTION WHEN insufficient_privilege THEN
      denied := true;
    END;
    RESET ROLE;
    IF NOT denied THEN
      RAISE EXCEPTION 'Browser direct image SELECT was not denied';
    END IF;
  END LOOP;
END;
$verify$;

SELECT 'PASS' AS browser_direct_image_access_denied,
  (SELECT count(*) FROM public.celebrities) AS people,
  (SELECT count(*) FROM public.celebrity_categories) AS category_relationships,
  (SELECT count(*) FROM public.game_image_assets) AS private_images,
  (SELECT count(*) FROM public.celebrities WHERE is_approved
    AND nullif(btrim(image_source),'') IS NOT NULL
    AND nullif(btrim(image_author),'') IS NOT NULL
    AND nullif(btrim(image_license),'') IS NOT NULL
    AND nullif(btrim(image_attribution),'') IS NOT NULL) AS approved_people_with_provenance,
  (SELECT count(DISTINCT celebrity.id) FROM public.celebrities AS celebrity
    JOIN public.celebrity_categories AS membership ON membership.celebrity_id=celebrity.id
    JOIN public.categories AS category ON category.id=membership.category_id AND category.is_active
    WHERE celebrity.is_approved
      AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id=celebrity.id AND asset.is_approved AND public.game_engine_png_valid(asset.png))
      AND NOT EXISTS (SELECT 1 FROM public.host_question_history AS history WHERE history.celebrity_id=celebrity.id)) AS usable_people_never_used_by_any_host,
  jsonb_build_object(
    'categories',(SELECT count(*) FROM public.categories),
    'hosts',(SELECT count(*) FROM public.hosts),
    'rooms',(SELECT count(*) FROM public.rooms),
    'room_categories',(SELECT count(*) FROM public.room_categories),
    'room_players',(SELECT count(*) FROM public.room_players),
    'room_questions',(SELECT count(*) FROM public.room_questions),
    'host_question_history',(SELECT count(*) FROM public.host_question_history)
  ) AS existing_business_counts;

ROLLBACK;
