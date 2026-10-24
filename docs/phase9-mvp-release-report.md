# Phase 9 — Polling MVP Release Preparation

日期：2026-10-24（Asia/Taipei）。

- **Phase 9 發布：DONE** — 使用者已批准限定發布；GitHub 設定唯讀驗證、Actions build／deploy 與公開唯讀 Smoke Test 均 PASS。正式網址完整多人驗收尚未執行。
- **Phase 7：DEFERRED** — 保留全部程式碼、草案與測試，沒有 Cloud 部署。
- **MVP Polling：READY** — 本機三人完整 15 題通過；正式網址已可存取，但本次公開 Smoke 不新增雲端遊戲資料，不冒稱正式網址完整 15 題已驗收。

## 1. Git Diff 摘要

| 檔案 | 用途 |
| --- | --- |
| src/lib/features.ts、src/vite-env.d.ts、.env.example | Feature Flag；只有精確 true 才開 Realtime，預設 false |
| src/lib/room-polling.ts、src/lib/room-polling.test.ts | 單一 Polling controller、排程／背景／限流／舊回應保護與測試 |
| src/hooks/useRoomSync.ts、src/types/realtime.ts | Hook 切換 Polling／保留的 Realtime；callback ref 避免 render 重建 |
| src/services/rooms.ts、src/services/game-engine.test.ts | 相容已部署 Phase 6 DTO，降低每輪 API 數，無新後端 API 依賴 |
| src/lib/room-api.ts | Retry-After 秒數、HTTP 日期及非 JSON 429，不截短伺服器等待時間 |
| src/pages/LobbyPage.tsx | 說明等待室定期同步、遊戲名單保留開場快照，不重新設計 UI |
| .github/workflows/pages.yml、scripts/check-pages-env.mjs | Pages 固定關閉 Realtime、拒絕提前開啟，保留 manual-only 發布 |
| scripts/check-polling-browser.mjs、supabase/tests/browser-fixture.mjs | Production Build＋三人＋舊 Phase 6 DTO 的本機驗收；合成題庫／唯讀本機統計，不部署 |
| scripts/check-room-browser.mjs | 冷卻立即斷言，不假設網路早於五秒回應，等待可容許 Retry-After |
| README.md、AGENTS.md、docs/pages-release-checklist.md、docs/phase7-realtime-report.md、本文件 | MVP 同步、延期邊界、發布與驗收步驟 |

沒有修改 `supabase/functions/`、正式／草案 Migration、RLS、GRANT 或後端 Secrets。Phase 7 原始碼仍保留，不部署、不重跑題庫匯入或 Cloud 遊戲測試。上述 21 個檔案已由使用者提交並推送為 20987cb；本次沿用它發布，只補四份發布文件／狀態紀錄。

## 2. Polling 與限流評估

已部署 SQL 的 get-room-state gate：global=600／分、source=30／分、驗證後 identity=30／分。game-state 與 private image 共用 read scope；缺可信來源時可能共用保守桶，不能信任前端 X-Forwarded-For。

- 三秒每人 20 次／分；Host＋兩 Player 即至少 60 次，尚未計入圖片，超過同來源 30 次。
- **改十秒基準**：三人穩態約 18 次狀態 API／分，留約 12 次給圖片／手動操作，不保證任意快速換題不會 429。
- 較大房間採 `max(10000, ceil((玩家數+1)*60000/18))` ms，六人約二十秒。來源 hash 碰撞、多分頁或其他房間仍可能共用 cap。
- 舊 DTO 初次快照最多兩次 API，另有既有 Session 驗證。waiting 通常一次 room-state；轉 playing 多一次 game-state。playing 通常一次 game-state，合併開場 roster；**遊戲中名單不保證持續更新**，避免每輪雙 API。
- 讀取完成後 setTimeout，不用 setInterval；每頁一個 controller，慢請求不重疊。手動刷新不能穿透間隔或退避。
- 背景／離線暫停，前景／online 恢復；finished、失效、過期、卸載停止。serial reads＋mutation epoch 防舊回應覆蓋新題／答案狀態。
- 429 採 Retry-After＋指數退避的較長值。一般退避最高六十秒；伺服器要求更長就等待更長，過長 timeout 分段等待避免溢位。圖片沿用原入口與重試，不改限流、RPC 或權限。

