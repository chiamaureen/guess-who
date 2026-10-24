# Phase 8 v3 — Supabase Cloud 唯讀盤點報告

## 1. 結論與授權範圍

盤點快照：**2026-10-24 23:14:07 Asia/Taipei（15:14:07 UTC）**。

- **唯讀盤點 PASS、180 位候選去重 PASS**。候選與現有正式人物匹配 **0**、待新增候選 **180**、重複／同名衝突／缺少可靠識別碼 **0**。不是 180 位已核准題目。
- **目前 Cloud 無法開始新的完整 15 題遊戲**：政治人物雖保留 15 位，但只有 **2 位人物 is_approved=true**；其他分類可抽題均 0。與先前驗收時狀態不同，不能再沿用「新 Host 可玩 15 題」的舊說明。
- **v3 八組各缺 15 位可抽題人物**；既有兩位美國政治人物不屬於台灣政治人物群組。
- **Cloud 不支援 WebP 題庫**：DB 仍只接受原 PNG CHECK，已部署圖片 API 也固定回傳 image/png。Repository 的本機 WebP 支援不等於已部署。
- 本次沒有套用 Migration、遠端 INSERT／UPDATE／DELETE／TRUNCATE、匯入、修改歷史、部署、Secrets 變更、Git Commit／Push 或網站發布。

## 2. 目標與正式 Schema

| 項目 | 實際結果 |
|---|---|
| Project Ref | `fgvajdnzrnptdjurhjfo` |
| Dashboard／CLI 實際 Project Name | `chiamaureen's Project`（不是文件中的友善名稱 guess-who；未更名） |
| 專案狀態／地區 | ACTIVE_HEALTHY／ap-northeast-1 |
| DB／Schema／PostgreSQL | postgres／public／17.11 |
| 主盤點交易 | transaction_read_only=on、repeatable read，最後 ROLLBACK |
| 已部署 Migration | `20261023060000`、`20261023093000`、`20261023120000` |
| 新分類／待審表 | youtubers 不存在；question_bank_candidates 不存在 |

先以本機 linked ref、Management API 的 projects list 與明確 `--project-ref` 三方核對目標。SQL 內的 projectRef 標籤本身不當作專案身分證明。

public 有 **11 張應用表**，均 ENABLE／FORCE RLS：categories、celebrities、celebrity_categories、game_image_assets、hosts、rooms、room_categories、room_players、room_questions、host_question_history、room_api_rate_limits。

另外讀取既有 Schema catalog：其範圍為原 10 張表（不含 game_image_assets），共 60 欄、66 限制、34 索引；私有圖片表的限制及權限由主盤點另外覆核。這是實際 catalog 盤點，未執行本機 Migration replay 或宣稱全面 drift comparison 通過。

- Browser 角色對上述原表僅有啟用分類所需的 categories SELECT；沒有非預期欄位 GRANT、PUBLIC table GRANT、public schema CREATE 或 public view。
- anon／authenticated 對 game_image_assets 均無 table／column SELECT；圖片表 RLS／FK／CHECK 均存在且 validated。
- 三個 game_engine 函式的 prosrc MD5 均與不可修改的 Phase 6 Migration 一致；SECURITY INVOKER、空 search_path、service_role-only EXECUTE，未向瀏覽器開放。
- public 的 `rls_auto_enable` 是先前已審核的平台 event trigger，來源摘要、擁有者、search_path 與 event trigger 條件仍符合既有 allowlist。其公開 EXECUTE 是已記錄的最小權限警告，不是本次新增；本次沒有修改它。
- catalog 的應用表未加入 supabase_realtime；Phase 7 草案沒有部署。

## 3. 原七分類實際數量

**可抽題定義**與雲端 Start Game SQL 一致：啟用分類、DISTINCT 人物、人物已核准，且至少一張已核准私有圖片。下表以「全新且沒有歷史的 Host／新房間」計算；既有 Host 還要扣除自己的 C 模式歷史，不能把任何 Host 用過的人物全域排除。

| 分類 | 啟用 | 實際人物 | 人物已核准 | 新 Host 可抽題 | 距分類 15 題缺口 |
|---|---|---:|---:|---:|---:|
| actors | 是 | 0 | 0 | 0 | 15 |
| singers | 是 | 0 | 0 | 0 | 15 |
| athletes | 是 | 0 | 0 | 0 | 15 |
| politicians | 是 | 15 | 2 | 2 | 13 |
| scientists | 是 | 0 | 0 | 0 | 15 |
| historical-figures | 是 | 0 | 0 | 0 | 15 |
| animated-characters | 是 | 0 | 0 | 0 | 15 |

所有 15 張現存圖片均仍 approved，且通過雲端 PNG 結構驗證；**13 位人物未核准**才是目前只有 2 位可用的原因。這不是圖片遺失，也不是 C 模式把所有 Host 的人物一起耗盡。本次沒有查明誰／何時改過核准狀態，不推測原因，也不自行恢復旗標。

