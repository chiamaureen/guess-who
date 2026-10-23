SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime' AND puballtables
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_namespace AS publication_schema
    JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_schema.pnpubid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = publication_schema.pnnspid
    WHERE publication.pubname = 'supabase_realtime' AND namespace.nspname = 'public'
  ) THEN
    RAISE EXCEPTION 'Unsafe Realtime publication: review automatic public table publication before applying this migration';
  END IF;
END;
$guard$;

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.celebrities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wikidata_id text UNIQUE CHECK (wikidata_id ~ '^Q[1-9][0-9]*$'),
  name_zh text NOT NULL CHECK (btrim(name_zh) <> ''),
  name_en text CHECK (btrim(name_en) <> ''),
  subject_type text NOT NULL CHECK (subject_type IN ('real_person', 'fictional_character')),
  image_url text NOT NULL CHECK (image_url ~ '^https://[^[:space:]]+$'),
  image_source text NOT NULL CHECK (image_source ~ '^https://[^[:space:]]+$'),
  image_author text NOT NULL CHECK (btrim(image_author) <> ''),
  image_license text NOT NULL CHECK (btrim(image_license) <> ''),
  image_attribution text NOT NULL CHECK (btrim(image_attribution) <> ''),
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (updated_at >= created_at)
);

CREATE TABLE public.celebrity_categories (
  celebrity_id uuid NOT NULL REFERENCES public.celebrities(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (celebrity_id, category_id)
);

CREATE TABLE public.hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_seen_at >= created_at)
);

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text NOT NULL UNIQUE CHECK (room_code ~ '^[A-Z0-9]{6}$'),
  host_id uuid NOT NULL REFERENCES public.hosts(id) ON DELETE RESTRICT,
  host_token_hash text NOT NULL UNIQUE CHECK (host_token_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  current_question integer NOT NULL DEFAULT 0 CHECK (current_question BETWEEN 0 AND 15),
  total_questions integer NOT NULL DEFAULT 15 CHECK (total_questions = 15),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (id, host_id),
  CHECK (expires_at > created_at),
  CHECK (started_at IS NULL OR started_at >= created_at),
  CHECK (ended_at IS NULL OR ended_at >= COALESCE(started_at, created_at)),
  CHECK (
    (status = 'waiting' AND current_question = 0 AND started_at IS NULL AND ended_at IS NULL)
    OR (status = 'playing' AND current_question BETWEEN 1 AND 15 AND started_at IS NOT NULL AND ended_at IS NULL)
    OR (status = 'finished' AND ended_at IS NOT NULL AND (
      (current_question = 0 AND started_at IS NULL)
      OR (current_question BETWEEN 1 AND 15 AND started_at IS NOT NULL)
    ))
  )
);

CREATE TABLE public.room_categories (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (room_id, category_id)
);

CREATE TABLE public.room_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 20),
  session_token_hash text NOT NULL UNIQUE CHECK (session_token_hash ~ '^[0-9a-f]{64}$'),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_seen_at >= joined_at)
);

CREATE TABLE public.room_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  question_number integer NOT NULL CHECK (question_number BETWEEN 1 AND 15),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  celebrity_id uuid NOT NULL REFERENCES public.celebrities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revealed_at timestamptz CHECK (revealed_at >= created_at),
  UNIQUE (room_id, question_number),
  UNIQUE (room_id, celebrity_id),
  FOREIGN KEY (room_id, category_id) REFERENCES public.room_categories(room_id, category_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (celebrity_id, category_id) REFERENCES public.celebrity_categories(celebrity_id, category_id)
    ON DELETE RESTRICT
);

CREATE TABLE public.host_question_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES public.hosts(id) ON DELETE RESTRICT,
  celebrity_id uuid NOT NULL REFERENCES public.celebrities(id) ON DELETE RESTRICT,
  first_room_id uuid,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (host_id, celebrity_id),
  FOREIGN KEY (first_room_id, host_id) REFERENCES public.rooms(id, host_id)
    ON DELETE SET NULL (first_room_id),
  FOREIGN KEY (first_room_id, celebrity_id) REFERENCES public.room_questions(room_id, celebrity_id)
    ON DELETE SET NULL (first_room_id)
);

CREATE INDEX celebrity_categories_category_idx ON public.celebrity_categories(category_id, celebrity_id);
CREATE INDEX celebrities_approved_idx ON public.celebrities(id) WHERE is_approved;
CREATE INDEX rooms_host_status_idx ON public.rooms(host_id, status);
CREATE INDEX rooms_expiration_idx ON public.rooms(expires_at) WHERE status <> 'finished';
CREATE INDEX room_categories_category_idx ON public.room_categories(category_id, room_id);
CREATE INDEX room_players_room_idx ON public.room_players(room_id);
CREATE INDEX room_questions_room_category_idx ON public.room_questions(room_id, category_id);
CREATE INDEX room_questions_celebrity_category_idx ON public.room_questions(celebrity_id, category_id);
CREATE INDEX room_questions_category_idx ON public.room_questions(category_id);
CREATE INDEX host_question_history_celebrity_idx ON public.host_question_history(celebrity_id);
CREATE INDEX host_question_history_first_room_host_idx ON public.host_question_history(first_room_id, host_id);
CREATE INDEX host_question_history_first_room_celebrity_idx ON public.host_question_history(first_room_id, celebrity_id);

CREATE FUNCTION public.guess_who_set_celebrity_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guess_who_set_celebrity_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guess_who_set_celebrity_updated_at() TO service_role;

CREATE TRIGGER celebrities_updated_at
BEFORE UPDATE ON public.celebrities
FOR EACH ROW EXECUTE FUNCTION public.guess_who_set_celebrity_updated_at();

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.categories FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.categories TO service_role;

ALTER TABLE public.celebrities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celebrities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.celebrities FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.celebrities TO service_role;

ALTER TABLE public.celebrity_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celebrity_categories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.celebrity_categories FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.celebrity_categories TO service_role;

ALTER TABLE public.hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hosts TO service_role;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rooms FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rooms TO service_role;

ALTER TABLE public.room_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_categories FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.room_categories FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.room_categories TO service_role;

ALTER TABLE public.room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_players FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.room_players FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.room_players TO service_role;

ALTER TABLE public.room_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_questions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.room_questions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.room_questions TO service_role;

ALTER TABLE public.host_question_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_question_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.host_question_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.host_question_history TO service_role;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON TABLE public.categories TO anon, authenticated;
CREATE POLICY categories_read_active ON public.categories
FOR SELECT TO anon, authenticated USING (is_active);
