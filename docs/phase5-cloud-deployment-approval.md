# Phase 5 — Cloud Deployment Approval Report

## Latest Cloud Deployment — Phase 5 DONE

使用者已明確批准並完成既有 ref 的唯一 Phase 5 Migration、唯讀 RPC／RLS／GRANT 驗證、兩項 Secrets、room-system v1 ACTIVE 與 11 組真實 Cloud 多人驗收；129 項本機測試及 Build 再次通過。實際 db push 僅使用已核對 linked Project 的 `--linked --skip-vault`，沒有 `--project-ref`、reset／repair／額外 Migration 或資料清除。後續不因本次授權而自動重複部署。

正式紀錄見 [Cloud Deployment Report](phase5-cloud-deployment-report.md)，Phase 6 只已準備設計清單；下方 preflight／NOT TESTED／待批准字樣保留為歷史，不代表最新狀態。

## Latest Final Preflight — PASS

依使用者最後指示，修正版已從草案移至正式 `supabase/migrations/20261023093000_room_system.sql`；不是 /tmp 副本。SHA-256 仍為 `d4917bd4d103b537a575e87d78e100dda4bf71b0b3865525b3b26954f76ad10f`，Phase 4 digest 不變。

實際執行 `npx --no-install supabase migration list --linked` 與 `npx --no-install supabase db push --dry-run --skip-vault --project-ref fgvajdnzrnptdjurhjfo`：Phase 4 local／remote 一致，Phase 5 僅 local；dry-run **只列出 20261023093000_room_system.sql**，seed／roles 均空。一張新表、三個 SECURITY INVOKER RPC、最小權限與 H-01 修正版均與已審內容一致。移入正式目錄後 129 項測試、獨立 H-01 檢查與 Build 再次通過。

`room-system` 維持 verify_jwt=false 及自訂 Host／Room／Player 驗證；兩個自訂後端設定仍為 ROOM_SYSTEM_SIGNING_KEY、ROOM_SYSTEM_ALLOWED_ORIGINS。GitHub Pages `/guess-who/` base、HashRouter 與 Build 已就緒；正式 Pages deployment Workflow 尚未建立，不冒稱已完成前端部署設定。

本次僅本機移檔與 history／dry-run，未真正 db push、部署 Function、設定 Secrets、Commit 或 Push。以下「尚未移入／修正版未 dry-run」描述保留為前次審核紀錄，最新狀態以本節為準；未發現剩餘 Critical／High，但真正雲端 runtime／多人整合尚未驗收。

審核日期：2026-10-23（Asia/Taipei）  
審核基準：Git HEAD `492f75a` 與目前工作目錄，Node.js 22.23.4、Supabase CLI 2.121.0。  
範圍：前次部署審核紀錄＋本次 H-01 本機修復與完整回歸。  
**新結論：READY（H-01 本機安全審核通過，等待使用者審批；不是立即部署授權或 Cloud 驗收完成）。**

H-01 在本次範圍內已修復且驗證，未發現剩餘 Critical／High。既有 Project／Free／origin 人工確認、使用者部署批准、修正版 dry-run 與部署後 Cloud 驗收仍是執行前後的必要 Gate，不能因 READY 省略。

本次沒有任何 Cloud 操作，包括遠端 dry-run／db push、functions deploy、secrets set／遠端業務資料修改；沒有 Commit／Push，也未開始 Phase 6。只修改尚未部署草案、限流相關 Function／驗收工具／文件。已部署 Phase 4 Migration 不變。下表 Cloud metadata、Schema 與舊版 dry-run 為前次審核證據，不是本次重跑。

## 1. Approval Summary

| 項目 | 結果 |
| --- | --- |
| 目標 ref／連線 | PASS：fgvajdnzrnptdjurhjfo，ACTIVE_HEALTHY，ap-northeast-1 |
| Project 顯示名稱 | 目前為 `chiamaureen's Project`，不是需求中的 guess-who；需使用者確認同一 ref 確為目標，未自行改名／重連 |
| Free Plan | 待 Dashboard 人工確認；CLI Project metadata 不足以證明目前 Billing Plan，沿用先前使用者說明但不假設已重新驗證 |
| Phase 4 Cloud drift review | PASS：九表、55 欄位、62 constraints、31 indexes、189 table privilege checks，零差異 |
| Migration history | PASS：local／remote 均只有 20261023060000 |
| 正式目錄 dry-run | PASS：零待套用項目；Phase 5 草案尚未被正式納管 |
| 隔離副本含草案 dry-run | 舊草案 PASS：只預覽一個 SQL；**修正版 NOT TESTED**，本次未獲遠端 db push／dry-run 授權，批准後重新預覽 |
| 新表／三 RPC 的 RLS／GRANT／search_path | PASS：本機測試及靜態審查；Cloud 尚無上述物件 |
| Host／Player 授權、DTO、CORS | 本機 PASS；真實 Deno／gateway 整合未驗證 |
| H-01 cardinality／A–J 安全檢查 | **PASS：全域拒絕後 20 次假 Credential 新增 0 列，未驗證身分無個別 bucket** |
| Native PostgreSQL concurrency | PASS：PG17.10，20 條真實連線、461 次請求、四組情境；不是 Cloud PG17.11 |
| 自訂 Secrets／已部署 Functions | 唯讀清單均為空；兩個自訂設定尚未配置，room-system 未部署 |
| 安全部署條件 | **安全審核 READY**；H-01 已關閉，執行仍等待使用者批准／preflight，不視為雲端部署完成 |

