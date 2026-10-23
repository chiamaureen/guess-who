# Phase 6 — Single Room Game Engine Report

日期：2026-10-23（Asia/Taipei）

**後續狀態更新：** 使用者於部署衝刺另行明確批准 Phase 6 Migration 與 game-engine，已完成 Cloud 部署／唯讀權限與 CORS 驗證；詳見 [MVP Deployment Sprint](mvp-deployment-sprint.md)。以下保留原本本機驗收時的草案路徑與未授權狀態，屬歷史收據。正式 SQL 現位於 migrations、禁止再改寫；完整 Cloud 15 題仍因題庫為 0 而 BLOCKED。

**本機開發驗收：READY。雲端部署／完整正式遊戲驗收：NOT READY／BLOCKED。**

核心引擎、兩角色 UI、答案隔離與 C 模式已在本機隔離環境驗證；尚未取得 Phase 6 雲端部署或測試資料寫入授權，沒有查詢或補齊正式題庫，不能宣稱雲端 15 題整合成功。本次不開始 Phase 7／8，也不重做 Phase 5。

## 1. Implemented Features

- PostgreSQL 保存 waiting→playing→finished、當前題號、題目圖片關聯及 revealed_at；初次 Start 正式產生第 1 題。
- 固定 15 題；開場檢查至少一個啟用分類、15 位 DISTINCT 已審核且具已審核私有圖片的人物，排除同 Host 歷史與本房已出題目。不足時保持 waiting 並提示增加分類／手動重置。
- 每題先隨機選仍有候選的分類，再選人物；題目、歷史與進度同一交易，保留既有 UNIQUE／FK 防線。
- 同房操作用 Host→Room 列鎖；以原 questionId 防 Next 網路重送／並行跳題。Start、同題 Reveal／Finish 可安全重試；舊 Reveal／Finish 不能誤操作新題。
- 先揭曉才能 Next；第 15 題後不產生第 16 題。正常或提前結束皆保留使用歷史；未揭曉不因結束自動公開答案。
- Host 取得答案；Player 揭曉前只有不透明題 UUID、題號與揭曉狀態，沒有答案、人物識別、原始圖片 URL、來源或署名。SQL 與 Edge 雙層過濾，不靠 CSS 隱藏。
- 安全圖片入口只提供本房當前題目，無任意外部 URL fetch。私有 PNG 有格式／CRC／Metadata 限制，固定中性檔名；前端用帶憑證 POST 取得 Blob。
- C 模式跨場歷史獨立於房間結束；手動 reset 需要長期 Host、二次確認、確認前 historyRevision 且無 playing 房間，只刪自己的 history，保留題目及其他 Host。
- 延伸既有房間頁：Host 開始／揭曉／下一題／確認結束／歷史重置；Player 照片／進度／等待與揭曉答案；手動刷新與載圖重試。兩角色重新整理會向伺服器恢復狀態，不重抽題。
- 沒有 Realtime、輪詢、WebSocket、計分、排行榜、搶答、管理後台或多房協調系統，也沒有把 Database 限成只能保存一間房。

## 2. Modified Files

| 檔案 | 用途 |
| --- | --- |
| supabase/migration-drafts/20261023120000_game_engine.sql | 待審增量：安全圖片、題目圖片 FK、PNG helper、角色 DTO 與交易引擎 |
| supabase/functions/game-engine/handler.ts | 七操作、憑證／來源／限流、雙層答案過濾、二進位圖片 |
| supabase/functions/game-engine/index.ts | 共用 Supabase 後端 Client、RPC adapter、Deno 入口 |
| supabase/functions/room-system/handler.ts | 只 export 既有 bounded readBody 給新 Function 重用；六操作邏輯不變 |
| supabase/config.toml | 新 game-engine verify_jwt=false、自訂授權與 import map |
| src/components/GamePanel.tsx | 遊戲照片／答案／控制／手動更新／確認操作與 Blob 釋放 |
| src/pages/LobbyPage.tsx | 接入遊戲區域與伺服器 Room 狀態，保留原等待室／Session |
| src/pages/CreateRoomPage.tsx | 移除已過時的下一階段才有引擎提示；不變更建立流程 |
| src/types/game-engine.ts、src/lib/game-api.ts | GameState 契約、解析、私有圖片請求 |
| src/services/rooms.ts、src/lib/room-api.ts | 沿用原憑證／Web Locks，新增遊戲服務與錯誤訊息；不保存權威遊戲狀態 |
| src/styles/index.css | 簡潔照片／答案面板與自適應尺寸，保留網站設計 |
| src/services/game-engine.test.ts | 8 項前端 Session／API／DTO 回歸 |
| supabase/tests/game-fixture.mjs、game-engine.node-test.mjs | 隔離合成題庫與 26 項實際 Fetch／SQL 測試 |
| supabase/tests/game-concurrency.mjs | PG17／20 真實連線、6 組併發與回滾驗證 |
| supabase/tests/verify_game_engine.sql | READ ONLY catalog／RLS／GRANT／RPC／Realtime 驗證；尚未在 Cloud 執行 |
| supabase/tests/browser-fixture.mjs | 本機 fixture 接入新引擎與可選合成題庫，不讀雲端憑證 |
| scripts/check-game-browser.mjs、check-room-browser.mjs | 23 項遊戲與原 48 項房間 Chrome 驗收；保留真正限流窗口 |
| package.json | test:game 納入預設 npm test；無新增 production dependency |
| README.md、AGENTS.md、docs/game-engine.md | 進度、架構、API 與開發安全邊界 |
| docs/database-schema.md、room-system.md、phase6-game-engine-preparation.md | 區分歷史已部署設計與本機新引擎，避免冒稱已上雲 |

