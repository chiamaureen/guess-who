# Phase 7 — Supabase Realtime Report

日期：2026-10-23（Asia/Taipei）。**本機驗收：READY。Cloud Realtime 驗收：NOT TESTED，尚未部署。**

**2026-10-24 發布順序調整：Phase 7 DEFERRED。** 全部程式碼、草案與測試保留；MVP 以 `VITE_ENABLE_REALTIME=false` 使用低頻 Polling，不依賴新 JWT／Migration／Functions。以下為原本的 Phase 7 驗收紀錄，不代表已啟用或部署。當前關卡見 [Phase 9 Report](phase9-mvp-release-report.md)。

## 1. 架構選擇

採 **Private Broadcast**，不採 Postgres Changes。PostgreSQL 保持唯一權威，Realtime 僅送失效通知，Client 再以原房間憑證呼叫 Edge API。沒有輪詢、搶答、計分、排行榜或多房調度。

Postgres Changes 需要資料可見性與 SELECT 授權，且容易誤將 room_questions／rooms 的敏感欄位帶入事件；本次不開放這些表，也不新增任何應用表到 Realtime publication。Broadcast 使用固定安全內容，而不是會攜帶 NEW／OLD row 的 broadcast_changes。

依據 [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast) 與 [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)：private channel 以 realtime.messages RLS 授權，且同名 public／private channel 不互通。實作永遠使用 private=true；不依賴房碼保密或全域關閉 public channels。

### 目前平台唯讀檢查

- 本機 supabase/config.toml：realtime.enabled=true，未修改。
- 對既有 Project fgvajdnzrnptdjurhjfo 只讀取 catalog：realtime.messages 已啟用 RLS、FORCE RLS=false、現有 policies=0。
- anon／authenticated／service_role 原本就有 realtime schema USAGE 與 messages SELECT／INSERT；因此草案不需要額外擴張平台表 GRANT，只新增嚴格 policies。
- Cloud 的 public 應用表 publication 清單仍空。沒有改動 Cloud 設定、資料庫結構、Secret 或 Function。
- 沒有查詢或修改 Dashboard「Allow public access」開關；本方案不依賴該開關。Cloud 對新 signing key 的信任與實際 JWT 加入仍待批准後驗證。

## 2. 訂閱與通知

```text
取得 Room Session → Edge 最新快照
  → room-system/get-realtime-ticket（原憑證＋H-01）
  → private Broadcast 訂閱
  → SUBSCRIBED 後再次取得最新快照

PostgreSQL 交易提交
  → trigger / realtime.send
  → private topic gw-room:<room UUID>
  → event invalidate，payload 僅 {"changed":true}
  → Client 合併通知後，重新讀取 Edge 快照
```

- rooms.status／current_question、room_players INSERT／DELETE、room_questions INSERT／revealed_at UPDATE 才發通知；通知跟資料同交易，回滾不會留下可發送事件。
- Broadcast 不含答案、題號、人物／玩家資料、憑證、Hash、來源或圖片。Topic 只有已授權房間的 UUID，不使用 Host Token／房碼當 Channel 密碼。
- game-engine 的 get-game-state 與控制回應增加 safeLobby 白名單 categories／players，同一次原 RPC 取得 Game／Lobby 快照，避免兩次查詢不一致與額外來源限流成本。舊 parseGameState 仍相容。
- 收到通知只讀資料，不呼叫 Start／Next／Reveal。重複通知 debounce，單一 in-flight read 配 trailing read，無任意 Broadcast 修改狀態入口。

## 3. Host／Player 授權與 JWT

- 原 Host Credential＋Room Token／Player Session 仍是全部遊戲 API 的唯一授權依據，沒有把它們當成 Supabase Auth JWT。
- 新 get-realtime-ticket 只接受 roomCode；既有 Origin／apikey／格式／H-01 gate 通過後，RPC 再驗證同一身分與房間，才建立 grant。拒絕 caller 指定 Host ID、Player ID、role、scope 或過期時間。
- 新 grant RPC 為 INVOKER、空 search_path、service_role-only。grant 以 room／viewer_role／viewer_id 唯一，重複取得不新增列；Token Hash 快照留在私表，不放入 JWT 或通知。
- 以 **ES256／P-256、Supabase 信任的 kid** 簽發最長五分鐘 JWT。固定 role=anon、aud=authenticated、sub=opaque grant ID、rt_room、iss、iat、exp；不包含 Host／Player Token、Hash 或正確姓名，不建立 Supabase Auth user。
- 授權 helper 為 SECURITY DEFINER、空 search_path，唯一輸出 boolean；它核對 JWT grant、實際 row topic、期限、Room 與當前 Host／Player 身分。anon／authenticated 不能讀 grants 或呼叫 grant RPC。
- realtime.messages 有一個限定 SELECT policy，加 restrictive SELECT／INSERT guards；即使存在其他寬鬆 policy，仍不能跨房讀取或以 Client 偽造 private 通知。其他 public 遊戲表權限完全不變。
- JWT 只存在專用 Realtime Client 記憶體，不進 localStorage、共用分類 Client、URL、console 或 HAR。WebSocket join／renew 必然攜帶短 JWT，這是授權 frame，不是 Broadcast 業務 payload。

