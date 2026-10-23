# Guess Who — Phase 5 Room System Report

驗收日期：2026-10-23（Asia/Taipei）  
範圍：Phase 5 剩餘本機驗收、必要修正、安全檢查與部署提案。  
目標 Project：既有 `fgvajdnzrnptdjurhjfo`；不得新增付費資源。

## 1. Executive Summary

**本機驗收 PASS；完整 Phase 5 雲端整合為 BLOCKED，尚未宣稱 Phase 5 完成。**

後續部署前審核發現的 H-01 High 已完成本機修復：20 次全域 429 新增 0 列；原 119 項與新增 A–J 合計 129 項通過，48 項 browser 與 native PG17.10／20 連線四組併發驗證通過。安全審核更新為 **READY（待使用者審批及部署前 preflight，不是 Cloud 驗收完成）**。本文件其他數字保留初次本機驗收紀錄；最新證據與九步部署計畫見 [Cloud Deployment Approval Report](phase5-cloud-deployment-approval.md)。

- `npm test`：119 項通過，包含原有 17 項後端隔離測試；沒有重複開發既有房間功能。
- Chrome／Playwright：48 項通過，包含主持人建立、玩家加入、邀請、分類複選、刷新恢復與 30 項 RWD 檢查。
- `npm run build`、Edge TypeScript 檢查與 Git 安全檢查通過；未設定 lint，不能記為通過。
- 修正兩項瀏覽器驗收發現：邀請頁加入成功後未切換等待室，以及手機長暱稱造成橫向溢位。
- 本次沒有部署 Function、推送 Migration、設定遠端 Secrets、寫入 Cloud 測試資料、Commit 或 Push；沒有開發 Phase 6。

## 2. Completed Tasks

- 建立房間 UI：從 Database 動態讀取分類、複選／取消、無分類禁用、錯誤／空狀態與重試。
- 建立成功進入 Host Lobby；故意中斷已提交建立操作的回應，再重試仍只有一個房間。
- 玩家可手動輸入代碼／暱稱，或從邀請連結進入；小寫代碼正規化，錯誤與不存在代碼有明確提示。
- Host／Player 在獨立瀏覽器 context 重新整理後，由後端驗證並恢復原控制權／Session，不重建玩家。
- 跨房間沿用同一 Host；玩家只離開自己；關閉後狀態保持 finished，新玩家不能加入。
- 驗證複製邀請連結、手動名單更新、五秒 cooldown、未開放遊戲按鈕、二次確認關閉／撤銷。
- 新增分類可動態呈現，沒有退回 Mock 資料假裝成功。
- 保留首頁視覺、互動、HashRouter 與 GitHub Pages base；首頁「怎麼玩」與回頂 hash 回歸通過。

### 本次修正

| 問題 | 修正 | 重新驗證 |
| --- | --- | --- |
| 邀請頁與加入後 Lobby 同一路徑，導航後沒有重新載入 Session | Lobby effect 納入 React Router location key | 邀請加入、玩家刷新皆 PASS |
| 320px 手機下 20 字元英文暱稱使頁面橫向溢位 | Lobby 標題允許長字斷行 | 六種尺寸、五個頁面皆無頁面橫向溢位 |

## 3. Architecture Overview

```text
React / HashRouter / localStorage credentials
  ├─ Supabase SDK → SELECT active categories（公開、唯讀）
  └─ fetch → room-system/{action}（自訂匿名憑證）
       ├─ Origin / Publishable Key / Input / Rate limit
       └─ service_role-only SQL RPC
            ├─ hosts / rooms / room_categories / room_players
            └─ room_api_rate_limits（待批准新增）
```

伺服器管理身分、房間歸屬、狀態與到期時間。前端本機 role 不是授權，localStorage 不保存權威遊戲狀態。等待室手動更新，沒有 Realtime、輪詢、出題或答案回應。

本機 browser fixture 只供隔離驗收：真實 Fetch handler＋PGlite，網路攔截轉送本機，結束即關閉；不是正式 Node Server，也沒有繞過權限改成假成功回應。

## 4. API Endpoints

準備部署 **一個 Edge Function：`room-system`**，不是六個獨立 Function。

