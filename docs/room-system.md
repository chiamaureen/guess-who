# Guess Who — Room System

**Phase 5 DONE：** 已經使用者明確批准，完成 Cloud Migration、Secrets、room-system v1 與真實多人驗收，見 [Cloud Deployment Report](phase5-cloud-deployment-report.md)。隨機出題、答案、計分、歷史重置及 Realtime 不在本階段；Phase 6 目前只有準備文件。

## 架構

```text
React / HashRouter
  ├─ Supabase 公開分類 SELECT（只有啟用分類）
  └─ HTTPS POST /functions/v1/room-system/{action}
       ├─ Origin / API Key / 輸入 / 自訂匿名憑證檢查
       ├─ 獨立、可持久化的限流 RPC
       └─ service_role-only SQL RPC（同一交易）
            ├─ hosts
            ├─ rooms / room_categories
            └─ room_players
```

正式架構沒有常駐 Node Server。`supabase/tests/browser-fixture.mjs` 只是本機驗收用的暫時 HTTP 橋接器，內含隔離記憶體 PGlite；瀏覽器測試結束即關閉，沒有 Cloud 憑證或正式資料。

## 1. Host Identity 生命週期

1. 第一次提交建立房間時，以瀏覽器 CSPRNG 產生 32 bytes `bootstrapKey`，先保存待確認請求。
2. Edge 以獨立後端簽章 Secret、用途分離 HMAC-SHA-256 產生 `gw_host_…` 長期憑證；DB 只存用途分離 SHA-256 hex Hash。
3. 相同 bootstrapKey 的網路重試產生相同憑證，`hosts.credential_hash UNIQUE` 保證不重複建立同一個身分。
4. 成功保存 `{hostId, credential}` 後清除 bootstrapKey；下次開房沿用憑證，不因刷新或路由變更重建 Host。
5. Web Locks 序列化同 origin 跨分頁首次建立與儲存操作；不支援 Web Locks／儲存遭封鎖時失敗關閉，不默默改成短期身分。
6. Host ID 只用於顯示／關聯，伺服器以憑證 Hash 找到真實 Host，不接受前端指定 Host ID。

### 保存與恢復的安全界線

GitHub Pages 與 Supabase 跨站，不能假設第三方 HttpOnly Cookie 可用。MVP 使用 `localStorage` 保存匿名 bearer 憑證、單房間 Token／Player Session，以及尚未確認的重試 nonce；**不保存具權威性的遊戲狀態或題目**。

同瀏覽器／同 origin 可恢復；清除網站資料、無痕視窗關閉、換瀏覽器或裝置可能永久失去控制權。localStorage 不是安全金庫，XSS、惡意擴充套件或共用裝置可取得憑證並重放；本機加密且金鑰同樣可讀無法解決 XSS。不得將 Token 放入 URL、console、分析服務或錯誤追蹤。玩家名稱以 React 純文字呈現，沒有 HTML 注入入口。

### 撤銷

主持人安全設定須二次確認，呼叫 `host-session` 的 revoke mode。伺服器驗證有效長期憑證，拒絕仍有未過期 waiting／playing 房間的撤銷。允許時將憑證 Hash 替換為不可用的隨機值，保留原 Host ID、房間與歷史；前端成功後才清除此裝置的 Host 憑證與房間控制 Token。

這不是清除 C 模式歷史。下次建立的是新的匿名身分，沒有舊歷史或跨裝置找回能力。舊 bootstrapKey 若被保留／重放，可建立新的匿名身分，但不能因而取得原 Host ID 的房間或歷史控制權；它本身也是敏感的短期待確認憑證。

## 2. Room Token / Player Session

| 類型 | 格式／用途 | 驗證 |
| --- | --- | --- |
| Host Credential | `gw_host_` + 43 位 canonical base64url（32 bytes） | 找出有效 Host，跨場保存身分 |
| Room Host Token | `gw_room_` + 43 位 base64url | 必須同時具有效 Host Credential、正確房間 Token 及 rooms.host_id |
| Player Session | `gw_player_` + 43 位 base64url | 只匹配該房間的 room_players Hash，不接受 Player ID／role 授權 |

Hash 以 `guess-who:{purpose}:v1:` 分離用途；不能把玩家憑證拿來當 Host 憑證。DB 不保存原始 Token。

開房前保存 CSPRNG requestKey；Room Token 以長期 Host Credential 與 requestKey 做用途分離 HMAC 推導。相同建立請求重試可重新取得同一房間與 Token，毋須在 DB 保存明文。建立房間及所有分類由單一 SQL RPC 交易完成；Token Hash 唯一，同一 Host 的建立操作以 Host row lock 序列化。

玩家先保存 CSPRNG joinKey 與原暱稱；Edge 以簽章 Secret、房間代碼、joinKey 推導 Session。相同請求重試回到同一 player row；已保存 Session 的重複加入直接驗證現有 Session，不新增玩家。

