import { prioritizeCheckedCandidates } from './order.js'

let state
let index = 0
let busy = false
let selectionVersion = 0
let pollTimer
let dirty = false
let displayIds = []
let initialPassCount = 0
const form = document.querySelector('#review-form')
const element = id => document.getElementById(id)
const fields = ['imageUrl', 'sourcePage', 'personSource', 'rosterSource', 'wikidataId', 'author', 'license', 'licenseTermsUrl', 'evidenceUrl']
const reviewFields = ['reviewer', 'notes', 'attributionPlan', 'evidenceCheckedOn']
const confirmations = ['subjectCorrect', 'personSourceConfirmed', 'categoryConfirmed', 'rightsConfirmed', 'conditionsSatisfied']

function receive(next) {
  if (!displayIds.length) {
    displayIds = prioritizeCheckedCandidates(next.entries).map(entry => entry.id)
    initialPassCount = next.entries.filter(entry => entry.imageCheck.status === 'PASS').length
  }
  const byId = new Map(next.entries.map(entry => [entry.id, entry]))
  return { ...next, entries: displayIds.map(id => byId.get(id)) }
}

async function request(path, input) {
  const response = await fetch(path, input ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Session': state.session }, body: JSON.stringify(input) } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? '本機請求失敗')
  return result
}

function link(id, value) {
  const anchor = element(id)
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error()
    anchor.href = url.href
    anchor.hidden = false
  } catch { anchor.removeAttribute('href'); anchor.hidden = true }
}

function render() {
  const entry = state.entries[index]
  const counts = state.summary
  element('summary').textContent = `總數 ${counts.total} · APPROVED ${counts.APPROVED} · REJECTED ${counts.REJECTED} · PENDING ${counts.PENDING} · MISSING_IMAGE ${counts.MISSING_IMAGE}`
  element('priority').textContent = `本次開啟優先排列 ${initialPassCount} 位已通過技術檢查的候選；技術通過不代表授權核准。審核期間順序固定，不因重新檢查而跳換人物。`
  element('gate').textContent = `${counts.metadataPreparationReady ? '可準備連結 Metadata 審查批次' : `尚需 ${counts.additionalApprovalsRequired} 位有效 APPROVED`}。雲端匯入未授權；現有遊戲引擎尚未支援 link-only。`
  element('job').textContent = state.job.running ? `檢查中 ${state.job.completed}/${state.job.total}` : state.job.stoppedReason ?? `已檢查 ${counts.checked} 張，連線／解碼 PASS ${counts.imageCheckPass}`
  const select = element('candidate')
  select.replaceChildren(...state.entries.map((entry, position) => {
    const option = document.createElement('option')
    option.value = String(position)
    option.textContent = `${position + 1}. ${entry.name} — ${entry.status}`
    return option
  }))
  select.value = String(index)
  element('name').textContent = `${index + 1}/${counts.total} · ${entry.name}`
  element('identity').textContent = `${entry.group} · athletes · ${entry.status}`
  element('qualification').textContent = `${entry.qualificationNote}\nMetadata 擷取：${entry.metadataRetrievedAt ?? '尚未取得'}；人工授權查證：${entry.review.evidenceCheckedOn || '尚未完成'}`
  element('warnings').textContent = [entry.identityWarning, entry.duplicateIssues.length ? `重複人物：${entry.duplicateIssues.join('、')}` : '', !entry.imageUrl && !entry.sourcePage ? '缺圖片：可填入具來源及明確授權的 Commons 圖片。' : ''].filter(Boolean).join('；')
  const check = entry.imageCheck
  element('image-check').textContent = `${check.status}${check.reason ? ` · ${check.reason}` : ''}${check.mime ? ` · ${check.mime} · ${check.bytes ?? '?'} bytes · ${check.width ?? '?'}×${check.height ?? '?'}` : ''}\n查證：${check.checkedAt ?? '尚未檢查'}`
  const photo = element('photo')
  photo.replaceChildren()
  if (entry.previewAvailable) {
    const image = document.createElement('img')
    image.src = `/api/image/${entry.id}?checked=${encodeURIComponent(check.checkedAt)}`
    image.alt = `${entry.name} 的待審圖片，須人工核對`
    photo.append(image)
  } else photo.textContent = entry.sourcePage || entry.imageUrl ? '請檢查連結以載入照片；檢查結果不代表授權通過。' : 'MISSING_IMAGE'
  for (const field of fields) form.elements[field].value = entry[field] ?? ''
  for (const field of reviewFields) form.elements[field].value = entry.review[field] ?? ''
  for (const field of confirmations) form.elements[field].checked = entry.review[field] === true
  for (const [id, field] of [['source-link', 'sourcePage'], ['person-link', 'personSource'], ['roster-link', 'rosterSource'], ['terms-link', 'licenseTermsUrl'], ['evidence-link', 'evidenceUrl']]) link(id, entry[field])
  setBusy(busy)
  dirty = false
}

