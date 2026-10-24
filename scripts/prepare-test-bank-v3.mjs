import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { collectV3Metadata, summarizeV3 } from './lib/test-bank-v3.mjs'

if (![3, 4].includes(process.argv.length) || !/^[a-z0-9-]+$/.test(process.argv[2])) throw new Error('New local output directory and optional previous manifest required')
const directory = resolve('data/question-bank/prepared', process.argv[2])
await mkdir(directory, { mode: 0o700 })
const scope = JSON.parse(await readFile('data/question-bank/test-bank-v3-scope.json', 'utf8'))
let athleteEvidence = [], athleteAssets = []
try { athleteEvidence = JSON.parse(await readFile('data/question-bank/prepared/athletes-local-review/final-review-20261024/source-evidence.json', 'utf8')).entries } catch {}
try { athleteAssets = JSON.parse(await readFile('data/question-bank/prepared/athletes-webp-20261024/webp-preparation.json', 'utf8')).entries } catch {}
const previousBank = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')) : null
const bank = await collectV3Metadata(scope, { athleteEvidence, athleteAssets, previousBank })
await writeFile(join(directory, 'candidates.json'), JSON.stringify(bank, null, 2), { mode: 0o600, flag: 'wx' })
const summary = summarizeV3(bank)
await writeFile(join(directory, 'summary.json'), JSON.stringify({ groups: summary, failures: bank.failures, cloudWrites: 0 }, null, 2), { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ groups: summary, failures: bank.failures.length, approved: 0, cloudWrites: 0 }))