### 過期／撤銷

- Client 約四分鐘重新取得授權，替換連線；重新訂閱成功後再次查詢，填補交接間隙。
- Player 離開或 Host 撤銷後，新 ticket／新加入驗證立即拒絕；已連線的 Realtime 授權可能被平台快取，**最長保留到 JWT 五分鐘到期**，不是宣稱立即踢除。
- 在該期間最多收到不敏感的 changed 訊號；所有資料／圖片 API 仍逐次檢查原憑證，不能因此取得答案或保持主持人權限。
- 過期 grants 於成功授權後清理，單次至多 100 列、SKIP LOCKED；沒有未驗證 Credential 建桶，無流量時只留下有限舊列，不會持續成長。Room 刪除時 grant FK cascade 不涉及遊戲歷史。

## 4. 連線管理

- 初次讀取後才訂閱；SUBSCRIBED 後必定再讀取。SDK 重連／主動重連後同樣再同步。
- offline／Socket 中斷會指數退避；online、頁面回前景重新驗證／同步；JWT 自動續期。
- read 單工、通知合併與 mutation epoch 防止延遲舊回應覆蓋新題／揭曉；圖片 effect 依 question ID 取消舊回應、釋放 Blob。
- 卸載／離房取消 channel、socket、timer、listener；React StrictMode 不留下多重有效訂閱。
- 初始 Lobby 驗證、狀態讀取與圖片遇 HTTP 429 時按 Retry-After 自動重試；不要求使用者刷新網頁。原 H-01 cap、可信代理來源與固定 scope 不變。
- 已知限制：同來源多位使用者或極快操作可能超過原本每分鐘 30 次 read cap，畫面會延遲至 Retry-After，而不是保證所有情況都次秒同步。本次快速 15 題測試確實觸發 14 次，已驗證會自動恢復；沒有為了測試放寬安全政策。
- 缺 Phase 7 後端／JWT 設定時明確顯示尚未部署，保留 Phase 6 手動備援，不冒稱即時連線成功。正常部署時玩家不需按手動刷新。

## 5. 實際測試結果

| 檢查 | 實際結果 |
| --- | --- |
| npm test | **PASS，207 項**：Vitest 68、Health 21、Phase 4 37、Room 27、Game 26、Realtime 18、題庫／圖片 10 |
| TypeScript／Edge TypeScript | **PASS**，分別由 build／check:edge 執行 |
| npm run build | **PASS**；沒有新增 production dependency，ws 僅 dev 本機測試 |
| 新 Realtime 瀏覽器 | **PASS，22 組**，Host＋兩 Player，完整 15 題自動同步 |
| 玩家加入／離開／重新加入 | **PASS**，Host 與其他 Player 名單自動更新，離房取消訂閱 |
| Start／Reveal／Next／Finish | **PASS**，兩 Player 不按手動更新，自動取得新題、圖片、答案與結束畫面 |
| 刷新恢復 | **PASS**，Host／Player 重新授權、相同 Session／題目、三個有效訂閱無重複 |
| 短暫斷線 | **PASS**，第 3 題中斷一位 Player，錯過 Reveal 後恢復連線，自動補取答案狀態 |
| 重複通知 | **PASS**，20 次 changed 只引發資料重取，不新增題目或跳題 |
| 答案隔離 | **PASS**，50 則資料庫通知均是常數 private payload；Player 揭曉前只有 id／number／revealed |
| 未授權／偽造／跨房 | **PASS**，無 JWT／篡改簽章拒絕；實際 RLS 讀取跨房被擋，private INSERT 被擋 |
| H-01 舊重現腳本 | **PASS**，20 次拒絕皆 429，新增桶=0、business actions=0 |
| Realtime ticket H-01 | **PASS**，20 個不同假 Session 在全域拒絕後，新增桶／grant 均 0 |
| H-01 自動恢復 | **PASS**，三人實測觸發 14 次既有 429，均自動恢復完成，沒有改 cap 或清 rate table |
| 既有房間／遊戲 Browser 回歸 | **PASS，48＋23＝71 項**，含手機／桌面 RWD、手動 fallback、原題重試與 Session |
| 真正 PostgreSQL 併發 | **PASS，8 組、20 連線**，含 20 次授權共用一 grant、新通知回滾，以及原六組引擎回歸 |
| READ ONLY 草案 verifier | **PASS**，verify_room_realtime.sql 在本機實際執行 |
| Cloud Realtime／Deno runtime／平台 JWT 信任 | **NOT TESTED**，不能以本機模型冒充 Cloud 驗收 |

