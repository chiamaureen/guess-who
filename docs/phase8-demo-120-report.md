# Phase 8 v3 — 120 位快速測試題庫準備報告

日期：2026-10-24。本次僅本機準備、公開 Commons 來源查詢及隔離測試，沒有 Supabase Cloud 查詢／寫入或部署，亦未 Commit／Push。

## 1. 結論

**第一批 120 位候選與 Seed 工具 READY；八組正式試玩與 READY FOR CLOUD IMPORT：NOT READY。**

已從原 180 位選出每組 15 位，沒有虛構／新增名單外人物；其餘 60 位完整保留。圖片網址候選 107、缺圖 13；76 張最終 WebP 通過技術檢查，但只有 **2 位完成工程來源、圖片與使用情境審核**。不能把其他圖片直接 approved。

完整第一批與第二批名單：[Demo120 候選表](phase8-demo-120-candidates.md)。穩定選擇設定：`data/question-bank/test-bank-v3-demo-scope.json`，不修改原 180 位 scope／catalog／QID。

## 2. 八組實際狀態

| 群組 | 第一批 | 圖片網址候選 | 技術合格 WebP | APPROVED／核准可用圖片 | 缺圖片網址 | 距單組15題缺口 |
|---|---:|---:|---:|---:|---:|---:|
| 國外演員 | 15 | 15 | 6 | 1 | 0 | 14 |
| 台灣演員 | 15 | 15 | 14 | 0 | 0 | 15 |
| 英語歌手 | 15 | 15 | 14 | 0 | 0 | 15 |
| 台灣歌手 | 15 | 15 | 15 | 0 | 0 | 15 |
| 運動員 | 15 | 15 | 15 | 1 | 0 | 14 |
| 台灣政治人物 | 15 | 15 | 1 | 0 | 0 | 15 |
| 台灣 YouTuber | 15 | 13 | 11 | 0 | 2 | 15 |
| 動畫人物 | 15 | 4 | 0 | 0 | 11 | 15 |
| **合計** | **120** | **107** | **76** | **2** | **13** | **118** |

APPROVED 是本機工程審核，不是使用者雲端匯入批准、真人／律師簽署或全球法律保證。所有 120 位在 Cloud 的可抽題數仍是上一份唯讀快照中的 **0**，本次沒有匯入這兩位。

### 選擇依據

- 原本只有 15 位的群組保留全部；不能因圖片不足替換成未經同意的新人物。
- 英語歌手優先常見單人照片與可追溯的 PD／CC 來源；台灣歌手先避開原本缺圖及僅標 Attribution 的候選。
- 運動員沿用 15 位既有人物／來源：14 份既有 WebP 原樣重用，譚雅婷另作 CC0 允許的明確裁切；保留其餘 15 位運動員第二批。
- 動畫組先列有 Commons 線索的四位，其餘保留高辨識度候選補足 15 位名單，**不代表其角色圖已獲准使用**。第二批其餘 15 位不刪除。

## 3. 圖片準備與審核證據

107 個有圖片的候選均保存 Commons 來源頁完整 wikitext、revision、查證時間；輸出 Metadata 保留作者、原始網址、授權聲明／條款、原始 notices、來源 SHA-1、下載 rendition SHA-256、轉檔 SHA-256 及修改紀錄。保存證據不是自動權利核准。

76 張最終引用 WebP 共 **5,356,716 bytes**：61 張新來源轉檔，加上 15 位沿用運動員素材（其中一張額外裁切）。逐張驗證：

