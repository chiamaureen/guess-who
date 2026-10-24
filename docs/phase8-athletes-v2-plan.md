# Phase 8 — 運動員題庫 v2 審核與變更預覽

> 最新需求改為 PostgreSQL 私有 WebP，取代 link-only 準備意向。見 [WebP 驗收](phase8-webp-acceptance.md) 與 [124 位盤點](phase8-athletes-image-inventory.md)；目前 0 位完整核准，沒有停用政治人物或匯入運動員。

2026-10-24（Asia/Taipei）。**候選整理已完成第一輪；匯入／切換抽題池仍 BLOCKED。** 本次題庫工作僅公開來源查詢、Cloud 唯讀盤點及本機產物，沒有匯入或停用任何人物。另依使用者單獨要求結束 E9YAU3 的操作不屬於題庫異動。

**後續更新：** 已建立[本機逐張圖片審核工具](phase8-athletes-image-review.md)，四項既有箭頭測試已修復，完整 275 項自動化與 13 組隔離瀏覽器檢查通過。真實題庫仍為 0 APPROVED；圖片可用性檢查在第 16 張遇 429 停止。下方四項箭頭失敗為本輪原始歷史結果，最新以審核工具報告為準。

## 最新決定：圖片只存連結

- 依使用者最新要求，新運動員批次**不將圖片二進位資料寫入 PostgreSQL**，不新增 `game_image_assets`，不使用 Storage。
- 先保留原始圖片 URL、來源頁、作者、授權、審核狀態與來源 SHA-1／版本線索；目前均在本機候選檔，尚未寫入 Cloud。
- 未來經逐項審核及另行批准，可沿用 `celebrities.image_url`、`image_source`、`image_author`、`image_license`、`image_attribution` 存連結 Metadata，並新增 athletes 關聯。草稿必須 `is_approved=false`，不因有 URL 就允許出題。
- 不刪除既有 15 張政治人物私有圖片、不改 Migration／RPC／RLS／GRANT／Secrets／Functions。
- **相容性阻斷：** 已部署 Game Engine 抽題要求 approved `game_image_assets`，且 `room_questions.game_image_id` 固定私有圖片。只有 URL 的新人物目前不能出題。因此暫不停用唯一可玩的政治人物題庫，也不宣稱運動員 MVP 已可玩。
- 後續若要以連結實際遊玩，須另審查受保護的圖片代理／狀態 DTO 與必要增量變更。不得直接把含姓名的 Commons URL／檔名交給未揭曉的 Player。外部下載需來源白名單、SSRF／重新導向限制、大小／超時／型別／Metadata 防護、來源完整性與失效處理；本次沒有提前實作或部署。
- 只存連結**不代表已取得使用權**，仍需逐張核對實際呈現方式與署名要求；不能把原本必須署名的照片改標 Public domain。

## 1. 舊政治人物影響分析

目標 Project 已核對：`fgvajdnzrnptdjurhjfo`。使用 `supabase/tests/review_athlete_bank_v2.sql`，整份 `BEGIN READ ONLY`／`ROLLBACK`，未查詢憑證、Token Hash、圖片內容或題目 UUID 對應。

| 唯讀快照 | 數量 |
| --- | ---: |
| categories（均啟用） | 7 |
| celebrities／分類關聯／私有圖片 | 各 15 |
| politicians 人物 | 15 |
| 同時屬其他分類的政治人物 | 0 |
| 可用 athletes | 0 |
| rooms／room_questions／host_question_history | 11／24／21 |
| playing 房間 | 0，E9YAU3 已依另行指示結束；不是永久保證 |

七分類保持 actors、singers、athletes、politicians、scientists、historical-figures、animated-characters；不刪政治人物分類。

| Wikidata | 現有政治人物 | 分類 |
| --- | --- | --- |
| Q11613 | 哈利·杜魯門 | politicians |
| Q12325 | 詹姆斯·布坎南 | politicians |
| Q207 | 喬治·沃克·布希 | politicians |
| Q22686 | 唐納·川普 | politicians |
| Q23505 | 喬治·赫伯特·沃克·布希 | politicians |
| Q34836 | 尤利西斯·格蘭特 | politicians |
| Q35648 | 威廉·霍華德·塔夫脫 | politicians |
| Q76 | 巴拉克·歐巴馬 | politicians |
| Q91 | 亞伯拉罕·林肯 | politicians |
| Q9582 | 傑拉德·福特 | politicians |
| Q9588 | 理查·尼克森 | politicians |
| Q9640 | 林登·詹森 | politicians |
| Q9696 | 約翰·甘迺迪 | politicians |
| Q9916 | 德懷特·艾森豪 | politicians |
| Q9960 | 隆納·雷根 | politicians |

