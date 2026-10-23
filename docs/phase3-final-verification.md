# Guess Who — Phase 3 Final Verification Report

驗收日期：2026-10-23（Asia/Taipei）  
驗收基準：Repository commit `9faa93f` 與本次列出的最小修正。  
目標 Project Reference ID：`fgvajdnzrnptdjurhjfo`。  
最終結論：**READY WITH WARNINGS**。

### 1. Executive Summary

Phase 3 的必要條件均有本次重新執行的證據：SDK 正常、Client 初始化成功、CLI 可存取並連結指定 Project、真實 Auth Health 回傳 HTTP 200、環境與 Git 憑證檢查通過、Build 成功、Phase 2 UI 無回歸。

- 51 項自動化測試及 27 項 Chrome 瀏覽器檢查通過。
- Console error 與未處理 JavaScript 例外均為 0。
- 初測發現 favicon 404；已補上本機 SVG 與 HTML 宣告，重測通過，不變更頁面流程或遊戲行為。
- 文件補齊 Host Token、明確 GRANT／RLS、伺服器 Game State 權威及 Realtime 答案隔離的安全設計前提，僅記錄規格。
- 非阻斷警告：lint 未設定、執行 Shell 預設 Node.js 仍為 20、雲端 Project 顯示名稱與期望不同；瀏覽器／實機範圍限制詳見後文。

本次沒有修改雲端設定、權限或正式環境，沒有建立資料表、執行 migration、查詢 PostgreSQL、啟動本機 Supabase、開發 Room API／遊戲邏輯、啟用付費服務或執行 Commit／Push。

### 2. Verification Checklist

| Check | Status | Details |
| --- | --- | --- |
| Repository | PASS | 正確位於 guess-who；origin 為 github.com/chiamaureen/guess-who.git；npm ls --all 無 dependency problems |
| Environment Variables | PASS | .env.local 存在，兩個值皆已設定；格式通過，檔案及執行時有效 URL 均指向指定 Reference ID；未列印任何金鑰 |
| Supabase Client | PASS | TypeScript createClient、import.meta.env、延遲單例與設定檢查正確；真實設定初始化成功；Mock 未改接 API |
| Supabase CLI | PASS | 2.121.0；config.toml 存在；projects list 成功且目標 linked=true；本機連結紀錄吻合 |
| Cloud Connectivity | PASS | 真實 GET /auth/v1/health：HTTP 200，GoTrue name／version／description 符合驗證條件；DNS／HTTPS 請求成功 |
| Frontend Regression | PASS | 27 項瀏覽器檢查通過，涵蓋首頁入口、分類複選、加入表單、路由、Mock、RWD、Console 與減少動態效果 |
| Build & Quality | PASS | TypeScript 與 Vite Build 成功，51 項測試通過；lint 為 NOT CONFIGURED，不當作失敗或已通過 |
| Security Review | PASS | 原始碼、Git Diff、環境檔追蹤與可達 Git 歷史的憑證格式掃描未發現實際憑證；Phase 4 六項安全前提已明確記錄 |
| Documentation | PASS | README 與 AGENTS 的架構、安裝、環境、CLI、測試、安全規格和實際程式一致；未將規格視為已實作 |
| Git Status | PASS | 只有本次說明的文件、favicon 與 HTML 修正；git diff --check 通過；沒有憑證檔被追蹤；未 Commit／Push |

實際安裝版本：React／React DOM 19.3.1、Vite 7.3.7、TypeScript 5.9.3、Tailwind CSS 4.3.3、React Router 7.18.4、Supabase SDK 2.118.0、Supabase CLI 2.121.0。直接依賴均與既有架構或 Phase 3 需求相符，未新增套件。

### 3. Test Execution Results

驗證使用本機已安裝的 **Node.js 22.23.4**，符合 package.json 的 22.18+ 與 .nvmrc；未變更系統預設 Node.js。以下 npm 命令透過該 Node 版本的 PATH 執行。

