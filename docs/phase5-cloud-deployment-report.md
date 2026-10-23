# Guess Who — Phase 5 Cloud Deployment Report

日期：2026-10-23（Asia/Taipei）  
Project Ref：`fgvajdnzrnptdjurhjfo`  
**結論：Phase 5 DONE。** 已依使用者明確授權完成唯一 Migration、權限驗證、兩個後端設定、單一 Function 與真實雲端多人驗收。這不是完整遊戲引擎或 GitHub Pages 發布完成。

## 1. Authorization and Preflight

- 只使用既有 Project；再次查詢結果為 ACTIVE_HEALTHY、ap-northeast-1，顯示名稱為 `chiamaureen's Project`，以明確批准的 ref 為準，沒有更名或切換 Project。
- CLI 2.121.0，已讀取安裝版本的 help，確認 `--linked`／`--skip-vault`。本次所有 db push 均使用已核對的 linked Project，**不使用 `--project-ref`**。
- History 初始只有 Phase 4 已套用；再次 dry-run 僅列出 `20261023093000_room_system.sql`，沒有 seed／roles。無意外 Migration。
- 部署前唯讀確認新 rate 表／三 RPC 均不存在；hosts、rooms、room_players、room_questions、host_question_history 全部為 0。沒有讀取憑證／答案資料列。
- Signing Key 在執行時由 CSPRNG 產生 32 random bytes；真值不出現在命令參數、對話、Git 或 VITE。Repository 外備份為 owner-only，沒有覆蓋或輪替既有自訂 key。
- Allowed Origins 驗證為精確 GitHub Pages HTTPS origin 及 localhost／127.0.0.1 的 5173 origin，不包含 path、wildcard 或非本機 HTTP。

沿用既有服務，沒有建立新 Project、選購／啟用付費計畫，也沒有發布 GitHub Pages。

## 2. Migration Deployment — PASS

實際命令（依序，省略程式內的 linked ref／digest／唯一候選檢查）：

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db push --dry-run --linked --skip-vault
npx --no-install supabase db push --linked --skip-vault --yes
```

實際套用唯一 `20261023093000_room_system.sql`，回報 `dryRun:false`，沒有 seed、roles 或 Vault 同步。

| Migration | SHA-256 | Status |
| --- | --- | --- |
| 20261023060000_create_guess_who_schema.sql | 8f5e0ed648794c09ced3b9d221b32ce070bf3b73f936d2f4bbe5b2834bdca07c | 原 Phase 4，不變 |
| 20261023093000_room_system.sql | d4917bd4d103b537a575e87d78e100dda4bf71b0b3865525b3b26954f76ad10f | 已部署，與 H-01 已審版本一致 |

兩個版本在 local／remote history 一致。**從現在起兩個檔案都不可改寫**，後續只新增經審核的增量。

新增私有表 `room_api_rate_limits`；RPC 為 `room_system_rate_limit(jsonb)`、`room_system_action(text,jsonb)`、`room_system_lobby(uuid,text,uuid)`。沒有改寫原九表或 C 模式去重規則。

## 3. RPC / RLS / GRANT Verification — PASS

先審閱驗證 SQL，確認是 READ ONLY catalog 查詢，沒有業務 DML。部署後執行：

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db query --linked --file supabase/tests/verify_room_system.sql
npm run check:db
```

| Check | Actual result |
| --- | --- |
| Cloud PostgreSQL | 17.11 |
| 應用表 | 10 張，全部 ENABLE／FORCE RLS |
| 欄位／constraints／indexes | 59／65／33，與本機重播零漂移 |
| Table privilege checks | 210，零差異 |
| 三個 RPC | SECURITY INVOKER，search_path 空；anon／authenticated 無 EXECUTE，service_role 可執行 |
| Browser isolation | browser_safe=true、rpc_service_only=true；瀏覽器只有啟用分類可讀，無 public schema CREATE |
| Realtime | 私表暴露 0，沒有新增 publication |
| 真實公開 API | categories HTTP 200，七個啟用分類；hosts／rooms／room_players／rate 表 LIMIT 0 被拒絕，SQLSTATE 42501 |
| 直接 rate RPC | 真實 Publishable Key 呼叫被拒絕，SQLSTATE 42501 |

