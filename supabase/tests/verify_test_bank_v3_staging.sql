BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';

SELECT group_slug,category_slug,review_status,count(*) AS candidates,
  count(*) FILTER (WHERE is_approved) AS unexpectedly_approved
FROM public.question_bank_candidates
GROUP BY group_slug,category_slug,review_status
ORDER BY group_slug,review_status;

SELECT relrowsecurity AS rls_enabled,relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid='public.question_bank_candidates'::regclass;

SELECT role_name,
  has_table_privilege(role_name,'public.question_bank_candidates','SELECT') AS can_select,
  has_table_privilege(role_name,'public.question_bank_candidates','INSERT') AS can_insert,
  has_table_privilege(role_name,'public.question_bank_candidates','UPDATE') AS can_update,
  has_table_privilege(role_name,'public.question_bank_candidates','DELETE') AS can_delete
FROM (VALUES ('anon'),('authenticated'),('service_role')) AS roles(role_name);

SELECT count(*) AS missing_category_relations
FROM public.question_bank_candidates AS candidate
LEFT JOIN public.categories AS category ON category.slug=candidate.category_slug
WHERE category.id IS NULL;

SELECT count(*) AS newly_overlapping_formal_people
FROM public.question_bank_candidates AS candidate
JOIN public.celebrities AS person ON person.wikidata_id=candidate.wikidata_id;

ROLLBACK;
