# Minimal Question Bank — Review Gate

目前沒有可直接匯入的已審核題庫。此目錄不在 `src`／`public`，prepared 內容亦被 Git 忽略；不把題庫原始 Metadata 打包給玩家。

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

官方來源：[Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)、[Commons machine-readable data](https://commons.wikimedia.org/wiki/Commons:Machine-readable_data/en)。