## 2. H-01 Root Cause, Fix and Verification（原 High，已修復）

### 問題與位置

舊版 handler 在驗證憑證是否存在於 DB **之前**，為外部提供的 Host／Player 憑證建立 scope；格式正確不代表身分有效。舊版 room_system_rate_limit 對任意 scope 陣列依 hash 排序後逐一 UPSERT，即使某個全域 bucket 超限，也繼續新增其餘 bucket。以任意 X-Forwarded-For 取來源也缺乏可信代理邊界，24 小時清理無法防止窗口內無限分配。

攻擊者不需有效身分，僅用公開 apikey、可偽造的 Origin 及每次不同的 canonical 假憑證，即可讓已被拒絕的請求持續增加持久資料。CORS 不是非瀏覽器防護。根因在 **分配發生於身分驗證之前，且 gate 沒有固定順序與短路**，不是 SQL Hash 強度不足。

### 隔離重現（沒有 Cloud 請求）

新增 `scripts/review-room-rate-limit.mjs`，載入真實 Fetch handler、Phase 4 SQL 與 Phase 5 草案，在記憶體 PGlite 以真實 service_role RPC 執行。所有 key／Token 為測試生成，不讀 `.env.local`。

```sh
node scripts/review-room-rate-limit.mjs
```

Node.js 22.18+。相同重現工具的前後結果：

| Evidence | Before | After |
| --- | --- | --- |
| 140 次不同假憑證後，再送 20 次 | 全部 429 | 全部 429 |
| room_api_rate_limits 列數 | 142 → 162，增加 20 | 2 → 2，增加 **0** |
| 額外業務 action | 0 | 0 |
| Cloud requests | 0 | 0 |
| 安全檢查 exit code | 1／FAIL | **0／PASS** |

原風險為未驗證輸入放大持久資料量／DB 負載，消耗免費 Database 額度；不是 Host 授權繞過或答案外洩。本次未在 Cloud 壓測或推估耗盡時間。

### 已實作的修復

1. **固定 gate 順序**：SQL 全域 → 來源 → DB 憑證驗證 → verified Identity。任一 gate 超限即 EXIT，後續不查身分／不分配新桶，只提交已發生的固定 counter 更新。
2. **來源可證明有界**：只讀 Deno 連線 metadata 的 remoteAddr.hostname；忽略所有 forwarding headers。取不到資料時保守共用 unavailable 來源，不信任自行填寫的 IP。HMAC 壓到 0–255 slots，SQL 再驗證數值；七種 action／mode 合計最多 1799 個匿名 gate key，無任意 nonce／時間後綴。
3. **先驗身分再建個別計數器**：RPC 以 Host hash 查 hosts.id，或以 Player hash＋房間代碼查 room_players.id；成功後依 server Identity ID／action 產生 SHA-256 key。假 Token 無對應 ID，不建立 counter。業務 action 再次驗證憑證／歸屬，避免 revoke／leave 競態。
4. **封閉 RPC input**：從任意 {hash,limit,windowSeconds} 陣列改成受驗證的 p_request 物件，政策／key 都由 SQL 產生；拒絕未知欄位／任意 scope／slot >255。三 RPC 的數量、signature 型別、SECURITY INVOKER／空 search_path／service_role-only 權限不變。
5. **併發與清理**：固定全域→來源→身分鎖序，UNIQUE 主鍵 UPSERT 原子累加，拒絕計數獨立交易提交。所有 counter 操作之後才清理最多 100 筆 24 小時 stale row，使用 SKIP LOCKED，清理後不再取得其他 counter lock。沒有流量不會自動刪舊列，但不會新增，後續流量分批回收。
6. **失敗請求也計量**：格式無效憑證、錯誤 apikey、JSON 解析／大小錯誤在回覆前仍經固定全域／來源 gate；CORS 拒絕／非業務路徑不配置任意 bucket。沒有把 Token、IP 或 ID 放入公開回應或 log。