## 3. API Design

選擇獨立 **game-engine**，Phase 5 room-system 六操作保持不變。前端沿用同一 Room Session／長期 Host Credential，不建立第二套匿名身分。

| Action | 參數 | 權限／結果 |
| --- | --- | --- |
| start-game | roomCode | Host＋Room Token；GameState／第 1 題 |
| get-game-state | roomCode | Host 或本房 Player；依角色／揭曉狀態過濾 |
| get-question-image | roomCode、questionId | 同房角色；僅當前題目 PNG bytes，無原始 URL |
| reveal-answer | roomCode、questionId | Host；揭曉同題冪等 |
| next-question | roomCode、questionId | Host；原題 UUID 防重送多前進 |
| finish-game | roomCode、questionId | Host；正常或提前結束，不清歷史 |
| reset-question-history | confirm:true、historyRevision | 長期 Host；只重置自己的歷史 |

Header、錯誤碼、DTO、圖片限制與完整授權流程見 [Game Engine](game-engine.md)。不信任前端 Host／Player ID、role 或公開 Publishable Key 作房間控制權。

## 4. Database Migration

**待審檔：`20261023120000_game_engine.sql`，目前只在 migration-drafts，不會被 db push 自動套用。** 依 AGENTS 規則，須明確批准後才加入正式 migrations；本機測試明確套用此草案，不是遺漏測試。

- 一張新私表 game_image_assets，套用後應用表共 11 張；ENABLE／FORCE RLS、無 browser policy／GRANT。
- service_role 僅 SELECT／INSERT／DELETE asset，不給 UPDATE／TRUNCATE／REFERENCES／TRIGGER；已引用素材不可刪除，圖片不會被一般後端原地替換。
- room_questions 新增可空 game_image_id（相容舊資料），新引擎必填；與 celebrity_id 的複合 FK 綁定正確素材。所有原去重 UNIQUE／歷史 FK 不變。
- 三個新函式皆 INVOKER、空 search_path、service_role-only EXECUTE：game_engine_action(text,jsonb)、game_engine_state(uuid,text,uuid)、game_engine_png_valid(bytea)。前者是操作 RPC，後兩者為私有 DTO／CHECK helper。
- 沒有公開答案 View、browser SELECT、Realtime publication、SECURITY DEFINER 或破壞性資料清理。
- Phase 4／5 已部署 Migration SHA-256 均以測試固定比對，未修改：
  - Phase 4：8f5e0ed648794c09ced3b9d221b32ce070bf3b73f936d2f4bbe5b2834bdca07c。
  - Phase 5：d4917bd4d103b537a575e87d78e100dda4bf71b0b3865525b3b26954f76ad10f。

## 5. Actual Test Results

本機 Node 22.23.4；PGlite PostgreSQL 18.6、原生 PostgreSQL 17.10、Chrome 155.0.8059.85。先前 Cloud 為 17.11，本次沒有執行任何 Cloud 驗收，不能將本機版本當成相同平台。

