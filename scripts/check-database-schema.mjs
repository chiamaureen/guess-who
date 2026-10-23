import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../', import.meta.url)
const expectedProject = 'fgvajdnzrnptdjurhjfo'
const sqlFile = new URL('../supabase/tests/schema_catalog.sql', import.meta.url)

export function differencePaths(expected, actual, path = 'schema') {
  if (Object.is(expected, actual)) return []
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object' || Array.isArray(expected) !== Array.isArray(actual)) return [path]
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
  return keys.flatMap(key => differencePaths(expected[key], actual[key], `${path}.${key}`))
}

export function withoutTransaction(sql) {
  return sql.replace(/^BEGIN READ ONLY;\s*/, '').replace(/COMMIT;\s*$/, '')
}

export function isReviewedPlatformFunction(functionRow) {
  return functionRow.name === 'rls_auto_enable'
    && functionRow.arguments === ''
    && functionRow.return_type === 'event_trigger'
    && functionRow.owner === 'postgres'
    && functionRow.security_definer === true
    && functionRow.source_md5 === 'c44fb229ea8a6b0afd04a0a33261c16c'
    && JSON.stringify(functionRow.config) === JSON.stringify(['search_path=pg_catalog'])
    && differencePaths([{ name: 'ensure_rls', event: 'ddl_command_end', enabled: 'O', tags: ['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'] }], functionRow.event_triggers).length === 0
}

export async function localCatalog() {
  const database = new PGlite()
  try {
    await database.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;')
    await database.exec(await readFile(new URL('../supabase/tests/realtime-platform.sql', import.meta.url), 'utf8'))
    const directory = new URL('../supabase/migrations/', import.meta.url)
    const files = (await readdir(directory)).filter(filename => filename.endsWith('.sql')).sort()
    const versions = files.map(filename => filename.split('_')[0])
    if (new Set(versions).size !== versions.length) throw new Error('DUPLICATE_MIGRATION_VERSION')
    for (const filename of files) await database.transaction(async transaction => transaction.exec(await readFile(new URL(filename, directory), 'utf8')))
    const results = await database.exec(await readFile(sqlFile, 'utf8'))
    return { ...results.at(-2).rows[0].catalog, migrations: files }
  } finally {
    await database.close()
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--linked') {
    console.log('BLOCKED: use --linked explicitly; this command compares an isolated local schema with read-only Cloud metadata.')
    process.exitCode = 2
    return
  }
  let linked
  try {
    linked = (await readFile(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8')).trim()
  } catch {
    console.log('BLOCKED: linked project record is missing.')
    process.exitCode = 2
    return
  }
  if (linked !== expectedProject) {
    console.log('BLOCKED: linked project does not match the approved verification target.')
    process.exitCode = 2
    return
  }

  let local
  try {
    local = await localCatalog()
  } catch {
    console.log('FAIL: isolated migration replay or catalog query failed; raw error redacted.')
    process.exitCode = 1
    return
  }
  let remote
  try {
    const { stdout } = await promisify(execFile)('npx', ['--no-install', 'supabase', 'db', 'query', '--linked', '--file', fileURLToPath(sqlFile)], { cwd: fileURLToPath(root), timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
    remote = JSON.parse(stdout).rows?.[0]?.catalog
    if (!remote?.schema) throw new Error('INVALID_CATALOG_RESPONSE')
  } catch {
    console.log('BLOCKED: Cloud read-only catalog query unavailable; CLI/network details redacted, no successful drift comparison.')
    process.exitCode = 2
    return
  }
  const extraFunctions = remote.public_functions.filter(functionRow => !local.public_functions.some(expected => expected.name === functionRow.name && expected.arguments === functionRow.arguments))
  const reviewedFunctions = extraFunctions.filter(isReviewedPlatformFunction)
  const unexpectedFunctions = extraFunctions.filter(functionRow => !isReviewedPlatformFunction(functionRow))
  const differences = [...differencePaths(local.schema, remote.schema), ...differencePaths(local.public_functions, remote.public_functions.filter(functionRow => !isReviewedPlatformFunction(functionRow)), 'functions')]
  const schemaCreateAllowed = remote.browser_schema_create.some(privilege => privilege.allowed)
  const unsafeObjects = remote.public_views.length > 0 || unexpectedFunctions.length > 0 || remote.realtime_tables.length > 0 || schemaCreateAllowed
  console.log(JSON.stringify({ result: differences.length || unsafeObjects ? 'FAIL' : 'PASS', localVersion: local.server_version, cloudVersion: remote.server_version, migrations: local.migrations, tables: remote.schema.tables.length, columns: remote.schema.columns.length, constraints: remote.schema.constraints.length, indexes: remote.schema.indexes.length, tablePrivilegeChecks: remote.schema.table_privileges.length, differences, publicViews: remote.public_views.length, unexpectedPublicFunctions: unexpectedFunctions.length, reviewedPlatformFunctions: reviewedFunctions.map(functionRow => ({ name: functionRow.name, returnType: functionRow.return_type, securityDefiner: functionRow.security_definer, anonExecute: functionRow.anon_execute, authenticatedExecute: functionRow.authenticated_execute })), browserSchemaCreate: schemaCreateAllowed, realtimeTables: remote.realtime_tables.length, warnings: reviewedFunctions.length ? ['Reviewed RLS event trigger exists outside app migrations; public EXECUTE is unnecessary. See final verification report.'] : [] }, null, 2))
  if (differences.length || unsafeObjects) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