來源 metadata 是連線 peer，可能是 Supabase 代理而非終端玩家；fallback／NAT／256 桶碰撞會共用配額。這是明列的可用性限制，不會退回信任 X-Forwarded-For。[Deno connection metadata](https://docs.deno.com/api/deno/http-server/)

### Test A–J 實際結果

| Test | Result | Evidence |
| --- | --- | --- |
| A 全域 429 後 20 次不同假憑證 | PASS | 新增 0 列；另換可信測試連線來源也不新增來源桶 |
| B 大量不同假憑證 | PASS | 240 次請求只有固定 global／source 共 2 列 |
| C 合法 Host | PASS | 建立、相同請求重試、五次個別 cap；同一 Host／房間 |
| D 合法 Player | PASS | 加入、原 Session 恢復及自己的離開 |
| E 非法 Credential | PASS | 隨機合法編碼與非法編碼先 401，超來源配額 429；不能接管／改狀態 |
| F 並行 | PASS | 80 個同時 handler 請求僅 30 加入／50 拒絕；另用 native PG17.10／20 條連線驗證四組情境 |
| G 到期與清理 | PASS | 合法原身分恢復；150 筆 stale 首次清 100、下次清 50；不誤清活躍列 |
| H 驗證失敗仍受來源保護 | PASS | 偽造 XFF／X-Real-IP／CF header 不換桶，malformed JSON 也會超限，僅 server metadata 控制來源 |
| I 直接 RPC | PASS | anon／authenticated EXECUTE 拒絕、PUBLIC 無 grant；service_role 的任意 scope 輸入拒絕，隨機假 hash＋變 slot 仍受固定 global gate |
| J 敏感資訊 | PASS | rate key 僅 64hex，state／error DTO 與應用 console 無 bearer；發行自己的憑證回應是必要例外 |

Test I 不宣稱能防止外洩的 service_role 直接 DML；該角色本來就是可信後端權限。安全邊界是 browser 無 EXECUTE，且 rate RPC 自身不再接受任意 counter key。

### Modified files

- `handler.ts`：可信連線來源分桶、固定 rate request、先 gate 再處理驗證失敗。
- `index.ts`／`runtime.d.ts`：安全取得 connection metadata，缺失或 getter 失敗時 fallback；RPC 改傳 p_request 並驗證內部回應。
- 未部署 `20261023093000_room_system.sql` 草案：只改 rate RPC 實作／參數名稱；新表欄位與所有 GRANT／RLS 不變，另外兩 RPC 不變。
- `room-system.node-test.mjs`：保留原 17 情境，更新內部契約並新增 A–J。
- `room-rate-concurrency.mjs`：可重跑的隔離 native PG 多連線檢查；`browser-fixture.mjs` 改用 socket metadata。
- `check-room-browser.mjs`：密集 RWD 操作在正常限流窗口外繼續，不偽造來源／刪除 counter／提高 production 門檻。原重現 script 現在 PASS。
- 相關 Room System／Schema／驗收文件及 AGENTS 更新。沒有增加 production dependencies 或改 package-lock。

## 3. Database Migration Review

### Migration inventory 與實際 CLI 結果

| Version / path | Current state | Impact |
| --- | --- | --- |
| supabase/migrations/20261023060000_create_guess_who_schema.sql | 已部署；local／remote 一致 | Phase 4 九表，禁止改寫 |
| supabase/migration-drafts/20261023093000_room_system.sql | 已修 H-01 的待審草案，不在正式 migrations | 新增一表、一個非 PK 索引、三個 RPC 與必要權限；批准後先對修正版重新 dry-run |

前次審核實際執行（本次修復沒有重跑任何遠端命令）：

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db push --dry-run --skip-vault
```

History 僅 `20261023060000`，正式目錄 dry-run 回報 `upToDate:true`、`migrations:[]`、`seeds:[]`、`roles:[]`。**這不是 Phase 5 已部署的證據**，而是 CLI 根本不掃描 migration-drafts。

為完整預覽，在 `/tmp/guess-who-deployment-review.*` 建立隔離工作目錄，僅複製 config、Phase 4 Migration、Phase 5 草案到副本的 migrations，未移動 Repository 內檔案，執行：

```sh
npx --no-install supabase db push --dry-run --skip-vault --project-ref fgvajdnzrnptdjurhjfo --workdir /tmp/guess-who-deployment-review.ACTUAL_SUFFIX
```

回報只會推送 `20261023093000_room_system.sql`，seed／roles 為空。路徑為本次暫存目錄示意，不能照抄。dry-run 只確認候選清單，不執行 SQL、不驗證 PG17 上的交易／runtime，也不自動批准草案。

目前 digest：

```text
Phase 4  8f5e0ed648794c09ced3b9d221b32ce070bf3b73f936d2f4bbe5b2834bdca07c
Phase 5  d4917bd4d103b537a575e87d78e100dda4bf71b0b3865525b3b26954f76ad10f
```

舊版 Phase 5 digest 是 `95a4950b93a6596c705e8d13926eb539a970d2166fb8f116008181eea8df111e`，僅保留歷史。上列修正版已在 PGlite 與 native PG17.10 套用，但未遠端 dry-run；批准後必須重新預覽，不能沿用舊版候選清單當成新內容驗證。

### New table

`public.room_api_rate_limits`：跨 Edge isolate 的持久限流狀態，不保存明文 Token／原始 IP。

| Column / object | Definition |
| --- | --- |
| scope_hash | text PK，64 字元小寫 hex CHECK |
| window_started_at | timestamptz NOT NULL |
| request_count | integer NOT NULL，必須 > 0 |
| updated_at | timestamptz NOT NULL，預設 now() |
| room_api_rate_limits_updated_idx | updated_at 索引，用於 stale cleanup |

RLS：ENABLE＋FORCE，無瀏覽器 policy。先從 PUBLIC／anon／authenticated／service_role REVOKE ALL，只授 service_role SELECT／INSERT／UPDATE／DELETE，無 TRUNCATE。此設定保持不變；H-01 修在可信後端的分配策略，不以放寬權限處理。

### Three RPC functions

| Function | Parameters | Return | Purpose |
| --- | --- | --- | --- |
| public.room_system_rate_limit | p_request jsonb：action、bootstrap:boolean、source_bucket:0–255；可選 host_hash／player_hash／room_code | jsonb {allowed:boolean,authenticated:boolean,retryAfter:number} | 固定 gate／DB 憑證驗證／verified Identity counter／有界 stale cleanup；H-01 已修復 |
| public.room_system_lobby | p_room_id uuid, p_role text, p_viewer_id uuid | jsonb {room,categories,players,viewer}；房間不存在時可為 SQL NULL | 產生等待室白名單，僅由可信後端傳入已驗證的 viewer |
| public.room_system_action | p_action text, p_input jsonb | jsonb，依 action 而異 | Host 身分、開房／分類、加入、恢復、離開及關閉的交易邊界 |

`room_system_action` 的內部回傳：bootstrap／resume 為 `{hostId}`；revoke `{revoked:true}`；leave `{left:true}`；create／join／get-state／close 為 Lobby DTO。原始 Host Credential／Room Token／Player Session 由 Edge 推導並只在必要回應發給該呼叫者，**SQL 不回傳明文憑證**。

`p_input` 使用後端欄位 `host_hash`／`room_token_hash`／`player_hash` 等，不是直接轉交前端 JSON。`p_role`／`p_viewer_id` 不應作為公開 RPC 參數接受任意使用者呼叫。

### Function security

- 三個函式皆為 **SECURITY INVOKER**，沒有新增 SECURITY DEFINER；固定 `SET search_path = ''`，應用物件使用 `public.`，避免可寫 schema 物件遮蔽。
- 對三個精確 signature 都 `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`，再只 `GRANT EXECUTE ... TO service_role`。
- 本機測試在過寬預設 grants 下驗證 anon／authenticated 呼叫被拒絕，PUBLIC ACL 由草案明確撤銷。
- service_role 可 BYPASSRLS，因此安全性仍依賴 Edge 授權與封閉 RPC；不能把 RLS 當作可信後端錯誤的保護傘。

### Phase 4 / C mode preservation

- 草案沒有 ALTER 原九表、DROP／TRUNCATE、重設 RLS、修改 FK／UNIQUE 或題庫 seed；只新增物件，正式 Migration digest 不變。
- `UNIQUE(host_id,celebrity_id)`、歷史與題目的 FK、刪房只清 first_room_id 的規則保持原樣。
- Room API 不插入／刪除 host_question_history、room_questions 或正式人物；關閉只更新本房間 status／ended_at，不清歷史。
- Host 撤銷更換 credential_hash，保留 Host row／ID／歷史；並非歷史重置。清除瀏覽器或建立新匿名身分不提供舊歷史繼承／帳號找回。
- 前次 `npm run check:db` 真實 Cloud READ ONLY 比對 PASS：九表及權限沒有漂移，public schema browser CREATE=false，應用表 Realtime 暴露為零。本次未連 Cloud；本機十表權限、PUBLIC／anon／authenticated RPC 拒絕與 search_path 再次通過。

已知平台 `rls_auto_enable()` 是 SECURITY DEFINER event_trigger、瀏覽器 EXECUTE 不必要，但符合 Phase 4 精確來源／擁有者／search_path 審查例外；本次仍匹配，為既有低風險警告，不是本次新增 RPC，也未修改平台物件。

## 4. Edge Function Review

單一 Function：`room-system`，入口 `supabase/functions/room-system/index.ts`，依賴由 deno.json 固定 `@supabase/supabase-js@2.118.0`。

```toml
[functions.room-system]
verify_jwt = false
import_map = "./functions/deno.json"
```

本專案採自訂匿名 bearer 憑證，沒有 Supabase Auth user JWT；關閉平台 JWT gate 與呼叫模式相符，但不代表端點可以不驗證身分。程式保留 apikey allowlist 與各 action 自訂憑證檢查。[Supabase Authorization headers](https://supabase.com/docs/guides/functions/auth-headers)

| POST operation | Review |
| --- | --- |
| host-session bootstrap | 保密 CSPRNG nonce＋後端 HMAC，credential_hash UNIQUE，重試沿用身分；固定全域／來源 gate，H-01 已修復 |
| host-session resume／revoke | 由有效 Host Credential 查 DB，不信任 Host ID；撤銷需 confirm，仍有未過期活動房間則拒絕，不刪歷史 |
| create-room | Host Credential 必要；server 推導單房間 Token，驗證分類 UUID／啟用狀態；同交易建立、同 Host 鎖、冪等／代碼衝突重試與五活動房上限 |
| join-room | 正規化房間代碼／暱稱，以 join nonce 推導 Player Session；只限有效 waiting、100 人上限、重試不重複玩家 |
| get-room-state | Host 必須同時有長期憑證＋本房 Token＋owner 關係；Player 必須有匹配本房的 Session；本機 role 不能授權 |
| leave-room | 只能刪自己 Session 對應 player row；不能指定 Player ID 來刪別人 |
| close-room | Host＋Room Token 才能 waiting→finished；重複關閉冪等、不恢復 finished、不處理 playing 引擎 |

六個 action、八種 mode／operation 均已檢視。前端未知欄位拒絕，包含 hostId／playerId／role，授權資料由 Edge 重新產生；不把 Publishable Key 當 Host 身分。

### CORS / preflight

- 僅接受明確 origin allowlist，HTTPS；localhost／127.0.0.1 可明列 HTTP。Origin 不含 `/guess-who/`，沒有 wildcard／credentials cookie。
- 合法 OPTIONS 回 204，不要求 Host／Player 或業務 apikey，也不執行 RPC；POST 以外回 405。
- 允許 headers：content-type、apikey、x-host-credential、x-room-token、x-player-session；暴露 Retry-After、Vary: Origin，回應 no-store／nosniff。
- 現有前端用 fetch，不附 Authorization／x-client-info，所以目前 header 清單匹配。未來換成 SDK functions.invoke 必須重新審查 headers，不能假設通用 SDK 預檢已涵蓋。
- 設定錯誤時入口回遮蔽的 503，沒有 CORS 成功 headers；瀏覽器可能只看到 network error，需營運側用不輸出秘密的診斷處理。真實 gateway／Deno 仍待部署後驗證。[Supabase CORS](https://supabase.com/docs/guides/functions/cors)

### Sensitive information

- 憑證格式分離、canonical 32 bytes、SHA-256 用途分離、HMAC 推導；DB 僅 Hash，邀請 URL 僅房間代碼。
- 正常 state DTO 無 Hash、其他玩家 Session、人物、答案、題目或歷史。首次發行／安全重試回傳自己的明文憑證是必要設計，不可誤稱所有 API 永不回 Token。
- 程式沒有 console logging／原始 SQL 例外回傳；未知錯誤白名單遮蔽，前端也不顯示遠端任意 message。
- 不宣稱平台 gateway、自訂 proxy 或外部分析服務絕不記錄 headers；部署時不得啟用含憑證的 debug／request dump，Cloud 實際 log review 尚未執行。
- localStorage bearer 仍受 XSS／惡意擴充套件／共用裝置影響；同 origin 其他 GitHub Pages 內容也在同一儲存安全邊界，path 不是隔離。這是需接受的 MVP 風險，不是伺服器授權測試可排除的威脅。

## 5. Environment Variables Review

| Variable | Purpose | Cloud default? | Required action |
| --- | --- | --- | --- |
| ROOM_SYSTEM_SIGNING_KEY | 32 random bytes 的 64 hex 簽章 key，推導可重試 Host／Player 憑證與 IP scope | 否，自訂 | 額外安全設定，不能用 placeholder／重複字元，不放 VITE／Repository／CLI 明文 |
| ROOM_SYSTEM_ALLOWED_ORIGINS | 明確網站 origin CSV，控制跨網域瀏覽器來源 | 否，自訂 | 確認正式 origin 與本機 port 後設定；不是秘密，但只屬後端設定 |

上述是本專案需要額外設定的 **兩項**。本次 Cloud `secrets list` 回傳空陣列，沒有自訂設定；這不表示平台預設 env 不存在，也不能證明 runtime 的值已驗證。

官方列為預設注入：`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEYS`／`SUPABASE_SECRET_KEYS` JSON map 等。入口優先使用新 map 的 secret，保留 legacy `SUPABASE_SERVICE_ROLE_KEY` fallback；Publishable map 缺失則 fail closed。這些高權限 key 只在 Edge 初始化 admin Client，不需要使用者複製進 React。[Supabase Environment variables](https://supabase.com/docs/guides/functions/secrets)

平台實際注入格式／選到的 key 是否具有需要的 service_role 權限仍須在批准部署後驗證，不能只因文件列為 default 就記 runtime PASS。程式目前取 map 第一個值，若未來有多個 named keys，應確認選擇策略，避免 key 輪替或插入順序導致設定故障；不是對外授權繞過。

前端只允許 `VITE_SUPABASE_URL`、`VITE_SUPABASE_PUBLISHABLE_KEY`。`.env.local`、CLI .temp 被忽略，兩份 .env.example 只有示意值。不得將 Signing Key、Service Role／Secret Key、DB Password 或 CLI Access Token 放進任何 VITE 變數。

## 6. Deployment Plan（全部為未執行提案）

**H-01 安全 Gate 已通過，但本次沒有授權部署；以下仍只能閱讀。** 各階段 CLI 使用已安裝版本；先確認 Node.js 22.18+。不得使用 repair、reset、pull、Supabase start、include-all、prune 或破壞性 rollback。隔離 native PG 工具不是 Supabase start，也不連遠端。

### Step 1 — Confirm target Project

```sh
npx --no-install supabase projects list
```

- 預期：ref `fgvajdnzrnptdjurhjfo`、healthy、Tokyo region；Dashboard 人工核對顯示名稱與 Free Plan，確認 CLI linked ref 相同。
- 風險：顯示名稱與需求不同，或切錯 org／Project／付費 Plan；list 本身不提供完整 Billing 證據。
- 失敗：停止；由使用者確認帳號／目標及免費額度。需要 login 時自行在安全終端機操作，不貼 Token，不自行建立或切換專案。

### Step 2 — Check Migration History and drift

```sh
npx --no-install supabase migration list --linked
npm run check:db
```

- 預期：部署前 local／remote 只有 Phase 4，原九表零漂移。正式推送前再次核對，不能只沿用本次時間點結果。
- 風險：他人同步修改、未知 Migration／同名新物件、平台函式摘要變動。
- 失敗：停止並調查差異；不 migration repair、不改寫已部署檔、不以 include-all 略過。

### Step 3 — Review and deploy required Migration

H-01 本機修復／審核已通過；待使用者批准後，才將修正版草案納入正式 `supabase/migrations/20261023093000_room_system.sql`，最終 digest／版本須與批准內容一致，並對修正版重新 dry-run。

```sh
npm test
npm run build
node scripts/review-room-rate-limit.mjs
npx --no-install supabase db push --dry-run --skip-vault
```

只有以上全部 PASS、dry-run 僅一個預期 Migration，且使用者明確批准後：

```sh
npx --no-install supabase db push --skip-vault
```

- 預期：一表／一索引／三 RPC 及最小權限新增，Phase 4 原物件／正式資料不變，不部署 seed／fixtures／Vault。
- 風險：Cloud PG17.11 與本機 PG17.10／PG18.6 的 minor／平台差異、鎖／超時、預設 grants／事件 trigger。dry-run 不驗證實際 SQL 執行；新 Edge 與 p_request 契約須一起部署，不能混用舊版 RPC 參數名稱。
- 失敗：不部署 Function；先唯讀確認 catalog／history，保留證據，不能假設整筆已 rollback，也不盲目重推或 DROP。修正以另行審核的增量處理，不重寫已成功 Migration。

### Step 4 — Verify Cloud Schema, RLS and RPC

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db query --linked --file supabase/tests/verify_room_system.sql
npm run check:db
```

- 預期：兩個版本 history 一致、十表 ENABLE／FORCE、browser_safe／rpc_service_only=true、零私表 Realtime 暴露，含新 RPC source／search_path／GRANT 的漂移比對 PASS。
- 風險：只看 JSON 回傳／HTTP 200 而沒判斷布林；查詢工具成功不等於權限全部正確。
- 失敗：停止後續公開入口部署，調查最小權限差異。該 SQL 只輸出驗證結果，不自動對 false 結束為失敗，操作者必須判讀；不得隱瞞 false。

### Step 5 — Set backend variables

```sh
npx --no-install supabase secrets set --project-ref fgvajdnzrnptdjurhjfo --env-file /ABSOLUTE/PRIVATE/PATH/room-system.env
```

- 預期：兩個自訂設定由 Repository 外、限本人讀取的私密 env 檔設定；Signing Key 安全生成及備份，origin 精確匹配。檔案路徑是示意，不可照抄。
- 風險：弱 key、誤放 VITE／Git、誤用帶 path 的 origin、輪替中途破壞待確認請求。輪替 Signing Key 不會自動撤銷已發行且以 DB Hash 驗證的憑證。
- 失敗：安全修正設定，不輸出值、不傳聊天、不啟用 debug。若秘密洩漏，停止、規劃撤銷／輪替；不能只刪 diff 當作已解決。

### Step 6 — Deploy room-system

```sh
npx --no-install supabase functions deploy room-system --project-ref fgvajdnzrnptdjurhjfo --use-api
npx --no-install supabase functions list --project-ref fgvajdnzrnptdjurhjfo
```

- 預期：單一 room-system Function，verify_jwt=false、正確 import map，service-side bundle 成功；不需 Docker／常駐 Node。
- 風險：Deno import／API key maps 不相容、設定遺漏回 503、意外取用錯誤 named key、關閉 JWT 卻遺漏程式授權。
- 失敗：不宣布上線或做多人測試，檢查不含秘密的錯誤與環境；修正／重新部署需符合授權範圍，不自動撤銷 schema、刪房或擴大 grants。

### Step 7 — Cloud API tests

先不寫應用資料，驗證合法／非法 Origin 與真實預檢：

```sh
curl --silent --show-error --include --request OPTIONS 'https://fgvajdnzrnptdjurhjfo.supabase.co/functions/v1/room-system/get-room-state' --header 'Origin: http://127.0.0.1:5173' --header 'Access-Control-Request-Method: POST' --header 'Access-Control-Request-Headers: content-type,apikey,x-host-credential,x-room-token,x-player-session'
curl --silent --show-error --include --request OPTIONS 'https://fgvajdnzrnptdjurhjfo.supabase.co/functions/v1/room-system/get-room-state' --header 'Origin: https://disallowed.invalid' --header 'Access-Control-Request-Method: POST'
npm run check:supabase
```

預期合法 204 與正確 CORS headers，非法 403 無 Allow-Origin。Auth Health 必須真實 HTTP 200，但不是房間 API 驗收替代。

**取得 Cloud 測試寫入範圍批准後**，可先跑最小缺憑證負向測試（即使回 401，也會更新 rate table，因此不是唯讀）：

```sh
node --env-file=.env.local --input-type=module <<'NODE'
const response = await fetch(`${process.env.VITE_SUPABASE_URL}/functions/v1/room-system/get-room-state`, {
  method: 'POST',
  headers: { Origin: 'http://127.0.0.1:5173', apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ roomCode: 'ZZZZZZ' }),
})
const body = await response.json()
const passed = response.status === 401 && body.error?.code === 'UNAUTHORIZED'
console.log(JSON.stringify({ result: passed ? 'PASS' : 'FAIL', status: response.status }))
if (!passed) process.exitCode = 1
NODE
```

- 預期：上述負向測試 401；再以新建測試身分覆蓋六 action、錯誤 Token／偽造 ID／跨房控制、無敏感 DTO、冪等重試、429／Retry-After。
- 風險：負向請求也寫 rate table，全域 cap／NAT 影響其他使用者；大量攻擊重現不得在既有 Cloud 跑。
- 失敗：立即停止測試，收集 status／白名單 code，不保存 tokens／headers；根據 401／403／429／503 區分授權、來源、限流與設定，不用放寬 RLS 解決。

### Step 8 — Host / Player multi-user integration

```sh
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

使用一般與無痕／另一瀏覽器 context，連真正 Cloud，不跑會攔截網路的本機 fixture：

- 經批准建立新的測試 Host／房間／玩家；分類複選、代碼／邀請、Host 跨場 ID、各自刷新恢復、名單手動更新、自己的離開、關閉與禁止晚加入。
- 驗證偽造 local role／ID／Token 無效；finished 保持關閉。到期／併發／重試只用批准的測試資料，PG17 真實併發優先在批准的隔離環境。
- 預期：無重複玩家／房間、無答案與其他憑證回應，未開放遊戲按鈕仍禁用。
- 風險：同 origin localStorage 混用身分、修改既有資料、誤把本機 fixture PASS 當 Cloud PASS、超出 Free 額度。
- 失敗：記錄非秘密 ID／步驟與結果並停止；只用正常 API 關閉本次測試房、離開自己的測試玩家。不刪 hosts／題目／歷史或原有資料；殘留測試資料清楚列出，額外清理另批。

### Step 9 — Final acceptance

```sh
npm test
npm run build
node scripts/review-room-rate-limit.mjs
npm run check:db
git diff --check
git diff --cached --check
git ls-files -- .env.local
git check-ignore -v .env.local
```

- 預期：High 清零、全部測試 PASS、雲端操作與多人證據齊全、敏感 env 未追蹤，報告更新真實結果；未設定 lint 保持 NOT TESTED。
- 風險：把 dry-run／初始化／Auth Health 當完整 Phase 5 通過，或漏列未驗證項目。
- 失敗：保持 NOT READY／Phase 5 未完成，列出修復計畫；不 Commit／Push、不開發 Phase 6。完成報告不等於獲得發布／提交授權。

## 7. Review Tests and Remaining Risks

| Test | Actual result |
| --- | --- |
| npm test | PASS：44 Vitest＋21 Health unit＋37 baseline SQL＋27 backend＝129；原 119 情境保留，另增 A–J；含 Edge TypeScript |
| npm run build | PASS：TypeScript＋Vite build |
| Lint | NOT TESTED：未配置 |
| Rate cardinality audit | **PASS：20 個 429 新增 0 列；前後均為 2 列** |
| Native PostgreSQL | PASS：17.10、20 條真正連線、461 次呼叫；四組 global／source／identity／expiry＋cleanup 情境，無競態或 deadlock |
| Cloud Phase 4 Schema／RLS／GRANT 比對 | 前次 PASS：PG17.11、九表，零漂移；本次未重跑，保留已審 event trigger 警告 |
| Migration list／dry-run | 前次 baseline／舊草案 PASS；修正版 NOT TESTED，本次禁止遠端 db push（含 dry-run） |
| Browser | 本次 48／48 PASS：建立／加入、恢復、關閉與六尺寸 RWD；真實 handler／SQL，本機 transport，不是 Cloud |
| Secret scan／Git diff | PASS：工作檔、diff／cached diff、135 個歷史 blobs 掃描零敏感發現；env 與 ignore 正確 |
| Deno／gateway／Cloud Phase 5 RPC／多人 | BLOCKED：未部署；本機 PG17.10 不等於 Cloud PG17.11 runtime／managed 配置 |

本機細節：PG17.10 執行檔 `@embedded-postgres/darwin-arm64@17.10.0-beta.17` 與 pg@8.16.3 僅安裝於 /tmp，未加入專案依賴。`room-rate-concurrency.mjs` 使用私有目錄／Unix socket，停用 TCP、不接受 DB URL、finally 停止 cluster。工具初次受 sandbox 限制，經允許後實際通過；不將 sandbox 失敗記為 PASS。

重跑 native 檢查（使用已安裝工具的絕對路徑，不會自行下載）：

```sh
PG_BIN_DIR=/absolute/path/to/postgres/bin PG_DRIVER_MODULE=/absolute/path/to/pg/lib/index.js node supabase/tests/room-rate-concurrency.mjs
```

Browser 最初沿用密集腳本，全部 context 現在共享可信 localhost peer，達正常 30 次來源 cap 而出現 429；調整測試節奏於 RWD 中等待真實 60 秒窗口後 48 項通過。沒有增加 production 限額、刪除 counter 或偽造來源來製造 PASS。產物：`/tmp/guess-who-h01-browser/results.json`；native 記錄：`/tmp/gw-h01-pg-3T1FkR`（server 已停止）。

其他已知風險：localStorage／XSS、匿名憑證失去即無法找回、全域 cap 可被耗盡造成短期 DoS、NAT／代理／來源桶碰撞誤限流、未驗證 Deno 與 managed 配置、部署後沒有自動破壞性 rollback。固定 gate 只限制 bucket 分配／業務負載，不消除所有 Edge invocation 成本或提供完整 DDoS 防護。

## 8. Git Security Review and Approval Gate

- `.env.local` 未被追蹤且命中 ignore；CLI .temp 同樣忽略；env 範例只有 placeholders。
- 工作檔／diff／staged diff／既有 Git blobs 掃描私密 key、service-role JWT、Access Token、含密碼 DB URI 與不當 env 追蹤；不輸出秘密。這是模式掃描及程式審查，不是對所有未知憑證格式的保證。
- 安全掃描及 diff 檢查僅作為輔助；H-01 的關閉依據是 A–J、原重現工具與 native 多連線證據，不是 regex 掃描。
- 最終掃描：75 個工作檔路徑、135 個歷史 blobs，findings／敏感追蹤／歷史 env 路徑均為空；env 範例只含示意值，本機 env 無後端秘密變數名稱。diff／cached diff 檢查通過，沒有把掃描 PASS 當作全面滲透測試保證。
- 本次僅修改未部署草案，沒有改寫正式 SQL、修改遠端資料、搬移草案、設定 Secrets、部署 Function、遠端 dry-run、Commit 或 Push。

**放行前尚需：**

1. H-01 本機修復與安全回歸已完成；由使用者審閱本次變更，批准後仍須對修正版重新 dry-run。
2. 使用者確認 Project 顯示名稱差異、正確 ref、Free Plan 與允許 origin。
3. 提供安全設定兩項自訂後端 env 的操作條件，不提供秘密給對話。
4. 明確批准修正版 Migration／Function／Secrets 的遠端部署；另確認 Cloud smoke 的新資料寫入與保留範圍。
5. 依 Step 1–9 順序驗收；結果不足不得宣稱完整 Phase 5 通過，不提前開發 Phase 6。

**最終決策：H-01 已關閉，本機安全審核 READY；執行部署仍為待批准／待 preflight，完整 Phase 5 Cloud 驗收尚未完成。本報告不是部署授權。**
