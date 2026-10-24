# Phase 8 — 測試題庫 v3 本機驗收報告

日期：2026-10-24。此配置取代先前 124 位運動員／69 張圖片批次的人數規劃，不刪除舊資料或審核紀錄。

**後續更新：** 使用者另批准的 [Cloud 唯讀盤點](phase8-test-bank-v3-cloud-inventory.md) 已完成：180 位候選與正式人物零匹配，Cloud 原政治人物 15 位目前僅 2 位核准，WebP 未部署。以下 BLOCKED 與測試結果保留為先前本機階段紀錄，不代表尚未執行後續唯讀盤點。

## 1. 結論

- **候選與本機 Seed 工具：READY**。八組共 180 位，180 個不同 Wikidata ID；來源查詢本次沒有網路失敗。
- **正式題庫／單組 15 題：NOT READY**。新批次核准數為 0；找到圖片網址不等於人物、授權、署名方式及輸出圖片已通過審核。
- **Cloud 去重與實際可抽題人數：BLOCKED**。本次雲端唯讀快照執行未獲允許，沒有改用其他方式查詢；不能以本機空資料庫結果當作雲端數量。
- 沒有寫入 Supabase Cloud、部署、Commit、Push、停用政治人物或修改遊戲歷史。

## 2. 名單與圖片盤點

完整名單：[180 位候選](phase8-test-bank-v3-candidates.md)。可追蹤的公開身分目錄：`data/question-bank/test-bank-v3-catalog.json`；每人有中文／原文名稱、QID、穩定 candidate UUID、分類、群組及查證連結。candidate UUID 不是遊戲圖片 ID。

| 群組 | 分類 | 候選 | 圖片網址候選 | 缺圖片網址 | 已有私有 WebP | 新核准／可抽題 |
|---|---|---:|---:|---:|---:|---:|
| 國外演員 | actors | 15 | 15 | 0 | 0 | 0 |
| 台灣演員 | actors | 15 | 15 | 0 | 0 | 0 |
| 英語歌手 | singers | 30 | 30 | 0 | 0 | 0 |
| 台灣歌手 | singers | 30 | 29 | 1 | 0 | 0 |
| 運動員 | athletes | 30 | 30 | 0 | 30 | 0 |
| 台灣政治人物 | politicians | 15 | 15 | 0 | 0 | 0 |
| 台灣 YouTuber | youtubers（草案） | 15 | 13 | 2 | 0 | 0 |
| 動畫人物 | animated-characters | 30 | 4 | 26 | 0 | 0 |
| **總計** | | **180** | **151** | **29** | **30** | **0** |

上表最後欄僅指本次新準備批次；各組在既有 Cloud 題庫的匹配／可抽題總數均未驗證，不能填 0 或宣稱達標。八組皆尚未證明具備 15 位已核准可抽題人物。原政治人物雲端驗收結果不代表本次台灣政治人物群組驗收通過。

- 缺圖片網址的真人：鄭宜農、黃大謙、愛莉莎莎。動畫 26 位缺網址，另外 4 位也尚未取得足夠使用權結論。
- 圖片候選均追到 Wikimedia Commons 資訊頁／版本證據，不把 Wikipedia 展示或 Google 結果當成授權。151 是原始來源候選數，**不是 151 張合法可匯入照片**。
- 30 位運動員優先沿用既有待審來源及真實 WebP，不重新下載／轉檔；逐檔驗證 SHA-256、完整解碼、長邊不超過 1024px、無 EXIF／ICC／XMP。沒有因此自動核准。
- 動畫候選中的 Mickey、Pooh、SpongeBob、Patrick 共 4 個 Commons 圖檔，包含 2 個 SVG。即使頁面標示 PD／CC，也須確認底層角色版本、權利範圍及本專案使用條件；SVG 不能直接進目前私有 WebP 匯入流程。全部維持待確認。
- 本次未新增圖片處理功能，也未將其他 121 個網址轉成 WebP。後續仍須逐張核實人物、照片可用性、作者、授權版本／條款、必要署名與修改紀錄；CC BY／BY-SA 不可改標 PD。揭曉前不提供含姓名的來源資訊，延後署名是否符合個別授權仍是審核關卡。
- 「台灣政治人物」涵蓋台灣政治脈絡中的現任及歷任人物，不要求僅現任；本批沒有 historical-figures 群組，該分類原封保留。