| Test | Result | Actual details |
| --- | --- | --- |
| npm test | PASS | 52 Vitest＋21 Health unit＋37 Phase 4＋27 Phase 5＋26 Game＝163；0 fail |
| 原 Phase 5 回歸 | PASS | 原 129 項涵蓋於 163 項；房間／Session／H-01 未被重做或破壞 |
| Game Engine Fetch／SQL | PASS | 26／26，實際本機 SQL、角色權限與 Fetch Response，不是單純 Mock UI |
| Native same-room concurrency | PASS | PG17.10、20 不同 backend connections、6／6；私有 Unix socket、TCP 關閉 |
| Phase 6 Chrome UI | PASS | 23／23；Host／Player 獨立 context、揭曉前後刷新、Next 回應遺失重試、reset、6 個寬度 |
| 原房間 Chrome UI | PASS | 48／48；建立／加入／邀請／分類／Session／RWD／關閉／撤銷／錯誤狀態 |
| H-01 reproduction | PASS | 20 次 429，beforeRows=2、afterRows=2，新增 0 列／0 業務操作 |
| Edge TypeScript | PASS | npm run check:edge，strict noEmit |
| npm run build | PASS | tsc＋Vite production build 成功 |
| npm run dev | PASS | 127.0.0.1:5177／guess-who/ 成功啟動，供 Chrome 實際驗證 |
| Lint | NOT CONFIGURED | 現有 package.json 無 lint，未新增無關工具、不冒稱 PASS |
| Cloud migration／Function | BLOCKED | 本階段未授權，完全未執行 |
| Cloud 完整 15 題多人整合 | BLOCKED | 新引擎未部署、未取得合格正式人物／安全素材與測試寫入授權 |

最終輸出：`/tmp/guess-who-phase6-tests.log`；Chrome 結果與截圖：`/tmp/guess-who-phase6-browser/`、`/tmp/guess-who-phase5-qa/`；最終 native PG 收據：`/tmp/gw-game-pg-9rjuFH`。這些不是正式雲端資料，沒有 Token／憑證輸出。

### 必要案例對照

| 規格項目 | Result | 證據 |
| --- | --- | --- |
| 1–5：Host Start／Player 拒絕／不足 15／跨分類 DISTINCT／第 1 題 | PASS | 14 人雙分類仍拒絕，15 人有安全圖可開始；0 半成品題目 |
| 6–8：未揭曉隔離、揭曉與 Player 讀取 | PASS | 未揭曉 question 僅 id／number／revealed，揭曉後才有 answer／attribution；Edge 二次白名單 |
| 9–11：先揭曉、Next 一題、重送不跳題 | PASS | SQL／並行／Chrome 遺失 HTTP 回應後按同一 Next，仍是第 2 題 |
| 12–13：15 位完全不重複、拒絕第 16 題 | PASS | 同場 count distinct 人物／題號各 15；LAST_QUESTION |
| 14–15：兩角色刷新 | PASS | 揭曉前後皆恢復原題／圖片／揭曉狀態；Host 保留控制，Player 無 Host 控制 |
| 16–18：提前結束、下一場排除、不同 Host 獨立 | PASS | 提前結束保留歷史；30 人連續兩場累積 30 位、不交疊；其他 Host 可獨立開始 |
| 19：只重置自己的歷史 | PASS | 長期 Host、confirm／revision、playing（含過期）拒絕、他人 ID 注入拒絕、題目保留 |
| 20：敏感資訊與答案不洩漏 | PASS | 無 Token／Hash／原始 URL；PNG 拒絕有效 CRC 的 tEXt、SVG、錯 CRC、尾隨資料與超限圖；私表／RPC 42501 |

### 併發與回滾

原生 PG 實際 20 連線：並行 Start 只有一題；20 個未揭曉 Next 全拒；並行 Reveal＋20 重送 Next 只有一個新人物；題目已插入但歷史 trigger 故意失敗時整筆回滾；20 Finish 冪等且歷史保留；reset 對 Start 的競態只有合法序列結果，沒有活動歷史被抹掉。

PGlite 另驗證 first Start 故意失敗，Room 仍 waiting／current=0／started_at=NULL，題目與 history 都 0；中途庫存停用或交易強制回滾不消耗人物。不把 PGlite 的序列執行當成真正多連線證據。

## 6. Security Review

- Host Credential／Room Token／Player Session 完全沿用 Phase 5；新 API 再向 PostgreSQL 驗證所有權及房間 Token，不靠前端狀態判權。
- 直接 anon／authenticated 呼叫新 RPC、讀 asset／人物／題目／history 被拒；service-only RPC 自身也拒絕錯房 Token、Player 寫入與偽造 role。
- 新 Function verify_jwt=false 與匿名架構相容，但 apikey／CORS／自訂憑證／RLS／H-01 限流仍必須通過。
- 固定 gate 與可信 runtime source metadata，不使用 X-Forwarded-For；state／image 與 get-room-state 共用 cap，寫入與 close-room 共用 cap，沒有任意 Credential 建桶。
- 只有圖片本體在未揭曉時可見；原始姓名／檔名／EXIF／來源不透過 API 或公開 DB 送給 Player，沒有新 Realtime 管道。
- .env.local 持續忽略、未追蹤；.env.example 僅公開示意值，沒有新增 VITE 私密設定或讀取／輪替現有 Signing Secret。
- 已執行 git diff --check、環境檔追蹤檢查與工作檔／diff／歷史敏感模式掃描；最終安全檢查見本報告末節。

