# Phase 3 — Supabase Setup Report

驗收日期：2026-10-23（Asia/Taipei）

結論：Phase 3 的必要技術驗證已完成，包含真實 SDK 初始化、CLI 登入及 Project Link、Auth Health HTTP 200。PostgreSQL Query 明確為 NOT TESTED；未開始 Phase 4。

### 1. Completed Tasks

- [x] 使用既有 Project，不另建或啟用付費資源；Free 方案由使用者確認，未呼叫 Billing API 另行驗證。
- [x] 已取得 Reference ID：`fgvajdnzrnptdjurhjfo`。
- [x] 已取得 Project URL：`https://fgvajdnzrnptdjurhjfo.supabase.co`。
- [x] 使用者將 Publishable Key 設於被忽略的 `.env.local`，本報告不包含金鑰。
- [x] 安裝 `@supabase/supabase-js@2.118.0` 與開發依賴 `supabase@2.121.0`。
- [x] 建立 `.nvmrc` 與 Node.js 22.18+ 需求，使用暫存 Node.js 22.23.4 執行驗證。
- [x] `.env.example` 僅含示意值；`.gitignore` 排除本機環境及 CLI `.temp`／`.branches`。
- [x] 共用 Client 延遲初始化，讀取 Vite 環境變數、拒絕示意值及非 Publishable Key，匯入但未使用時不影響 UI。
- [x] `supabase init` 已產生 `supabase/config.toml`，未使用 `--force`。
- [x] 使用者自行完成 CLI 登入；唯讀 `projects list` 實測成功。
- [x] CLI Link 成功，`projects list` 顯示指定 Reference ID 的 `linked: true`，本機 `.temp/project-ref` 亦吻合。
- [x] 真實 Client 初始化及 Cloud Auth Health Check 分別通過。
- [x] Build、自動化測試、Phase 2 瀏覽器回歸與 Git 安全檢查通過。
- [x] 更新 README 與 AGENTS，保留既有頁面、Mock Data、路由和動畫行為。

CLI 查到的 Project 狀態為 `ACTIVE_HEALTHY`，Region 為 `ap-northeast-1`（Tokyo）。Dashboard 的目前顯示名稱為 **chiamaureen's Project**，與原本期望的 **guess-who** 不同；本次依使用者提供的 Reference ID 連結，未自行改名或另建 Project。

### 2. Modified Files

| 檔案 | 用途 |
| --- | --- |
| package.json / package-lock.json | SDK／CLI 依賴、Node 需求、連線檢查及測試命令 |
| .nvmrc | 指定 Node.js 22，不修改使用者預設版本 |
| .env.example | 公開環境變數示意值 |
| .env.local | 真實 URL／Publishable Key，由使用者填寫；Git 忽略，未納入追蹤 |
| .gitignore | 額外排除 CLI 臨時連結資訊 |
| src/vite-env.d.ts | 公開 Vite 環境變數型別 |
| src/lib/supabase-config.ts | 環境檢查、HTTPS 官方網域限制、公開金鑰格式與安全錯誤訊息 |
| src/lib/supabase.ts | getSupabaseClient 延遲單例，不自動建立 Session 或呼叫 API |
| src/lib/supabase.test.ts | 缺設定、URL、憑證類型及初始化回歸測試 |
| scripts/check-supabase.mjs | 安全載入環境、SDK 初始化與真正 Auth Health GET |
| scripts/check-supabase.node-test.mjs | Health 狀態判斷、HTTP／網路錯誤與不回顯金鑰測試 |
| supabase/config.toml / supabase/.gitignore | CLI 官方初始化範本與排除規則 |
| README.md / AGENTS.md | 安裝、設定、CLI、安全界線、驗證及後續階段規則 |
| docs/phase3-supabase-setup.md | 本驗收報告 |

`supabase/.temp/` 為 CLI 產生且被忽略的本機資料，不是要提交的設定或憑證。

### 3. Test Results

| Test | Result | Details |
| --- | --- | --- |
| SDK Installation | PASS | npm ls 確認 @supabase/supabase-js 2.118.0 |
| CLI Installation | PASS | npx --no-install supabase --version 實際回傳 2.121.0 |
| CLI Initialization | PASS | init 完成，config.toml 存在；未啟動本機服務 |
| CLI Login | PASS | 使用者登入後 projects list 成功列出指定 Project |
| CLI Project Link | PASS | link 成功，後續 list 顯示 linked=true，本機 Reference ID 紀錄一致 |
| Client Initialization | PASS | 使用 .env.local 的真實值成功初始化 src/lib/supabase.ts 的共用 Client |
| Cloud API Health Check | PASS | 真實 GET /auth/v1/health，apikey header，HTTP 200，name／version／description 符合 GoTrue Health Response |
| PostgreSQL Query | NOT TESTED | Phase 4；未執行 SELECT、Schema 或 RLS 驗證 |
| npm test | PASS | 30 項 Vitest + 21 項 Node 原生測試，共 51 項通過 |
| npm run build | PASS | Node.js 22.23.4；TypeScript 與 Vite Build 成功 |
| Build without Supabase config | PASS | 以空的兩個 VITE_SUPABASE_* 值執行 Build，仍可成功建置 Phase 2 UI |
| Phase 2 UI Regression | PASS | 現有 Chrome 155 的 25 項瀏覽器檢查通過；3 頁 × 6 種寬度、Mock 表單、路由與互動；無 pageerror／房間 API 請求 |
| lint | NOT CONFIGURED | 無既有 lint script，本階段未新增工具或假設通過 |
| Git Security Review | PASS | .env.local 未追蹤且被忽略；原始碼、未忽略新增檔及 Git Diff 掃描未發現實際憑證 |
| git diff --check | PASS | 無空白錯誤 |

