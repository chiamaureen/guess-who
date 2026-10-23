INSERT INTO public.categories (id, name, slug)
VALUES
  ('10000000-0000-4000-8000-000000000001', '演員', 'actors'),
  ('10000000-0000-4000-8000-000000000002', '歌手', 'singers'),
  ('10000000-0000-4000-8000-000000000003', '運動員', 'athletes'),
  ('10000000-0000-4000-8000-000000000004', '政治人物', 'politicians'),
  ('10000000-0000-4000-8000-000000000005', '科學家', 'scientists'),
  ('10000000-0000-4000-8000-000000000006', '歷史人物', 'historical-figures'),
  ('10000000-0000-4000-8000-000000000007', '動畫人物', 'animated-characters')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;
