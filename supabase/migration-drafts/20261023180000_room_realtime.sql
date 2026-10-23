BEGIN;

CREATE TABLE public.room_realtime_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL,
  viewer_role text NOT NULL CHECK (viewer_role IN ('host','player')),
  credential_snapshot text NOT NULL CHECK (credential_snapshot ~ '^[0-9a-f]{64}$'),
  room_token_snapshot text CHECK (room_token_snapshot ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  UNIQUE (room_id,viewer_role,viewer_id)
);
CREATE INDEX room_realtime_grants_expiry_idx ON public.room_realtime_grants(expires_at);
ALTER TABLE public.room_realtime_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_realtime_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.room_realtime_grants FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.room_realtime_grants TO service_role;

CREATE FUNCTION public.room_realtime_grant(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  lobby jsonb;
  target_room uuid;
  target_viewer uuid;
  target_role text;
  grant_row public.room_realtime_grants;
  deadline timestamptz;
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_input) AS field WHERE field NOT IN ('host_hash','room_token_hash','player_hash','room_code')) THEN
    RAISE EXCEPTION USING MESSAGE='INVALID_INPUT';
  END IF;
  lobby := public.room_system_action('get-room-state',p_input);
  target_room := (lobby->'room'->>'id')::uuid;
  target_viewer := (lobby->'viewer'->>'id')::uuid;
  target_role := lobby->'viewer'->>'role';
  deadline := least((lobby->'room'->>'expiresAt')::timestamptz,clock_timestamp()+interval '5 minutes');
  INSERT INTO public.room_realtime_grants(room_id,viewer_id,viewer_role,credential_snapshot,room_token_snapshot,expires_at)
  VALUES(target_room,target_viewer,target_role,coalesce(p_input->>'host_hash',p_input->>'player_hash'),p_input->>'room_token_hash',deadline)
  ON CONFLICT (room_id,viewer_role,viewer_id) DO UPDATE SET credential_snapshot=EXCLUDED.credential_snapshot,room_token_snapshot=EXCLUDED.room_token_snapshot,expires_at=EXCLUDED.expires_at
  RETURNING * INTO grant_row;
  WITH expired AS (SELECT id FROM public.room_realtime_grants WHERE expires_at < clock_timestamp()-interval '5 minutes' ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)
  DELETE FROM public.room_realtime_grants AS grants USING expired WHERE grants.id=expired.id;
  RETURN jsonb_build_object('grantId',grant_row.id,'roomId',target_room,'expiresAt',grant_row.expires_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.room_realtime_grant(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.room_realtime_grant(jsonb) TO service_role;

CREATE FUNCTION public.room_realtime_can_receive(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH claims AS (SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb AS value)
  SELECT EXISTS (
    SELECT 1 FROM public.room_realtime_grants AS grants
    JOIN public.rooms AS room ON room.id=grants.room_id
    CROSS JOIN claims
    WHERE claims.value->>'role'='anon'
      AND claims.value->>'sub'=grants.id::text
      AND claims.value->>'rt_room'=grants.room_id::text
      AND p_topic='gw-room:'||grants.room_id::text
      AND grants.expires_at>now() AND room.expires_at>now()
      AND CASE WHEN claims.value->>'exp' ~ '^[0-9]{1,12}$' THEN (claims.value->>'exp')::bigint>extract(epoch FROM now()) AND (claims.value->>'exp')::bigint<=extract(epoch FROM grants.expires_at) ELSE false END
      AND (grants.viewer_role='host' AND EXISTS (SELECT 1 FROM public.hosts AS host WHERE host.id=grants.viewer_id AND room.host_id=host.id AND host.credential_hash=grants.credential_snapshot AND room.host_token_hash=grants.room_token_snapshot)
        OR grants.viewer_role='player' AND EXISTS (SELECT 1 FROM public.room_players AS player WHERE player.id=grants.viewer_id AND player.room_id=room.id AND player.session_token_hash=grants.credential_snapshot))
  );
$function$;
REVOKE ALL ON FUNCTION public.room_realtime_can_receive(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.room_realtime_can_receive(text) TO anon,authenticated,service_role;

CREATE POLICY guess_who_receive ON realtime.messages FOR SELECT TO anon
USING (extension='broadcast' AND topic=realtime.topic() AND public.room_realtime_can_receive(topic));
CREATE POLICY guess_who_receive_guard ON realtime.messages AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING (topic NOT LIKE 'gw-room:%' OR extension='broadcast' AND topic=realtime.topic() AND public.room_realtime_can_receive(topic));
CREATE POLICY guess_who_no_client_broadcast ON realtime.messages AS RESTRICTIVE FOR INSERT TO anon,authenticated
WITH CHECK (topic NOT LIKE 'gw-room:%');

CREATE FUNCTION public.room_realtime_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  target uuid;
BEGIN
  IF TG_TABLE_NAME='rooms' THEN target:=NEW.id;
  ELSIF TG_OP='DELETE' THEN target:=OLD.room_id;
  ELSE target:=NEW.room_id;
  END IF;
  PERFORM realtime.send('{"changed":true}'::jsonb,'invalidate','gw-room:'||target::text,true);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.room_realtime_notify() FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER room_realtime_room AFTER UPDATE OF status,current_question ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.room_realtime_notify();
CREATE TRIGGER room_realtime_players AFTER INSERT OR DELETE ON public.room_players FOR EACH ROW EXECUTE FUNCTION public.room_realtime_notify();
CREATE TRIGGER room_realtime_questions AFTER INSERT OR UPDATE OF revealed_at ON public.room_questions FOR EACH ROW EXECUTE FUNCTION public.room_realtime_notify();

COMMIT;