| POST action | 功能 | 驗證 |
| --- | --- | --- |
| host-session | bootstrap／resume／revoke | 保密 bootstrap nonce 或 Host Credential；撤銷需確認 |
| create-room | 房間與分類原子建立 | Host Credential |
| join-room | 匿名加入／安全重試 | 房間代碼、暱稱、保密 join nonce |
| get-room-state | 等待室快照與 Session 恢復 | Host＋Room Token 或 Player Session |
| leave-room | 移除自己的玩家紀錄 | Player Session |
| close-room | waiting → finished | Host＋Room Token |

路徑：`/functions/v1/room-system/{action}`。完整請求、回應與錯誤碼見 [API Contract](room-api.md)。

## 5. Host Identity & Player Session

- Host Credential、單房間 Host Token、Player Session 分離，均為 32 bytes 強度、不同前綴與用途分離 Hash。
- DB 只存 SHA-256 Hash；bootstrap／join 由後端 HMAC 推導可重試憑證，開房使用原 requestKey 避免回應遺失後另開房。
- Web Locks 序列化同 origin 跨分頁首次建立；缺少安全儲存／Web Locks 時明確失敗，不默默改成不持久身分。
- 同瀏覽器刷新可恢復；清除網站資料、無痕關閉、換裝置／origin 可能永久失去控制權，不提供以房間代碼找回 Host 的不安全捷徑。
- localStorage 是 bearer 儲存，不是保險箱；XSS／擴充套件／共用裝置仍可竊取與重放。沒有使用 Supabase Auth Anonymous Sign-In 或假設跨站 HttpOnly Cookie 可用。
- 撤銷保留 Host／房間／跨場歷史；網路失敗不先清除本機憑證。有未到期活動房間時拒絕撤銷。
- 輪替簽章 key 不等於撤銷既有 DB Hash Session；應安排輪替與待確認重試窗口。生命週期與限制詳見 [Room System](room-system.md)。

## 6. Database Operations

### 需要批准的增量

草案：`supabase/migration-drafts/20261023093000_room_system.sql`，**尚未移入 migrations／尚未部署**。

| 項目 | 是否需要 | 影響 |
| --- | --- | --- |
| 新增表 | 是 | 第十表 room_api_rate_limits，主鍵與清理用索引 |
| 新增 RPC | 是 | room_system_action、room_system_lobby、room_system_rate_limit |
| 新表 RLS／GRANT | 是 | ENABLE／FORCE RLS；瀏覽器零權限，service_role 必要 DML |
| RPC EXECUTE | 是 | SECURITY INVOKER、空 search_path；只准 service_role |
| 原九表欄位／RLS | 否 | 不修改、不放寬 |
| 人物／題目／Host history | 否 | 不新增／刪改正式題庫或遊戲歷史 |

建立房間與分類、加入、離開及關閉分別由單一 SQL RPC 交易執行；限流使用另一交易，業務失敗不會撤銷計數。房間代碼 UNIQUE、有界碰撞重試，Session Hash 唯一並驗證原請求一致性。

已部署 Phase 4 Migration SHA-256 保持：

```text
8f5e0ed648794c09ced3b9d221b32ce070bf3b73f936d2f4bbe5b2834bdca07c
```

## 7. Security Review

| 檢查 | 本機結果與界線 |
| --- | --- |
| Host Token | PASS：需要有效長期憑證＋對應房間 Token＋房間歸屬，偽造 ID／role 或玩家 Token 不能控制 |
| Player Session | PASS：刷新／重試不重複加入，只能移除自己；不能偽造 Player ID 接管他人 |
| RLS／GRANT | PASS：合併 Schema 十表 ENABLE／FORCE RLS；私表拒絕 anon／authenticated，三個 RPC 只授 service_role |
| CORS | PASS：allowlist、OPTIONS／方法／headers、非法 Origin 拒絕；沒有 wildcard。真實雲端 gateway 尚未驗證 |
| 限流 | PASS：持久計數、失敗仍提交、過期重置；同時用全域、IP hint 與可用的憑證 scope |
| 敏感回應 | PASS：DTO 白名單，不含 Hash、其他 Session、人物、答案、歷史或 SQL 例外 |
| 邀請 URL | PASS：只有六碼房間代碼，沒有 Host／Player Token 或秘密 query |
| Git／前端憑證 | PASS：未追蹤敏感 env；工作檔、diff／staged diff 與既有 Git blobs 掃描未發現私密 key／token／密碼 URI；env 範例只有示意值 |

