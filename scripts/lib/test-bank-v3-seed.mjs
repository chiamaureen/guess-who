import { randomUUID } from 'node:crypto'
import { validateV3Candidates, summarizeV3 } from './test-bank-v3.mjs'

const quote = value => `'${String(value).replaceAll("'", "''")}'`
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('en').replace(/[\s._'’·-]+/g, '')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function candidatePayload(entry) {
  return {
    id: entry.id, identityKey: entry.identityKey, wikidataId: entry.wikidataId,
    nameZh: entry.nameZh, nameOriginal: entry.nameOriginal, category: entry.category, group: entry.group,
    sources: entry.sources, approved: false, image: entry.image,
    imageStatus: entry.imageStatus, identityStatus: entry.identityStatus,
    review: { subject: false, rights: false, image: false, presentation: false }, notes: '',
  }
}

export function planV3Seed(bank, snapshot = null) {
  validateV3Candidates(bank.entries)
  if (snapshot && (snapshot.projectRef !== 'fgvajdnzrnptdjurhjfo' || !Array.isArray(snapshot.celebrities) || !Array.isArray(snapshot.categories) || !Array.isArray(snapshot.staged ?? [])
    || snapshot.celebrities.some(person => !uuid.test(person.id) || !Array.isArray(person.categories)))) throw new Error('INVALID_OR_WRONG_PROJECT_SNAPSHOT')
  if (snapshot?.stagingExists && !Array.isArray(snapshot.staged)) throw new Error('STAGING_SNAPSHOT_REQUIRED')
  if (snapshot && (!Number.isFinite(Date.parse(snapshot.checkedAt)) || Date.now() - Date.parse(snapshot.checkedAt) > 86400000 || Date.parse(snapshot.checkedAt) - Date.now() > 300000)) throw new Error('FRESH_SNAPSHOT_REQUIRED')
  const staged = snapshot?.staged ?? []
  const actions = bank.entries.map(entry => {
    if (!snapshot) return { id: entry.id, action: 'UNVERIFIED', reason: 'CLOUD_DUPLICATE_CHECK_NOT_PERFORMED' }
    const matched = snapshot.celebrities.filter(person => entry.wikidataId && person.wikidata_id === entry.wikidataId)
    if (matched.length === 1) return { id: entry.id, action: 'REUSE_EXISTING', celebrityId: matched[0].id }
    const names = new Set([normalize(entry.nameZh), normalize(entry.nameOriginal)])
    if (matched.length > 1 || snapshot.celebrities.some(person => [person.name_zh, person.name_en].filter(Boolean).some(name => names.has(normalize(name))))) return { id: entry.id, action: 'BLOCKED_IDENTITY_CONFLICT' }
    const candidates = staged.filter(person => person.id === entry.id || person.identity_key === entry.identityKey || entry.wikidataId && person.wikidata_id === entry.wikidataId)
    if (candidates.length === 1 && candidates[0].id === entry.id && candidates[0].identity_key === entry.identityKey && candidates[0].wikidata_id === entry.wikidataId && candidates[0].group_slug === entry.group && candidates[0].category_slug === entry.category) return { id: entry.id, action: 'KEEP_STAGED' }
    if (candidates.length) return { id: entry.id, action: 'BLOCKED_STAGING_CONFLICT' }
    return { id: entry.id, action: 'INSERT_PENDING_STAGING' }
  })
  const conflicts = actions.filter(action => action.action.startsWith('BLOCKED'))
  return {
    status: !snapshot ? 'BLOCKED_CLOUD_DUPLICATE_CHECK' : conflicts.length ? 'BLOCKED_IDENTITY_CONFLICT' : 'READY_FOR_LOCAL_SQL_REVIEW',
    snapshotTime: snapshot?.checkedAt ?? null, snapshotEnvironment: snapshot?.environment ?? 'UNVERIFIED',
    cloudWrites: 0, formalCelebrityInserts: 0, imageAssetInserts: 0, categoryRelationInserts: 0,
    pendingStagingInserts: snapshot ? actions.filter(action => action.action === 'INSERT_PENDING_STAGING').length : null,
    existingReused: snapshot ? actions.filter(action => action.action === 'REUSE_EXISTING').length : null,
    groups: summarizeV3(bank, snapshot), conflicts, actions,
  }
}

export function makeV3SeedSql(bank, runId = randomUUID()) {
  validateV3Candidates(bank.entries)
  if (!uuid.test(runId)) throw new Error('INVALID_RUN_ID')
  const payload = JSON.stringify(bank.entries.map(candidatePayload))
  const values = `${quote(payload)}::jsonb`
  let seedTag = '$seed$'
  let guardTag = '$guard$'
  while (payload.includes(seedTag)) seedTag = seedTag.replace('$', '$_')
  while (payload.includes(guardTag)) guardTag = guardTag.replace('$', '$_')
  const sqlNormalize = expression => `lower(regexp_replace(normalize(coalesce(${expression},''),NFKC),${quote("[[:space:]._'’·-]+")},'','g'))`
  const seed = `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
LOCK TABLE public.question_bank_candidates IN SHARE ROW EXCLUSIVE MODE;
DO ${seedTag}
DECLARE
  candidate jsonb;
  existing public.question_bank_candidates;
  matches integer;
BEGIN
  FOR candidate IN SELECT value FROM jsonb_array_elements(${values}) LOOP
    IF EXISTS (SELECT 1 FROM public.celebrities WHERE wikidata_id=candidate->>'wikidataId') THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.celebrities WHERE ${sqlNormalize('name_zh')} IN (${sqlNormalize("candidate->>'nameZh'")},${sqlNormalize("candidate->>'nameOriginal'")})
      OR ${sqlNormalize('name_en')} IN (${sqlNormalize("candidate->>'nameZh'")},${sqlNormalize("candidate->>'nameOriginal'")})) THEN
      RAISE EXCEPTION 'Existing person requires explicit identity reconciliation';
    END IF;
    SELECT count(*) INTO matches FROM public.question_bank_candidates WHERE id=(candidate->>'id')::uuid OR identity_key=candidate->>'identityKey'
      OR (candidate->>'wikidataId' IS NOT NULL AND wikidata_id=candidate->>'wikidataId');
    IF matches>1 THEN RAISE EXCEPTION 'Ambiguous candidate identity'; END IF;
    IF matches=1 THEN
      SELECT * INTO existing FROM public.question_bank_candidates WHERE id=(candidate->>'id')::uuid OR identity_key=candidate->>'identityKey'
        OR (candidate->>'wikidataId' IS NOT NULL AND wikidata_id=candidate->>'wikidataId');
      IF existing.id<>(candidate->>'id')::uuid OR existing.identity_key<>candidate->>'identityKey'
        OR existing.wikidata_id IS DISTINCT FROM candidate->>'wikidataId' OR existing.group_slug<>candidate->>'group'
        OR existing.category_slug<>candidate->>'category' THEN RAISE EXCEPTION 'Candidate identity changed; never overwrite'; END IF;
      CONTINUE;
    END IF;
    INSERT INTO public.question_bank_candidates(id,identity_key,wikidata_id,category_slug,group_slug,payload,review_status,is_approved,seed_run_id)
    VALUES((candidate->>'id')::uuid,candidate->>'identityKey',candidate->>'wikidataId',candidate->>'category',candidate->>'group',candidate,
      CASE WHEN candidate->'image'='null'::jsonb THEN 'MISSING_IMAGE' ELSE 'PENDING' END,false,${quote(runId)}::uuid);
  END LOOP;
END;
${seedTag};
COMMIT;
`
  const rollback = `BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.question_bank_candidates IN SHARE ROW EXCLUSIVE MODE;
DO ${guardTag}
BEGIN
  IF EXISTS (SELECT 1 FROM public.question_bank_candidates AS stored
    LEFT JOIN jsonb_array_elements(${values}) AS expected ON (expected.value->>'id')::uuid=stored.id
    WHERE stored.seed_run_id=${quote(runId)}::uuid AND (expected.value IS NULL OR stored.payload<>expected.value OR stored.is_approved
      OR stored.review_status<>CASE WHEN expected.value->'image'='null'::jsonb THEN 'MISSING_IMAGE' ELSE 'PENDING' END)) THEN
    RAISE EXCEPTION 'Candidate review changed; refuse rollback';
  END IF;
END;
${guardTag};
DELETE FROM public.question_bank_candidates WHERE seed_run_id=${quote(runId)}::uuid;
COMMIT;
`
  return { runId, seed, rollback }
}