| 實際指令／檢查 | Result | 證據與限制 |
| --- | --- | --- |
| Git Remote 檢查 | PASS | 讀取 git remote -v 的輸出後，只顯示 host／path，避免不必要的 URL 憑證輸出；origin 符合預期 |
| npm ls --depth=0 | PASS | React／Vite／TypeScript／SDK／CLI 等直接依賴正常 |
| npm ls --all --json | PASS | dependency problems 為空，未發現 missing／invalid 衝突 |
| node --version | WARNING | 原始 Shell 是 v20.19.5；實際測試使用既有 v22.23.4 |
| npx --no-install supabase --version | PASS | 2.121.0；使用既有安裝，不下載或更新 CLI |
| npx --no-install supabase projects list | PASS | 目標 fgvajdnzrnptdjurhjfo、ACTIVE_HEALTHY、Tokyo、linked=true |
| 本機 CLI Link 檢查 | PASS | supabase/.temp/project-ref 與目標一致；config.toml 存在且 project_id=guess-who；未重新 link／init 或改寫 config |
| 安全環境檢查 | PASS | .env.local 的 URL／Publishable Key 存在、格式合理、Project 一致；不顯示值 |
| npm run check:supabase | PASS | SDK Initialization 與 Cloud Auth API Connectivity 分別 PASS；程式結束碼 0 |
| PostgreSQL Database Query | NOT TESTED | 留到 Phase 4，Health 通過不代表 SELECT、寫入、Schema 或 RLS 驗證通過 |
| npm test | PASS | 30 項 Vitest + 21 項 Node 原生測試，共 51 項；包含初始化、環境驗證、HTTP／DNS／Timeout／錯誤分類 |
| npm run build | PASS | TypeScript 無編譯錯誤，Vite 正常產生 dist |
| npm run lint | NOT CONFIGURED | package.json 沒有此 script，未執行不存在的命令，也未新增 lint 設定 |
| Playwright + 現有 Chrome | PASS | 最終 27／27；初測 26／27 的 favicon 資源錯誤已修正並複測 |
| 正式 favicon 產物檢查 | PASS | dist/index.html 指向 /guess-who/favicon.svg，檔案存在且與來源一致 |
| git ls-files -- .env .env.local | PASS | 無輸出，兩個敏感環境檔未被追蹤 |
| git check-ignore -v .env.local | PASS | .gitignore 的 .env.* 規則生效；CLI .temp 也被忽略 |
| 安全掃描 | PASS | 工作區與新增檔、Git Diff、66 個可達歷史 blob 未發現符合檢查條件的實際秘密憑證或硬編碼的本機真實 Publishable Key |
| git status --short／git diff --check | PASS | 僅預期修改，無空白錯誤 |

雲端驗證與 CLI 管理資訊透過已授權的唯讀網路命令執行；不使用 Debug 模式、不讀取或列印 CLI Access Token。SDK 的 fixture-only 測試不算雲端連線證據，實際 Health 請求獨立執行。

#### 瀏覽器測試範圍

- Chrome 155.0.8059.85 headless，三個頁面分別測試 320、375、390、768、1024、1440px 寬度，共 18 組 RWD 檢查，沒有整頁水平溢出。
- 實際點擊首頁建立／加入入口、主持人分類複選與取消、空選擇停用、Mock 回饋正常。
- 房間代碼預填／轉大寫、必填、非法代碼、空白與過長暱稱、合法暱稱提交正常。
- 首頁／建立／加入路由、重新整理、邀請碼保留、未知路由 fallback、怎麼玩底線與回頂端清除錨點正常。
- 磁吸與減少動態效果切換正常；未捕捉到 console.error、pageerror 或房間 API fetch／XHR。
- 證據暫存在 `/tmp/guess-who-phase3-final-qa/results.json` 與同目錄的 6 張手機／桌面截圖。瀏覽器腳本為 `/tmp/guess-who-phase2-qa/final-check.mjs`，未新增至專案依賴或 CI。

### 4. Issues Found

| Severity | 問題 | 狀態／影響 |
| --- | --- | --- |
| Critical | 無已發現問題 | 本次有限範圍檢查沒有發現秘密憑證外洩或錯誤 Project 連結；不等同完整滲透測試 |
| High | 無已發現問題 | 必要初始化、CLI、真實 API、Build 與 UI 條件均已通過 |
| Medium | 無已發現問題 | 未有未解決的阻斷測試失敗 |
| Low | 未宣告 favicon，Chrome 自動請求 /favicon.ico 產生 404 Console Error | 已補本機 SVG 與明確連結；27 項檢查重測通過，Console 為 0 |
| Low | 文件未逐字明確表達 Host Token／GRANT／Game State 唯一權威 | 已補 README 與 AGENTS，僅需求規格，未提前實作 |
| Low | lint 未設定 | 非阻斷；若下一階段要求，應先決定規則與 CI 命令 |
| Low | 本次預設執行 Shell 仍為 Node.js 20.19.5 | Node.js 22.23.4 已存在並用於所有必要測試；日常開發先 nvm use |
| Low | 雲端顯示名稱為 chiamaureen's Project，與期望 guess-who 不同 | Reference ID、URL、健康狀態及 Link 均正確；未擅自改名或另建 Project |

### 5. Files Modified

| File | Reason |
| --- | --- |
| AGENTS.md | 明確補充 GRANT／RLS、Host Token、Game State 權威與 Realtime 隔離需求 |
| README.md | 補充六項 Phase 4 安全設計前提，加入本最終報告入口 |
| index.html | 明確宣告本機 favicon，避免隱式 /favicon.ico 404 |
| public/favicon.svg | 本機 SVG 圖示，不依賴第三方圖片或網路 |
| docs/phase3-final-verification.md | 本次實測證據、限制與 Readiness Gate 結論 |

