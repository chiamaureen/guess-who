# Phase 4 — Database Design Report

日期：2026-10-23  
規格：Database Design Specification v1.2  
狀態：**Phase 4 Database Design 範圍已完成。經使用者明確確認，已部署至既有 Supabase Free Project，並通過真實 Cloud PostgreSQL 17.11 結構與權限驗證。未開始 Phase 5。**

## 1. Completed Tasks

- 建立九張應用資料表 Migration、PK／FK／UNIQUE／CHECK 與查詢索引。
- 支援真人、動畫等虛構角色、可空 Wikidata ID、人物多對多分類、圖片來源／作者／授權／署名與預設未審核狀態。
- 房間固定 15 題、題號範圍、每房間唯一人物與唯一題號、房間生命週期快照限制。
- C 模式以 `UNIQUE(host_id, celebrity_id)` 支援跨場、跨分類去重；不同主持人獨立。首次房間 FK 驗證 Host 與實際出題，房間清除不連帶刪歷史。
- 長期 Host 憑證、單房間 Host Token、Player Session 三種雜湊欄位分離；只設計資料儲存，未實作憑證發行或登入。
- 九表 ENABLE／FORCE RLS、明確撤銷既有權限；瀏覽器角色僅能讀取啟用分類，其他八表完全私有，不能修改任何應用資料表。
- 只授權後端 service_role 必要的四種資料操作；沒有公開答案 View／RPC，也不啟用任何應用資料表 Realtime。
- 建立可重複執行、不重新啟用已停用分類的七分類 seed；未匯入正式人物或圖片。
- 完成 ERD、匿名憑證保存／驗證／恢復設計、Host 層鎖與逐題交易方案、庫存不足及安全重置策略。
- 保留全部前端 Mock UI 與 Phase 3 Client，未建立房間 API、遊戲引擎、重置 API 或 Realtime。
- 完成部署前預檢與 dry-run，經確認部署一個 Migration 與七分類 seed；沒有部署 fixtures 或同步 Vault secrets。
- Cloud local／remote migration history 一致；實際切換瀏覽器 DB 角色與 Publishable Key REST GET 均驗證私表不可公開讀取。

## 2. Modified Files

| 檔案 | 用途 |
| --- | --- |
| `supabase/migrations/20261023060000_create_guess_who_schema.sql` | 九表結構、限制、索引、更新時間 trigger、GRANT／RLS、Realtime 防護 |
| `supabase/seed.sql` | 七個正式分類，依 slug 可重跑 |
| `supabase/tests/database.node-test.mjs` | 31 項隔離 SQL／角色權限測試 |
| `supabase/tests/fixtures.sql` | 僅供隔離測試的假人物／房間／Hash，不得部署 |
| `supabase/tests/preflight.sql` | 雲端版本、既有結構、角色與 publication 唯讀預檢 |
| `supabase/tests/verify_schema.sql` | 部署後 READ ONLY 角色存取與權限／結構檢查 |
| `docs/database-schema.md` | Schema、ERD、安全與後續交易設計、部署程序 |
| `docs/phase4-database-report.md` | 本驗收報告 |
| `package.json` / `package-lock.json` | 固定開發測試依賴 PGlite 0.5.11，加入 test:db 與既有 test 流程 |
| `AGENTS.md` | 更新 Phase 4 範圍、C 模式、安全與部署規範 |
| `README.md` | 保持目的與架構導向，簡述 C 模式、資料庫進度與文件入口 |

沿用 `supabase/config.toml` 的 PostgreSQL 17 與既有 seed 路徑，沒有覆寫設定；`.env.example`、`.gitignore` 原本正確，無需修改。未變更 `src/`。

## 3. Test Results

