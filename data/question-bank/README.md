# Minimal Question Bank — Review Gate

**最新狀態：** 已逐頁與逐張檢查原候選、保守排除拜登／柯林頓，再補林肯／格蘭特，15 位批次已經使用者批准匯入 Cloud 並通過唯讀驗證。詳見 [Cloud Import Report](../../docs/phase8-cloud-import-report.md)；不得再次匯入同批次，完整遊戲 QA 需另行授權。以下保留準備工具說明，不代表可略過來源與視覺審核。

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