離開時只能刪除自己 Session 對應的 player row，之後舊 Session 無法恢復該 player。明確重新加入會建立新的玩家；重放原始匿名加入請求也可能建立新的 player row，但不能接管別人的 Session。網路錯誤不清除待確認請求／身分；不以任意 401 自動建立新的 Host。

## 3. Room Code 與分類

- 六碼，字元集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`，排除 I／O／0／1。
- 32 個字元，以 CSPRNG bytes 的低五位均勻取樣，無 modulo bias；DB UNIQUE 是最後防線，衝突最多重試八次。
- Room Code 只是邀請識別，不是主持人授權。
- React 從 `categories` 動態讀取 `id,name,slug`，只顯示啟用資料；未知新分類也會呈現，不以 Mock Data 補假成功。
- 可複選 1–32 個不同 UUID；Server 重新檢查存在及啟用，交易內鎖定分類，避免部分成功。至少 15 位不同可用人物的檢查留待 Phase 6。

## 4. API 與 DTO

部署單一 Function **room-system**，六個 POST action：

| Action | 功能 | 授權 |
| --- | --- | --- |
| host-session | bootstrap／resume／revoke 長期匿名身分 | bootstrap nonce 或有效 Host Credential；revoke 需 confirm |
| create-room | 建立房間＋複選分類 | Host Credential |
| join-room | 匿名加入／重試 | 房間代碼、暱稱、保密 joinKey |
| get-room-state | 驗證並取得等待室快照 | Host Credential + Room Token，或 Player Session |
| leave-room | 只移除目前玩家 | Player Session |
| close-room | waiting → finished，重複關閉保持 finished | Host Credential + Room Token |

請求欄位、headers、錯誤碼與回應白名單見 [API Contract](room-api.md)。玩家與 Host 的狀態 DTO 只包含房間公開狀態、選定分類、玩家 id／暱稱／加入時間與自己的 viewer；沒有 Token Hash、人物、答案或歷史。

## 5. Lobby 與 Lifecycle

- 主持人：房間代碼、只有代碼的邀請連結／複製、已選分類、玩家名單、狀態、禁用的開始按鈕與二次確認關閉。
- 玩家：房間代碼、自己的暱稱、名單、等待提示與離開。
- 初始資料固定 `waiting`、`total_questions=15`、`current_question=0`。
- 關閉以 Phase 4 既有 `finished`＋`ended_at` 表示；不新增 `closed`，不把 finished 改回 waiting。
- Phase 5 不控制 playing 房間；加入或關閉 playing 回 409，正式遊戲控制留待 Phase 6。
- 房間預設 24 小時到期，使用伺服器時間判斷。過期無法正常加入、恢復或控制；留下資料不代表仍有效，不延長期限或自動重開。
- 沒有背景清理／斷線刪房；關閉頁面不發刪除請求。未來保存／清理策略需另外設計，不能清除 C 模式歷史。
- 無自動輪詢或 Realtime；名單以手動刷新更新，UI 有五秒 cooldown。已加入玩家需手動刷新或重新載入才會看到主持人關閉，這是 Phase 5 已知限制。

## 6. GitHub Pages 路由

邀請格式：`https://chiamaureen.github.io/guess-who/#/room/ABC123`。只有房間代碼，不包含 Host／Player Token、Host ID 或秘密 query。

未加入者進暱稱表單；已保存 Session 者向後端重新驗證角色並恢復等待室。保留 `/join?code=ABC123`（HashRouter 內）與手動輸入入口。邀請表單在同一路徑完成加入時，也重新驗證 Session，不停留原表單。GitHub Pages 刷新不需要伺服器 rewrite。

## 7. CORS / API Keys / Limits

`supabase/config.toml` 對此 Function 設 `verify_jwt=false`，因本專案採自訂匿名憑證而非 Auth user JWT。程式仍明確驗證環境內允許的 Publishable Key、輸入、Host／Room／Player Hash、Origin 及持久化限流；公開 API Key 不等於使用者身分，CORS 也不是授權。

後端優先使用平台自動提供的 `SUPABASE_SECRET_KEYS`／`SUPABASE_PUBLISHABLE_KEYS` JSON map；admin key 只在 Edge 記憶體中初始化 Client，保留既有 `SUPABASE_SERVICE_ROLE_KEY` 相容 fallback。沒有啟用 Auth Anonymous Sign-In。

只接受明確 origin allowlist：正式網站 HTTPS origin、不含 `/guess-who/` 路徑；本機可明列 localhost／127.0.0.1 HTTP。OPTIONS 回 204，允許 POST 與目前使用的五個 headers；沒有 wildcard origin／跨站 credentials cookie。回應 `Cache-Control: no-store`，錯誤不回顯 SQL／原始例外。

