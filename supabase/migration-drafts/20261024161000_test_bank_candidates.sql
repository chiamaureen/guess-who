BEGIN;

CREATE TABLE public.question_bank_candidates (
  id uuid PRIMARY KEY,
  identity_key text NOT NULL UNIQUE CHECK (identity_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  wikidata_id text UNIQUE CHECK (wikidata_id ~ '^Q[1-9][0-9]*$'),
  category_slug text NOT NULL REFERENCES public.categories(slug) ON DELETE RESTRICT,
  group_slug text NOT NULL,
  payload jsonb NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('PENDING','MISSING_IMAGE','REJECTED')),
  is_approved boolean NOT NULL DEFAULT false CHECK (NOT is_approved),
  seed_run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (group_slug IN ('foreign-actors','taiwan-actors') AND category_slug='actors')
    OR (group_slug IN ('english-singers','taiwan-singers') AND category_slug='singers')
    OR (group_slug='athletes' AND category_slug='athletes')
    OR (group_slug='taiwan-politicians' AND category_slug='politicians')
    OR (group_slug='taiwan-youtubers' AND category_slug='youtubers')
    OR (group_slug='animated-characters' AND category_slug='animated-characters')
  ),
  CHECK (jsonb_typeof(payload)='object' AND payload ?& ARRAY['id','identityKey','nameZh','nameOriginal','wikidataId','category','group','sources','approved','image']
    AND payload->>'id'=id::text AND payload->>'identityKey'=identity_key
    AND (payload->>'wikidataId') IS NOT DISTINCT FROM wikidata_id
    AND payload->>'category'=category_slug AND payload->>'group'=group_slug
    AND btrim(payload->>'nameZh')<>'' AND btrim(payload->>'nameOriginal')<>''
    AND payload->'approved'='false'::jsonb
    AND CASE WHEN jsonb_typeof(payload->'sources')='array' THEN jsonb_array_length(payload->'sources')>0 ELSE false END)
);

CREATE INDEX question_bank_candidates_group_idx ON public.question_bank_candidates(group_slug);
ALTER TABLE public.question_bank_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank_candidates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_bank_candidates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.question_bank_candidates TO service_role;

COMMIT;