| Test | Result | Details |
| --- | --- | --- |
| 既有前端／設定單元測試 | PASS | Vitest，30／30 |
| Phase 3 Health Script 模擬測試 | PASS | Node test，21／21；與真實連線分開記錄 |
| Migration／Seed／SQL 測試 | PASS | PGlite，31／31；實際執行 SQL，不只是字串檢查 |
| `npm test` | PASS | 合計 82／82 |
| `npm run build` | PASS | TypeScript 與 Vite production build 成功 |
| `npm run dev` | PASS | Vite 7.3.7，`/guess-who/` 正常提供頁面 |
| 瀏覽器／RWD 回歸 | PASS | Chrome 155，27／27；320、375、390、768、1024、1440px 的首頁／建立／加入頁，表單／導覽／刷新／減少動態效果；無 JS／console 錯誤 |
| Phase 3 SDK 初始化 | PASS | 使用本機真實設定初始化共用 Client |
| 真實 Auth Health API | PASS | 實際 HTTP 200 與 GoTrue response 驗證；第一次沙箱 DNS 受限，授權網路後重測成功 |
| Cloud PostgreSQL 唯讀預檢 | PASS | 真實 PG 17.11；九張同名應用表均不存在；anon／authenticated 無 BYPASSRLS、service_role 有 BYPASSRLS；無自動 Realtime publication |
| Cloud migration history | PASS | 部署前無既有 migrations；部署後 local／remote 均為 `20261023060000` |
| 本機 RLS／GRANT 負向測試 | PASS | anon／authenticated 對八表 SELECT 被拒，對九表 INSERT／UPDATE／DELETE 被拒；分類僅讀啟用列；過寬 grants 下 RLS 仍拒絕；非 bypass owner 受 FORCE RLS 限制 |
| C 模式資料限制與回滾 | PASS | 同場及跨場去重、不同 Host 獨立、來源房間一致性、分類重疊 DISTINCT、庫存不足不 reset、衝突回滾題目與進度 |
| 歷史保存／重置資料策略 | PASS | 隔離 SQL 驗證房間清除保留 history、只刪指定 Host history 不影響完成題目與其他 Host；不代表重置 API／授權已完成 |
| Realtime／RPC 防洩漏限制 | PASS | 本機無答案 View／SECURITY DEFINER RPC，trigger 不可公開執行；自動全部表／public schema publication 會阻止 Migration |
| Migration dry-run | PASS | 僅預期 `20261023060000_create_guess_who_schema.sql` 與 `supabase/seed.sql`，不包含 fixtures／額外角色 |
| 雲端 Migration 部署 | PASS | 使用者明確確認後執行 `db push --include-seed --skip-vault`，Migration 與 seed 成功 |
| Cloud PG17 結構／權限驗證 | PASS | `verify_schema.sql` 實際 READ ONLY 執行：九表 ENABLE／FORCE RLS、七分類、零權限違規、限制／索引有效、只有分類 policy、零 Realtime 暴露 |
| Cloud DB 角色實際 SELECT | PASS | anon／authenticated 均可讀啟用分類；八張私表實際 SELECT 被權限拒絕；非只看 SDK 初始化 |
| Cloud Publishable Key REST GET | PASS | 分類 HTTP 200 且七個正確 slug；其餘八表 HTTP 401 + `42501`，沒有把 404 視為通過 |
| 多連線抽題／重置競爭 | NOT TESTED | Phase 6 引擎尚未實作；本機唯一限制與回滾測試不能替代此驗證 |
| 圖片／DTO／Realtime 答案隔離端到端 | NOT TESTED | 尚無正式素材、玩家 DTO 或 Realtime；Phase 7／8／10 驗證 |
| Lint | NOT CONFIGURED | Repository 沒有 lint script，未新增不相關工具 |
| Git Security Review | PASS | 未追蹤 .env.local、CLI 暫存；示例僅 placeholder；掃描工作檔、diff 與既有 Git 歷史無金鑰／Token／密碼洩漏；`git diff --check` 通過 |

**版本限制：** 本機 PGlite 0.5.11 為 PostgreSQL **18.6**，Cloud 是 **17.11**。本次已另外在 PG17 完成真實部署及唯讀結構／角色權限檢查；31 項 fixture 資料異動測試仍只在本機 PG18 執行，沒有在 Cloud 匯入假資料或進行 DML／多連線競爭測試。

瀏覽器截圖與結果暫存於 `/tmp/guess-who-phase4-qa/`，不加入 Repository。測試使用 Node.js 22.23.4。

## 4. Deployment Record / Manual Actions