權利判斷參考：[Commons 衍生作品](https://commons.wikimedia.org/wiki/Commons:Derivative_works/en)、[非自由作品的自由描繪](https://commons.wikimedia.org/wiki/Commons:Free_depictions_of_non-free_works)、[CC BY-SA 4.0 條款](https://creativecommons.org/licenses/by-sa/4.0/)。上述文件不是本批核准證明。

## 3. 分類與最小 Schema 草案

沒有改寫任何已部署 Migration，新增兩份待審草案，尚未放入正式 migrations：

1. `20261024160000_add_youtubers_category.sql`：僅新增 `youtubers`，固定 UUID 尾碼 008；預設 **inactive**。原七分類保持原樣，YouTuber 不進 scientists。ID／slug 衝突即停止，不覆蓋既有資料。
2. `20261024161000_test_bank_candidates.sql`：新增私有 `question_bank_candidates` 待審表，保存穩定身分、主分類、群組、來源及圖片候選 Metadata。RLS ENABLE／FORCE；anon／authenticated／PUBLIC 無存取，service_role 僅 SELECT／INSERT／DELETE，沒有 UPDATE。CHECK 強制 `is_approved=false`，群組必須對應正確主分類。

既有 `celebrities` 的圖片／作者／授權欄位要求完整且非空，因此不能為缺圖候選填假網址或假授權。Seed 先寫隔離待審表，**不插入正式 celebrities／celebrity_categories／game_image_assets，也不會變成可抽題人物**。Game Engine 完全不讀此待審表，不新增 RPC、公開 SELECT 或 Realtime publication。

若未來批准完整 180 位待審入庫：待審表最多新增 180 列，實際須扣除已存在 QID 與已 staging 人物；分類最多新增 1 列。精確 Cloud 異動數在取得快照之前未知；正式人物、分類關聯、私有圖片本次計畫均為 **0 列**。

## 4. 子群組獨立選擇方案（尚未實作）

目前 group 欄位只是候選編輯資訊，**不能讓正式遊戲分開選國外／台灣演員或英語／台灣歌手**。最小可維護的後續方案：

- 新增 `question_groups`（slug、category FK、啟用狀態）、`celebrity_question_groups`（人物／群組唯一關聯）、`room_question_groups`（持久化本房選擇）。這三表只是方案，本次沒有建立相關 Migration。
- 建立房間 UI 顯示群組 checkbox；`create-room` 可接受經後端驗證的 group IDs，同交易保存，保留原 categoryIds 相容路徑。Player 不能改篩選條件。
- 開場計數與每題抽題均在伺服器套用群組條件，先 DISTINCT 人物、排除 Host 歷史，再從仍有候選的分類隨機抽題。不能僅在 React 過濾顯示。
- 保留固定 15 題、題號冪等、交易及 C 模式；不同群組／分類仍使用同一人物 ID。分類／群組公開資訊只含名稱與可用數量，不公開人物答案清單或圖片映射。
- 修改 Room System／Game Engine 的參數驗證與 SQL 候選條件，Host／Player DTO、私有圖片授權及揭曉規則不放寬。新表／RPC 權限另審，不部署 Phase 7。

## 5. 可重複 Seed 與 Dry Run

使用 Node.js 22.18+。工具不讀雲端金鑰、沒有 `--apply`，也不建立網路連線。

```sh
nvm use
npm run test:bank-v3

# 只讀公開 Wikipedia／Wikidata／Commons Metadata；一律未核准
node scripts/prepare-test-bank-v3.mjs new-v3-directory

# 缺雲端快照時會輸出 BLOCKED_CLOUD_DUPLICATE_CHECK，exit 2，不產生可執行匯入 SQL
node scripts/seed-test-bank-v3.mjs --dry-run \
  --bank data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/candidates.json \
  --out data/question-bank/prepared/NEW-v3-dry-run

# 取得另經允許的唯讀快照後，才可準備 SQL，仍不執行 SQL
node scripts/seed-test-bank-v3.mjs --dry-run \
  --bank data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/candidates.json \
  --snapshot data/question-bank/prepared/APPROVED-SNAPSHOT.json \
  --emit-sql --out data/question-bank/prepared/NEW-v3-sql-review
```

prepare 工具第一個參數是新的小寫 slug，結果寫入 `data/question-bank/prepared/<slug>/`；Seed 的 `NEW-*` 也必須是尚不存在的目錄。公開 catalog 刻意不含完整圖片 Metadata／本機私有 asset 映射，**不可直接當 `--bank` 使用**；需使用 prepare 工具的完整 candidates.json。新 checkout 若沒有舊 athlete prepared cache，工具仍可重新查詢該 30 位的公開來源，但不會自動得到舊 WebP 或核准狀態。

本次完整結果在 ignored `data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/`。所有 prepared JSON／SQL／圖片不進 `src`、`public`、dist 或 Git。

### 去重、交易與回滾

- 雲端去重須另批准執行 `supabase/tests/snapshot_test_bank_v3.sql`；若待審表已存在，再執行 `snapshot_test_bank_v3_staged.sql`，把結果加進 snapshot 的 staged 陣列。快照不含圖片 bytes、Token、Hash、房間或歷史。須確認 linked project 正確，快照不超過 24 小時。
- 相同 QID 重用既有人物，不重建、不自動補改原分類或圖片；同名但 QID 不匹配即 BLOCKED，須人工對照。若既有人物需要新增群組／分類關聯，另列入正式匯入計畫，不能偷偷寫入。
- 同一穩定 ID／QID 的已待審資料重跑不新增、不覆寫備註或決定；識別、主分類或群組衝突即停止。
- SQL 使用單一交易、待審表鎖與唯一限制；交易內重新檢查正式人物 QID／正規化姓名。任何錯誤整批 Rollback，不使用 UPSERT、CASCADE 或正式人物 UPDATE／DELETE。
- 每批有 run UUID、SQL SHA-256、回滾 SQL。回滾僅刪本批實際新增且 payload／review_status 未變的 pending rows；有人審核或修改則拒絕回滾，不能刪掉後續審核成果。
- `verify_test_bank_v3_staging.sql` 是部署後唯讀驗證計畫：群組筆數、核准數應為 0、RLS／GRANT、分類 FK、與正式人物新增重疊。只有待審表確實存在後才可執行，筆數應比對該批收據／去重結果，不強制假設一定新增 180。

## 6. 實際本機測試

| 項目 | 結果 | 範圍 |
|---|---|---|
| 180 候選／8 組／唯一 QID、ID、姓名與分類 | PASS | 真實公開來源資料；所有 approved=false |
| 既有運動員 WebP 重用 | PASS | 30 張真實 bytes／SHA／完整解碼／尺寸／Metadata；不代表授權核准 |
| 真實 v3 manifest 待審 Seed | PASS | 本機空 PGlite：首跑 180、重跑仍 180、回滾後 0；正式人物／圖片／遊戲資料維持 0 |
| 保留既有資料、衝突拒絕與權限 | PASS | 另以隔離 fixtures 驗證舊 15 張 PNG、房間、題目、C 歷史不變；姓名／QID／staging 衝突、交易失敗、審核後拒回滾、匿名拒讀與 CHECK 禁核准 |
| 雲端去重 Dry Run | BLOCKED | 未獲唯讀快照允許；輸出 unknown 而非 0，未產生 Cloud 匯入 SQL |
| 新八組單組 15 題真人題庫驗收 | NOT TESTED | 新核准均 0，不能以合成 fixtures 或歷史政治人物驗收替代 |
| 瀏覽器 | PASS | 23 項本機遊戲／Session／RWD + 7 項真實待審 WebP 圖片檢查；Cloud requests=0 |

完整自動化、TypeScript、Build 與 Git 安全檢查結果見本報告末節的最終執行紀錄。沒有設定 lint script，未宣稱 lint 通過。Game Engine 的 Host／Player 答案隔離、15 題、交易及 C 模式由原有隔離測試回歸；本次沒有改動正式前端／Edge／遊戲 SQL。

## 7. 待批准的雲端順序

1. **先批准唯讀盤點**：核對 `fgvajdnzrnptdjurhjfo` linked ref，取得正式人物及必要 staging 快照，重跑 Dry Run；此階段沒有 Cloud 寫入。
2. 審核兩份新分類／待審表草案，另外批准後才移入 migrations；確認 migration list／dry-run 只含所批准檔案。不能順帶部署 WebP 或 Phase 7 草案。
3. 依新快照產生精確待審列數、SQL SHA 與回滾收據；另批准 SQL 後才能寫入待審表。執行唯讀驗證與匿名拒讀檢查，既有政治人物、rooms／room_questions／host_question_history 不動。
4. **待審入庫不是可玩入庫**。繼續人物／圖片／權利確認，至少每組 15 位合格；補足 29 個缺網址候選與動畫權利，確認署名時機。正式可用批次仍用既有嚴格匯入器，現有工具每批 15～150 位，不可直接把 180 個 pending 塞進去。
5. 真正啟用新 WebP 前，另審／批准 `20261024120000_game_image_formats.sql` → 相容 `game-engine` 部署 → 相容前端建置／發布 → 已核准人物、必要分類關聯及私有 WebP 批次匯入 → 唯讀圖片／權限驗證。保留舊 PNG／JPEG；不改 Secrets、不使用 Storage、不啟用 Realtime。只有 staging metadata 入庫不需要這份 WebP Migration。
6. 子群組正式可選功能依第 4 節另開發／審核；YouTubers 至少 15 位可抽題後，再另批准啟用該分類。最後另批准新 QA Host 的各組 15 題雲端驗收，不重置既有歷史。

本次不執行上述任何雲端操作，等待使用者審核。

## 8. 檔案與最終執行紀錄

| 檔案 | 用途 |
|---|---|
| `data/question-bank/test-bank-v3-scope.json`、`test-bank-v3-catalog.json` | 八組配置及帶 QID／來源的 180 位公開候選目錄 |
| `docs/phase8-test-bank-v3-candidates.md` | 逐人表格，供人工對照與名單審核 |
| `scripts/prepare-test-bank-v3.mjs`、`scripts/lib/test-bank-v3.mjs` | 公開來源盤點、舊運動員證據重用、驗證及統計 |
| `scripts/seed-test-bank-v3.mjs`、`scripts/lib/test-bank-v3-seed.mjs` | 無網路的 Dry Run、去重、單交易待審 Seed／回滾 SQL |
| `scripts/check-test-bank-v3.mjs`、`scripts/test-bank-v3.node-test.mjs` | 真實 30 張圖片檢查、180 位本機實跑與 12 項 v3 回歸測試 |
| 兩份 `2026102416*` Migration 草案 | inactive YouTubers 分類及私有 pending staging 表 |
| `supabase/tests/snapshot_test_bank_v3*.sql`、`verify_test_bank_v3_staging.sql` | 待批准的唯讀快照／匯入驗證計畫；驗證 SQL 已在本機執行 |
| `package.json`、`AGENTS.md`、兩份 README | 測試入口、最新範圍與安全規範；不改正式遊戲流程 |

最終實際結果：

- `npm test`：**306 PASS、0 FAIL**（Vitest 101 + Node 測試 205，包含 v3 的 12 項；不是額外再加 12）。Edge TypeScript 檢查 PASS。
- `npm run build`：**PASS**，含前端 TypeScript，Vite 117 modules。
- 瀏覽器：**30 PASS**（Chrome 155.0.8059.85；23 項隔離遊戲流程 + 7 項真實待審 Curry WebP／合成身分的照片及署名顯示）。既有答案隔離仍通過，不代表這 180 位均已完成真人圖片或 15 題驗收。
- 本機引擎：Node 22.23.4、PGlite 0.5.11／PostgreSQL 18.6；既有文件記錄 Cloud 為 PostgreSQL 17.11，本次未重查雲端版本。PGlite 不是 Supabase 平台／多連線 Cloud 測試。
- 真實 manifest 實跑：180 pending → 重跑仍 180 → rollback 0；30 WebP 均通過解碼／digest。CLI 使用明確標為 `LOCAL_ISOLATED_EMPTY_PGLITE_NOT_CLOUD` 的快照也可產出待審 SQL，**不是 Cloud Dry Run PASS**。
- `git diff --check`：PASS；`.env.local`、prepared JSON／SQL／圖片均 ignored，沒有被追蹤。工作樹／Git 歷史安全掃描未發現 Secret／Service Role JWT／Access Token／含密碼連線字串；`.env.example` 仍僅 placeholder。
- Phase 4／5／6 已部署 Migration 的 SHA-256 均與已記錄值相同，沒有更動既有 SQL。沒有新增 Secret、Storage、Edge 部署或遠端業務異動。

工具輸出：`prepared/test-bank-v3-20261024-reviewed-scope/summary.json`、`local-seed-qa/receipt.json`、`prepared/test-bank-v3-20261024-dry-run/dry-run.json`；均 ignored。瀏覽器收據在 `/tmp/guess-who-v3-game-browser/` 與 `/tmp/guess-who-final-review-photo-browser/`，不是正式資料。

**最終判定：候選／本機 Seed READY；正式可玩 v3 題庫與 Cloud Import NOT READY，等待圖片審核、唯讀去重及後續限定批准。**