初始化 PASS 不等於連線 PASS；本次另行取得真實 HTTP 200 才將 Cloud API 標示 PASS。51 項自動化測試中的 fixture-only 回應只是測試資料，不是雲端連線證據。

首次在沙箱內測試時曾發生 DNS FAIL；取得網路授權後，及 CLI Link 完成後的兩次實際請求均通過。沒有將 DNS 失敗或 HTTP 404 當作成功。

正式檢查命令（先切換至 Node.js 22.18+）：

```sh
node --version
npm ls @supabase/supabase-js supabase
npx --no-install supabase --version
npx --no-install supabase projects list
npm run check:supabase
npm test
npm run build
git status --short
git diff --check
git ls-files -- .env.local
git check-ignore -v .env.local
```

Health Script 結束碼：PASS=0、FAIL=1、BLOCKED=2。只有設定缺失／仍為示意值等情形才回報 BLOCKED；HTTP 或網路請求失敗回報 FAIL。

Phase 2 瀏覽器回歸使用暫存的 `/tmp/guess-who-phase2-qa/check.mjs`；本次結果與截圖位於 `/tmp/guess-who-phase3-qa/`，不納入 Repository 或 CI。這不代表 Safari／Firefox 或實體手機已驗證。

### 4. Manual Actions Required

必要的雲端建立、環境值填入及 CLI 登入已由使用者完成，目前無缺失憑證造成的 BLOCKED 項目。

- 日常開發前請在自己的 Shell 執行 `nvm install`、`nvm use`，確認 `node --version` 為 22.18+。本次驗證使用暫存 Node.js 22.23.4，未更改系統預設 Node.js 20.19.5。
- 若希望 Project 顯示名稱與 Repository 一致，可在 Dashboard 的 Project Settings 確認並改為 guess-who；Reference ID 不需更動，本次沒有代改。
- 換電腦／清除 CLI 憑證時，需自行在互動終端機重新 login／link；勿把 Access Token 或資料庫密碼傳給助理或寫入指令參數。

### 5. Security Review

- `.env.local` 未列於 `git ls-files -- .env.local`，`git check-ignore -v` 確認 `.env.*` 排除規則生效。
- `.env.example` 只有 YOUR_PROJECT_REF／YOUR_PUBLISHABLE_KEY 示意值。
- 實際 Publishable Key 未硬編碼到原始碼、文件、測試或 Git Diff，也未在輸出中回顯。
- 已掃描追蹤與未被忽略的新增檔、Git Diff，未發現 Secret Key、Service Role JWT、Database Password URI 或 CLI Access Token 的實際值；此為本次檔案及格式檢查，不是完整 Git 歷史稽核。
- CLI 登入憑證由 CLI 在使用者層級管理，未讀取或印出；`.temp`／`.branches` 被排除。
- Client 只接受 Publishable Key；它不是 Host Token，也不具主持人權限。
- Client 目前關閉 Session 儲存、自動刷新及 URL Session 偵測。未來 Auth 設計需另行實作，不把此設定誤認為正式匿名身分機制。
- Health 測試只送 GET、10 秒逾時、拒絕重新導向，避免將 apikey 轉送其他位置；錯誤不輸出原始回應或底層可能含憑證的內容。
- 未執行 supabase start、db reset、db push、db pull、migration、資料表操作或任何正式部署。
- 未執行 Git Commit 或 Push。

### 6. Remaining Issues

- 雲端 Project 顯示名稱與原期望不同；Reference ID、URL、健康狀態及 Link 均已核實，不影響目前連線。
- Free 方案依使用者確認；未啟用任何付費資源，亦未修改 Billing 設定。
- 使用者預設 Shell 仍為 Node.js 20；最新版 SDK 不再支援此版本，請依 .nvmrc 切換 Node.js 22。原 React／Vite／Router 版本與設定未變更。
- lint 尚未設定；尚未建立正式 CI 或部署 Workflow。
- 自訂 Supabase 網域與本機 Supabase URL 不在目前驗證器支援範圍；本階段只對標準雲端 URL 做安全連線。
- 無 Phase 4 的正式資料表、RLS、資料庫查詢或 API，因此無法宣稱遊戲資料權限或 PostgreSQL 存取已驗證。

### 7. Phase 4 Readiness

- **是否已完成 Phase 3？** 是，依本次必要技術清單已通過；上述專案名稱、日常 Node 切換與未設定 lint 等限制如實列出。
- **是否可以進入 Phase 4？** 技術前置條件已就緒，但必須取得使用者新的 Phase 4 授權才開始；本次未實作。
- **哪些事項尚未完成？** 正式 Schema、RLS／GRANT、SELECT 驗證、匿名 Session、主持人憑證、房間 API、遊戲引擎、Realtime、題庫與部署。
- **資料庫工作優先順序：** 先設計房間、玩家 Session、人物／分類與遊戲進度的資料模型，區分玩家可讀狀態與私密答案，再設計 migration、約束、GRANT／RLS 及權限測試，最後才開始雲端資料庫操作。

依據官方文件確認的 Health 格式與公開金鑰界線：[Auth Health](https://supabase.com/kb/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR)、[API Keys](https://supabase.com/docs/guides/getting-started/api-keys)、[SDK Node.js Support](https://github.com/supabase/supabase-js#support-policy)。
