import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function gameVerificationSql(code) {
  if (typeof code !== 'string' || !/^[A-Z0-9]{6}$/.test(code)) throw new Error('Valid exact QA room code required')
  return `BEGIN READ ONLY;
DO $verify$
DECLARE
  target public.rooms;
  total integer;
  unique_people integer;
  revealed integer;
  remembered integer;
BEGIN
  SELECT * INTO STRICT target FROM public.rooms WHERE room_code='${code}';
  IF target.status <> 'finished' OR target.current_question <> 15 OR target.total_questions <> 15 THEN RAISE EXCEPTION 'QA game not finished at15'; END IF;
  SELECT count(*),count(DISTINCT celebrity_id),count(revealed_at) INTO total,unique_people,revealed FROM public.room_questions WHERE room_id=target.id;
  IF total <> 15 OR unique_people <> 15 OR revealed <> 15 THEN RAISE EXCEPTION 'QA questions repeated, missing or unrevealed'; END IF;
  SELECT count(*) INTO remembered FROM public.host_question_history AS history JOIN public.room_questions AS question ON question.room_id=target.id AND question.celebrity_id=history.celebrity_id WHERE history.host_id=target.host_id AND history.first_room_id=target.id;
  IF remembered <> 15 THEN RAISE EXCEPTION 'QA first-game C-mode history mismatch; verify BEFORE manual reset'; END IF;
END;
$verify$;
SELECT room.room_code,room.status,room.current_question,room.total_questions,
  (SELECT count(*) FROM public.room_questions WHERE room_id=room.id) AS questions,
  (SELECT count(DISTINCT celebrity_id) FROM public.room_questions WHERE room_id=room.id) AS distinct_people,
  (SELECT count(*) FROM public.host_question_history WHERE host_id=room.host_id) AS host_history_count
FROM public.rooms AS room WHERE room.room_code='${code}';
ROLLBACK;
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Room code and output path required')
    await writeFile(process.argv[3],gameVerificationSql(process.argv[2]),{mode:0o600,flag:'wx'})
    console.log('PASS: exact-room READ ONLY SQL prepared; not executed against Cloud.')
  } catch {console.error('BLOCKED: invalid room code or existing output; no Cloud access.');process.exitCode=2}
}