## 3. 發布設定與安全

- Vite `/guess-who/`、HashRouter 保持原設定；邀請 `/guess-who/#/room/CODE` 不含憑證。
- Cloud 僅用既有 room-system／game-engine；本機特別剝除 Phase 7 的 game DTO categories／players，驗證舊版相容性。
- Workflow 只 workflow_dispatch，固定 `VITE_ENABLE_REALTIME=false`。沒有 ticket API／WebSocket，不需 Realtime signing key、Migration 或 Functions 部署。
- 真實本機公開設定檢查 PASS，不輸出值；Secret／Service Role／CLI Token／DB Password／私鑰不能進 VITE 或 Actions 建置環境。
- 真實 Cloud OPTIONS：正式 Origin **https://chiamaureen.github.io**，兩個 Function 均 204、headers 完整；非法 Origin 均 403。沒有查閱 Secret 值、呼叫限流／業務 RPC 或修改資料。
- 狀態與圖片仍走原 Host／Room／Player headers。答案存取在後端過濾，不以 CSS 或 Polling 邏輯取代權限控制。

## 4. 實際測試結果

| Test | Result | Details |
| --- | --- | --- |
| npm test | PASS | 231 項：Vitest 92、Health 21、DB 37、Room 27、Game 26、Realtime 18、題庫／圖片 10，保留 Phase 7 與 H-01 測試 |
| TypeScript／Edge TypeScript | PASS | 最終 npm test 的 check:edge 與 build 的 tsc 均通過 |
| npm run build | PASS | 最終 Retry-After 保護後已重跑，115 modules，dist 僅靜態前端 |
| Polling browser | PASS | Chrome 155、production Preview、1440／390／768px，24 組、Host＋兩 Player、完整 15 題 |
| Phase 6 舊 DTO | PASS | 不需 game categories／players 擴充欄位，即可初始化與穩態遊玩 |
| 加入／離開、Start／Reveal／Next／Finish | PASS | waiting roster 自動更新；兩 Player 不按手動刷新，取得每題圖片／答案與結束，無第 16 題 |
| Session／舊回應／單一 Loop | PASS | Host／Player reload、慢請求、StrictMode cleanup、serial reads、mutation epoch |
| 背景／離線恢復 | PASS | 模擬 visibility hidden 暫停；真實 browser offline 漏過下一題後 online 自動補取，不是實體手機 OS 背景測試 |
| 限流恢復 | PASS | 模擬完整 CORS 的 429 等候至少 12 秒；本機真實 gate 另外觸發 5 次 429，均恢復完成，未放寬 cap |
| 答案／歷史 | PASS | 15 題 Player 未揭曉只有 id／number／revealed；15 位不同、15 題揭曉、15 筆歷史保留，未 reset |
| Realtime 依賴 | PASS | ticket requests=0、WebSocket requests=0、Cloud 業務 requests=0 |
| 既有遊戲 browser 回歸 | PASS | 23 項，含 RWD、原題重試與 Session |
| 既有房間 browser 回歸 | PASS | 調整冷卻斷言後 48 項通過，含六種尺寸、邀請、離開／關閉與 Session |
| 最終 production Build 冒煙 | PASS | 最後 Build 後另跑 7 組：兩人建立／加入、第一題、Reveal、Next、reload、Finish、無 Realtime／保留歷史；僅本機兩題測試，不重稱 15 題雲端驗收 |
| lint | NOT CONFIGURED | 沒有 lint script，不新增工具 |
| H-01 獨立重現腳本 | PASS | 20 次不同假 Credential 都 429，新增 rate rows=0、business actions=0 |
| Workflow／公開設定 | PASS | YAML 可解析、僅 manual trigger、Realtime=false、build→deploy；實際本機設定指向指定 Project |
| Git／dist 安全 | PASS | 137 工作檔、132 index 檔、298 歷史 blobs（含 Reflog）及 7 個 dist 檔，秘密模式 findings=0；環境檔／prepared 忽略，暫存檔=0，後端／Migration diff=0 |
| Actions／正式 Pages | PASS | run 40056684258，build／deploy 成功；公開網址 HTTP 200、十二項唯讀 Smoke 通過 |
| 正式網址完整多人／實體手機 | NOT TESTED | 本次禁止 Supabase Database 寫入，不建立 QA Host／Player／Room；390px 是 Chrome viewport，不是實體手機 |