保留 Phase 4 已審的 `rls_auto_enable()` 平台 event trigger 非阻斷警告，來源摘要／owner／search_path 仍匹配；沒有擅自修改平台函式，也不宣稱 Cloud 完全沒有 SECURITY DEFINER。

## 4. Backend Settings and Function — PASS

已設定並以名稱清單確認：

- `ROOM_SYSTEM_SIGNING_KEY`
- `ROOM_SYSTEM_ALLOWED_ORIGINS`

沒有輸出上述值或摘要；沒有設定任何 `VITE_` 私密變數或複製 Service Role Key 至前端。平台預設 URL／API key maps 在實際 runtime 可用，真實業務 RPC 已成功執行，不只驗證了 Client 初始化。

```sh
npx --no-install supabase secrets set --project-ref fgvajdnzrnptdjurhjfo --env-file /PRIVATE/room-system.env
npx --no-install supabase functions deploy room-system --project-ref fgvajdnzrnptdjurhjfo --use-api
```

上方 env 路徑僅示意；實際使用 Repository 外私密檔案。Function 清單確認 `room-system` **version 1、ACTIVE、verify_jwt=false**，保留自訂 Host／Room／Player 授權、apikey、CORS 及 H-01 gate。

真實 gateway 驗證：127.0.0.1、localhost 與 GitHub Pages 三個已設定 Origin 的 OPTIONS 皆為 204，允許所需 headers；非法 Origin 403、無 Allow-Origin。SDK 初始化及真實 Auth Health HTTP 200 也通過，但不取代實際房間 RPC 驗證。無需 Docker／常駐 Node Server，沒有失敗後重試部署、擴大 GRANT、reset 或 repair。

## 5. Real Cloud Multiplayer Tests — PASS

新增可重跑工具 `scripts/check-room-cloud.mjs`。未帶明確授權參數時直接 BLOCKED，不會讀設定後偷偷建立資料；不納入預設 npm test，避免 CI 意外寫入雲端。