function setBusy(value) {
  busy = value
  for (const id of ['previous', 'next', 'candidate', 'check', 'approve', 'reject', 'pending', 'check-all']) element(id).disabled = value || state?.job.running === true
  element('previous').disabled ||= index === 0
  element('next').disabled ||= index === state.entries.length - 1
  for (const field of [...fields, ...reviewFields, ...confirmations]) form.elements[field].disabled = value || state.job.running
}

async function run(operation) {
  if (busy || state.job.running) return
  setBusy(true)
  element('message').textContent = '處理中…'
  try { await operation(); element('message').textContent = '已完成並儲存至本機。' }
  catch (error) { element('message').textContent = error.message }
  finally { setBusy(false) }
}

async function checkCurrent(version = selectionVersion) {
  if (dirty) throw new Error('請先儲存 PENDING，再檢查圖片；避免遺失尚未儲存的連結或備註。')
  const id = state.entries[index].id
  const result = await request('/api/check', { id })
  if (version === selectionVersion) { state = receive(result); render() }
}

async function select(position) {
  if (dirty && !window.confirm('尚有未儲存的審核內容，確定切換人物？')) { element('candidate').value = String(index); return }
  index = position
  selectionVersion++
  element('message').textContent = ''
  render()
  if (state.entries[index].imageUrl || state.entries[index].sourcePage) await run(() => checkCurrent())
}

async function save(action) {
  const entry = state.entries[index]
  const input = { id: entry.id, revision: state.revision, action, review: {} }
  for (const field of fields) input[field] = form.elements[field].value
  for (const field of reviewFields) input.review[field] = form.elements[field].value
  for (const field of confirmations) input.review[field] = form.elements[field].checked
  state = receive(await request('/api/review', input))
  render()
}

function watchJob() {
  clearTimeout(pollTimer)
  if (!state.job.running) return
  pollTimer = setTimeout(async () => {
    try { state = receive(await request('/api/state')); render(); watchJob() }
    catch (error) { element('message').textContent = error.message }
  }, 1000)
}

element('previous').addEventListener('click', () => select(Math.max(0, index - 1)))
element('next').addEventListener('click', () => select(Math.min(state.entries.length - 1, index + 1)))
element('candidate').addEventListener('change', event => select(Number(event.target.value)))
element('check').addEventListener('click', () => run(() => checkCurrent()))
for (const action of ['APPROVE', 'REJECT', 'PENDING']) element(action.toLowerCase()).addEventListener('click', () => run(() => save(action)))
element('check-all').addEventListener('click', () => run(async () => {
  if (dirty) throw new Error('請先儲存審核草稿，再啟動批次檢查。')
  state = receive(await request('/api/check-all', {})); render(); watchJob()
}))
form.addEventListener('submit', event => event.preventDefault())
form.addEventListener('input', () => { dirty = true })
for (const [id, field] of [['source-link', 'sourcePage'], ['person-link', 'personSource'], ['roster-link', 'rosterSource'], ['terms-link', 'licenseTermsUrl'], ['evidence-link', 'evidenceUrl']]) form.elements[field].addEventListener('input', () => link(id, form.elements[field].value))
window.addEventListener('beforeunload', event => { clearTimeout(pollTimer); if (dirty) { event.preventDefault(); event.returnValue = '' } })
try { state = receive(await request('/api/state')); await select(0) }
catch (error) { element('message').textContent = `無法載入本機審核：${error.message}` }