`git ls-files -- .env.local` 無輸出；`git check-ignore -v .env.local` 命中 `.gitignore`，CLI `.temp` 也被忽略。`git diff --check` 與 cached 版本通過。沒有 Commit／Push；本報告不含憑證。

安全限制不能省略：CORS 不是身分驗證；Publishable Key 可公開；X-Forwarded-For 僅輔助且可能偽造。全域 cap 保護免費額度但仍可能被耗盡造成拒絕服務，共用 NAT 可能較早遇到限制。這是有界 MVP 防護，不宣稱完整 DDoS／滲透測試通過。掃描為模式與程式審查，不是所有未知憑證格式皆可偵測的保證。

Cloud 既有平台 `rls_auto_enable()` 警告沿用 Phase 4 審查，沒有修改平台事件函式；本次未重跑 Cloud SQL catalog，不能以本機權限通過取代遠端驗證。

## 8. Test Results

環境：Node.js 22.23.4、Chrome 155.0.8059.85、PGlite 0.5.11／PostgreSQL 18.6。Cloud PostgreSQL 17.11 是 Phase 4 先前驗證值，本次沒有寫入或重跑 Cloud 資料庫測試。

| Test | Result | Details |
| --- | --- | --- |
| Vitest | PASS | 44 項；含前端驗證、Session／API service 重試及儲存錯誤 |
| Health script unit tests | PASS | 21 項；模擬 HTTP／設定錯誤，不代表真實連線 |
| Phase 4 baseline SQL | PASS | 37 項；原九表 snapshot 回歸 |
| Phase 5 backend isolation | PASS | 17 項；真實 Fetch handler、合併 SQL、交易／授權／CORS／限流 |
| npm test | PASS | 上述合計 119 項，失敗 0；也執行 check:edge |
| Chrome browser suite | PASS | 48／48，獨立 Host／Player context、邀請／代碼／恢復／錯誤流程 |
| RWD | PASS | 含於 browser suite：320／375／390／768／1024／1440px × 五頁，共 30 項橫向溢位檢查；保留截圖並抽查手機 Lobby、桌面開房頁 |
| npm run check:edge | PASS | 本機 TypeScript strict，非 Deno runtime 驗證 |
| npm run build | PASS | TypeScript＋Vite production build，無失敗 |
| Lint | NOT TESTED | package.json 沒有 lint script；未額外引入 lint 工具或假稱通過 |
| Real SDK initialization | PASS | check:supabase 使用現有真實前端設定 |
| Cloud Auth Health GET | PASS | 真實 HTTP 200、GoTrue Health Response 驗證；唯讀，不是房間 API 驗收 |
| Cloud active categories SELECT | PASS | 真實公開 SDK SELECT 讀到七個啟用分類，沒有修改資料 |
| Git security／diff review | PASS | 無敏感 env 追蹤／掃描發現；已部署 Migration 未變 |
| Cloud Phase 5 Function／RPC／RLS | BLOCKED | 未獲部署授權，本次沒有部署或遠端 SQL 修改 |
| Deno／Supabase gateway integration | NOT TESTED | 本機無 Deno，需批准部署後驗證實際 runtime、import map 與平台 Keys |
| Cloud PG17 Phase 5 DML／多連線競爭 | NOT TESTED | PGlite PG18 單實例結果不能代表真實 PG17 多連線 |

Browser suite 使用真實前端操作與本機業務 handler／SQL；Supabase 請求攔截轉送隔離 fixture，**不是實際 Cloud Edge Function 呼叫**。沒有缺少瀏覽器工具而假設通過；工具確實可用並已執行。

初次 browser run 找到兩個問題，修正後最終 48 項全部通過；目前沒有未修復的本機測試 FAIL。暫時產物在 `/tmp/guess-who-phase5-qa/results.json` 與同目錄截圖，不含 Token，未納入 Git。

