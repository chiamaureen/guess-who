# Minimal Question Bank — Review Gate

## Demo120（最新優先批次）

已從原180位每組挑15，60位保留第二批。76張WebP通過技術檢查，僅2位工程核准，還不能形成15位合格匯入批次。見 [第一批／第二批名單](../../docs/phase8-demo-120-candidates.md)、[審核、Seed與部署計畫](../../docs/phase8-demo-120-report.md)。不會自動核准、匯入或修改舊政治人物／歷史；圖片／完整來源證據仍ignored，WebP雲端支援與群組篩選尚待批准／實作。

## 測試題庫 v3（最新，取代先前人數配置）

八組共 180 位候選、180 個不同 QID，保留原七分類，YouTuber 另有 inactive `youtubers` 草案，不混入 scientists。151 個圖片網址候選／29 位缺網址，重用 30 張待審運動員 WebP；**新核准 0 位**，不能當成八組已可玩題庫。原政治人物／歷史不變。

見 [v3 候選表](../../docs/phase8-test-bank-v3-candidates.md)、[本機驗收與 Seed 說明](../../docs/phase8-test-bank-v3-report.md)。`npm run test:bank-v3` 驗證候選、私有 pending Seed、去重／交易／回滾。後續經批准的 [Cloud 唯讀盤點](../../docs/phase8-test-bank-v3-cloud-inventory.md) 已確認：180 位皆未存在，零識別衝突；原政治人物 15 位中僅 2 位可抽題，WebP 未部署。待審表與新分類均僅本機 Migration 草案，沒有雲端寫入。以下 v2／舊政治人物紀錄保留作歷史，不是最新人數要求。

## 運動員 v2（2026-10-24 最新要求）

**最新變更：** 使用者其後改回 69 位 approved＋私有 PNG 入庫請求，取代下方 link-only 意向。現僅本機準備 2 張後因大圖上限停止，尚未寫 Cloud；原匯入器與授權／署名支援仍有阻擋，見[私有圖片入庫請求](../../docs/phase8-athletes-private-import-request.md)。不得把這份啟用請求冒充已完成 69 張的查證或匯入。

已建立[本機逐張審核工具](../../docs/phase8-athletes-image-review.md)：`npm run review:athletes` → `http://127.0.0.1:5188`。提供照片與來源／授權證據、APPROVE／REJECT／PENDING、備註與原子儲存。輸出 ignored `prepared/athletes-local-review/phase8-athletes-reviewed.json` 及摘要；只有至少 15 位不同身分有效 APPROVED 才能準備 Metadata 批次，不會自動匯入。真實名單目前 0 APPROVED／0 REJECTED／69 PENDING／55 MISSING_IMAGE；16 張技術檢查後遇 429 停止，不宣稱全量通過。

新批次改為 **link-only**：先整理圖片 URL／作者／授權，不新增圖片二進位資料、不使用 Storage。既有政治人物私有圖片及已部署引擎保留；現有引擎仍需要私有圖片 asset，不能宣稱只存 URL 即可出題。新人物及舊題庫停用均未寫入 Cloud，詳見 [運動員 v2 計畫](../../docs/phase8-athletes-v2-plan.md) 與[候選表](../../docs/phase8-athletes-v2-candidates.md)。

`prepare-athlete-review.mjs <new-directory>` 只讀公開 Metadata、所有 review flags=false；`plan-athlete-bank.mjs <manifest> <readonly-impact-json>` 只產生本機變更預覽。不要使用下方舊 PNG 匯入流程匯入 link-only 批次。Google 圖片第一筆遭機器人驗證，不能把 Commons 候選冒稱已完成 Google 核驗。

**最新狀態：** 已逐頁與逐張檢查原候選、保守排除拜登／柯林頓，再補林肯／格蘭特，15 位批次已經使用者批准匯入 Cloud 並通過唯讀驗證。詳見 [Cloud Import Report](../../docs/phase8-cloud-import-report.md)；不得再次匯入同批次，後續另批准的完整 [Cloud 遊戲驗收](../../docs/phase6-cloud-acceptance-report.md) 亦已 PASS。重跑 QA 或任何新寫入仍需新授權。以下保留準備工具說明，不代表可略過來源與視覺審核。

