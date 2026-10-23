BEGIN READ ONLY;
SELECT current_setting('server_version') AS postgres_version,
  (SELECT count(*) FROM public.celebrities) AS people,
  (SELECT count(*) FROM public.celebrities WHERE is_approved) AS approved_people,
  (SELECT count(*) FROM public.game_image_assets WHERE is_approved) AS approved_assets,
  (SELECT count(DISTINCT celebrity.id) FROM public.celebrities AS celebrity
   JOIN public.celebrity_categories AS membership ON membership.celebrity_id=celebrity.id
   JOIN public.categories AS category ON category.id=membership.category_id AND category.is_active
   WHERE celebrity.is_approved AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id=celebrity.id AND asset.is_approved)) AS usable_people;
ROLLBACK;
