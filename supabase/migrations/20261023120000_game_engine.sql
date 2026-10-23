DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname='supabase_realtime' AND puballtables)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_publication_namespace AS membership JOIN pg_catalog.pg_publication AS publication ON publication.oid=membership.pnpubid JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=membership.pnnspid WHERE publication.pubname='supabase_realtime' AND namespace.nspname='public') THEN
    RAISE EXCEPTION 'Unsafe automatic Realtime publication';
  END IF;
END;
$guard$;

CREATE FUNCTION public.game_engine_png_valid(p_image bytea)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  cursor_position integer := 8;
  chunk_size bigint;
  chunk_type text;
  image_size integer := octet_length(p_image);
  image_width bigint;
  image_height bigint;
  has_header boolean := false;
  has_pixels boolean := false;
  checksum bigint;
  stored_checksum bigint;
  byte_position integer;
  bit_position integer;
BEGIN
  IF image_size < 57 OR image_size > 524288 OR substring(p_image FROM 1 FOR 8) <> decode('89504e470d0a1a0a','hex') THEN RETURN false; END IF;
  WHILE cursor_position + 12 <= image_size LOOP
    chunk_size := get_byte(p_image,cursor_position)::bigint * 16777216 + get_byte(p_image,cursor_position+1) * 65536 + get_byte(p_image,cursor_position+2) * 256 + get_byte(p_image,cursor_position+3);
    IF chunk_size > 524288 OR cursor_position + chunk_size + 12 > image_size THEN RETURN false; END IF;
    checksum := 4294967295;
    FOR byte_position IN cursor_position+4..cursor_position+7+chunk_size::integer LOOP
      checksum := checksum # get_byte(p_image,byte_position)::bigint;
      FOR bit_position IN 1..8 LOOP
        checksum := (checksum >> 1) # CASE WHEN (checksum & 1)=1 THEN 3988292384 ELSE 0 END;
      END LOOP;
    END LOOP;
    checksum := checksum # 4294967295;
    byte_position := cursor_position+8+chunk_size::integer;
    stored_checksum := get_byte(p_image,byte_position)::bigint * 16777216 + get_byte(p_image,byte_position+1) * 65536 + get_byte(p_image,byte_position+2) * 256 + get_byte(p_image,byte_position+3);
    IF checksum <> stored_checksum THEN RETURN false; END IF;
    chunk_type := encode(substring(p_image FROM cursor_position+5 FOR 4),'hex');
    IF chunk_type = '49484452' THEN
      IF has_header OR cursor_position <> 8 OR chunk_size <> 13 THEN RETURN false; END IF;
      image_width := get_byte(p_image,16)::bigint * 16777216 + get_byte(p_image,17) * 65536 + get_byte(p_image,18) * 256 + get_byte(p_image,19);
      image_height := get_byte(p_image,20)::bigint * 16777216 + get_byte(p_image,21) * 65536 + get_byte(p_image,22) * 256 + get_byte(p_image,23);
      IF image_width NOT BETWEEN 1 AND 1600 OR image_height NOT BETWEEN 1 AND 1600 OR get_byte(p_image,24) <> 8 OR get_byte(p_image,25) NOT IN (2,6) OR get_byte(p_image,26) <> 0 OR get_byte(p_image,27) <> 0 OR get_byte(p_image,28) <> 0 THEN RETURN false; END IF;
      has_header := true;
    ELSIF chunk_type = '49444154' THEN
      IF NOT has_header OR chunk_size = 0 THEN RETURN false; END IF;
      has_pixels := true;
    ELSIF chunk_type = '49454e44' THEN
      RETURN has_header AND has_pixels AND chunk_size = 0 AND cursor_position + 12 = image_size;
    ELSE
      RETURN false;
    END IF;
    cursor_position := cursor_position + chunk_size::integer + 12;
  END LOOP;
  RETURN false;
END;
$function$;

CREATE TABLE public.game_image_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celebrity_id uuid NOT NULL REFERENCES public.celebrities(id) ON DELETE RESTRICT,
  png bytea NOT NULL CHECK (public.game_engine_png_valid(png)),
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, celebrity_id)
);
CREATE INDEX game_image_assets_celebrity_idx ON public.game_image_assets(celebrity_id) WHERE is_approved;
ALTER TABLE public.game_image_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_image_assets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_image_assets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON public.game_image_assets TO service_role;

