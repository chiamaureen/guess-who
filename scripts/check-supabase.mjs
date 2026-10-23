import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { pathToFileURL } from 'node:url'
import { getSupabaseClient } from '../src/lib/supabase.ts'
import { readSupabaseConfig, SupabaseConfigError } from '../src/lib/supabase-config.ts'

const result = (status, details) => ({ status, details })

export async function readEnvironment(filename = new URL('../.env.local', import.meta.url)) {
  let values = {}
  try {
    values = parseEnv(await readFile(filename, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('ENV_READ_FAILED')
  }

  return Object.fromEntries(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].map(name => [name, process.env[name] ?? values[name]]))
}

export function classifyNetworkError(error) {
  if (['TimeoutError', 'AbortError'].includes(error?.name) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.cause?.code)) return 'TIMEOUT：請檢查網路或稍後重試。'
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.cause?.code)) return 'DNS：無法解析 Project 網域。'
  return 'NETWORK：網路、TLS 或連線失敗；若收到重新導向，也會拒絕跟隨以避免轉送金鑰。'
}

export async function checkSupabase(environment, { fetchImpl = globalThis.fetch, initializeClient = getSupabaseClient, timeoutMs = 10000 } = {}) {
  const results = { initialization: null, connectivity: null, postgres: result('NOT TESTED', 'Phase 4；本測試不查詢 PostgreSQL。') }
  let config
  try {
    config = readSupabaseConfig(environment)
  } catch (error) {
    const blocked = error instanceof SupabaseConfigError && ['MISSING_CONFIG', 'PLACEHOLDER_CONFIG'].includes(error.code)
    results.initialization = result(blocked ? 'BLOCKED' : 'FAIL', error instanceof SupabaseConfigError ? error.message : '無法驗證 Supabase 設定。')
    results.connectivity = result('BLOCKED', '請先修正環境設定，未送出 HTTP 請求。')
    return results
  }

  try {
    const client = initializeClient(environment)
    if (!client?.auth || typeof client.from !== 'function') throw new Error('INVALID_CLIENT')
    results.initialization = result('PASS', '已使用實際提供的設定初始化共用 SDK Client；此結果不代表雲端連線成功。')
  } catch {
    results.initialization = result('FAIL', 'SDK 初始化失敗；請確認 Node.js 22.18+ 與依賴安裝，未輸出底層錯誤以避免洩漏憑證。')
  }

  try {
    const response = await fetchImpl(`${config.url}/auth/v1/health`, {
      method: 'GET',
      headers: { apikey: config.publishableKey },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })

    if (response.status !== 200) {
      const hints = {
        401: '金鑰未被接受，請檢查 Publishable Key。',
        403: '存取被拒，請檢查專案狀態或存取限制。',
        404: 'Health Endpoint 不存在，請檢查 Project URL；404 不是連線通過。',
      }
      results.connectivity = result('FAIL', `HTTP ${response.status}：${hints[response.status] ?? '預期 HTTP 200，請檢查專案狀態。'}`)
      return results
    }

    let body
    try {
      body = await response.json()
    } catch (error) {
      if (['AbortError', 'TimeoutError'].includes(error?.name)) throw error
      results.connectivity = result('FAIL', 'INVALID_RESPONSE：HTTP 200，但回應不是有效 JSON。')
      return results
    }

    if (body?.name !== 'GoTrue' || typeof body.version !== 'string' || !/^v?\d+\.\d+\.\d+(?:[-+].+)?$/.test(body.version)
      || typeof body.description !== 'string' || !/authentication API/i.test(body.description)) {
      results.connectivity = result('FAIL', 'INVALID_RESPONSE：HTTP 200，但內容不符合官方 GoTrue Health Response。')
      return results
    }

    results.connectivity = result('PASS', 'GET /auth/v1/health 實際回傳 HTTP 200，且 GoTrue Health Response 驗證通過。')
  } catch (error) {
    results.connectivity = result('FAIL', classifyNetworkError(error))
  }

  return results
}

export function exitCodeFor(results) {
  const statuses = [results.initialization.status, results.connectivity.status]
  return statuses.includes('FAIL') ? 1 : statuses.includes('BLOCKED') ? 2 : 0
}

async function main() {
  let results
  try {
    results = await checkSupabase(await readEnvironment())
  } catch {
    results = {
      initialization: result('BLOCKED', '無法安全讀取 .env.local；請檢查檔案格式與權限。'),
      connectivity: result('BLOCKED', '未送出 HTTP 請求。'),
      postgres: result('NOT TESTED', 'Phase 4'),
    }
  }

  for (const [label, entry] of [['SDK Initialization', results.initialization], ['Cloud Auth API Connectivity', results.connectivity], ['PostgreSQL Query', results.postgres]]) {
    console.log(`${label}: ${entry.status} — ${entry.details}`)
  }
  process.exitCode = exitCodeFor(results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
