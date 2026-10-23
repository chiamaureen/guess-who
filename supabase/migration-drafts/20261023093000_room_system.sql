CREATE TABLE public.room_api_rate_limits (
  scope_hash text PRIMARY KEY CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX room_api_rate_limits_updated_idx ON public.room_api_rate_limits(updated_at);
ALTER TABLE public.room_api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_api_rate_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_api_rate_limits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_api_rate_limits TO service_role;

CREATE FUNCTION public.room_system_rate_limit(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  clock_time timestamptz;
  rate_row public.room_api_rate_limits;
  allowed boolean := true;
  authenticated boolean := false;
  retry_after integer := 0;
  window_seconds integer;
  request_limit integer;
  action_name text;
  bootstrap boolean;
  source_bucket integer;
  identity_id uuid;
  identity_kind text;
  scope_name text;
  scope_digest text;
  stage integer;
BEGIN
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_INPUT';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_request) AS field WHERE field NOT IN ('action', 'bootstrap', 'source_bucket', 'host_hash', 'player_hash', 'room_code'))
    OR jsonb_typeof(p_request->'action') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_request->'bootstrap') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_request->'source_bucket') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_INPUT';
  END IF;
  action_name := p_request->>'action';
  bootstrap := (p_request->>'bootstrap')::boolean;
  IF action_name NOT IN ('host-session', 'create-room', 'join-room', 'get-room-state', 'leave-room', 'close-room')
    OR bootstrap AND action_name <> 'host-session'
    OR (p_request->>'source_bucket') !~ '^(0|[1-9][0-9]{0,2})$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_INPUT';
  END IF;
  source_bucket := (p_request->>'source_bucket')::integer;
  IF source_bucket > 255
    OR p_request ? 'host_hash' AND coalesce(p_request->>'host_hash', '') !~ '^[0-9a-f]{64}$'
    OR p_request ? 'player_hash' AND coalesce(p_request->>'player_hash', '') !~ '^[0-9a-f]{64}$'
    OR p_request ? 'room_code' AND coalesce(p_request->>'room_code', '') !~ '^[A-Z0-9]{6}$'
    OR p_request ? 'host_hash' AND p_request ? 'player_hash' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_INPUT';
  END IF;
  FOR stage IN 0..2 LOOP
    window_seconds := CASE WHEN bootstrap THEN 600 ELSE 60 END;
    IF stage = 0 THEN
      scope_name := 'global:' || action_name || ':' || bootstrap::text;
      request_limit := CASE WHEN bootstrap THEN 30 WHEN action_name = 'get-room-state' THEN 600 ELSE 120 END;
    ELSIF stage = 1 THEN
      scope_name := 'source:' || action_name || ':' || bootstrap::text || ':' || source_bucket::text;
      request_limit := CASE WHEN bootstrap THEN 5 ELSE 30 END;
    ELSE
      IF p_request ? 'host_hash' THEN
        SELECT id INTO identity_id FROM public.hosts WHERE credential_hash = p_request->>'host_hash';
        identity_kind := 'host';
      ELSIF p_request ? 'player_hash' THEN
        SELECT player.id INTO identity_id FROM public.room_players AS player
        JOIN public.rooms AS room ON room.id = player.room_id
        WHERE player.session_token_hash = p_request->>'player_hash' AND room.room_code = p_request->>'room_code';
        identity_kind := 'player';
      ELSE
        authenticated := bootstrap OR action_name = 'join-room';
        EXIT;
      END IF;
      authenticated := identity_id IS NOT NULL;
      EXIT WHEN NOT authenticated;
      scope_name := 'identity:' || identity_kind || ':' || action_name || ':' || identity_id::text;
      window_seconds := 60;
      request_limit := CASE WHEN action_name = 'create-room' THEN 5 ELSE 30 END;
    END IF;
    scope_digest := encode(sha256(convert_to('guess-who:rate:v2:' || scope_name, 'UTF8')), 'hex');
    clock_time := clock_timestamp();
    INSERT INTO public.room_api_rate_limits (scope_hash, window_started_at, request_count, updated_at)
    VALUES (scope_digest, clock_time, 1, clock_time)
    ON CONFLICT (scope_hash) DO UPDATE SET
      window_started_at = CASE WHEN room_api_rate_limits.window_started_at + make_interval(secs => window_seconds) <= clock_time THEN clock_time ELSE room_api_rate_limits.window_started_at END,
      request_count = CASE WHEN room_api_rate_limits.window_started_at + make_interval(secs => window_seconds) <= clock_time THEN 1 ELSE least(room_api_rate_limits.request_count + 1, 1000000) END,
      updated_at = clock_time
    RETURNING * INTO rate_row;
    clock_time := clock_timestamp();
    IF rate_row.request_count > request_limit THEN
      allowed := false;
      retry_after := ceil(extract(epoch FROM rate_row.window_started_at + make_interval(secs => window_seconds) - clock_time))::integer;
      EXIT;
    END IF;
  END LOOP;
  clock_time := clock_timestamp();
  WITH stale AS (
    SELECT scope_hash FROM public.room_api_rate_limits WHERE updated_at < clock_time - interval '24 hours'
    ORDER BY scope_hash LIMIT 100 FOR UPDATE SKIP LOCKED
  ) DELETE FROM public.room_api_rate_limits AS rate USING stale WHERE rate.scope_hash = stale.scope_hash;
  RETURN jsonb_build_object('allowed', allowed, 'authenticated', authenticated, 'retryAfter', greatest(retry_after, 1));