ALTER TABLE public.room_questions ADD COLUMN game_image_id uuid;
ALTER TABLE public.room_questions ADD CONSTRAINT room_questions_game_image_fk
  FOREIGN KEY (game_image_id, celebrity_id) REFERENCES public.game_image_assets(id, celebrity_id) ON DELETE RESTRICT;
CREATE INDEX room_questions_game_image_idx ON public.room_questions(game_image_id, celebrity_id);

CREATE FUNCTION public.game_engine_state(p_room_id uuid, p_role text, p_viewer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT public.room_system_lobby(room.id,p_role,p_viewer_id) || jsonb_build_object(
    'question', CASE WHEN question.id IS NULL THEN NULL ELSE
      jsonb_build_object('id',question.id,'number',question.question_number,'revealed',question.revealed_at IS NOT NULL)
      || CASE WHEN p_role = 'host' OR question.revealed_at IS NOT NULL THEN jsonb_build_object('answer',celebrity.name_zh,
        'attribution',jsonb_build_object('author',celebrity.image_author,'license',celebrity.image_license,'text',celebrity.image_attribution,'source',celebrity.image_source)) ELSE '{}'::jsonb END END
  ) || CASE WHEN p_role = 'host' THEN jsonb_build_object('historyRevision',
    (SELECT md5(coalesce(string_agg(history.celebrity_id::text || ':' || history.id::text,',' ORDER BY history.id),'')) FROM public.host_question_history AS history WHERE history.host_id=room.host_id)) ELSE '{}'::jsonb END
  FROM public.rooms AS room
  LEFT JOIN public.room_questions AS question ON question.room_id=room.id AND question.question_number=room.current_question
  LEFT JOIN public.celebrities AS celebrity ON celebrity.id=question.celebrity_id
  WHERE room.id=p_room_id;
$function$;

CREATE FUNCTION public.game_engine_action(p_action text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  host_row public.hosts;
  room_row public.rooms;
  question_row public.room_questions;
  viewer_id uuid;
  viewer_role text;
  drawn_category_id uuid;
  drawn_celebrity_id uuid;
  drawn_image_id uuid;
  available_count integer;
  current_revision text;
  clock_time timestamptz;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('start-game','get-game-state','get-question-image','reveal-answer','next-question','finish-game','reset-question-history')
    OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) AS field WHERE field NOT IN ('host_hash','room_token_hash','player_hash','room_code','question_id','confirm','history_revision'))
    OR p_input ? 'host_hash' AND p_input ? 'player_hash'
    OR p_input ? 'host_hash' AND coalesce(p_input->>'host_hash','') !~ '^[0-9a-f]{64}$'
    OR p_input ? 'player_hash' AND coalesce(p_input->>'player_hash','') !~ '^[0-9a-f]{64}$'
    OR p_input ? 'room_token_hash' AND coalesce(p_input->>'room_token_hash','') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_INPUT';
  END IF;
  IF p_input ? 'host_hash' THEN
    SELECT * INTO host_row FROM public.hosts WHERE credential_hash=p_input->>'host_hash' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='UNAUTHORIZED'; END IF;
    viewer_id := host_row.id;
    viewer_role := 'host';
  END IF;
  IF p_action='reset-question-history' THEN
    IF host_row.id IS NULL THEN RAISE EXCEPTION USING MESSAGE='FORBIDDEN'; END IF;
    IF p_input->'confirm' IS DISTINCT FROM 'true'::jsonb OR coalesce(p_input->>'history_revision','') !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION USING MESSAGE='CONFIRM_REQUIRED'; END IF;
    IF EXISTS (SELECT 1 FROM public.rooms WHERE host_id=host_row.id AND status='playing') THEN RAISE EXCEPTION USING MESSAGE='GAME_ACTIVE'; END IF;
    SELECT md5(coalesce(string_agg(history.celebrity_id::text || ':' || history.id::text,',' ORDER BY history.id),'')) INTO current_revision FROM public.host_question_history AS history WHERE history.host_id=host_row.id;
    IF current_revision <> p_input->>'history_revision' THEN RAISE EXCEPTION USING MESSAGE='STALE_STATE'; END IF;
    DELETE FROM public.host_question_history WHERE host_id=host_row.id;
    RETURN jsonb_build_object('reset',true);
  END IF;
  IF coalesce(p_input->>'room_code','') !~ '^[A-Z0-9]{6}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_INPUT'; END IF;
  SELECT * INTO room_row FROM public.rooms WHERE room_code=p_input->>'room_code' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='ROOM_NOT_FOUND'; END IF;
  clock_time := clock_timestamp();
  IF viewer_role='host' THEN
    IF room_row.host_id <> host_row.id OR room_row.host_token_hash IS DISTINCT FROM p_input->>'room_token_hash' THEN RAISE EXCEPTION USING MESSAGE='FORBIDDEN'; END IF;
  ELSE
    SELECT id INTO viewer_id FROM public.room_players WHERE room_id=room_row.id AND session_token_hash=p_input->>'player_hash';
    IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='UNAUTHORIZED'; END IF;
    viewer_role := 'player';
  END IF;
  IF p_action NOT IN ('get-game-state','get-question-image') AND viewer_role <> 'host' THEN RAISE EXCEPTION USING MESSAGE='FORBIDDEN'; END IF;
  IF room_row.expires_at <= clock_time AND p_action <> 'finish-game' THEN RAISE EXCEPTION USING MESSAGE='ROOM_EXPIRED'; END IF;
  IF p_action='get-game-state' THEN RETURN public.game_engine_state(room_row.id,viewer_role,viewer_id); END IF;
  SELECT * INTO question_row FROM public.room_questions WHERE room_id=room_row.id AND question_number=room_row.current_question;
  IF p_action IN ('get-question-image','reveal-answer','next-question','finish-game') THEN
    IF coalesce(p_input->>'question_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_INPUT'; END IF;
    IF question_row.id IS DISTINCT FROM (p_input->>'question_id')::uuid THEN
      IF p_action='next-question' AND EXISTS (SELECT 1 FROM public.room_questions WHERE room_id=room_row.id AND id=(p_input->>'question_id')::uuid AND question_number < room_row.current_question AND revealed_at IS NOT NULL) THEN
        RETURN public.game_engine_state(room_row.id,viewer_role,viewer_id);
      END IF;
      RAISE EXCEPTION USING MESSAGE='STALE_STATE';
    END IF;
  END IF;
  IF p_action='get-question-image' THEN
    RETURN (SELECT jsonb_build_object('png',encode(asset.png,'base64')) FROM public.game_image_assets AS asset WHERE asset.id=question_row.game_image_id);
  END IF;
  IF p_action='finish-game' THEN
    IF room_row.status='waiting' THEN RAISE EXCEPTION USING MESSAGE='INVALID_STATE'; END IF;
    IF room_row.status='playing' THEN UPDATE public.rooms SET status='finished',ended_at=clock_time WHERE id=room_row.id; END IF;
    RETURN public.game_engine_state(room_row.id,viewer_role,viewer_id);
  END IF;
  IF p_action='start-game' THEN
    IF room_row.status='playing' THEN RETURN public.game_engine_state(room_row.id,viewer_role,viewer_id); END IF;
    IF room_row.status <> 'waiting' THEN RAISE EXCEPTION USING MESSAGE='INVALID_STATE'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.room_categories AS selected JOIN public.categories AS category ON category.id=selected.category_id WHERE selected.room_id=room_row.id AND category.is_active) THEN RAISE EXCEPTION USING MESSAGE='INVALID_CATEGORIES'; END IF;
    SELECT count(DISTINCT celebrity.id) INTO available_count
    FROM public.room_categories AS selected JOIN public.categories AS category ON category.id=selected.category_id AND category.is_active
    JOIN public.celebrity_categories AS membership ON membership.category_id=category.id
    JOIN public.celebrities AS celebrity ON celebrity.id=membership.celebrity_id AND celebrity.is_approved
    WHERE selected.room_id=room_row.id
      AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id=celebrity.id AND asset.is_approved)
      AND NOT EXISTS (SELECT 1 FROM public.host_question_history AS history WHERE history.host_id=room_row.host_id AND history.celebrity_id=celebrity.id)
      AND NOT EXISTS (SELECT 1 FROM public.room_questions AS used WHERE used.room_id=room_row.id AND used.celebrity_id=celebrity.id);
    IF available_count < 15 THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_QUESTIONS'; END IF;
  ELSE
    IF room_row.status <> 'playing' THEN RAISE EXCEPTION USING MESSAGE='INVALID_STATE'; END IF;
    IF p_action='reveal-answer' THEN
      UPDATE public.room_questions SET revealed_at=coalesce(revealed_at,clock_time) WHERE id=question_row.id;
      RETURN public.game_engine_state(room_row.id,viewer_role,viewer_id);
    END IF;
    IF question_row.revealed_at IS NULL THEN RAISE EXCEPTION USING MESSAGE='ANSWER_NOT_REVEALED'; END IF;
    IF room_row.current_question >= 15 THEN RAISE EXCEPTION USING MESSAGE='LAST_QUESTION'; END IF;
  END IF;
  SELECT category.id INTO drawn_category_id FROM public.room_categories AS selected
  JOIN public.categories AS category ON category.id=selected.category_id AND category.is_active
  WHERE selected.room_id=room_row.id AND EXISTS (
    SELECT 1 FROM public.celebrity_categories AS membership JOIN public.celebrities AS celebrity ON celebrity.id=membership.celebrity_id AND celebrity.is_approved
    WHERE membership.category_id=category.id
      AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id=celebrity.id AND asset.is_approved)
      AND NOT EXISTS (SELECT 1 FROM public.host_question_history AS history WHERE history.host_id=room_row.host_id AND history.celebrity_id=celebrity.id)
      AND NOT EXISTS (SELECT 1 FROM public.room_questions AS used WHERE used.room_id=room_row.id AND used.celebrity_id=celebrity.id)
  ) ORDER BY random() LIMIT 1 FOR SHARE OF category;
  IF drawn_category_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_QUESTIONS'; END IF;
  SELECT celebrity.id INTO drawn_celebrity_id FROM public.celebrity_categories AS membership
  JOIN public.celebrities AS celebrity ON celebrity.id=membership.celebrity_id AND celebrity.is_approved
  WHERE membership.category_id=drawn_category_id
    AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id=celebrity.id AND asset.is_approved)
    AND NOT EXISTS (SELECT 1 FROM public.host_question_history AS history WHERE history.host_id=room_row.host_id AND history.celebrity_id=celebrity.id)
    AND NOT EXISTS (SELECT 1 FROM public.room_questions AS used WHERE used.room_id=room_row.id AND used.celebrity_id=celebrity.id)
  ORDER BY random() LIMIT 1 FOR SHARE OF celebrity;
  SELECT asset.id INTO drawn_image_id FROM public.game_image_assets AS asset WHERE asset.celebrity_id=drawn_celebrity_id AND asset.is_approved ORDER BY asset.id LIMIT 1;
  IF drawn_celebrity_id IS NULL OR drawn_image_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_QUESTIONS'; END IF;
  INSERT INTO public.room_questions(room_id,question_number,category_id,celebrity_id,game_image_id)
    VALUES(room_row.id,room_row.current_question+1,drawn_category_id,drawn_celebrity_id,drawn_image_id);
  INSERT INTO public.host_question_history(host_id,celebrity_id,first_room_id) VALUES(room_row.host_id,drawn_celebrity_id,room_row.id);
  UPDATE public.rooms SET status='playing',started_at=coalesce(started_at,clock_time),current_question=current_question+1 WHERE id=room_row.id;
  RETURN public.game_engine_state(room_row.id,viewer_role,viewer_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.game_engine_png_valid(bytea), public.game_engine_state(uuid,text,uuid), public.game_engine_action(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_engine_png_valid(bytea), public.game_engine_state(uuid,text,uuid), public.game_engine_action(text,jsonb) TO service_role;
