INSERT INTO public.hosts (id, credential_hash)
VALUES ('20000000-0000-4000-8000-000000000001', repeat('a', 64)),
       ('20000000-0000-4000-8000-000000000002', repeat('b', 64));

INSERT INTO public.rooms (id, room_code, host_id, host_token_hash)
VALUES ('30000000-0000-4000-8000-000000000001', 'ROOM01', '20000000-0000-4000-8000-000000000001', repeat('1', 64)),
       ('30000000-0000-4000-8000-000000000002', 'ROOM02', '20000000-0000-4000-8000-000000000001', repeat('2', 64)),
       ('30000000-0000-4000-8000-000000000003', 'ROOM03', '20000000-0000-4000-8000-000000000002', repeat('3', 64));

INSERT INTO public.celebrities (id, wikidata_id, name_zh, subject_type, image_url, image_source, image_author, image_license, image_attribution, is_approved)
SELECT ('40000000-0000-4000-8000-' || lpad(subject_number::text, 12, '0'))::uuid,
       CASE WHEN subject_number <= 2 THEN NULL ELSE 'Q' || (9000000 + subject_number)::text END,
       '測試人物' || subject_number::text,
       CASE WHEN subject_number <= 2 THEN 'fictional_character' ELSE 'real_person' END,
       'https://assets.invalid/' || subject_number::text || '.webp',
       'https://source.invalid/fixture', 'Test author', 'Test license', 'Test attribution',
       subject_number <= 20
FROM generate_series(1, 21) AS subjects(subject_number);

INSERT INTO public.celebrity_categories (celebrity_id, category_id)
SELECT id, '10000000-0000-4000-8000-000000000001'::uuid FROM public.celebrities;

INSERT INTO public.celebrity_categories (celebrity_id, category_id)
SELECT id, '10000000-0000-4000-8000-000000000002'::uuid FROM public.celebrities WHERE is_approved;

INSERT INTO public.room_categories (room_id, category_id)
SELECT id, '10000000-0000-4000-8000-000000000001'::uuid FROM public.rooms;

INSERT INTO public.room_players (id, room_id, nickname, session_token_hash)
VALUES ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '測試玩家', repeat('c', 64));

INSERT INTO public.room_questions (room_id, question_number, category_id, celebrity_id)
VALUES ('30000000-0000-4000-8000-000000000001', 1, '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001');

UPDATE public.rooms SET status = 'playing', current_question = 1, started_at = now()
WHERE id = '30000000-0000-4000-8000-000000000001';

INSERT INTO public.host_question_history (host_id, celebrity_id, first_room_id)
VALUES ('20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001');