首次 TypeScript build 發現 controller union narrowing，修正後通過。首次新 browser 的模擬 429 缺 CORS，未能正確讀 Retry-After；只修 harness 後 24 組通過。舊房間測試在等 roster 回應後才查五秒冷卻，低頻更新時可能已結束；改點擊後立即斷言。這些失敗沒有冒稱 PASS，也沒有更改 Cloud 來繞過。

未發現本次範圍內的 Critical／High；不代表全面滲透測試或未知歷史的絕對保證。前端 Build 不包含私鑰、資料庫密碼、Service Role／Secret Key、私有題庫圖片／SQL 或實際 QA Session；只有 URL 與 Publishable Key 是預期公開設定。Phase 9 的阻礙是待確認的遠端設定與發布關卡，不是已知安全缺陷。

本機收據：`/tmp/guess-who-phase9-final-tests.log`、`/tmp/guess-who-phase9-polling-browser/results.json`、`/tmp/guess-who-phase9-room-regression/results.json`、`/tmp/guess-who-phase9-game-regression/results.json`、`/tmp/guess-who-phase9-final-build-smoke.json`。瀏覽器合計 102 組，僅本機模型，不是 Cloud 或正式網址測試。

## 5. GitHub Variables 與 Pages 設定

Repository → Settings → Secrets and variables → Actions → **Variables**：

| Name | Value / purpose |
| --- | --- |
| VITE_SUPABASE_URL | https://fgvajdnzrnptdjurhjfo.supabase.co |
| VITE_SUPABASE_PUBLISHABLE_KEY | 從本機 `.env.local` 複製 Publishable Key，不展示真值 |

不需自訂 Repository Secrets；平台提供 GITHUB_TOKEN／OIDC。Realtime flag 在 Workflow 固定 false，不需新增 Variable。使用者已設定並批准發布；本次以 GitHub API 唯讀確認 public Repository、Source=workflow、無自訂網域、兩個 Variables 指向正確 Project 且公開 Key 與本機審核版本一致。不輸出或保存 Key 值，也沒有更改這些設定。無 GitHub CLI，改透過既有 Git credential helper 在記憶體內授權 GitHub API，不將登入憑證寫入 Repository 或命令參數。

## 6. 原審核 Git / Pages 計畫與本次執行

以下為原審核計畫，留存作範圍紀錄，不需重新執行整批 add／Commit。此次開始時程式碼未暫存，但後續偵測使用者已自行 Commit／Push 為 20987cb，local HEAD 與 origin/main 相符；因此不重複建立程式碼 Commit。本次只對四份發布文件執行新的紀錄 Commit／Push，不 amend、不 force、不新建分支。

```sh
git status --short
git diff --check
git diff
git check-ignore -v .env.local data/question-bank/prepared/review-20261023/reviewed-bank.json
git add .env.example .github/workflows/pages.yml AGENTS.md README.md \
  scripts/check-pages-env.mjs scripts/check-polling-browser.mjs scripts/check-room-browser.mjs \
  src/lib/features.ts src/lib/room-polling.ts src/lib/room-polling.test.ts src/lib/room-api.ts \
  src/hooks/useRoomSync.ts src/types/realtime.ts src/vite-env.d.ts src/pages/LobbyPage.tsx \
  src/services/rooms.ts src/services/game-engine.test.ts supabase/tests/browser-fixture.mjs \
  docs/phase7-realtime-report.md docs/pages-release-checklist.md docs/phase9-mvp-release-report.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: prepare polling MVP for GitHub Pages"
git push origin main
```

Push 不自動發布。本次經明確批准，以 GitHub API 對 main 送出一次 pages.yml workflow_dispatch；再次核對 GitHub main 與審核 SHA 相符才觸發。Workflow 只上傳 dist，沒有 Supabase db push／deploy／secrets 指令。實際網址 **https://chiamaureen.github.io/guess-who/** 已發布且唯讀驗證通過。

