BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.categories WHERE (slug='youtubers' OR id='10000000-0000-4000-8000-000000000008')
    AND NOT (slug='youtubers' AND id='10000000-0000-4000-8000-000000000008')) THEN
    RAISE EXCEPTION 'YouTubers category identity conflict; do not overwrite existing categories';
  END IF;
END;
$guard$;

INSERT INTO public.categories(id,name,slug,is_active)
SELECT '10000000-0000-4000-8000-000000000008','YouTuber','youtubers',false
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE slug='youtubers');

COMMIT;