本次經授權執行：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/check-room-cloud.mjs --allow-test-writes --project-ref fgvajdnzrnptdjurhjfo
```

本機 Vite 使用 127.0.0.1:5173；Chrome 155.0.8059.85，三個獨立 browser context。**全部呼叫真正 Supabase Cloud Edge／PostgreSQL，沒有 fixture、Mock、request redirection 或假成功。**

| Cloud check | Result |
| --- | --- |
| 七分類動態讀取、複選建立 waiting 房間 | PASS |
| Host 刷新後恢復原身分與控制權 | PASS |
| 只有代碼的邀請連結、複製、真實玩家表單加入 | PASS |
| Player 刷新保留同 Session，不重複玩家 | PASS |
| 第二個獨立玩家以小寫手動代碼加入，名單手動刷新 | PASS |
| 同 Host 跨兩房，關閉後刷新仍 finished | PASS |
| 無效／缺少憑證、Player 操作 Host API、錯房 Token、偽造 ID／role、另一 Host 控制被拒絕 | PASS |
| 玩家只離開自己的新測試紀錄，另一位保留 | PASS |
| Host 關閉原房、既有玩家刷新看到結束、晚到者被拒 | PASS |
| 明確撤銷兩個新測試 Host 憑證，保留房間／歷史、不啟動引擎 | PASS |
| Browser runtime errors／未預期 Cloud 5xx | PASS：均為 0 |

上述刻意測試的 400／401／403／410 是預期拒絕，不是部署權限異常；沒有任何非預期 Migration、權限或部署失敗。一般 state DTO 無其他 Token、Hash、人物或歷史；初次發行自己的憑證是必要例外，不會寫進報告／console。

### Identifiable test data receipt

Test label：`P5QA10231042`。房間沒有名稱欄位，因此以以下 IDs／代碼、玩家 QA 暱稱及收據識別，沒有為標記測試而新增 Schema。

| Room code | Room ID | Final status |
| --- | --- | --- |
| UNJBPX | 91d01381-a74d-4813-9d5f-9056979cc433 | finished，0／15 |
| 778E5M | 9634251e-a3a3-41be-a19c-ec8347820310 | finished，0／15 |

原 Host ID：`55d5865a-c070-4001-b027-0d705efe35fe`；另一個用於跨 Host 負向測試的 ID：`65611283-7583-4c7e-bfaf-d03fb58d1684`。兩者只屬本次新建測試，憑證已透過合法 API 撤銷，未刪除 Host row。

部署後測試的最終 READ ONLY 核對：

- rooms 2、hosts 2、room_categories 3；兩房均 finished／current_question=0／total_questions=15，unrelated rooms=0。
- 剩餘一位 `P5QA10231042-B` 測試玩家；A 僅透過正常 leave API 移除自己本次新建的 player row。沒有刪除任何預先存在資料，沒有清除整張表或歷史。
- questions=0、host_question_history=0、啟用分類仍為 7；沒有開始抽題／重置歷史／修改正式人物。
- rate rows=24，全部 key 為 64hex；沒有將假 Token 原文或 IP 存入 key。這是觀測當下數量，會依後續流量／清理變動。

保留測試房間／Host／B 玩家供審核，不執行額外刪除；若需要清理，另行確認範圍。私密 Session 備份在 Repository 外、owner-only，不寫 Git。公開結果與截圖：`/tmp/guess-who-phase5-cloud-10231042/results.json` 及同目錄 screenshots；不含憑證。

## 6. Final Acceptance

| Test | Result |
| --- | --- |
| Migration deployment | PASS：唯一已審增量 |
| Cloud Schema／RPC／RLS／GRANT | PASS：PG17.11，完整零漂移與真實拒絕驗證 |
| Secrets／Function | PASS：兩名稱確認；room-system v1 ACTIVE |
| Real gateway／public API isolation | PASS：五組基礎檢查＋另外兩個允許 Origin 預檢 |
| SDK initialization／Auth Health | PASS：實際初始化與 HTTP 200 Health Response |
| Cloud multiplayer browser/API | PASS：11／11，三個獨立 context |
| Post-test data boundaries | PASS：只操作本次可辨識資料，零題目／歷史異動 |
| npm test | PASS：44＋21＋37＋27＝129，含 Edge TypeScript |
| H-01 reproduction | PASS：20 次 429 新增 0 列 |
| npm run build／Cloud tool syntax | PASS |
| Git security／private backup permissions | PASS：79 個工作檔路徑與 149 個歷史 blobs 掃描零敏感發現；env 忽略正確、備份 owner-only、diff／cached diff 與文件連結通過 |
| Lint | NOT TESTED：專案未配置，不冒稱 PASS |

本次沒有在既有 Project 進行 H-01 大量攻擊／DDoS／高併發壓測；H-01 A–J、native PG17.10／20 連線四組併發及 48 項本機 browser 證據見前次安全審核。本次真實多人／PG17.11 業務流程補足雲端整合，不將壓測未執行藏起來。

已知非阻斷限制：localStorage bearer 的 XSS／裝置風險、匿名資料遺失不能跨裝置找回、代理／fallback／來源桶碰撞共用額度、全域 cap 可被耗盡、名單手動更新。沒有宣稱完整 DDoS 防護，也未下載可能含敏感 headers 的平台 raw gateway logs；應用程式沒有 Token logging。

**Phase 5 DONE：** 房間系統可使用，正式遊戲／Realtime／題庫／Pages 發布仍待後續階段。未執行 Git Commit／Push、db reset、migration repair、既有資料刪除或 GitHub Pages 發布。

## 7. Phase 6 Preparation

已建立 [Game Engine Preparation](phase6-game-engine-preparation.md)：先確認交易／狀態／答案隔離契約，再進入實作。這次只準備設計與驗收清單，沒有新增 Phase 6 RPC、Migration、抽題、揭曉或歷史重置功能。
