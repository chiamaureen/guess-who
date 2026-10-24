BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';

DO $verify$
DECLARE
  category_slugs text[];
BEGIN
  SELECT array_agg(slug ORDER BY slug) INTO category_slugs FROM public.categories;
  IF category_slugs IS DISTINCT FROM ARRAY['actors','animated-characters','athletes','historical-figures','politicians','scientists','singers']::text[]
    OR EXISTS (SELECT 1 FROM public.categories WHERE NOT is_active) THEN
    RAISE EXCEPTION 'Seven active categories must be preserved';
  END IF;
  IF (SELECT count(*) FROM public.celebrities WHERE wikidata_id = ANY(ARRAY['Q11613','Q12325','Q207','Q22686','Q23505','Q34836','Q35648','Q76','Q91','Q9582','Q9588','Q9640','Q9696','Q9916','Q9960'])) <> 15 THEN
    RAISE EXCEPTION 'Original politicians must not be deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.celebrities AS celebrity
    JOIN public.celebrity_categories AS membership ON membership.celebrity_id = celebrity.id
    JOIN public.categories AS category ON category.id = membership.category_id
    WHERE category.slug = 'athletes' AND NOT celebrity.is_approved
      AND celebrity.image_url ~ '^https://upload[.]wikimedia[.]org/'
      AND celebrity.image_source ~ '^https://commons[.]wikimedia[.]org/wiki/File:'
      AND nullif(btrim(celebrity.image_author),'') IS NOT NULL
      AND nullif(btrim(celebrity.image_license),'') IS NOT NULL
      AND nullif(btrim(celebrity.image_attribution),'') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id = celebrity.id)) THEN
    RAISE EXCEPTION 'Link-only draft metadata not found';
  END IF;
END;
$verify$;

SELECT 'LINK_METADATA_ONLY_NOT_GAME_READY' AS result,
  (SELECT count(*) FROM public.categories) AS categories,
  (SELECT count(*) FROM public.celebrities) AS people,
  (SELECT count(*) FROM public.celebrity_categories) AS memberships,
  (SELECT count(*) FROM public.game_image_assets) AS existing_private_images,
  (SELECT count(*) FROM public.rooms) AS rooms,
  (SELECT count(*) FROM public.room_questions) AS questions,
  (SELECT count(*) FROM public.host_question_history) AS history;

ROLLBACK;