**未發現剩餘 Critical／High 的本機阻斷問題。** 這不是正式素材、Cloud runtime、瀏覽器 XSS 或全面滲透測試的保證。localStorage bearer／共用裝置、保守共用來源 cap、全域額度被耗盡等 Phase 5 已知限制仍在。

## 7. Remaining Work / Deployment

1. 需使用者審核本機修改，明確批准 Phase 6 草案納入 migrations 與後續 Cloud 範圍；目前沒有待自動套用的正式 Phase 6 Migration。
2. 批准後確認 linked ref fgvajdnzrnptdjurhjfo、Migration history、dry-run 唯一預期增量；再規劃 db push。不得改 Phase 4／5、reset、repair 或清除舊資料。
3. READ ONLY verify_game_engine.sql 及既有 Schema／GRANT／RLS 差異驗證需在 Cloud 執行；新表預期十一表、三個新 helper／RPC，維持 browser 私有。
4. 待部署 Function 只有 **game-engine**；沿用 ROOM_SYSTEM_SIGNING_KEY／ROOM_SYSTEM_ALLOWED_ORIGINS，沒有必須新設的 Secret，不需重新部署 room-system。
5. 正式題庫／合格 private PNG 尚未建立。Phase 8 才做正式人物與授權匯入；本機幾何臉 fixtures 不得偷偷上雲。若雲端不足 15 位，Start 應明確拒絕，完整 15 題 Cloud 測試維持 BLOCKED。
6. 後續 Cloud 測試寫入須另批准，包含可辨識新測試 Host／Room／Player、兩角色刷新、15 題、去重／reset 與公開 RPC 拒絕；原 Phase 5 Cloud UI script 不是新引擎驗收工具，不應直接重跑冒充成功。
7. 過期 playing 仍保留歷史並阻擋 reset；後端允許原有效 Host 以已知當前 questionId Finish 收尾。目前既有 Lobby 過期會先顯示錯誤，未提供專門的過期遊戲收尾 UI；需在後續部署審核評估此操作 UX，不能用自動刪歷史繞過。
8. 原始素材的實際可解碼、圖像內容／水印與署名時機仍須人工審核。PNG validator 是防 Metadata 與格式界線，不是通用解碼／重新編碼 pipeline；Phase 8 未實作。私有圖 bytea 適用目前小題庫，正式容量需另檢查。

僅供**取得批准後**規劃，以下未執行：

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db push --dry-run --linked --skip-vault
npx --no-install supabase db push --linked --skip-vault
npx --no-install supabase db query --linked --file supabase/tests/verify_game_engine.sql
npx --no-install supabase functions deploy game-engine --project-ref fgvajdnzrnptdjurhjfo --use-api
```

執行前必須先批准並納入唯一草案、核對連結與預期差異；沒有隱含授權。缺正式題庫時不可用測試 fixtures 宣稱 Cloud PASS。

## 8. Final Decision

- **Phase 6 本機：READY**，最小單房可玩流程與要求的安全／C 模式／併發案例均有本機證據。
- **Phase 6 Cloud／完整正式驗收：NOT READY**，等待明確部署授權、合格題庫／安全圖片與實際 Cloud 多人 15 題驗證。
- 本次沒有遠端 db push、Function deploy、Secrets 設定、遠端業務修改、Commit／Push、Worktree 或 Subagents；不開始 Phase 7 Realtime／Phase 8 正式題庫。

### Final Git Security Check

- PASS：92 個工作檔路徑、156 個歷史 blobs，以及 git diff／cached diff 敏感模式掃描，findings=0；沒有敏感環境檔被追蹤。
- PASS：git diff --check 無問題，git ls-files -- .env.local 無結果，git check-ignore -v .env.local 正確命中 `.env.*`。
- PASS：兩個已部署 SQL 的 SHA-256 與固定摘要一致；cached diff 為空，沒有 Commit／Push。
- .env.example 只含示意值，未新增私密 VITE 變數；本次沒有顯示 Secret、Access Token、Database Password 或真實 Session。