預定退出抽題池方式：只對上述精確 QID 使用既有 `celebrities.is_approved=false`，**目前未執行**。此欄為全域停用；任何人物若新增其他分類，須停止並重新審核，不能影響其他分類。

FK 影響：`room_questions`、`host_question_history`、`game_image_assets` 對人物為 RESTRICT；題目對人物分類關聯及圖片／人物組合亦為 RESTRICT。刪除 `rooms` 則 CASCADE 玩家、房間分類與題目，不符合保留歷史的要求。故不採實體刪除、刪關聯或 TRUNCATE，也不產生此類清除 SQL。停用人物不會移除既有題目、原圖或 C 模式歷史。

## 2. 新人物候選與資格核對

完整逐人名單、候選 QID、圖片來源、作者、授權及 pending 狀態見 [候選／圖片登錄表](phase8-athletes-v2-candidates.md)。它是候選，不是最終正確身分或授權保證。

| 組別 | 具名候選 | 有尚未核准圖片候選 | 缺圖片候選 |
| --- | ---: | ---: | ---: |
| NBA Instagram 前 35，僅限現役 | 35 | 34 | 1 |
| 2026 U23 世界盃台灣正選候選 | 24 | 0 | 24 |
| 台灣正式奧運獎牌選手候選 | 65 | 35 | 30 |
| 合計 | **124** | **69** | **55** |

