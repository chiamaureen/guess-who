BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s';

WITH assets AS MATERIALIZED (
  SELECT id,celebrity_id,is_approved,octet_length(png) AS bytes,
    CASE
      WHEN substring(png FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex') THEN 'image/png'
      WHEN substring(png FROM 1 FOR 3)=decode('ffd8ff','hex') THEN 'image/jpeg'
      WHEN substring(png FROM 1 FOR 4)=decode('52494646','hex')
        AND substring(png FROM 9 FOR 4)=decode('57454250','hex') THEN 'image/webp'
      ELSE 'unknown'
    END AS mime,
    public.game_engine_png_valid(png) AS valid_legacy_png
  FROM public.game_image_assets
), people AS MATERIALIZED (
  SELECT person.id,person.wikidata_id,person.name_zh,person.name_en,person.is_approved,
    nullif(btrim(person.image_author),'') IS NOT NULL
      AND nullif(btrim(person.image_source),'') IS NOT NULL
      AND nullif(btrim(person.image_license),'') IS NOT NULL
      AND nullif(btrim(person.image_attribution),'') IS NOT NULL AS provenance_fields_present,
    (SELECT count(*) FROM assets WHERE celebrity_id=person.id AND is_approved) AS approved_assets,
    (SELECT count(*) FROM assets WHERE celebrity_id=person.id AND is_approved AND valid_legacy_png) AS approved_valid_legacy_png,
    (SELECT coalesce(jsonb_agg(category.slug ORDER BY category.slug),'[]'::jsonb)
      FROM public.celebrity_categories AS membership
      JOIN public.categories AS category ON category.id=membership.category_id
      WHERE membership.celebrity_id=person.id) AS categories
  FROM public.celebrities AS person
)
SELECT jsonb_build_object(
  'checkedAt',transaction_timestamp(),
  'database',current_database(),
  'schema','public',
  'postgresVersion',current_setting('server_version'),
  'readOnly',current_setting('transaction_read_only'),
  'isolation',current_setting('transaction_isolation'),
  'migrationHistory',(SELECT coalesce(jsonb_agg(version ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations),
  'tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',table_row.relname,'rls',table_row.relrowsecurity,'forceRls',table_row.relforcerowsecurity) ORDER BY table_row.relname),'[]'::jsonb)
    FROM pg_catalog.pg_class AS table_row
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=table_row.relnamespace
    WHERE namespace.nspname='public' AND table_row.relkind IN ('r','p')),
  'categoryCounts',(SELECT jsonb_agg(jsonb_build_object(
    'id',category.id,'slug',category.slug,'name',category.name,'active',category.is_active,
    'totalPeople',(SELECT count(DISTINCT person.id) FROM people AS person WHERE person.categories ? category.slug),
    'approvedPeople',(SELECT count(DISTINCT person.id) FROM people AS person WHERE person.categories ? category.slug AND person.is_approved),
    'eligibleNewHost',(SELECT count(DISTINCT person.id) FROM people AS person
      WHERE person.categories ? category.slug AND person.is_approved AND person.approved_assets>0 AND category.is_active),
    'eligibleWithValidLegacyPng',(SELECT count(DISTINCT person.id) FROM people AS person
      WHERE person.categories ? category.slug AND person.is_approved AND person.approved_valid_legacy_png>0 AND category.is_active)
  ) ORDER BY category.slug) FROM public.categories AS category),
  'people',(SELECT coalesce(jsonb_agg(to_jsonb(person) ORDER BY person.wikidata_id),'[]'::jsonb) FROM people AS person),
  'assetCounts',(SELECT coalesce(jsonb_agg(to_jsonb(formats) ORDER BY formats.mime),'[]'::jsonb) FROM (
    SELECT mime,count(*) AS total,count(*) FILTER (WHERE is_approved) AS approved,
      count(*) FILTER (WHERE valid_legacy_png) AS valid_legacy_png,sum(bytes) AS bytes
    FROM assets GROUP BY mime
  ) AS formats),
  'assets',(SELECT coalesce(jsonb_agg(to_jsonb(asset) ORDER BY asset.id),'[]'::jsonb) FROM assets AS asset),
  'assetsWithMissingPerson',(SELECT count(*) FROM assets LEFT JOIN public.celebrities AS person ON person.id=assets.celebrity_id WHERE person.id IS NULL),
  'duplicateWikidata',(SELECT coalesce(jsonb_agg(to_jsonb(duplicate)),'[]'::jsonb) FROM (
    SELECT wikidata_id,count(*) AS total FROM public.celebrities WHERE wikidata_id IS NOT NULL GROUP BY wikidata_id HAVING count(*)>1
  ) AS duplicate),
  'peopleMissingWikidata',(SELECT count(*) FROM people WHERE wikidata_id IS NULL),
  'imageConstraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',conname,'validated',convalidated,'definition',pg_get_constraintdef(oid)) ORDER BY conname),'[]'::jsonb)
    FROM pg_catalog.pg_constraint WHERE conrelid='public.game_image_assets'::regclass),
  'gameFunctions',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name',procedure.proname,'arguments',pg_get_function_identity_arguments(procedure.oid),'sourceMd5',md5(procedure.prosrc),
    'securityDefiner',procedure.prosecdef,'config',procedure.proconfig,'volatility',procedure.provolatile,
    'anonExecute',has_function_privilege('anon',procedure.oid,'EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated',procedure.oid,'EXECUTE'),
    'serviceExecute',has_function_privilege('service_role',procedure.oid,'EXECUTE')
  ) ORDER BY procedure.proname),'[]'::jsonb)
    FROM pg_catalog.pg_proc AS procedure JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname='public' AND procedure.proname LIKE 'game_engine_%'),
  'browserImageAccess',(SELECT jsonb_agg(jsonb_build_object('role',role_name,
    'tableSelect',has_table_privilege(role_name,'public.game_image_assets','SELECT'),
    'columnSelect',has_any_column_privilege(role_name,'public.game_image_assets','SELECT')))
    FROM (VALUES ('anon'),('authenticated')) AS roles(role_name)),
  'stagingExists',to_regclass('public.question_bank_candidates') IS NOT NULL,
  'hasWebpValidator',to_regprocedure('public.game_engine_webp_valid(bytea)') IS NOT NULL,
  'hasMultiFormatValidator',to_regprocedure('public.game_engine_image_valid(bytea)') IS NOT NULL
) AS inventory;

ROLLBACK;
