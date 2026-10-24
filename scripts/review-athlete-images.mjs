import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, chmod, open, unlink } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { reconcileCandidates, updateDuplicateIssues, probeImage, resolveCommonsSource, applyReview, reviewSummary, approvalErrors } from './lib/athlete-image-review.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultOutput = resolve(root, 'data/question-bank/prepared/athletes-local-review')
const outputName = 'phase8-athletes-reviewed.json'

async function atomicWrite(path, content) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

export async function createReviewStore({ outputDirectory = defaultOutput, markdown, scope, manifest, fetchImpl = fetch } = {}) {
  markdown ??= await readFile(resolve(root, 'docs/phase8-athletes-v2-candidates.md'), 'utf8')
  scope ??= JSON.parse(await readFile(resolve(root, 'data/question-bank/athletes-v2-scope.json'), 'utf8'))
  if (manifest === undefined) {
    try { manifest = JSON.parse(await readFile(resolve(root, 'data/question-bank/prepared/athletes-v2-review-20261024/candidates-links-pending.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const sourceDigest = createHash('sha256').update(markdown + JSON.stringify(scope)).digest('hex')
  let entries = reconcileCandidates(markdown, scope, manifest)
  let revision = 0
  let previousJob
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  const lockPath = resolve(outputDirectory, '.review.lock')
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) }
  catch (error) { if (error.code === 'EEXIST') throw new Error('REVIEW_DIRECTORY_LOCKED_CLOSE_OTHER_REVIEW_PROCESS'); throw error }
  await lock.writeFile(JSON.stringify({ pid: process.pid }))
  let disposed = false
  const release = async () => { await lock.close(); await unlink(lockPath) }
  try {
  try {
    const existing = JSON.parse(await readFile(resolve(outputDirectory, outputName), 'utf8'))
    if (existing.sourceDigest !== sourceDigest || existing.entries.length !== entries.length
      || !entries.every(entry => existing.entries.some(saved => saved.id === entry.id && saved.name === entry.name && saved.group === entry.group && saved.category === 'athletes'))) throw new Error('SOURCE_CHANGED_USE_NEW_OUTPUT_DIRECTORY')
    entries = updateDuplicateIssues(existing.entries.map(saved => ({ ...entries.find(entry => entry.id === saved.id), ...saved })))
    revision = existing.revision
    previousJob = existing.lastBatch
    for (const entry of entries) {
      if (!['APPROVED', 'REJECTED', 'PENDING', 'MISSING_IMAGE'].includes(entry.status)) throw new Error('INVALID_SAVED_REVIEW')
      if (entry.status === 'APPROVED' && approvalErrors(entry).length) { entry.status = 'PENDING'; revision++ }
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  let queue = Promise.resolve()
  let cache = null
  const job = { ...{ running: false, completed: 0, total: 0, stoppedReason: null }, ...previousJob, running: false }
  if (!previousJob && entries.some(entry => entry.imageCheck.reason === 'HTTP_429')) Object.assign(job, { completed: entries.filter(entry => entry.imageCheck.checkedAt).length, total: entries.filter(entry => entry.sourcePage || entry.imageUrl).length, stoppedReason: 'HTTP_429_MANUAL_RETRY_REQUIRED' })
  const summary = () => reviewSummary(entries)
  const snapshot = () => ({ version: 1, imageStorageMode: 'link-only', source: 'docs/phase8-athletes-v2-candidates.md', sourceDigest, revision, exportedAt: new Date().toISOString(), summary: summary(), lastBatch: { ...job }, entries })
  const persist = async () => {
    const state = snapshot()
    await atomicWrite(resolve(outputDirectory, outputName), JSON.stringify(state, null, 2) + '\n')
    const counts = state.summary
    await atomicWrite(resolve(outputDirectory, 'phase8-athletes-review-summary.md'), `# Phase 8 — Local Athlete Image Review\n\n${state.exportedAt}\n\n| Status | Count |\n| --- | ---: |\n${['APPROVED', 'REJECTED', 'PENDING', 'MISSING_IMAGE'].map(status => `| ${status} | ${counts[status]} |`).join('\n')}\n\nChecked: ${counts.checked}; Image check PASS: ${counts.imageCheckPass}.\n\nUnique valid APPROVED: ${counts.uniqueApproved}/15. Metadata preparation: ${counts.metadataPreparationReady ? 'READY FOR SEPARATE REVIEW' : 'BLOCKED'}.\n\nLink-only metadata; no image binary stored. No Cloud writes. Current deployed Game Engine still requires private image assets. Approval does not authorize Cloud import or make URL-only games compatible.\n`)
  }
  const serial = operation => {
    const result = queue.then(operation)
    queue = result.catch(() => {})
    return result
  }
  const ensureNetworkReady = () => {
    if (entries.some(entry => entry.imageCheck.reason === 'HTTP_429'
      && Date.now() < (Date.parse(entry.imageCheck.retryAllowedAt) || Date.parse(entry.imageCheck.checkedAt) + 60000))) throw new Error('PUBLIC_RATE_LIMIT_RETRY_AFTER_NOT_ELAPSED')
  }
  const checkEntry = id => serial(async () => {
    ensureNetworkReady()
    const entry = entries.find(entry => entry.id === id)
    if (!entry) throw new Error('CANDIDATE_NOT_FOUND')
    if (!entry.imageUrl && entry.sourcePage) {
      try { Object.assign(entry, await resolveCommonsSource(entry, fetchImpl)); entry.review.subjectCorrect = false; entry.review.rightsConfirmed = false }
      catch { entry.imageCheck = { status: 'FAIL', reason: 'COMMONS_METADATA_UNAVAILABLE', checkedAt: new Date().toISOString() } }
    }
    if (entry.imageUrl) {
      const previous = entry.imageCheck
      const result = await probeImage(entry.imageUrl, fetchImpl)
      entry.imageCheck = result.check
      cache = result.buffer ? { id, url: entry.imageUrl, buffer: result.buffer, mime: result.check.mime, checkedAt: result.check.checkedAt } : null
      if (entry.status === 'APPROVED' && (result.check.status !== 'PASS' || previous.sha256 !== result.check.sha256)) {
        entry.status = 'PENDING'
        entry.review.subjectCorrect = false
        entry.review.rightsConfirmed = false
        entry.review.imageChangedAt = new Date().toISOString()
      }
    }
    revision++
    await persist()
    return entry
  })
  const checkAll = async () => {
    if (job.running) throw new Error('CHECK_ALREADY_RUNNING')
    ensureNetworkReady()
    const ids = entries.filter(entry => (entry.imageUrl || entry.sourcePage) && (!entry.imageCheck.checkedAt || Date.now() - Date.parse(entry.imageCheck.checkedAt) >= 86400000)).map(entry => entry.id)
    Object.assign(job, { running: true, completed: 0, total: ids.length, stoppedReason: null })
    try {
      for (const id of ids) {
        if (disposed) break
        const entry = await checkEntry(id)
        job.completed++
        if (entry.imageCheck.reason === 'HTTP_429') { job.stoppedReason = 'HTTP_429_MANUAL_RETRY_REQUIRED'; break }
        if (fetchImpl === fetch && job.completed < ids.length) await delay(1500)
      }
    } finally { job.running = false; await persist() }
    return summary()
  }
  await persist()
  return {
    outputDirectory, snapshot, job, checkEntry, checkAll, persist,
    preview(id) { return cache?.id === id ? cache : null },
    state() { return { ...snapshot(), job, entries: entries.map(entry => ({ ...entry, previewAvailable: cache?.id === entry.id && cache.url === entry.imageUrl })) } },
    save(id, input) { return serial(async () => {
      if (input.revision !== revision) throw new Error('STALE_REVIEW_RELOAD_REQUIRED')
      const entry = applyReview(entries, id, input)
      entries = updateDuplicateIssues(entries.map(previous => previous.id === id ? entry : previous))
      if (cache?.id === id && cache.url !== entry.imageUrl) cache = null
      revision++
      await persist()
      return entry
    }) },
    async dispose() { if (!disposed) { disposed = true; await queue; await release() } },
  }
  } catch (error) { await release(); throw error }
}

export async function startReviewServer(options = {}) {
  const store = options.store ?? await createReviewStore(options)
  const session = randomBytes(32).toString('hex')
  let origin
  const send = (response, status, body, type = 'application/json; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" })
    response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host || request.headers['sec-fetch-site'] === 'cross-site') return send(response, 403, { error: 'LOCAL_ACCESS_ONLY' })
      const url = new URL(request.url, origin)
      if (request.method === 'GET') {
        if (url.pathname === '/api/state') return send(response, 200, { ...store.state(), session })
        if (url.pathname === '/api/export') return send(response, 200, store.snapshot())
        if (url.pathname.startsWith('/api/image/')) {
          const image = store.preview(url.pathname.slice('/api/image/'.length))
          return image ? send(response, 200, image.buffer, image.mime) : send(response, 404, { error: 'CHECK_IMAGE_FIRST' })
        }
        const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/order.js': ['order.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] }
        const file = files[url.pathname]
        return file ? send(response, 200, await readFile(resolve(root, 'tools/athlete-review', file[0])), file[1]) : send(response, 404, { error: 'NOT_FOUND' })
      }
      if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['x-review-session'] !== session || !request.headers['content-type']?.startsWith('application/json')) return send(response, 403, { error: 'LOCAL_SESSION_REQUIRED' })
      let bytes = 0
      const chunks = []
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 32768) return send(response, 413, { error: 'REQUEST_TOO_LARGE' })
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (url.pathname === '/api/review') await store.save(input.id, input)
      else if (url.pathname === '/api/check') await store.checkEntry(input.id)
      else if (url.pathname === '/api/check-all') {
        if (store.job.running) return send(response, 409, { error: 'CHECK_ALREADY_RUNNING' })
        void store.checkAll().catch(() => { store.job.running = false; store.job.stoppedReason = 'CHECK_FAILED' })
      } else return send(response, 404, { error: 'NOT_FOUND' })
      return send(response, 200, { ...store.state(), session })
    } catch (error) { return send(response, error.message === 'STALE_REVIEW_RELOAD_REQUIRED' ? 409 : 400, { error: String(error.message).slice(0, 1500) }) }
  })
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 5188, '127.0.0.1', resolve) }) }
  catch (error) { await store.dispose(); throw error }
  origin = `http://127.0.0.1:${server.address().port}`
  return { server, store, origin, close: async () => { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await store.dispose() } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.some(arg => arg !== '--check' && !/^--port=\d{1,5}$/.test(arg))) throw new Error('Usage: npm run review:athletes [-- --check | --port=5188]')
    if (args.includes('--check')) {
      const store = await createReviewStore()
      try {
        await store.checkAll()
        console.log(JSON.stringify({ ...store.snapshot().summary, job: store.job, output: `data/question-bank/prepared/athletes-local-review/${outputName}` }, null, 2))
        if (store.job.stoppedReason) process.exitCode = 2
      } finally { await store.dispose() }
    } else {
      const app = await startReviewServer({ port: Number(args.find(arg => arg.startsWith('--port='))?.split('=')[1] ?? 5188) })
      console.log(`Local review: ${app.origin}\nOutput: data/question-bank/prepared/athletes-local-review/${outputName}\nNo Cloud writes. Ctrl+C to stop.`)
      process.once('SIGINT', async () => { await app.close(); process.exit(0) })
      process.once('SIGTERM', async () => { await app.close(); process.exit(0) })
    }
  } catch (error) {
    console.error(`BLOCKED: ${String(error.message).replace(/https?:\/\/[^\s]+/g, '[URL]').slice(0, 180)}`)
    process.exitCode = 2
  }
}