原候選檔維持未審核狀態；正式待審批次在 ignored `prepared/review-20261023/reviewed-bank.json`，圖片／SQL 不進 `src`／`public` 或 dist。Vite 開發伺服器也拒絕直接存取此題庫目錄，不把原始 Metadata 交給玩家。

```sh
node scripts/prepare-question-bank.mjs
```

本次另準備 `prepared/candidates-mvp.json`：15 位真人，官方 Metadata 均標示 Public domain，但審核旗標仍全部 false。原 `candidates.json` 保留作來源紀錄，其中一張 CC-BY 候選不在最小匯入白名單，勿直接核准。可用 `node scripts/prepare-question-bank.mjs candidates-mvp.json` 產生新版清單；工具不覆蓋既有審核檔。

工具只讀 Wikidata P18 與 Commons 官方 Imageinfo／extmetadata，準備 15 位真人候選的照片來源、版本、作者及授權線索；**所有 approved／review 旗標維持 false**。API Metadata 不是完整授權結論，不能因 Public domain 字樣就自動可用；需逐檔檢查來源、作者／政府作品聲明、權利範圍與圖片是否正確。不納入動畫角色。

人工確認 subject／rights／image，填入 reviewedBy、reviewedAt、乾淨 author／attribution；選用授權允許實際署名時機的 Public domain／CC0 素材。若不符合或有其他 restrictions，不採用。

接著將獲准圖片重新編碼為 metadata-free、8-bit RGB／RGBA、非交錯 PNG，寬高不超過 1600、檔案不超過 512 KiB，只留 IHDR／IDAT／IEND；需實際打開確認可解碼、無姓名水印。把中性 PNG 放在 manifest 同目錄內，填相對 imagePath 與 SHA-256，最後才設 approved=true 與三個 review=true。

```sh
node scripts/prepare-question-import.mjs data/question-bank/prepared/candidates-mvp.json
```

工具拒絕未審核資料、重複 Wikidata、缺來源／授權／確認、目錄外圖片、SHA-256 不符或違反正式 PNG CHECK 的素材；僅產生 owner-only `reviewed-import.sql`，**不連 Cloud、不執行 SQL**。匯入是單一交易且純 INSERT；相同人物若已存在會拒絕，不用 UPSERT 覆蓋舊題庫或審核資料。仍須人工審 SQL 並另取得遠端題庫寫入授權。

本機 fixtures 及合成臉不能混入正式題庫。只準備候選或 SQL 不代表雲端已可玩。

## 本次已完成的審核流程

1. `source-review.json` 記錄每張來源的具體依據／作者／排除理由，不以 Metadata 自動核准。
2. `scripts/prepare-reviewed-images.mjs` 重新取得來源 revision／SHA-1，下載與核對原圖、轉成中性 PNG 並產生聯絡表；此步驟仍 approved=false。
3. 實際逐張確認原圖與最終縮圖、正確人物及無姓名水印，才由 `finalize-question-review.mjs` 的明確確認與具名 reviewer 產生 reviewed-bank.json。審核者照實為 Codex，不冒稱人類／律師簽署。
4. `prepare-question-import.mjs` 產生單交易 INSERT、批次 receipt 與 READ ONLY verify-import.sql，全部 owner-only／ignored。它不連 Cloud，重複 Wikidata 會整批拒絕，不會覆寫既有題庫。
5. `check-reviewed-bank.mjs` 只在隔離 PGlite 驗證本批真實照片、15 題流程／Player 隔離／C 模式；不是 Cloud 成功證據。

本次預計新增 15 celebrities＋15 關聯＋15 私有圖片，既有 categories 不增不改。SQL hash 與批准範圍見驗收報告；原圖 Public Domain 聲明可能具地域範圍，改為代言／廣告或其他用途需重審，不將工程審核當成全球法律保證。

官方來源：[Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)、[Commons machine-readable data](https://commons.wikimedia.org/wiki/Commons:Machine-readable_data/en)。
# WebP 最新準備狀態

2026-10-24：圖片來源重新盤點124位，69張原始候選已完成本機 WebP 技術處理；目前0位完整核准，不可匯入。工具與實際統計見 `docs/phase8-webp-acceptance.md`，逐人表見 `docs/phase8-athletes-image-inventory.md`。新格式相容SQL僅在 migration-drafts，未修改舊Migration、政治人物或雲端資料。技術轉檔成功不代表圖片適合作為題目或已獲權利許可。