PGlite PostgreSQL 18.6；另用本機 PostgreSQL 17.10／私有 Unix socket 跑真實併發，最後自動停機。既有 Cloud 17.11 來自前階段收據，本次沒有把它當成本機版本。

瀏覽器使用真實 React、SDK、Fetch handlers 與 PGlite 草案，以及本機 Phoenix／WebSocket 協定橋接。realtime-platform.sql 是測試用平台模型，刻意放寬既有 policies 以測 restrictive guards，**不是完整 Supabase Realtime 伺服器**，不可部署到 Cloud。

### 開發期間修正

- SDK 使用 top-level accessToken callback 保持自訂 JWT，避免預設 Auth callback 把它換回 Publishable Key。
- 首次恢復房間原本遇 429 會停在錯誤頁；已改自動尊重 Retry-After，於三人實測完成驗證。
- 初版測試誤用 Playwright connectToServer(url)：此 API 不支援改 URL，曾嘗試原始 Cloud WebSocket 端點，沒有將 HTTP 業務請求、真實 Host／Player 憑證或私密 Key 送到 Cloud，也未做任何 Migration／部署。已移除該用法，最終成功測試全面攔截 HTTP／Socket、以手動本機 bridge 傳輸，Cloud requests=0。未將那些失敗嘗試列成 Cloud PASS。

## 6. 修改檔案