1. 使用者明確回覆「同意部署至上述既有 Free Project」，目標 `fgvajdnzrnptdjurhjfo`，未建立新專案或付費資源。
2. 重新檢查 linked Project、雲端 migration history、既有應用表、角色及 Realtime publication，均符合首次部署前提。
3. `npx --no-install supabase db push --dry-run --include-seed --skip-vault`：只列出預期一個 Migration 與分類 seed。
4. `npx --no-install supabase db push --include-seed --skip-vault`：成功建立 Schema 並寫入七分類，未要求另外傳送密碼。
5. `npx --no-install supabase migration list --linked`：local／remote 均 `20261023060000`。
6. `npx --no-install supabase db query --linked --file supabase/tests/verify_schema.sql`：Cloud PG17.11 結構、權限與實際角色 SELECT 驗證成功。
7. 真實 Publishable Key 對九表做唯讀 REST GET，分類可讀、八表拒絕，沒有回顯金鑰或下載私有資料列。

部署檔案 SHA-256：`8f5e0ed648794c09ced3b9d221b32ce070bf3b73f936d2f4bbe5b2834bdca07c`。此為 Migration 檔案完整性摘要，不是任何憑證。

目前沒有阻礙 Phase 4 結案的人工操作。請使用者檢查 Git diff 與本報告；若要進入 Phase 5，需另行指定任務。已部署 Migration 不可修改，後續修正必須新增增量 Migration；未自動 Commit／Push。

## 5. Security Review

- 瀏覽器不能直接查詢人物、房間題目、Host／Player Hash 或主持人歷史；Publishable Key 不授予主持人權限。
- 不使用 `auth.uid()` 識別匿名主持人。高權限後端仍須驗證長期 Host 憑證、房間控制 Token 與 Host 關聯，RLS 不能替代 BYPASSRLS 後端的授權。
- DB 只定義 Hash 欄位；測試的重複字元 Hash 是假資料，不是真正安全隨機憑證或正式主持人邏輯。
- `.env.local` 未追蹤且被 `.gitignore` 排除；`.env.example` 僅有示意 URL／Publishable Key；CLI `.temp` 被忽略；未輸出私密憑證。
- Git 工作檔／diff 與歷史掃描沒有發現 Secret Key、Service Role JWT、CLI Access Token、含密碼連線字串或實際 Publishable Key 硬編碼。
- 沒有執行 `supabase start`、reset、pull、破壞性資料清除或 migration repair；沒有建立付費資源、Commit 或 Push。
- Seed 不含敏感資料；tests/fixtures 僅載入隔離記憶體資料庫。沒有為測試而把 Debug UI 或 service_role Client 放進 React。

## 6. Remaining Issues

- **Phase 4 無已知阻斷問題：** 原部署及部署後驗證兩項 BLOCKED 已解除。
- **驗證界線：** Cloud 已驗證 PG17 DDL、七分類、RLS／GRANT、索引／限制與 Realtime 隔離；沒有對雲端做 fixture DML 或多連線競爭測試，不把本機測試等同完整遊戲驗收。
- **UI 刻意保留 Mock：** 前端仍有 Phase 2 的六個 Mock 分類；資料庫的七個正式分類已獨立 seed。尚未串接，這不是宣稱正式分類 API 已完成，留待 Phase 5 整合。
- **資料限制不等於遊戲引擎：** Snapshot CHECK、UNIQUE 與 FK 不會自動發行身分、確保每題寫歷史、驗證主持人重置、控制合法流程或完成跨連線鎖定。
- **素材安全尚未驗證：** 真實照片 URL、檔名、Metadata 與署名可能暴露答案，需要 Phase 8 合法且不洩漏答案的素材管線。

## 7. Next Phase Readiness

**Phase 4 規定的資料庫設計、部署與權限驗收已完成，可以準備 Phase 5，但尚未授權或開始實作。** 下列功能與端到端測試屬於後續階段，不代表目前已有可玩的多人雲端遊戲。

- Phase 5：安全匿名 Host 身分及持久化恢復、獨立房間 Token、Player Session、房間 API、嚴格輸入／授權與 Host／Player DTO。
- Phase 6：同 Host 跨房間鎖、至少 15 個不同可用人物檢查、逐題交易與冪等、題庫不足、二次確認與無 playing 房間才可重置；執行真實多連線競爭測試。
- Phase 7：只傳角色可見資訊的 Realtime 設計，不直接公開含答案資料列。
- Phase 8：Wikidata／Commons 收錄、動畫與歷史人物標準、授權與署名審核、圖片防答案洩漏。
- Phase 9／10：正式部署與多人完整測試。