- 真實 lossy VP8／image/webp，品質 82，不是改副檔名。
- 長邊不超過 1024px、不放大小圖、比例縮放，完整解碼與 DB WebP helper 均 PASS。
- EXIF／GPS／ICC／XMP／orientation 資訊不進輸出；匿名 UUID 檔名，不進 public／src／dist。
- 原始素材不改寫；輸入 32 MiB／40M pixels、安全下載網域及禁止 redirect 的限制不提高。
- Kyrie 使用已核對來源的既有官方 rendition WebP，不重新解碼超限原圖。
- 未符合初步來源／授權 gate 的 44 位沒有硬轉檔：缺圖 13、已有圖片但角色權利未明 4、自訂 Attribution 類型 16、另 11 位有額外權利警示。此為不重複的處理分組；蔡英文同時有 Attribution 與 personality 警示，不重複計人。

### 本次完成的兩位工程核准

| 人物 | 來源與權利依據 | 圖片／呈現處理 |
|---|---|---|
| 摩根·費里曼 | Commons 具名圖說與原始 DoD 攝影說明、PD-USGov-Military；攝影者 Alexander Kubitza／美國國防部 | 檢視最終單人主體照片，無答案文字；保留完整政府攝影來源及原始裁切資訊，Host／揭曉後提供來源 |
| 譚雅婷 | 既有 Wikidata 圖片映射、Commons 人物分類與 Voltmetro own-work CC0 聲明一致 | 裁除下方裝備可能暴露姓名的字樣；最終裁切 left150／top0／874×620，保留臉及上半身、不修臉，CC0／來源及修改紀錄完整保存 |

身分依據是具名來源紀錄與 QID／圖片映射，不是以臉部外觀進行生物辨識。兩張均實際檢視最終輸出，綁定圖片 SHA-256、來源 revision、審核者與日期。審核者照實記為 Codex 工程審核。譚雅婷裁切前父圖只作溯源保留，不會額外匯入成第二張題目圖片；首次超界裁切被 Sharp 拒絕且未寫出，修正範圍後已重新完整驗證。

兩位完整 manifest 在 ignored `prepared/demo-120-20261024/approved-subset.json`；其餘 118 位仍未核准，不能從 metadata-ready 自動晉級。

### 仍需處理的具體人物／來源

- **缺圖 13 位**：黃大謙、愛莉莎莎，以及哆啦A夢、皮卡丘、史迪奇、唐老鴨、史努比、凱蒂貓、野原新之助、蒙其·D·魯夫、漩渦鳴人、孫悟空（七龍珠）、艾莎。
- **動畫四張現有來源**：米老鼠、小熊維尼、海綿寶寶、派大星。兩個 SVG 不是直接可入庫的 WebP；PD／CC 或影片擷取標籤不自動解決角色、版本、商標及底層作品權利。15 位動畫人物都尚無本批核准。
- **僅標 Attribution，尚非本匯入器可接受的四種授權證據**：政治人物除馬英九以外的 14 位，以及陳孜昊（HowHow）、啾啾鞋。不能把政府開放資料／自訂聲明直接改標 CC BY；須核對原始條款或尋找相容替代圖。
- **額外 personality 警示保留、不抹除**：湯姆·克魯斯、布萊德·彼特、強尼·戴普、小勞勃·道尼、基努·李維、巨石強森、史嘉蕾·喬韓森、艾瑪·華森、茱莉亞·羅勃茲、張震、麥莉·希拉，另蔡英文亦有此警示。這是本工具的保守 gate，不是宣稱其 CC 授權失效；未標示者也不代表無肖像等其他權利。
- **可解碼但仍不應直接當題目**：珍妮佛·勞倫斯圖片可見名牌，標記 REJECT_CURRENT_IMAGE，人物本身仍 PENDING；陳綺貞與張惠妹的舞台照主體偏遠，需更清楚個人照片；陳柏霖有多個人物，需原圖圖說確認；小賈斯汀的原始說明描述總統出席活動，尚須明確完成 crop-to-person 溯源；柯震東來源有 LicenseReview 尚待外站聲明核對，不能因 PD 字樣直接核准。
- **其他 CC BY／BY-SA 待審**：作者、原始 notices、來源與條款已保存；但不能把「轉檔成功」或「頁面有 CC 模板」當成已逐張完成權利及署名時機審核。尚未解除 Host／揭曉後才提供 credits 的相容性關卡。