| 檔案 | 用途 |
| --- | --- |
| supabase/migration-drafts/20261023180000_room_realtime.sql | 唯一新草案：grant、RPC／helper、三個常數通知 trigger、private policies |
| supabase/functions/room-system/realtime.ts | 嚴格 ES256 JWT 簽發與期限／grant 驗證 |
| supabase/functions/room-system/handler.ts、index.ts | 新 ticket 操作、沿用 H-01／憑證、讀新後端 Secret |
| supabase/functions/game-engine/handler.ts | 沿用答案過濾，增加 safeLobby 的一致快照 |
| src/lib/room-sync.ts、realtime-transport.ts | 合併／排序／復原、獨立 SDK Client 與私有訂閱 |
| src/hooks/useRoomSync.ts、src/types/realtime.ts | React 每房訂閱與資料契約 |
| src/services/rooms.ts、src/lib/room-api.ts | 原憑證換 ticket、單次快照、Retry-After |
| src/pages/LobbyPage.tsx、src/components/GamePanel.tsx | 接入自動更新，429／照片／初始狀態自動恢復 |
| src/lib/*realtime*.test.ts、room-sync.test.ts、src/services/game-engine.test.ts | 授權、合併、續期、清理、舊回應與快照測試 |
| supabase/tests/realtime*.mjs、realtime-platform.sql、verify_room_realtime.sql | 真實 SQL、平台模型、WS 及權限／交易驗證 |
| scripts/check-realtime-browser.mjs | 純本機三人 15 題／斷線自動同步驗收 |
| scripts/check-game-browser.mjs、check-room-browser.mjs | 保留既有回歸，更新文案與新 ticket 限流計數 |
| scripts/check-database-schema.mjs、既有 test fixtures／game-concurrency.mjs | 共用測試平台模型，準備未來經批准納管增量，仍不含在 Cloud 部署 |
| supabase/tests/review_realtime_platform.sql | Cloud 平台 catalog 的唯讀檢查，不讀事件內容 |
| package.json／package-lock.json | test:realtime、開發測試用 ws |
| supabase/functions/.env.example、README／AGENTS／架構文件 | 新 Secret 名稱、審核／部署邊界與最新進度 |

## 7. 待審 Migration 與安全檢查

唯一草案：**20261023180000_room_realtime.sql**，仍在 migration-drafts。

SHA-256：`adcbdb76a1287123e4de199db53ec0966f390339400f332c21717009bf40a0c3`。

- 一張新私表 room_realtime_grants，ENABLE／FORCE RLS，browser 無 GRANT；service_role 只有明確 CRUD。
- room_realtime_grant(jsonb)：INVOKER，只限 service_role，回 grantId／roomId／expiresAt。
- room_realtime_can_receive(text)：窄輸出 SECURITY DEFINER、空 search_path，只供 RLS 回 boolean；不提供私表查詢或任意 SQL。
- room_realtime_notify()：SECURITY DEFINER、空 search_path，僅由三個 trigger 發常數通知；撤銷所有直接 EXECUTE。
- realtime.messages 三個 policies 均限定廣播 namespace；沒有改動遊戲表的既有 RLS／GRANT／RPC 或 C 模式。
- Phase 4～6 三個已部署 Migration SHA-256 全部維持原值；沒有將草案移入正式 migrations、沒有 dry-run／db push 或 Secrets／Function 部署。
- git diff --check／cached diff check 通過；敏感掃描 132 個工作檔／247 個歷史 blobs，findings=0，.env.local 未追蹤；新範本保留原設定並增加空 JWK，沒有私密值。暫時測試資料均在本機 fixture／tmp。

## 8. 需要的後續批准

**需要 Migration；不新增 Edge Function，但需要部署現有 room-system 與 game-engine。需要新增後端 Secret ROOM_REALTIME_SIGNING_JWK，以及先審核該 ES256 kid 在 Supabase 的信任設定。**

依 [Supabase Signing Keys](https://supabase.com/docs/guides/auth/signing-keys) 與 [Custom JWT](https://supabase.com/docs/guides/auth/jwts)，自己簽的 JWT 必須使用平台信任的 key。公開 JWKS 不能簽章；也不能把本機 fixture key、ROOM_SYSTEM_SIGNING_KEY 或任意新私鑰直接當成平台已接受的 key。本次未產生／匯入正式 key、沒有讀取／輸出既有 Secret。

此 Secret 格式是完整 private JWK JSON（kty=EC、crv=P-256、alg=ES256、可信 kid 與 d／x／y），不是公開 JWKS、PEM 或 base64 包裝字串；切勿貼入對話、終端輸出或 Git。

先由使用者審核 key 匯入與私鑰保存方式，**不得擅自輪替或撤銷現有 Auth signing key**。若平台流程需要額外 Auth 設定或會影響既有使用者，先停下重新確認。私鑰只放 Edge Secret，絕不放 VITE、GitHub Actions 前端 vars 或 Repository。

批准後才可規劃：納管已審草案 → Migration List／唯一增量 dry-run → 套用增量 → verify_room_realtime.sql → 批准並設定 key 信任／Secret → 部署兩 Function → 專用 QA 真正 Cloud 三人測試。

以下是**未執行**的部署示意，必須先取得涵蓋各操作的明確批准，不可直接複製執行：

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db push --dry-run --linked --skip-vault
npx --no-install supabase db push --linked --skip-vault
npx --no-install supabase db query --linked --file supabase/tests/verify_room_realtime.sql
npx --no-install supabase functions deploy room-system --project-ref fgvajdnzrnptdjurhjfo --use-api
npx --no-install supabase functions deploy game-engine --project-ref fgvajdnzrnptdjurhjfo --use-api
```

簽章信任與 Secret 必須另外安全操作，不提供帶私鑰的命令列或回顯值。Cloud 測試寫入也需另批准；本機 READY 不代表 Cloud 已可訂閱。

## 9. 結論與收據

**Phase 7 本機：READY。** 七個自動同步目標及指定安全／斷線案例均有本機測試。未發現此範圍剩餘 Critical／High 阻斷問題；這不是全面滲透測試或 Supabase Cloud 連線成功保證。

**Phase 7 Cloud／正式發布：尚未準備完成。** 阻擋事項為 signing key 信任／Secret、增量與兩個 Function 的審核批准，以及真正 Cloud Realtime 驗收。沒有自動執行任何 Cloud Migration、Secrets 設定、部署、Commit／Push 或 Pages 發布。

收據：

- `/tmp/guess-who-phase7-final-tests.log`、`/tmp/guess-who-phase7-final-build.log`。
- `/tmp/guess-who-phase7-browser/results.json`：22 組 PASS、50 則常數通知、71 次玩家狀態回應、14 次 429 自動恢復、runtime errors=0。
- `/tmp/guess-who-phase7-room-browser.log`、`/tmp/guess-who-phase7-game-browser.log`：71 項既有回歸 PASS。
- `/tmp/guess-who-phase7-concurrency.log`：PG17.10、20 連線、8 組 PASS。

已停在本機交付與草案審核階段，等待下一步明確批准。