END;
$function$;

CREATE FUNCTION public.room_system_lobby(p_room_id uuid, p_role text, p_viewer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'room', jsonb_build_object('id', room.id, 'code', room.room_code, 'status', room.status, 'currentQuestion', room.current_question, 'totalQuestions', room.total_questions, 'expiresAt', room.expires_at),
    'categories', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', category.id, 'name', category.name, 'slug', category.slug) ORDER BY category.slug), '[]'::jsonb) FROM public.room_categories AS selected JOIN public.categories AS category ON category.id = selected.category_id WHERE selected.room_id = room.id),
    'players', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', player.id, 'nickname', player.nickname, 'joinedAt', player.joined_at) ORDER BY player.joined_at, player.id), '[]'::jsonb) FROM public.room_players AS player WHERE player.room_id = room.id),
    'viewer', jsonb_build_object('role', p_role, 'id', p_viewer_id)
  ) FROM public.rooms AS room WHERE room.id = p_room_id;
$function$;

CREATE FUNCTION public.room_system_action(p_action text, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  host_row public.hosts;
  room_row public.rooms;
  player_row public.room_players;
  selected_ids uuid[];
  existing_ids uuid[];
  clock_time timestamptz := clock_timestamp();
  violation_name text;
BEGIN
  IF p_action NOT IN ('host-session', 'create-room', 'join-room', 'get-room-state', 'leave-room', 'close-room') OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_INPUT';
  END IF;
  IF p_action = 'host-session' AND p_input->>'mode' = 'bootstrap' THEN
    INSERT INTO public.hosts (credential_hash) VALUES (p_input->>'host_hash')
    ON CONFLICT (credential_hash) DO UPDATE SET last_seen_at = clock_time
    RETURNING * INTO host_row;
    RETURN jsonb_build_object('hostId', host_row.id);
  END IF;

  IF p_input->>'host_hash' IS NOT NULL THEN
    SELECT * INTO host_row FROM public.hosts WHERE credential_hash = p_input->>'host_hash' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'UNAUTHORIZED'; END IF;
    UPDATE public.hosts SET last_seen_at = clock_time WHERE id = host_row.id;
  END IF;

  IF p_action = 'host-session' THEN
    IF host_row.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'UNAUTHORIZED'; END IF;
    IF p_input->>'mode' = 'revoke' THEN
      IF EXISTS (SELECT 1 FROM public.rooms WHERE host_id = host_row.id AND status IN ('waiting', 'playing') AND expires_at > clock_time) THEN
        RAISE EXCEPTION USING MESSAGE = 'ACTIVE_ROOMS';
      END IF;
      UPDATE public.hosts SET credential_hash = p_input->>'revoke_hash' WHERE id = host_row.id;
      RETURN jsonb_build_object('revoked', true);
    END IF;
    IF p_input->>'mode' <> 'resume' THEN RAISE EXCEPTION USING MESSAGE = 'INVALID_INPUT'; END IF;
    RETURN jsonb_build_object('hostId', host_row.id);
  END IF;

  IF p_action = 'create-room' THEN
    IF host_row.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'UNAUTHORIZED'; END IF;
    SELECT array_agg(value::uuid ORDER BY value::uuid) INTO selected_ids FROM jsonb_array_elements_text(p_input->'category_ids');
    IF coalesce(cardinality(selected_ids), 0) NOT BETWEEN 1 AND 32 OR cardinality(selected_ids) <> (SELECT count(DISTINCT selected_id) FROM unnest(selected_ids) AS selected_id) THEN
      RAISE EXCEPTION USING MESSAGE = 'INVALID_CATEGORIES';
    END IF;
    SELECT * INTO room_row FROM public.rooms WHERE host_token_hash = p_input->>'room_token_hash';
    IF FOUND THEN
      IF room_row.host_id <> host_row.id THEN RAISE EXCEPTION USING MESSAGE = 'UNAUTHORIZED'; END IF;
      SELECT array_agg(category_id ORDER BY category_id) INTO existing_ids FROM public.room_categories WHERE room_id = room_row.id;
      IF existing_ids IS DISTINCT FROM selected_ids THEN RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT'; END IF;
      IF room_row.expires_at <= clock_time THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_EXPIRED'; END IF;
      RETURN public.room_system_lobby(room_row.id, 'host', host_row.id);
    END IF;
    PERFORM id FROM public.categories WHERE id = ANY(selected_ids) AND is_active ORDER BY id FOR SHARE;
    IF (SELECT count(*) FROM public.categories WHERE id = ANY(selected_ids) AND is_active) <> cardinality(selected_ids) THEN
      RAISE EXCEPTION USING MESSAGE = 'INVALID_CATEGORIES';
    END IF;
    IF (SELECT count(*) FROM public.rooms WHERE host_id = host_row.id AND status IN ('waiting', 'playing') AND expires_at > clock_time) >= 5 THEN
      RAISE EXCEPTION USING MESSAGE = 'ROOM_LIMIT';
    END IF;
    BEGIN
      INSERT INTO public.rooms (room_code, host_id, host_token_hash)
      VALUES (p_input->>'room_code', host_row.id, p_input->>'room_token_hash') RETURNING * INTO room_row;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS violation_name = CONSTRAINT_NAME;
      IF violation_name = 'rooms_room_code_key' THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_CODE_COLLISION'; END IF;
      RAISE;
    END;
    INSERT INTO public.room_categories (room_id, category_id) SELECT room_row.id, selected_id FROM unnest(selected_ids) AS selected_id;
    RETURN public.room_system_lobby(room_row.id, 'host', host_row.id);
  END IF;

  SELECT * INTO room_row FROM public.rooms WHERE room_code = p_input->>'room_code' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_NOT_FOUND'; END IF;

  IF p_action = 'join-room' THEN
    IF room_row.expires_at <= clock_time THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_EXPIRED'; END IF;
    IF room_row.status = 'finished' THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_CLOSED'; END IF;
    IF room_row.status <> 'waiting' THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_IN_PROGRESS'; END IF;
    SELECT * INTO player_row FROM public.room_players WHERE session_token_hash = p_input->>'player_hash';
    IF FOUND THEN
      IF player_row.room_id <> room_row.id THEN RAISE EXCEPTION USING MESSAGE = 'UNAUTHORIZED'; END IF;
      IF player_row.nickname <> p_input->>'nickname' THEN RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT'; END IF;
      UPDATE public.room_players SET last_seen_at = clock_time WHERE id = player_row.id;
    ELSE
      IF (SELECT count(*) FROM public.room_players WHERE room_id = room_row.id) >= 100 THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_FULL'; END IF;
      INSERT INTO public.room_players (room_id, nickname, session_token_hash)
      VALUES (room_row.id, p_input->>'nickname', p_input->>'player_hash') RETURNING * INTO player_row;
    END IF;
    RETURN public.room_system_lobby(room_row.id, 'player', player_row.id);
  END IF;

  IF host_row.id IS NOT NULL THEN
    IF room_row.host_id <> host_row.id OR room_row.host_token_hash IS DISTINCT FROM p_input->>'room_token_hash' THEN
      RAISE EXCEPTION USING MESSAGE = 'FORBIDDEN';
    END IF;
  ELSE
    SELECT * INTO player_row FROM public.room_players WHERE room_id = room_row.id AND session_token_hash = p_input->>'player_hash';
    IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'UNAUTHORIZED'; END IF;
  END IF;

  IF p_action = 'leave-room' THEN
    IF player_row.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'FORBIDDEN'; END IF;
    DELETE FROM public.room_players WHERE id = player_row.id;
    RETURN jsonb_build_object('left', true);
  END IF;
  IF room_row.expires_at <= clock_time THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_EXPIRED'; END IF;
  IF p_action = 'close-room' THEN
    IF host_row.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'FORBIDDEN'; END IF;
    IF room_row.status = 'playing' THEN RAISE EXCEPTION USING MESSAGE = 'ROOM_IN_PROGRESS'; END IF;
    IF room_row.status = 'waiting' THEN
      UPDATE public.rooms SET status = 'finished', ended_at = clock_time WHERE id = room_row.id;
    END IF;
  END IF;
  RETURN public.room_system_lobby(room_row.id, CASE WHEN host_row.id IS NULL THEN 'player' ELSE 'host' END, coalesce(host_row.id, player_row.id));
END;
$function$;

REVOKE ALL ON FUNCTION public.room_system_rate_limit(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.room_system_lobby(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.room_system_action(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.room_system_rate_limit(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.room_system_lobby(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.room_system_action(text, jsonb) TO service_role;