## 7. 發布後驗收與 Phase 7 待辦

依 [Pages Release Checklist](pages-release-checklist.md)：新匿名 Host、政治人物、實體手機＋另一 Player、不按刷新完成 15 題、圖片、答案隔離、重載、離線恢復、無重複與 C 模式歷史。保留 QA 歷史，不擅自 reset；新增 QA 資料須包含於下一次授權。

Phase 7 待完成：可信 ES256 kid／私鑰管理與 Cloud 授權、ROOM_REALTIME_SIGNING_JWK、草案審核／Migration 部署、兩個 Functions 更新、真正 Supabase Realtime 多人／重連／過期與撤銷驗收，都不包含在本次發布。

**下一步：另行批准正式網址的新匿名 QA Host／Players／房間與完整 15 題資料寫入測試。** 本次發布授權禁止 Supabase Database 異動，因此不重跑遊戲、不重置任何歷史。可先修正下列過時文案；不因此擴大這次程式碼發布範圍。

## 8. Cloud Publication Receipt

| 項目 | 實際結果 |
| --- | --- |
| 發布 Commit | 20987cb1ae67df5d7b6916c013d79c91a5735c81，使用者原已 Commit／Push；沿用、不重複提交 |
| Repository | chiamaureen/guess-who，public、main；沒有變更可見性、方案或分支 |
| Workflow run | [40056684258](https://github.com/chiamaureen/guess-who/actions/runs/40056684258)，workflow_dispatch，completed／success |
| Build job | success；npm ci、公開設定驗證、npm test、npm run build、configure-pages、artifact upload 全部成功 |
| Deploy job | success；github-pages environment 的 Deploy step 成功 |
| 正式網址 | https://chiamaureen.github.io/guess-who/；實際 HTTP 200，Source=workflow、CNAME 空、https_enforced=true |
| 重新本機測試 | 231 項 PASS；TypeScript／Edge TypeScript／Build PASS；另以 VITE_ENABLE_REALTIME=false 重建通過，沒有 lint script |
| 發布前安全 | 137 個工作檔／304 個歷史 blobs 掃描無發現，環境檔未追蹤；另檢私鑰、私有 JWK、硬編碼 Token／Backend Key 與 dist，無發現；正式／草案 Migration 與 Functions 無異動 |
| 公開 Smoke | 12 項 PASS、0 FAIL；Chrome 155，1440px／390px，沒有 fixtures 或後端重導向 |
| 真實 Cloud 唯讀 | categories 四次 HTTP 200；兩個 Function 的正式 Origin OPTIONS 204、非法 Origin 403 |
| Realtime／資料寫入 | 發布 JS 內 flag=false，ticket=0、WebSocket=0、Supabase 寫入嘗試=0、瀏覽器 runtime errors=0；無 QA Host／Player／Room 新增 |

十二項 Smoke 涵蓋：公開 HTML／標題／base、JS／CSS／favicon 與秘密模式檢查、CORS、兩種 viewport 的首頁導覽／how-to-play 回頂 URL、Host 七分類真實讀取／分類選擇／刷新、Join 表單大小寫與路由刷新、無 Session 邀請路由刷新，以及零寫入／零 Realtime／無錯誤總檢。

**非阻斷待辦：** 首頁仍有「正式遊戲尚未開放」及加入頁仍有「等待室名單需手動更新」的過時文案。實際已有遊戲／Polling；本次記錄此 Low 文案問題，不另改已審核發布程式碼。未發現本次範圍內 Critical／High；不是全面滲透測試保證。

發布收據（均不含憑證）：`/tmp/guess-who-phase9-github-preflight.json`、`/tmp/guess-who-phase9-actions-status.json`、`/tmp/guess-who-phase9-public-smoke/results.json`；公開頁截圖在同一 Smoke 目錄。API Pages status 欄位為 null，沒有誤當成 legacy built 狀態；成功依據是明確的 Actions jobs success 與真實公開 HTTP／瀏覽器結果。

本次沒有 Supabase Cloud schema／RPC／RLS／GRANT／Secrets／Functions 或業務資料寫入，沒有部署 Phase 7，也沒有刪除或重置歷史。
