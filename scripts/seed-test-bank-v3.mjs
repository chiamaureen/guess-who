import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { planV3Seed, makeV3SeedSql } from './lib/test-bank-v3-seed.mjs'

try {
  const args = process.argv.slice(2)
  const allowed = ['--dry-run', '--bank', '--snapshot', '--out', '--emit-sql']
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (!allowed.includes(flag) || Object.hasOwn(options, flag)) throw new Error('INVALID_FLAGS')
    options[flag] = ['--dry-run', '--emit-sql'].includes(flag) ? true : args[++index]
  }
  if (!options['--dry-run'] || !options['--bank'] || !options['--out']) throw new Error('USE_DRY_RUN_BANK_AND_NEW_OUTPUT_DIRECTORY')
  const bank = JSON.parse(await readFile(options['--bank'], 'utf8'))
  const raw = options['--snapshot'] ? JSON.parse(await readFile(options['--snapshot'], 'utf8')) : null
  const snapshot = raw?.rows?.[0]?.snapshot ?? raw
  const plan = planV3Seed(bank, snapshot)
  const directory = resolve(options['--out'])
  const root = resolve('data/question-bank/prepared')
  if (!directory.startsWith(root + '/')) throw new Error('OUTPUT_MUST_BE_IGNORED_PREPARED_DIRECTORY')
  await mkdir(directory, { mode: 0o700 })
  await writeFile(join(directory, 'dry-run.json'), JSON.stringify(plan, null, 2), { mode: 0o600, flag: 'wx' })
  if (options['--emit-sql'] && plan.status === 'READY_FOR_LOCAL_SQL_REVIEW') {
    const sql = makeV3SeedSql(bank)
    await writeFile(join(directory, 'pending-candidate-seed.sql'), sql.seed, { mode: 0o600, flag: 'wx' })
    await writeFile(join(directory, 'rollback-pending-candidates.sql'), sql.rollback, { mode: 0o600, flag: 'wx' })
    await writeFile(join(directory, 'receipt.json'), JSON.stringify({ runId: sql.runId, status: 'LOCAL_SQL_ONLY_NOT_DEPLOYED', sqlSha256: createHash('sha256').update(sql.seed).digest('hex'), cloudWrites: 0 }, null, 2), { mode: 0o600, flag: 'wx' })
  }
  console.log(JSON.stringify({ status: plan.status, pendingStagingInserts: plan.pendingStagingInserts, existingReused: plan.existingReused, groups: plan.groups, cloudWrites: 0 }))
  if (plan.status.startsWith('BLOCKED')) process.exitCode = 2
} catch {
  console.error('BLOCKED: invalid candidates, snapshot or output; no Cloud connection or write performed.')
  process.exitCode = 2
}