本次沒有修改 SDK／CLI 版本、lockfile、Supabase Client、Mock service、頁面流程、CSS、config.toml 或雲端設定。

### 6. Security Findings

- `.env.local` 未被追蹤，內容只在記憶體用於格式檢查及 Health header；本報告、輸出與 Diff 不含真實金鑰。
- `.env.example` 只有示意值。未發現誤用 Secret／Service Role Key，亦未發現資料庫密碼、CLI Access Token 硬編碼。
- 掃描目前可見的檔案、Git Diff 與 Git 可達歷史 blob；未發現敏感環境檔路徑或符合秘密金鑰、Access Token、Service Role JWT、帶密碼 PostgreSQL URI 等規則的內容。不涉及已清除／不可達物件、外部日誌或完整組織層級安全稽核。
- 沒有新增 Debug UI、Debug API、正式房間 API、答案控制或任何雲端資料修改；現有 roomService 只回傳清楚標示的 Mock 結果。
- Client 為延遲單例，只接受 Publishable Key；缺設定不會因匯入模組就破壞 Phase 2 UI。Publishable Key 不代表主持人身分或權限。
- Health Script 僅 GET、固定標準 Supabase HTTPS 網域驗證、10 秒逾時、拒絕重新導向，且只輸出固定診斷訊息。
- `supabase/config.toml` 的本機服務與 env(...) 設定是初始化範本，沒有硬編碼秘密，也不表示本機服務或對應雲端功能已啟動。
- 六項未來安全要求已明確寫入：揭曉前玩家不可取得姓名、不可只靠 UI 隱藏、明確 GRANT／RLS／Edge Functions 授權、Host Token 伺服器驗證、Server 唯一 Game State 權威、Realtime 不傳未揭曉答案。**只記錄規格，並未驗證其實作。**

### 7. Manual Verification Required

- Safari／Firefox 與實體 iPhone／Android：NOT TESTED。人工依序檢查三頁、分類複選、加入表單、導覽、橫向溢出與 Console；本次 Chrome 視窗模擬不替代實機。
- 真正 GitHub Pages 公開部署：NOT TESTED。本次只驗證本機路由與產物 Base Path，沒有變更正式環境或部署 Workflow。
- Free Plan／Billing：沿用使用者確認的 Free Project，未額外驗證 Billing，也沒有建立或啟用任何付費功能。可在 Dashboard 確認方案。
- Project 顯示名稱如需統一，可由使用者在 Dashboard 確認後修改；本次以 Reference ID 為識別依據。
- 在自己的終端機執行 `nvm use`，確認 Node.js 22.18+ 再執行 npm 命令；不需要重新提供任何金鑰或 Token。

### 8. Phase 4 Readiness

**READY WITH WARNINGS**

| 必要條件 | 結果 |
| --- | --- |
| Supabase SDK 與 Client 初始化 | PASS |
| CLI 可用並連結正確 Project | PASS |
| 真實 Auth Health API HTTP 200 | PASS |
| 環境設定正確、未發現憑證洩漏 | PASS |
| TypeScript／Vite Build | PASS |
| Phase 2 核心功能無回歸 | PASS |
| README／AGENTS 完整且符合實際狀態 | PASS |

沒有必要驗收項目失敗或 BLOCKED。保留 WARNINGS 是因 lint 未設定、Shell Node 選擇、Project 顯示名稱及跨瀏覽器／實機／正式部署範圍限制；它們不阻擋開始資料庫設計。

**PostgreSQL Query、Schema、GRANT、RLS 與資料庫讀寫仍為 NOT TESTED，留待 Phase 4。** Health API 成功不代表資料庫權限已完成。

技術上可以進入 Phase 4，但本次只有驗收與 Readiness Check，尚未取得新的實作授權，因此沒有開始 Phase 4。

### 9. Recommended Next Steps

在使用者明確授權 Phase 4 後，建議依序：

1. 先完成資料模型與狀態機設計：房間、玩家 Session、人物、分類、每場題目及進度。
2. 將玩家可讀照片／揭曉狀態與主持人或伺服器私密答案分離，明確定義每個角色可讀寫欄位。
3. 規劃匿名身分與安全 Host Token 的伺服器驗證、保存、到期與主持人重新整理恢復方式。
4. 設計唯一性、外鍵、狀態限制與同場人物不重複的約束；規劃伺服器每場 15 題抽題及題庫不足時的處理。
5. 先列出 GRANT／RLS／Edge Functions 的權限矩陣與允許／拒絕案例，再審查 migrations。
6. 另行授權資料庫操作後，才執行 migration、SELECT 與權限測試；Realtime payload 必須遵守答案隔離。

本次沒有執行 `supabase start`、`supabase db reset`、`supabase db push`、`supabase db pull` 或任何正式資料表／權限修改，也沒有 Commit 或 Push。