重跑：Node.js 22.18+ 執行 `npm test`、`npm run build`；browser 指令及工具前提見 [Room System](room-system.md#10-本機驗證)。

## 9. Modified Files

以下為目前 Phase 5 累積變更；本次收尾著重驗收與必要修正，並非重新開發已完成功能。

| Files | 用途 |
| --- | --- |
| src/pages/CreateRoomPage.tsx、JoinRoomPage.tsx、LobbyPage.tsx、HomePage.tsx、src/App.tsx | 真實房間入口／等待室路由，保留現有設計；修正邀請加入導航 |
| src/services/rooms.ts、src/hooks/useCategories.ts | API orchestration、動態分類、儲存／重試／恢復 |
| src/lib/room-api.ts、room-storage.ts、validation.ts、src/types/game.ts | DTO／錯誤白名單、憑證儲存、輸入與型別 |
| src/data/categories.ts（移除） | 移除未再使用的 Mock 分類，避免與真實分類混淆 |
| src/styles/index.css | Lobby RWD 與長暱稱斷行 |
| supabase/functions/room-system/{index,handler,crypto,runtime.d}.ts | Edge runtime、六個 action 與安全憑證 |
| supabase/functions/deno.json、.env.example、tsconfig.edge.json、supabase/config.toml | 依賴／Secrets 範例、型別檢查與單一 Function 設定 |
| supabase/migration-drafts/20261023093000_room_system.sql | 待審原子 RPC／限流表；不是已部署 Migration |
| src/services/rooms.test.ts、src/lib/validation.test.ts、src/pages/pages.test.tsx | 前端服務測試與既有測試回歸更新 |
| supabase/tests/room-system.node-test.mjs、browser-fixture.mjs、verify_room_system.sql | 17 項隔離後端、browser 測試橋接、部署後唯讀權限檢查 |
| scripts/check-room-browser.mjs | 可重跑 48 項 Chrome 驗收及 RWD 截圖 |
| scripts/check-database-schema.mjs、supabase/tests/schema_catalog.sql、database.node-test.mjs、package.json | 將來增量 Schema 比對、保留 Phase 4 baseline、測試命令 |
| README.md、AGENTS.md、docs/database-schema.md、room-system.md、room-api.md、本報告 | 專案概況、規則、生命週期、API、安全限制與部署提案 |

沒有新增付費依賴，沒有改動 package-lock 或既有已部署 SQL；`.gitignore` 與根 `.env.example` 已符合需求，沿用有效設定。

## 10. Manual Actions Required

### A. 審核範圍與設定

1. 審查本報告、草案 SQL、三個 RPC／service_role 權限及單一 Function，再明確批准雲端部署；目前不要執行。
2. 確認既有 Project 仍為 Free、linked ref 正確、Migration history 與 Phase 4 狀態一致；有漂移先停止，不 repair／覆蓋。
3. 確認允許的正式 origin 與本機 port。GitHub Pages origin 不含 `/guess-who/`；例如 `https://chiamaureen.github.io` 與需要的 localhost origin，不能使用 wildcard。
4. 安全產生並保存 32 random bytes／64 hex 的 `ROOM_SYSTEM_SIGNING_KEY`，以及 `ROOM_SYSTEM_ALLOWED_ORIGINS`；只能在 Dashboard Secrets 或 Repository 外、限制讀取權限的 env 檔設定，不貼對話、不放 VITE 或 CLI 明文參數。
5. Supabase 平台應注入 URL 與 API key maps；不要求使用者把 Secret／Service Role Key 放前端。不啟用 Auth Anonymous Sign-In、不新增 Realtime publication。
6. 另確認 Cloud smoke test 可寫入的環境／資料範圍。部署批准不自動等於允許測試資料異動；本次尚未取得此授權。

### B. 預計部署指令（僅提案，尚未執行）

先經批准將待審 SQL 移到 `supabase/migrations/20261023093000_room_system.sql`，保留 Phase 4 已部署檔原樣；重新跑本機測試，再依序：

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db push --dry-run --skip-vault
```

dry-run 必須只有預期的 Phase 5 增量，不能包含 fixtures／額外 Migration。確認後才執行以下遠端寫入：

```sh
npx --no-install supabase db push --skip-vault
npx --no-install supabase secrets set --project-ref fgvajdnzrnptdjurhjfo --env-file /ABSOLUTE/PRIVATE/PATH/room-system.env
npx --no-install supabase functions deploy room-system --project-ref fgvajdnzrnptdjurhjfo --use-api
```

`/ABSOLUTE/PRIVATE/PATH/room-system.env` 是 Repository 外的私密檔路徑示意，不能直接複製使用。`--use-api` 使用服務端 bundling，不需 Docker。config 已有 `verify_jwt=false`，所以必須保留程式中的 Publishable Key／自訂憑證／CORS／限流，不能把關閉平台 JWT 檢查當作授權完成。

不使用 `--include-seed` 重播不必要的 seed，不 deploy fixtures，不同步 Vault，不執行 `start`／`reset`／`pull`／`repair`／`--prune`。若 CLI 要求登入／密碼，由使用者在自己的安全互動終端機處理。

### C. 部署後驗收計畫（未執行）

先做唯讀驗證：

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db query --linked --file supabase/tests/verify_room_system.sql
npm run check:db
npm run check:supabase
```

- 確認十表 RLS／FORCE、原九表權限未放寬、三 RPC 僅 service_role、零私表 Realtime 暴露；比對新函式來源與 grants，不能只驗證 HTTP 200。
- 用合法／非法 Origin 驗證真實 gateway OPTIONS、CORS、自訂 headers、API key、錯誤遮蔽；確認 Deno import map 與平台 key maps 正常。

**取得測試寫入授權後**，使用全新且可識別的測試 Host／Room／Player：

1. 兩個獨立瀏覽器 context，以手動代碼及邀請進入；複選分類、名單、Host／Player 重新整理、跨場沿用 Host。
2. 模擬回應遺失／重試；檢查不重複房間或玩家；實際 PG17 確認交易回滾及受控多連線競爭。高併發／限流壓測優先在另外批准的隔離環境，避免耗盡既有 Project 全域 bucket。
3. 驗證缺少／無效／跨房間 Token、偽造 ID／role、Player 冒充 Host、其他玩家離開、匿名私表／RPC 讀寫全部被拒絕。
4. Host 關閉後刷新持續 finished、既有玩家看見已結束、新玩家不能加入；過期案例只在批准的測試資料或到期流程驗證，不修改原有房間日期。
5. 檢查回應／URL／log 無憑證或答案洩漏。測試記錄只列非秘密 ID／結果，不記 Token。
6. 僅由正常 API 關閉本次新建測試房間、離開自己的測試玩家；不盲目刪除 hosts、原資料、題目或跨場歷史。殘留測試紀錄清楚列出，額外清理另請批准。

所有必要 Cloud 驗證通過才可更新 Phase 5 為完成；任何未驗證項目維持 BLOCKED／NOT TESTED。

## 11. Remaining Issues

| 項目 | 狀態 | 下一步 |
| --- | --- | --- |
| Phase 5 SQL／Function 未部署 | BLOCKED | 使用者審查後另行批准；目前前端連雲端開房不能視為可用 |
| 遠端 Secrets／origin 尚未設定與驗證 | BLOCKED | 安全設定兩項自訂環境變數，實測真實 runtime |
| 真實 Cloud UI／RLS／RPC 整合 | BLOCKED | 部署後依上列計畫執行；寫入測試須另有範圍授權 |
| PG18 與 PG17 差異、多連線競爭 | NOT TESTED | 真實 PG17 或批准的隔離環境驗證，不把 PGlite 序列測試當成併發證據 |
| Deno 啟動／平台 key map | NOT TESTED | 本機 tsc 不是 Deno；部署後驗證初始化及完整 API |
| Lint | NOT TESTED | 專案未配置，本階段不新增工具；如需建立規則另開任務 |
| 跨裝置恢復／bearer 竊取風險 | 已記錄限制 | MVP 無帳號復原；保護網站與裝置，不能用公開 ID 恢復控制 |
| 名單即時更新／正式玩法 | 未實作，刻意保留 | Phase 7 Realtime；Phase 6 引擎，不能提前開發 |

## 12. Phase 6 Readiness

- **本機 Phase 5 驗收已完成；完整 Phase 5 尚未完成。** Cloud 部署、設定與整合驗收仍受授權阻擋。
- 現在不進入 Phase 6，也不將禁用的開始遊戲按鈕改成假成功。
- 日後 Phase 6 可重用穩定 Host ID、已驗證控制權、交易 RPC 與安全 DTO 邊界；須另外設計至少 15 位 DISTINCT 未使用人物檢查、逐題原子交易、同 Host 跨房間鎖、題目／歷史／進度一致提交與答案隔離。
- Realtime、正式題庫／圖片與正式前端部署分別留到後續階段；本報告的部署提案不是執行授權。