### 特別指定的 Q76／Q22686

| Wikidata | 人物 | 存在 | 人物核准 | 私有圖片 | 目前條件 |
|---|---|---|---|---|---|
| Q76 | 巴拉克·歐巴馬 | 是 | true | 1 張 approved、有效 PNG | 新 Host 可抽；既有 Host 仍受自己歷史限制 |
| Q22686 | 唐納·川普 | 是 | true | 1 張 approved、有效 PNG | 新 Host 可抽；既有 Host 仍受自己歷史限制 |

其餘保留的 13 位：哈利·杜魯門、詹姆斯·布坎南、喬治·沃克·布希、喬治·赫伯特·沃克·布希、尤利西斯·格蘭特、威廉·霍華德·塔夫脫、亞伯拉罕·林肯、傑拉德·福特、理查·尼克森、林登·詹森、約翰·甘迺迪、德懷特·艾森豪、隆納·雷根；目前皆人物 is_approved=false，各自仍有一張 approved 私有 PNG。

## 4. 私有圖片與可重用數量

| 範圍 | 實際數量／狀態 |
|---|---|
| Cloud 私有圖片 | 15 張，全為 PNG，共 1,772,134 bytes |
| Cloud JPEG／WebP／未知格式 | 0／0／0 |
| 圖片已核准／有效 legacy PNG | 15／15 |
| 圖片無人物 FK 對應 | 0 |
| 現有人物缺 QID／重複 QID | 0／0 |
| 現有人物作者／來源／授權／署名欄位完整 | 15（欄位完整不等於本次重新做了法律審核） |
| 可直接重用到 v3 名單的 Cloud 圖片 | **0**，沒有同一人物匹配；不可把舊人物照片配給新人物 |
| 可沿用的本機運動員 WebP | **30**，技術準備可重用、權利審核仍 PENDING，未上雲 |

本次不下載私有圖片內容，不取姓名與 game image ID 的公開映射，不呼叫任何可能更新限流表的遊戲 Edge API。Cloud 圖片格式由 bytea 的 magic header 分類、以既有純驗證 helper 檢查 PNG 結構；這不是新的瀏覽器解碼／圖片 API 動態驗收。

## 5. 180 位候選與正式人物比對

| 比對項目 | 數量 |
|---|---:|
| 唯一候選／QID／穩定 ID | 180／180／180 |
| 已存在，同 QID 可重用人物 | 0 |
| 尚不存在，待新增候選 | 180 |
| 候選內重複 QID／ID／正規化姓名 | 0／0／0 |
| Cloud 正式人物重複 QID | 0 |
| 同名但 QID 不同的識別衝突 | 0 |
| 缺少 QID／可靠識別碼 | 0 |
| 已存在 staging rows | 0，待審表本身尚不存在 |

以 QID 精確比對，並將中文／原文名進行 NFKC、大小寫及空白／標點正規化作衝突預警，不以同名直接合併。QID 齊全不代表逐張照片本人／身分審核已完成。

**待新增的就是原名單全部 180 位，沒有例外；已存在、重複、識別碼不足三份名單均為空。** 詳見 [Cloud 去重逐人表](phase8-test-bank-v3-cloud-matches.md)，列出每位姓名、群組、QID 與比對結果；原始來源見 [v3 候選表](phase8-test-bank-v3-candidates.md)。

真實 Cloud 快照已輸入原 Seed 工具，離線 Dry Run 得到 `READY_FOR_LOCAL_SQL_REVIEW`：**pending staging 預計 180 列、重用既有人物 0、正式人物／圖片／正式分類關聯新增均 0**。沒有 `--emit-sql`、沒有執行 Seed，這不是 `supabase db push --dry-run` 或遠端匯入驗證。

## 6. 八個群組的 15 題缺口

此處只計算指定 v3 名單中的人物，不能把政治人物主分類的兩位美國人物計入「台灣政治人物」。

| 群組 | 候選 | 原始圖片候選 | 缺圖片網址 | 已有本機 WebP | 本組 Cloud 可抽 | 距 15 題缺口 |
|---|---:|---:|---:|---:|---:|---:|
| 國外演員 | 15 | 15 | 0 | 0 | 0 | 15 |
| 台灣演員 | 15 | 15 | 0 | 0 | 0 | 15 |
| 英語歌手 | 30 | 30 | 0 | 0 | 0 | 15 |
| 台灣歌手 | 30 | 29 | 1 | 0 | 0 | 15 |
| 運動員 | 30 | 30 | 0 | 30 | 0 | 15 |
| 台灣政治人物 | 15 | 15 | 0 | 0 | 0 | 15 |
| 台灣 YouTuber | 15 | 13 | 2 | 0 | 0 | 15 |
| 動畫人物 | 30 | 4 | 26 | 0 | 0 | 15 |
| **合計** | **180** | **151** | **29** | **30** | **0** | **120** |

