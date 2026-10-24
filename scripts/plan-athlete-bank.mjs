import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { summarizeAthleteReview } from './prepare-athlete-review.mjs'

const categories = ['actors', 'animated-characters', 'athletes', 'historical-figures', 'politicians', 'scientists', 'singers']
const expectedPoliticians = ['Q11613', 'Q12325', 'Q207', 'Q22686', 'Q23505', 'Q34836', 'Q35648', 'Q76', 'Q91', 'Q9582', 'Q9588', 'Q9640', 'Q9696', 'Q9916', 'Q9960']
const athleteCategory = '10000000-0000-4000-8000-000000000003'
const same = (first, second) => JSON.stringify([...first].sort()) === JSON.stringify([...second].sort())

export function planAthleteChanges(bank, impact) {
  const summary = summarizeAthleteReview(bank)
  const proposed = bank.entries.filter(entry => entry.review?.subject === true && entry.review?.rights === true && entry.review?.image === true)
  const blockers = []
  if (!same(impact.categories.map(category => category.slug), categories) || impact.categories.some(category => !category.is_active)) blockers.push('CATEGORY_SNAPSHOT_CHANGED')
  if (!same(impact.politicians.map(person => person.wikidata_id), expectedPoliticians)) blockers.push('POLITICIAN_SET_CHANGED')
  if (impact.politicians.some(person => person.is_approved !== true || !same(person.categories, ['politicians']))) blockers.push('SHARED_OR_CHANGED_POLITICIAN')
  if (bank.entries.some(entry => entry.categorySlug !== 'athletes' || !same(entry.categoryIds, [athleteCategory]))) blockers.push('ATHLETE_CATEGORY_MISMATCH')
  if (summary.duplicateQids.length) blockers.push('DUPLICATE_QID_REQUIRES_REVIEWED_MERGE')
  if (proposed.some(entry => impact.existing_subjects.some(person => person.wikidata_id === entry.wikidataId))) blockers.push('EXISTING_SUBJECT_CONFLICT_NO_OVERWRITE')
  if (!proposed.length || proposed.some(entry => !/^Q[1-9][0-9]*$/.test(entry.wikidataId) || !entry.author?.trim() || !entry.license?.trim() || !entry.attribution?.trim() || !entry.review.reviewedBy?.trim() || !Number.isFinite(Date.parse(entry.review.reviewedAt)) || !/^https:\/\/upload\.wikimedia\.org\//.test(entry.imageUrl ?? '') || !/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(entry.source ?? ''))) blockers.push('REVIEWED_LINK_METADATA_INCOMPLETE')
  blockers.push('LINK_ONLY_IMAGES_NOT_SUPPORTED_BY_DEPLOYED_GAME_ENGINE')
  if (bank.entries.some(entry => entry.approved === true)) blockers.push('LINK_ONLY_DRAFT_MUST_NOT_ENTER_DRAWING_POOL')
  if (bank.entries.some(entry => entry.google?.firstResultVerified !== true)) blockers.push('GOOGLE_FIRST_RESULT_NOT_VERIFIED')
  if (bank.entries.some(entry => entry.review?.subject !== true)) blockers.push('SOURCE_IDENTITY_REVIEW_PENDING')
  if (impact.counts.playing_rooms > 0) blockers.push('DEACTIVATION_REQUIRES_SAFE_GAME_BOUNDARY_RECHECK')
  return {
    status: 'BLOCKED', summary, blockers,
    oldPoliticians: impact.politicians.length, sharedPoliticians: impact.politicians.filter(person => person.categories.some(slug => slug !== 'politicians')).length,
    proposedReviewedSubjects: proposed.length,
    executableChanges: { celebritiesInsert: 0, membershipsInsert: 0, privateImagesInsert: 0, celebritiesDeactivate: 0 },
    pendingMaximumEstimate: { celebritiesInsert: bank.entries.length, membershipsInsert: bank.entries.length, privateImagesInsert: 0, celebritiesDeactivate: expectedPoliticians.length },
    preserved: ['categories', 'rooms', 'room_questions', 'host_question_history', 'existing celebrity_categories', 'existing game_image_assets'],
    imageStorageMode: 'link-only', sqlGenerated: false, cloudWrites: 0,
  }
}

const cell = value => String(value ?? '—').replace(/<[^>]*>/g, '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ').trim()
export function renderAthleteCatalog(bank) {
  const rows = bank.entries.map(entry => `| ${cell(entry.group)} | ${cell(entry.rank)} | ${cell(entry.name)} | ${cell(entry.wikidataId)} | ${entry.source ? `[來源頁](${entry.source})` : '缺候選'} | ${cell(entry.authorHtml)} | ${cell(entry.license)} | 未審核 |`)
  return `# Athletes v2 — Candidate and Image Register\n\n準備時間：${bank.preparedAt}。此表是候選 Metadata，不是已審核可匯入名單。新批次只存圖片連結，不新增圖片二進位資料。\n\n原始圖片 URL、來源 revision／SHA-1、作者 HTML、授權 URL、Google 第一筆狀態與逐人 review flags 保存在 ignored candidates-links-pending.json。這裡不含遊戲題目 UUID／答案映射。\n\nGoogle 第一筆尚未核驗；Commons 為替代候選，不冒稱 Google 排名。所有人物仍 approved=false；有作者／授權字樣不代表已完成原始權利與視覺審核。\n\n| 組別 | 排名 | 姓名 | 候選 QID（未確認） | 圖片來源 | 作者（Metadata） | 授權（Metadata） | 審核 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Candidate manifest and read-only impact JSON required')
    const bank = JSON.parse(await readFile(process.argv[2], 'utf8'))
    const impact = JSON.parse(await readFile(process.argv[3], 'utf8')).rows[0].impact
    const preview = planAthleteChanges(bank, impact)
    const path = resolve(process.argv[2], '..', 'change-preview-links.json')
    await writeFile(path, JSON.stringify(preview, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify(preview))
  } catch {
    console.error('BLOCKED: invalid review/snapshot or existing preview; no SQL generated and no Cloud writes.')
    process.exitCode = 2
  }
}