- NBA：[第三方排行榜](https://www.popularbasketballers.com/) 及其公開 JSON 快照。精確值第 35 Jordan Clarkson 2,141,513、第 36 Zach LaVine 2,138,006，並非四捨五入後任意選人。仍須人工核對 [NBA 現役名單](https://www.nba.com/players) 與 Instagram 帳號／數字；官方名單本機 HTTP 403，不能宣稱現役資格與追蹤數已完整認證。沒有把已退役球員自動納入。
- U23：採 [CNA 10/23 正選 24 人](https://www.cna.com.tw/news/aspt/202610230188.aspx)，與[另一報導](https://sports.ltn.com.tw/news/breakingnews/5616556) 對照；不是早期 26 人培訓名單。棒協原始公告連線受阻，正式名冊仍待原始公告核對。吳瑞璁／吳瑞聰寫法有衝突；林柏佑禁止誤配 1986 年出生的同名球員。吳丞顥／吳承皓保留為不同人。不得以同名新聞照片補齊。
- 奧運：[奧運人協會名單](https://olympians.tw/athlete/) 篩選正式金／銀／銅、排除示範賽，74 筆列紀錄去重後 **65 人**，包含 1992 棒球 20 位選手，並非把團體只算一人。跨屆不重建人物。以 [國訓中心成績](https://web.nstc.org.tw/Athletics/Home/Article/b56e0452-4697-49cc-8583-cc82a643b0b3) 補充核對；協會資料有陳葦綾年份、2004 男團射箭獎牌色別等錯誤，需逐項確認，不將錯誤照搬為已驗證獎牌明細。冬奧完整性亦待核對；排除青年奧運、帕運及教練。

## 3. 圖片候選與授權

- Google Images 實際嘗試 LeBron James，HTTP 200 卻是機器人驗證頁，**BLOCKED_CAPTCHA**；已檢查保存頁面，不繞過驗證、不把 Google 縮圖當原始來源。其餘人物標記未嘗試／待人工確認 Google 第一筆。Commons 候選不冒稱 Google 第一筆。
- 已唯讀取得 Wikipedia／Wikidata P18 與 Commons 官方 Imageinfo，並為缺 P18 者查詢替代素材。101 位有候選 QID，23 位尚未安全對應；已對應的 QID 沒有跨組重複，但這不等於全部身分已驗證。
- 第一輪搜尋出 96 筆帶來源 Metadata 的結果；排除 27 筆 PDF／同名演員／不同人物／銅像等明顯不適合的結果，保留 69 筆**待審**圖片候選。排除依據與原始授權保留在 `rejectedImageCandidates`，沒有因 Public domain 就把文件或錯人當照片。
- 69 筆候選 Metadata：CC BY 2.0 ×24、CC BY-SA 4.0 ×15、CC BY-SA 2.0 ×13、CC BY 4.0 ×1、CC BY-SA 3.0 ×9、CC BY-SA 2.5 ×1、Attribution ×4、Public domain ×1、CC0 ×1。尚需原始聲明、署名時機、正確人物與視覺檢查，**不是 69 張已取得完整許可**。
- Public domain 楊傳廣候選來自 [1960 年 UCLA 年鑑](https://commons.wikimedia.org/wiki/File:C_K_Yang_-_Southern_Campus_1960_crop.jpg)，頁面涉及美國未續展聲明，不能擴張為全球權利保證；譚雅婷候選 Metadata 為 CC0，亦尚未完成逐張視覺審核。
- 現有舊 PNG 匯入器只接受 PD／CC0，不能拿它匯入本次 link-only 批次。BY／BY-SA 不代表一概不能用，但現有畫面揭曉後才提供作者／來源，必須先審查實際呈現是否滿足授權，不偷偷放寬舊 guard。
- **可直接匯入：0 人。** 55 人尚缺合適候選；所有 124 人仍缺完整圖片／身分核准。缺候選是本輪查詢結果，不代表網路上絕無照片。未下載、轉檔或產生本次正式圖片二進位資產。

## 4. 本機資料、去重與變更預覽

```text
data/question-bank/athletes-v2-scope.json                 可版控：來源範圍／名單／排除規則
data/question-bank/prepared/athletes-v2-review-20261024/   ignored、owner-only
  candidates-links-pending.json                          完整 URL／作者／授權／review flags
  summary-links-pending.json                             數量及 manifest SHA-256
  change-preview-links.json                              雲端異動預覽，非可執行 SQL
```

所有候選 approved=false、subject／rights／image=false。人物只連到既有 athletes；NFC 同名歧義須人工確認，只有相同且已驗證的 QID 才能合併跨名單，保留多來源證據。不同 QID 不因拼音相似而合併，既有 QID 衝突直接阻擋，不 UPSERT。

| 表／操作 | 目前可執行 | 全部候選通過後的理論上限（非批准批次） |
| --- | ---: | ---: |
| celebrities INSERT（URL Metadata 草稿） | 0 | 124 |
| celebrity_categories INSERT（athletes） | 0 | 124 |
| game_image_assets INSERT | **0** | **0** |
| 舊 politicians approved→false | 0 | 15，須引擎支援 URL 且新池可玩後另批准 |
| categories／rooms／questions／history／既有圖片 | 0 | 0 |

連結 Metadata 最多新增 248 列；日後另行核准停用舊人物最多再 UPDATE 15 列。**不是目前可部署 263 列**，新名單或去重結果變更須重算。本次未產生執行用 mutation SQL；現有 `prepare-question-import.mjs` 不修改、不執行。

## 5. 可回滾匯入與停用計畫（尚未執行）

1. 補齊原始名單、Google 第一筆紀錄、逐張授權／人物／可用性，產出具名審核及精確 QID／URL／來源摘要；未通過者不納入。網址名稱不得在 Player DTO／圖片回應標頭暴露。
2. 先完成 link-only 引擎支援的獨立審查，或僅批准新增 `is_approved=false` 的非遊戲草稿。不得將舊 PNG 匯入器換成缺圖也 approved=true。
3. 雲端寫入另取得精確人數、SQL SHA-256 與範圍批准。匯入以單一 PostgreSQL 交易純 INSERT 人物 Metadata 與 athletes 關聯，確認七分類快照及 QID 未存在；唯一鍵保護併發重跑，任一錯誤整批 ROLLBACK，不覆寫既有資料。
4. 目前不包含舊人物停用；待 URL 圖片流程與至少 15 位合格可玩人物驗收後，再批准切換。切換前重讀政治人物精確集合與跨分類狀態，選擇安全遊戲邊界；不為此關閉其他房間。若發現新遊戲／資料漂移，停止，不忽略或刪除。
5. 匯入後以批次 receipt 的精確人物 QID／UUID、連結、關聯數核對；新增 `game_image_assets` 必須為 0。`verify_athlete_links_v2.sql` 只是補充 Metadata／七分類／舊人物保留檢查，**不能代替精確批次 verifier，也不代表可開始遊戲**。再執行既有 `verify_question_bank_access.sql` 確認舊私表仍不可由 browser 讀取。
6. 切換後另查政治人物抽題池為 0、新運動員至少 15 位、原題目／歷史／原圖與七分類保留，並驗 Player 未揭曉答案隔離；這些測試本次未執行。
7. 提交前錯誤用 ROLLBACK。提交後若有問題，只能依收據與新批准反向停用本批、恢復先前已核准且未被另行修改的舊 approved 狀態；不得刪除已被遊戲引用的新人、新題或 C 模式歷史。必須保留當前值／updated_at 等漂移保護，不預先準備無條件 DELETE。

## 6. 本機檢查與限制

- 新工具只抓公開 Metadata／產生本機 preview，無 Supabase Client、CLI mutation、UPDATE／DELETE／Storage 上傳路徑。
- 題庫原始 URL 與作者紀錄在 ignored prepared；不進 src／public／dist。公開候選表不含實際遊戲 UUID→答案映射。Google 驗證畫面含連線資訊，僅本機保留、不提交。
- 所有已部署 Migration 不變；沒有 Cloud 題庫匯入、停用、權限／Secrets／Function 變更、Git Commit／Push／Pages 發布。
- 需要安全的手動 Google 搜尋紀錄、棒協原始公告、現役 NBA／Instagram 核對，以及 U23 等缺圖人物的明確可用照片／權利證據。不得為了湊 15 人自動核准。

| 檢查 | 實際結果 |
| --- | --- |
| 新運動員候選／link-only／拒絕錯人與 PDF／唯讀 SQL 測試 | **PASS，15／15**；含 PGlite 真正執行 Metadata verifier |
| 既有與新增 Node suites 分開執行 | **PASS，154／154**（Health 21、DB 37、Rooms 27、Game 26、Realtime 18、題庫與圖片 25） |
| `npm test` | **FAIL**，最先執行的 Vitest 93 PASS／4 FAIL；因 `&&` 停止，其餘 suites 已如上獨立跑完 |
| 四項既有 UI 失敗 | `ArrowUpRight.test.tsx` 三項、`pages.test.tsx` 一項仍期待 VS15 文字，但目前 HEAD `23553ed` 已改 SVG；本次沒有修改元件或這兩份測試，不藉題庫任務覆蓋使用者的 SVG 決定 |
| 整體自動化（合併上述實際執行、不重算重跑項目） | **247 PASS／4 FAIL，共 251 項**，不宣稱全部回歸通過 |
| 前端 TypeScript／`npm run build` | **PASS**，Vite 116 modules |
| Edge TypeScript | **PASS**，`npm run check:edge` |
| lint | **NOT CONFIGURED**，沒有 lint script |
| Git／敏感檔檢查 | **PASS**，diff --check；env 與 prepared 被忽略；工作目錄含未追蹤檔及歷史 Blob 掃描未發現 Secret／DB URI 密碼／Service Role JWT／CLI Token；dist 未發現題庫候選內容 |
| 已部署三份 Migration SHA-256 | **PASS**，與 AGENTS 基準一致，無改寫 |
| Cloud 題庫匯入／連結實際出題／完整來源人工核驗 | **NOT EXECUTED／BLOCKED**，不能以本機測試或有圖片連結代替 |

最終 link-only pending manifest SHA-256：`0fe6c846b6bf691d13f45f958eaf99ace22b5b82abc75c9e3a597e03a3b60911`。沒有可批准執行的匯入 SQL。

紀錄：`/tmp/guess-who-athletes-v2-specific.log`、`/tmp/guess-who-athletes-v2-tests-final.log`、`/tmp/guess-who-athletes-v2-regression.log`、`/tmp/guess-who-athletes-v2-build-final.log`。

**結論：題庫候選與 link-only 變更計畫已備妥供審閱；Cloud 匯入／取代舊題庫 NOT READY。** 下一步是補來源／授權與缺圖、審核 link-only 引擎支援範圍，而不是批准這 124 人直接成為可玩題庫。
