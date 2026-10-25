BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE public.question_groups (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z-]+$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.celebrity_question_groups (
  celebrity_id uuid NOT NULL REFERENCES public.celebrities(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES public.question_groups(id) ON DELETE RESTRICT,
  PRIMARY KEY(celebrity_id,group_id)
);
CREATE INDEX celebrity_question_groups_group_idx ON public.celebrity_question_groups(group_id,celebrity_id);
CREATE TABLE public.room_question_groups (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES public.question_groups(id) ON DELETE RESTRICT,
  PRIMARY KEY(room_id,group_id)
);
ALTER TABLE public.question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.celebrity_question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.celebrity_question_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.room_question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_question_groups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_groups,public.celebrity_question_groups,public.room_question_groups FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON public.question_groups,public.celebrity_question_groups,public.room_question_groups TO service_role;

INSERT INTO public.question_groups(id,slug,name,category_id) VALUES
('20000000-0000-4000-8000-000000000001','foreign-actors','國外演員','10000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002','taiwan-actors','台灣演員','10000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000003','english-singers','英語歌手','10000000-0000-4000-8000-000000000002'),
('20000000-0000-4000-8000-000000000004','taiwan-singers','台灣歌手','10000000-0000-4000-8000-000000000002'),
('20000000-0000-4000-8000-000000000005','athletes','運動員','10000000-0000-4000-8000-000000000003'),
('20000000-0000-4000-8000-000000000006','taiwan-politicians','台灣政治人物','10000000-0000-4000-8000-000000000004'),
('20000000-0000-4000-8000-000000000007','taiwan-youtubers','台灣 YouTuber','10000000-0000-4000-8000-000000000008'),
('20000000-0000-4000-8000-000000000008','animated-characters','動畫人物','10000000-0000-4000-8000-000000000007');

CREATE FUNCTION public.game_engine_group_eligible(p_room_id uuid,p_celebrity_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $function$
  SELECT NOT EXISTS (SELECT 1 FROM public.room_question_groups WHERE room_id=p_room_id)
    OR EXISTS (
      SELECT 1 FROM public.room_question_groups AS selected
      JOIN public.question_groups AS grouping ON grouping.id=selected.group_id AND grouping.is_active
      JOIN public.celebrity_question_groups AS member ON member.group_id=grouping.id AND member.celebrity_id=p_celebrity_id
      JOIN public.celebrity_categories AS category_member ON category_member.celebrity_id=member.celebrity_id AND category_member.category_id=grouping.category_id
      JOIN public.room_categories AS room_category ON room_category.room_id=p_room_id AND room_category.category_id=grouping.category_id
      WHERE selected.room_id=p_room_id
    );
$function$;

CREATE FUNCTION public.room_group_action(p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE
  host_row public.hosts;
  room_row public.rooms;
  group_ids uuid[];
  category_ids uuid[];
  existing_ids uuid[];
  result jsonb;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('get-question-groups','create-room')
    OR jsonb_typeof(p_input) IS DISTINCT FROM 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) AS field WHERE field NOT IN ('host_hash','group_ids','room_code','room_token_hash'))
    OR coalesce(p_input->>'host_hash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_INPUT'; END IF;
  SELECT * INTO host_row FROM public.hosts WHERE credential_hash=p_input->>'host_hash' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE='UNAUTHORIZED'; END IF;
  IF p_action='get-question-groups' THEN
    RETURN jsonb_build_object('groups',(
      SELECT jsonb_agg(jsonb_build_object('id',grouping.id,'slug',grouping.slug,'name',grouping.name,
        'categoryId',grouping.category_id,'available',counts.available,
        'selectable',grouping.is_active AND category.is_active AND counts.available>=15,
        'reason',CASE WHEN NOT grouping.is_active OR NOT category.is_active THEN '此分組尚未開放'
          WHEN counts.available<15 THEN '尚有 '||counts.available::text||' 位未使用的合格人物，至少需要 15 位'
          ELSE '' END) ORDER BY grouping.id)
      FROM public.question_groups AS grouping JOIN public.categories AS category ON category.id=grouping.category_id
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT person.id)::integer AS available
        FROM public.celebrity_question_groups AS member JOIN public.celebrities AS person ON person.id=member.celebrity_id AND person.is_approved
        JOIN public.celebrity_categories AS category_member ON category_member.celebrity_id=person.id AND category_member.category_id=grouping.category_id
        WHERE member.group_id=grouping.id
          AND EXISTS (SELECT 1 FROM public.game_image_assets WHERE celebrity_id=person.id AND is_approved)
          AND NOT EXISTS (SELECT 1 FROM public.host_question_history WHERE host_id=host_row.id AND celebrity_id=person.id)
      ) AS counts
    ));
  END IF;
  IF jsonb_typeof(p_input->'group_ids') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'group_ids') NOT BETWEEN 1 AND 8
    OR coalesce(p_input->>'room_code','') !~ '^[A-Z0-9]{6}$'
    OR coalesce(p_input->>'room_token_hash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION USING MESSAGE='INVALID_INPUT'; END IF;
  SELECT array_agg(value::uuid ORDER BY value::uuid) INTO group_ids FROM jsonb_array_elements_text(p_input->'group_ids');
  IF cardinality(group_ids)<>(SELECT count(DISTINCT selected_id) FROM unnest(group_ids) AS selected_id) THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUPS'; END IF;
  SELECT * INTO room_row FROM public.rooms WHERE host_token_hash=p_input->>'room_token_hash';
  IF FOUND THEN
    IF room_row.host_id<>host_row.id THEN RAISE EXCEPTION USING MESSAGE='UNAUTHORIZED'; END IF;
    SELECT array_agg(group_id ORDER BY group_id) INTO existing_ids FROM public.room_question_groups WHERE room_id=room_row.id;
    IF existing_ids IS DISTINCT FROM group_ids THEN RAISE EXCEPTION USING MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
    IF room_row.expires_at<=clock_timestamp() THEN RAISE EXCEPTION USING MESSAGE='ROOM_EXPIRED'; END IF;
    RETURN public.room_system_lobby(room_row.id,'host',host_row.id);
  END IF;
  PERFORM grouping.id FROM public.question_groups AS grouping JOIN public.categories AS category ON category.id=grouping.category_id
    WHERE grouping.id=ANY(group_ids) AND grouping.is_active AND category.is_active ORDER BY grouping.id FOR SHARE OF category;
  IF (SELECT count(*) FROM public.question_groups AS grouping JOIN public.categories AS category ON category.id=grouping.category_id
      WHERE grouping.id=ANY(group_ids) AND grouping.is_active AND category.is_active)<>cardinality(group_ids) THEN RAISE EXCEPTION USING MESSAGE='INVALID_GROUPS'; END IF;
  result:=public.room_group_action('get-question-groups',jsonb_build_object('host_hash',p_input->>'host_hash'));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(result->'groups') AS grouping WHERE (grouping->>'id')::uuid=ANY(group_ids) AND grouping->'selectable'<>'true'::jsonb) THEN
    RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_QUESTIONS';
  END IF;
  SELECT array_agg(DISTINCT category_id ORDER BY category_id) INTO category_ids FROM public.question_groups WHERE id=ANY(group_ids);
  result:=public.room_system_action('create-room',jsonb_build_object('host_hash',p_input->>'host_hash','room_code',p_input->>'room_code',
    'room_token_hash',p_input->>'room_token_hash','category_ids',to_jsonb(category_ids)));
  INSERT INTO public.room_question_groups(room_id,group_id) SELECT (result->'room'->>'id')::uuid,selected_id FROM unnest(group_ids) AS selected_id;
  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.game_engine_action(p_action text, p_input jsonb)
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
      AND public.game_engine_group_eligible(room_row.id,celebrity.id)
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
      AND public.game_engine_group_eligible(room_row.id,celebrity.id)
      AND EXISTS (SELECT 1 FROM public.game_image_assets AS asset WHERE asset.celebrity_id=celebrity.id AND asset.is_approved)
      AND NOT EXISTS (SELECT 1 FROM public.host_question_history AS history WHERE history.host_id=room_row.host_id AND history.celebrity_id=celebrity.id)
      AND NOT EXISTS (SELECT 1 FROM public.room_questions AS used WHERE used.room_id=room_row.id AND used.celebrity_id=celebrity.id)
  ) ORDER BY random() LIMIT 1 FOR SHARE OF category;
  IF drawn_category_id IS NULL THEN RAISE EXCEPTION USING MESSAGE='INSUFFICIENT_QUESTIONS'; END IF;
  SELECT celebrity.id INTO drawn_celebrity_id FROM public.celebrity_categories AS membership
  JOIN public.celebrities AS celebrity ON celebrity.id=membership.celebrity_id AND celebrity.is_approved
  WHERE membership.category_id=drawn_category_id
    AND public.game_engine_group_eligible(room_row.id,celebrity.id)
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


REVOKE ALL ON FUNCTION public.game_engine_group_eligible(uuid,uuid),public.room_group_action(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.game_engine_group_eligible(uuid,uuid),public.room_group_action(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.game_engine_action(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.game_engine_action(text,jsonb) TO service_role;
COMMIT;