限流在獨立 RPC 交易提交，所以主操作失敗不會把限流計數一併回滾：

| Scope | 限制 |
| --- | --- |
| Host bootstrap 全域／來源桶 | 30 次／10 分鐘；5 次／10 分鐘 |
| 其他 action 全域 | 120 次／分鐘；get-room-state 為 600 次／分鐘 |
| 其他 action 來源桶 | 30 次／分鐘 |
| DB 驗證成功的 Host／Player Identity | 每 action 30 次／分鐘；create-room 為 5 次／分鐘 |
| 房間資源 | 同 Host 最多五個未過期活動房間；每房最多 100 玩家 |

H-01 修復後，`room_system_rate_limit(p_request jsonb)` 不再接受任意 hash／limit／window 陣列。政策由 SQL 固定，依序執行全域 gate → 來源 gate → DB 驗證憑證 → verified Identity gate；一旦拒絕就停止後續分配，無效憑證沒有個別計數器。回傳 `{allowed,authenticated,retryAfter}` 只供 Edge 使用，業務 RPC 再次驗證控制權，避免驗證與使用之間的撤銷競態。

來源只採用 runtime 的 `Deno.serve` connection `remoteAddr.hostname`（本機 fixture 使用 socket.remoteAddress），**不讀 X-Forwarded-For／X-Real-IP／CF-Connecting-IP**。此地址可能是平台代理，不宣稱等同真實終端玩家 IP；若 metadata 不可用／存取失敗，使用所有人共用的 unavailable 來源，不能退回信任 headers。[Deno connection metadata](https://docs.deno.com/api/deno/http-server/)

連線來源以後端 HMAC 映射到 256 個固定桶，SQL 驗證 slot 為 0–255。六個 action 與額外 bootstrap mode 合計最多 7 個 global、1792 個 source key，不因偽造 IP／Token／每次換 key／時間窗口累積。這會有雜湊碰撞與代理／fallback 共用配額的可用性取捨，必須在批准部署後確認實際 metadata／多人容量，不能為改善容量而重新信任客戶端 headers。

Identity key 只在 DB 以 credential hash 找到真實 Host ID，或匹配房間的 Player ID 後，依用途、action、server ID 產生 SHA-256；不從任意未驗證 Token 建桶。DB 不存原始 IP、Token 或明文 Identity key。每個 scope 的窗口更新沿用同一主鍵，不建立時間後綴新列。

每次限流交易固定先鎖全域、再來源、再身分；以唯一鍵 UPSERT 原子累加，拒絕也獨立提交。最後才以 `FOR UPDATE SKIP LOCKED` 清理最多 100 筆超過 24 小時未更新的列，清理後不再取得其他 rate lock；沒有流量時不會自動清空，但也不會產生新列。匿名大量錯誤請求只能使用固定 gate；已驗證 Identity 的舊列會在後續流量中分批回收。

這不是完整 DDoS 防護；全域 cap 可能被惡意耗盡造成可用性限制，共用 NAT 的多人快速加入／刷新也可能被限流。MVP 優先保護免費額度；正式流量調整需另行評估，不隱藏此權衡。

官方依據：[Edge Functions auth](https://supabase.com/docs/guides/functions/auth)、[Function configuration](https://supabase.com/docs/guides/functions/function-configuration)、[API keys](https://supabase.com/docs/guides/getting-started/api-keys)、[CORS](https://supabase.com/docs/guides/functions/cors)。本專案以明確自訂授權實作，不把關閉 JWT 驗證當成完成安全控制。

## 8. 已部署 Database 增量

`supabase/migrations/20261023093000_room_system.sql` 已經使用者批准套用至既有 ref，與已審 H-01 digest 一致；從現在起禁止修改，只能以另行審核的增量變更：

- 新增私有 `room_api_rate_limits` 表與索引：ENABLE／FORCE RLS、瀏覽器零權限、service_role 必要 DML。
- 新增 `room_system_action`、`room_system_lobby`、`room_system_rate_limit` 三個 SECURITY INVOKER／空 search_path 函式；明確 REVOKE PUBLIC／anon／authenticated，只授 service_role EXECUTE。
- 不更動原九表欄位／RLS、不改已部署 Migration、不碰人物／題目／跨場歷史資料。

需要新增 SQL 的原因：Edge 多次 REST insert 不能提供跨房間與分類的原子交易；記憶體限流無法跨 Edge isolate 持久化。瀏覽器不能直接呼叫上述 RPC，也不會因此取得寫表權限。

## 9. Secrets 與部署前提

| 設定 | 位置 | 需求 |
| --- | --- | --- |
| Project URL／Publishable Key | 前端 `.env.local`，部署時 build env | 可公開，沿用 `.env.example` |
| ROOM_SYSTEM_SIGNING_KEY | Edge Secrets | 32 個隨機 bytes 的 64 字元 hex；不可用示例／重複字元、不可放 VITE |
| ROOM_SYSTEM_ALLOWED_ORIGINS | Edge 環境 | 明確 origin CSV，例如 `https://chiamaureen.github.io,http://localhost:5173,http://127.0.0.1:5173` |
| SUPABASE_URL／API key maps | 平台自動注入 | 不要求使用者將 Secret／Service Role Key 複製到前端 |

後端示例為 `supabase/functions/.env.example`，內容刻意無法直接作為有效私密設定。真值由使用者在 Dashboard Secrets 或 Repository 外的私密 env 檔安全設定，不貼到對話、不寫在 CLI 參數。

簽章 key 輪替會影響尚未確認的 bootstrap／join 重試；既有 Host／Player 仍以 DB Hash 驗證，所以**換簽章 key 不會自動登出全部既有 Session**。需保護及備份 key、安排輪替窗口；撤銷既有身分用明確的撤銷流程。

已執行指令、僅列名稱的 Secrets 結果與真實 Cloud 證據見 [Cloud Deployment Report](phase5-cloud-deployment-report.md)。後續不得因文件列出指令就重複執行、輪替 Key 或新增 Cloud 測試資料。

## 10. 本機驗證

Node.js 22.18+：

```sh
npm test
npm run build
```

`npm test` 包含既有單元測試、Health 模擬、Phase 4 baseline、Phase 5 Fetch handler＋PGlite 交易／授權，以及 Edge TypeScript 檢查。PGlite 為 PostgreSQL 18.6，Cloud 先前確認為 PG17.11；本機不代替真實 Cloud／Deno runtime 驗收。

H-01 回歸：`node scripts/review-room-rate-limit.mjs`；Test A–J 已納入 `npm run test:rooms`。真正多連線檢查可用已安裝的本機 PostgreSQL binary 與 pg driver：

```sh
PG_BIN_DIR=/absolute/path/to/postgres/bin PG_DRIVER_MODULE=/absolute/path/to/pg/lib/index.js node supabase/tests/room-rate-concurrency.mjs
```

工具缺失為 BLOCKED，不自動安裝或接受 Cloud DB URL；script 只建立 /tmp 私有 Unix socket cluster、停用 TCP、以 20 條連線測試，finally 停止。本次實際使用 PG17.10，與 managed PG17.11 仍有 minor／平台差異，工具沒有加入專案 production dependencies。

瀏覽器工具使用既有 Playwright 與 Chrome；不會自動安裝工具：

```sh
npm run dev -- --host 127.0.0.1 --port 5177 --strictPort
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/check-room-browser.mjs
```

若專案環境已安裝 `playwright` 可省略 `PLAYWRIGHT_MODULE`。script 自行啟閉隔離後端，將 Supabase 請求攔截轉送本機；缺工具為 BLOCKED，失敗為 FAIL。沒有真實 Cloud 房間資料寫入。結果與截圖預設 `/tmp/guess-who-phase5-qa/`。

RWD suite 在密集頁面刷新中等待真實 60 秒來源窗口，因所有測試 context 都經同一 localhost socket；不以偽造 forwarding headers 區分玩家、不清除限流資料或提高正式門檻。單獨的 Test F 與 native PG 檢查負責驗證超量並行確實被拒絕。

## 真實 Cloud 驗收工具

`scripts/check-room-cloud.mjs` 與本機工具分開：需要已部署後端、允許的 127.0.0.1:5173 前端，以及明確的測試寫入授權與 `--allow-test-writes --project-ref fgvajdnzrnptdjurhjfo`。沒有 fixture 或 Mock，會建立實際房間／身分；預設 npm test 不會執行它，缺少明確參數直接 BLOCKED。測試只透過正常 API 操作本次新建資料；失敗立即停止、不自動清理或修復。憑證備份只存 Repository 外 private 檔，不進報告。

## 11. 後續邊界

- Phase 6 已新增獨立 `game-engine` 與遊戲面板的本機實作：15 位 DISTINCT 庫存、逐題交易、揭曉、換題、結束及二次確認歷史重置；尚未部署，不改 `room-system` 的六個既有 action。細節見 [Game Engine](game-engine.md) 與 [Phase 6 Report](phase6-game-engine-report.md)。
- Phase 7 才做權限正確且不含答案的 Realtime，取代手動更新；不直接公開含答案資料表。
- Phase 8 才正式匯入人物／圖片並審核授權。Phase 6 不讀原始 URL 作為玩家照片，使用已審核私有 PNG；room-system 本身仍不查詢／回傳題目答案。
- 原 `check-room-cloud.mjs` 保留 Phase 5 當時的 UI 驗收假設；不能直接當 Phase 6 雲端測試工具。下一次 Cloud 寫入需另批准並審核更新測試範圍，本次沒有執行它。