- 新題庫核准 **0**；151 位有圖片候選但仍待人物／授權／署名及呈現方式審核，29 位尚缺圖片候選，**共 180 位尚未達到最終圖片核准**。
- 缺圖真人：鄭宜農、黃大謙、愛莉莎莎；另 26 位動畫角色缺圖。
- 動畫已有 4 個 Commons 來源候選也未核准，含 2 個 SVG。不能把搜尋結果、維基展示、PD／CC 標籤或自行轉檔當成底層角色使用權已確認；不能為湊人數強行啟用。
- Commons 外部再利用仍須核對各檔案條件、作者及修改／署名要求，Commons 不保證每個檔案的權利標示。參考 [Commons 再利用說明](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) 與[衍生作品指引](https://commons.wikimedia.org/wiki/Commons:Derivative_works/en)。本次沒有重新決定任何圖片的授權狀態。

另外，正式前端／Room API／Game Engine **尚無可獨立選擇國外／台灣演員、英語／台灣歌手的群組篩選**。即使先補齊圖片，只有主分類仍不能宣稱通過單群組抽題驗收。

## 7. Cloud WebP 支援核對

不是根據本機檔案推測：已唯讀下載 ACTIVE `game-engine` **version 1** 到 ignored 隔離目錄，沒有覆蓋 Repository 的 Function。

| 層級 | Cloud 實際狀態 |
|---|---|
| DB CHECK | `game_image_assets_png_check` → `game_engine_png_valid(png)`，validated |
| WebP／通用格式 helper | game_engine_webp_valid／game_engine_image_valid 均不存在 |
| game_engine_action／state／PNG helper | 來源 MD5 全部符合原 Phase 6 Migration |
| 已部署 get-question-image | Content-Type 固定 image/png、檔名固定 photo.png |
| Realtime／WebP 新 Migration | 沒有出現在 Migration history |
| 本機 WebP 草案與程式 | 存在且有先前本機驗證，但未部署 |

因此 **Cloud WebP NOT READY**。僅改圖片副檔名或先塞 WebP bytes 會違反現有 CHECK，亦不能先把 PNG API 冒稱支援 WebP。舊 PNG 可維持原樣；未揭曉 Player 的答案／來源過濾仍是原 SQL 與 Edge DTO，不能為授權署名資訊而提前暴露姓名。

此次只靜態覆核已部署源碼與權限，沒有使用 Host／Player 憑證執行新一輪動態答案隔離或 15 題 Cloud 遊戲，避免超出唯讀範圍及更新限流表。

## 8. 新分類、待審表與後續順序

### 必要性

- **youtubers：需要**。不應混入 scientists；新增 inactive 分類可保留原七分類與其資料。草案 `20261024160000_add_youtubers_category.sql` 仍未部署，最多新增 1 列。
- **私有待審表：有條件需要**。若要把完整 180 位（含缺圖者）放進 Cloud 供審核，`question_bank_candidates` 是最小且安全的分流；現有 celebrities 的五項圖片／來源欄位皆 NOT NULL，不能填假素材、假作者或假授權。草案 `20261024161000_test_bank_candidates.sql` 強制 pending／approved=false、RLS 與瀏覽器拒讀，預計 180 列。
- 若只求最快可玩，不一定要先把 180 位 pending 上雲；可繼續本機審核，之後僅匯入合格批次。待審表入庫本身不增加可抽題數。
- **獨立群組篩選仍需要另行開發與批准**：沿用 v3 方案的群組／人物群組／房間群組關聯及伺服器候選條件，主分類與 C 模式保持不變；目前只是方案，沒有悄悄建立這三表。

### 建議執行次序（全部尚未執行）

1. 審閱本次數據，決定是否先上 Cloud 待審清單；若要，另批准前述兩份草案，僅移入批准的 Migration，檢查 history／dry-run，不能夾帶 WebP 或 Phase 7。
2. 寫入前重新取得新快照（Seed 工具要求 24 小時內），審核確切 180-row pending SQL／SHA／交易與回滾，再另批准執行。維持正式人物、圖片及歷史不變；匯入後唯讀驗證 pending 計數與 RLS。
3. 並行完成首批每組 15 位照片本人、作者、來源、授權版本、修改紀錄、署名及揭曉前資訊安全審核；不能直接切 approved。圖片合格後才形成正式匯入 manifest。
4. 另審／批准 WebP 草案 `20261024120000_game_image_formats.sql`，保留舊 PNG／JPEG 相容與限制；部署僅 WebP 相容的 game-engine 更新，確認受控 MIME、答案與來源隔離。不得順帶部署 room-system 的 Phase 7 功能或新 Secrets。
5. 完成並另審群組篩選的最小 Schema／Room API／Game Engine／UI，確保群組條件在 DB Transaction 中套用 DISTINCT 與 Host 歷史。YouTubers 至少 15 位合格後，再另批准啟用分類。
6. 另批准相容前端發布及正式已核准圖片匯入。以首批八組各 15 位計，當前零重用，最低 **120 celebrities + 120 celebrity_categories + 120 game_image_assets = 360 列**；群組關聯與分類列另計，不是本次寫入授權，也不代表已備妥這 360 列。
7. 唯讀覆核 DB／圖片／授權與 Browser 拒讀，再另批准新的匿名 QA Host／Player 各群組 15 題測試；不用舊 Host 的既有歷史做捷徑，不重置或刪除任何人的歷史。

### 最快達到八組各 15 題的方法

先做 **120 位合格子集**，不必等待全 180 位都補圖：運動員優先重用 30 張已轉檔素材並挑 15 張權利最明確者；英語歌手與台灣歌手從 30／29 個來源候選先選 15 位。兩組演員、台灣政治人物與 YouTuber 都只有 15 個人，需全數合格或取得批准後替換候選，YouTuber 至少補兩張照片。

**動畫是最難保證時程的阻擋**：4 個網址尚無本專案核准結論，仍需至少 15 位有確認權利的角色圖；可取得權利人允許，或另批准改成使用權可確認的角色／具體版本，不能假設描圖、粉絲圖或官方角色圖自然可用。在此之前可以先驗收真人群組，但不能宣稱八組都達標。

原政治人物主分類目前只差 13 位即可恢復分類 15 題容量，但這不等於台灣政治人物群組達標；更不能未經批准重新核准舊 13 位。

## 9. 執行紀錄與驗證邊界

實際執行的 Cloud 動作僅以下讀取：

```sh
npx --no-install supabase projects list --output json
npx --no-install supabase db query --linked \
  --project-ref fgvajdnzrnptdjurhjfo \
  --file supabase/tests/inventory_test_bank_v3.sql --output json
npx --no-install supabase db query --linked \
  --project-ref fgvajdnzrnptdjurhjfo \
  --file supabase/tests/schema_catalog.sql --output json
npx --no-install supabase functions list --project-ref fgvajdnzrnptdjurhjfo --output json
npx --no-install supabase functions download game-engine \
  --project-ref fgvajdnzrnptdjurhjfo --use-api \
  --workdir data/question-bank/prepared/test-bank-v3-cloud-inventory-20261024/edge-download
```

functions download 僅在本機 ignored 目錄寫入下載的程式碼，沒有遠端 deploy。查詢不取得 Token、憑證 Hash、Database Password 或 Secret，不匯出原始圖片 bytes；不查詢 Host 身分／Session／房間內容。函式源碼 MD5 僅用來核對已部署程式，並非使用者憑證。

| 驗證 | 本次結果 |
|---|---|
| Project／Schema／數量／RLS／圖片格式盤點 | PASS，實際 Cloud 回應 |
| 180 候選 QID＋姓名去重／私有圖片對應 | PASS，既有匹配 0；不產生新核准 |
| Seed 使用真實 Cloud 快照的離線 Dry Run | PASS，預計待審 180；沒有執行 SQL |
| WebP 是否已上雲 | 已確認 **否**，不是查證失敗 |
| 新八組可完成 15 題 | NOT READY，皆缺 15 位合格人物，另缺群組功能 |
| Vitest | 101 PASS、0 FAIL |
| 前端 TypeScript／Build | PASS，117 modules |
| Migration replay／Cloud 遊戲／瀏覽器重驗 | 未執行，本次只盤點且未改應用程式；先前 306 自動化／30 瀏覽器 PASS 是歷史本機紀錄，不冒稱本次重跑 |

Git 安全覆核：`git diff --check` PASS；`.env.local` 未追蹤，原始盤點、下載 Function 及 prepared 產物均 ignored。工作樹與 Git 歷史掃描沒有發現 Secret Key、Service Role JWT、Access Token、含密碼連線字串或被追蹤的敏感 env；三份已部署 Migration 的 SHA-256 均與既有紀錄相同。沒有替使用者 Commit／Push。

原始回應、下載源碼、cloud-snapshot.json、candidate-matches.json、summary.json 均在 ignored `data/question-bank/prepared/test-bank-v3-cloud-inventory-20261024/`。Seed Dry Run 在 ignored `prepared/test-bank-v3-cloud-dry-run-20261024/dry-run.json`。這些不是可公開發布的遊戲映射，也不進 dist／Git。

**盤點完成；Cloud 變更仍未授權。等待下一次對明確 Migration、待審 Seed 或已核准圖片批次的獨立批准。**