CC0 官方 deed／legalcode 以及 http 的同一官方條款網址可正規化為 HTTPS canonical URL，但保留原始證據；不接受假冒網域或把自訂 Attribution 改成 CC。參考 [CC0 條款](https://creativecommons.org/publicdomain/zero/1.0/legalcode.en)、[CC BY 4.0 條款](https://creativecommons.org/licenses/by/4.0/legalcode.en)、[Commons 再利用指引](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)。

## 4. Seed 流程與實際可匯入列數

### 待審候選 Seed（不是正式可玩題庫）

沿用原 `seed-test-bank-v3.mjs`，新增明確 selection 參數。仍先驗證完整 180 位，再只選第一批 120 個穩定 ID；要求八組各 15、無重複，60 位不刪除、不改審核。

```sh
nvm use
node scripts/seed-test-bank-v3.mjs --dry-run \
  --bank data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/candidates.json \
  --selection data/question-bank/test-bank-v3-demo-scope.json \
  --snapshot data/question-bank/prepared/test-bank-v3-cloud-inventory-20261024/cloud-snapshot.json \
  --out data/question-bank/prepared/new-demo-dry-run
```

本次實跑結果：120 pending staging 預計新增、重用 0，正式人物／關聯／圖片均 0。這份快照是先前已批准盤點的結果，不是本次再查 Cloud；須在 24 小時內使用且寫入前重查。未帶 `--emit-sql`，沒有執行任何 SQL。

### 正式已核准匯入

不另造一個會繞過審核的 importer。沿用 `prepare-question-import.mjs`，新增可選 `--idempotent` 與有護欄的 `rollback-import.sql`：

- 原預設模式仍在重複 QID 時拒絕；明確 idempotent 模式才會重用 **QID、姓名、類型、圖片 bytes SHA、來源／作者／授權／署名、分類及核准狀態全部一致**的資料。
- 差異、停用旗標或多張不一致的可用圖片皆拒絕，不使用 UPSERT 修補或重新啟用既有資料。重跑相同 SQL／重新產生等價批次皆不新增重複人物。
- 單一 Transaction、匯入表鎖及 timeout，任一失敗整批 Rollback；沒有部分啟用或修改其他房間／歷史。
- 回滾只針對該收據新建 UUID 且完整內容仍一致的列；重用到舊批次的資料不會被新收據回滾。
- 任一人物已被 room_questions 或 C 歷史使用、內容／審核已改變，即拒絕整批回滾；不刪遊戲／歷史、不 CASCADE。
- 增加 fictional_character 的獨立角色權利證據 gate，不再把所有匯入人物硬編為 real_person。原有 PNG／真人 manifest 相容。

未來完整合格批次才能執行本機準備：

```sh
node scripts/prepare-question-import.mjs PATH/TO/reviewed-bank.json --idempotent
```

**本次可正式匯入的完整批次：0；已產生正式匯入 SQL：0。** 部分核准只有 2 位，不足原匯入器 15 位門檻；已實際確認此 manifest 被拒絕，沒有降低門檻或補 13 位假核准。兩份合格圖片資料保留，待湊足真實合格批次。

如果未來 120 位全數合格，基本資料為 120 celebrities＋120 celebrity_categories＋120 game_image_assets＝360 列，群組關聯另計；現在沒有備妥或授權這 360 列。若先上待審表，則是 120 pending rows＋最多 1 個 inactive youtubers，不能當作可抽題增加 120 位。

## 5. 最小雲端部署計畫（只規劃，未執行）

Cloud 現況依上一份已完成的 [唯讀盤點](phase8-test-bank-v3-cloud-inventory.md)：Phase 4～6 三份 Migration、私有 PNG CHECK、game-engine v1 固定 image/png；七分類、政治人物 Q76／Q22686 兩位可抽題。**本次不接觸這些資料或 Secrets。**

1. **WebP 增量 Migration**：審核／另批准既有草案 `20261024120000_game_image_formats.sql`，新增 JPEG／WebP helper 並替換私有圖片 CHECK。沿用 png bytea 欄位，不搬 Storage、不改舊 Migration，不提高限制。
2. **YouTubers 分類**：另批准 `20261024160000_add_youtubers_category.sql`，新增 inactive youtubers，保留七分類；完成至少 15 位合格人物後再另批准啟用，不混入 scientists。
3. **群組篩選的最小必要變更**：目前只有主分類。沿用已提出的 question_groups／celebrity_question_groups／room_question_groups 三個小型關聯表方案，保存分類內群組及房間選擇；此部分**尚無實作／Migration**。不做多房協調、新帳號系統或 Realtime。
4. **Edge Functions**：game-engine 只部署已審核的 WebP MIME sniff／中性檔名相容變更；群組功能完成後 room-system 驗證 group IDs 並保存，game-engine 在開場／抽題 Transaction 套用群組 EXISTS／DISTINCT 與 Host 歷史，保留 Next 冪等與答案 DTO。不得整包順帶部署 Phase 7 ticket／Secrets。
5. **前端**：在建立房間增加分類內群組 checkbox、傳送經驗證群組 IDs；遊戲圖片仍走原受控 Blob API，來源／署名只在允許時顯示。現有前端 WebP／結構化 credits 已有本機回歸，群組 UI **尚未實作**。需要另批准正式 Pages 發布，不只上圖片就可單群組玩。
6. **匯入**：先確認圖片審核與實際署名方式相容，再重新唯讀去重、產生確切 SQL／SHA／rollback，另批准已核准批次才寫入。若落實人物群組映射，120 個群組關聯須追加到同批 Transaction；目前 importer 只有主分類，尚未宣稱支援群組關聯入庫。
7. **驗證**：唯讀核對 MIME、圖片／人物／授權、RLS／GRANT；另批准新 QA Host／Player 才能執行各組 15 題及 C 模式 Cloud 遊戲。既有兩位政治人物、既有題目及歷史全保留。

可選待審表草案 `20261024161000_test_bank_candidates.sql` **不是最快可玩的必要前置**：完整審核可以先留本機，不必為 Demo 先上 120 個 pending。需要雲端審核流程時再批准，不能讓它取代真正圖片／人物核准。

沒有新增必要 Secret，不需要變更現有 RLS 來讓 Browser 直接讀人物／圖片，亦不需要新的圖片 Endpoint 或 Storage。新群組表權限必須另審且預設私有；所有新遠端變更等待明確批准。

## 6. 工具操作及結果位置

```sh
# 準備新的120位技術批次：僅公開Commons下載，不會自動核准
node scripts/prepare-demo-bank-v3.mjs \
  data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/candidates.json new-demo-directory

# 只續作尚未完成的技術工作；有任何審核決定即拒絕，不覆寫 approved／review notes
node scripts/prepare-demo-bank-v3.mjs \
  data/question-bank/prepared/test-bank-v3-20261024-reviewed-scope/candidates.json new-demo-directory --resume-technical

# 完整解碼／DB helper／中性檔名檢查，輸出每組私人聯絡表
node scripts/check-demo-bank-v3.mjs \
  data/question-bank/prepared/demo-120-20261024/demo-review.json

# 兩張實際已審照片的受控API／來源隔離；仍只用本機合成身分
node scripts/check-demo-private-images.mjs \
  data/question-bank/prepared/demo-120-20261024/approved-subset.json

npm run test:bank-v3
npm test
npm run build
```

本次真實輸出：ignored `data/question-bank/prepared/demo-120-20261024/` 下的 demo-review.json、summary.json、approved-subset.json、deferred-60.json、technical-verification.json、contact-*.png、images/。有了兩筆明確審核後，**不得對此目錄執行 resume**；工具會拒絕，使用新的目錄作後續新候選準備。

## 7. 實際驗收

| 項目 | 結果 |
|---|---|
| 120 位／八組各15、60位保留、穩定ID與分類 | PASS |
| 真實圖片安全處理 | 76 張完整解碼、尺寸、Metadata、SHA 與 PostgreSQL WebP helper PASS；44 位保留阻擋，不是44張解碼失敗 |
| 已審照片受控 API | 兩張實際 Morgan／譚雅婷 bytes 與 credits PASS：Host／Player 都取得中性 image/webp，SHA 相同，無憑證拒絕、未揭曉無 answer／author／source，揭曉後才有 credits；每例使用15個本機合成身分，不冒稱120位已核准遊戲 |
| 來源審核 | 107份來源證據保存；2 APPROVED，118未核准；沒有把網址自動 approved |
| 120 pending Seed | PASS：隔離資料庫首跑120、重跑仍120、回滾0，正式人物不增加 |
| 正式匯入冪等／交易／回滾／舊資料保護 | PASS：使用合成已核准 fixtures，非真實題庫批准；同 SQL／等價重建皆可重跑，差異拒絕，使用後拒回滾，保留 Q76／Q22686-like 舊人物與遊戲歷史 |
| 兩位部分核准可否直接形成完整匯入 | 預期 BLOCKED：不足15位，0份正式SQL產生 |
| 完整自動化 | **316 PASS、0 FAIL**，包含10項新 Demo／匯入安全測試；Edge TypeScript PASS |
| Browser | **30 PASS**：23項本機遊戲／Session／RWD＋7項真實待審Curry WebP／credits／隔離，Cloud requests=0 |
| TypeScript／Build | PASS，117 modules |
| Cloud 八組各15題 | NOT TESTED／NOT READY，沒有用合成或舊政治人物驗收替代 |

本機 Node22.23.4、PGlite0.5.11／PostgreSQL18.6、Chrome155；Cloud17.11來自前次盤點，本次未重新查詢。沒有 lint script，未宣稱 lint 通過。

Git 安全檢查 PASS：`.env.local` 未被追蹤，prepared 原始圖／來源證據／審核／SQL 均 ignored；工作樹與歷史未發現 Secret、Service Role JWT、Access Token 或含密碼連線字串。三份已部署 Migration SHA-256 保持原值，`git diff --check` 通過。沒有新增秘密或修改 Cloud 權限。

## 8. 修改檔案摘要

- `data/question-bank/test-bank-v3-demo-scope.json`：固定120個原名單 identity keys；原180設定不變。
- `scripts/lib/demo-bank-v3.mjs`、`prepare-demo-bank-v3.mjs`、`check-demo-bank-v3.mjs`：選擇／分批、來源證據、安全WebP與聯絡表／QC，不自動核准。
- `scripts/check-demo-private-images.mjs`：兩張實際核准照片的本機受控API驗證，不連Cloud。
- `scripts/lib/test-bank-v3-seed.mjs`、`seed-test-bank-v3.mjs`：沿用原pending流程，新增120位selection，保留原180模式。
- `scripts/prepare-question-import.mjs`、`scripts/lib/question-import-idempotence.mjs`、`scripts/lib/question-license.mjs`：明確冪等模式、安全回滾、角色權利保留及官方條款URL正規化，不放寬未核准gate。
- `scripts/demo-bank-v3.node-test.mjs`、`package.json`：10項新安全／Demo測試，納入完整回歸與test:bank-v3。
- `AGENTS.md`、README與本報告／名單：更新優先批次、審核數量與部署前置。正式Frontend／Edge Functions／Migration沒有修改。

**下一步應先解除圖片／授權與群組功能阻擋，而不是批准把120位全部啟用。** 第一批人物清單已備妥，不能用「Demo」名義略過權利與答案隔離。
