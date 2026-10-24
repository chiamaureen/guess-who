# Phase 8 — 69 位人物與私有圖片入庫請求

> 本文為先前 PNG 準備受阻的歷史紀錄。最新要求改為 WebP；69 張已在本機完成技術處理，但授權／人物審核仍阻擋匯入。請以 [WebP 最新驗收](phase8-webp-acceptance.md) 為準，不可重跑舊批次雲端匯入。

2026-10-24（Asia/Taipei）。**BLOCKED；Cloud 題庫寫入 0 列。**

## 最新指示與範圍

使用者已明確要求：將目前 69 位有圖片連結的運動員設為 approved，並將照片實際存入 PostgreSQL 私有圖片表。此決定取代先前 link-only 計畫；不需要再重複詢問是否要啟用，但不能把未完成的技術／授權查證記成已通過。

目標 linked Project：`fgvajdnzrnptdjurhjfo`。期望新建 69 celebrities＋69 athletes 分類關聯＋69 game_image_assets，合計 **207 列**；既有七分類、政治人物、原圖、房間、題目、C 模式歷史均不更動。沒有取得其他 Schema、RLS、GRANT、Secrets、Functions 或 Git 發布的修改範圍。

## 已執行

- 唯讀檢查現有候選：69 個不同 QID、有圖片 URL／作者／來源；沒有把 user request 偽裝成人物／權利／視覺五項審核已完成。
- 新增 `scripts/prepare-athlete-assets.mjs`，只做本機素材準備：固定 69 人、Wikimedia HTTPS 白名單、來源 SHA-1 一致、32 MiB 原圖上限、禁止重新導向、沿用正式 Metadata-free RGB PNG encoder。
- 每張輸出中性 UUID PNG、SHA-256、尺寸及來源收據；每檔不超過 128 KiB，保留來源／作者／原始授權，沒有將 CC BY／BY-SA 改標為 PD。圖片及收據均在 ignored 目錄，0600／0700，不進前端 bundle。
- 實際完成 **2 張**（LeBron James、Stephen Curry）後停止，沒有產生 mutation SQL，也沒有匯入任何部分批次。
- 另唯讀取得 Kyrie Irving 的 Commons Metadata：17,834,001 bytes、5505×8256、**45,449,280 像素**，超出現有 encoder 的 40,000,000 輸入像素上限。原始準備收據記為下載／轉檔失敗；後續尺寸核對確認此既有上限是阻擋條件，未自行放寬。

## 尚未解決的阻擋

1. **圖片處理：** 67 張尚未產出安全 PNG。需處理過大原圖，例如核對 Commons 官方縮圖與來源版本，不跳過 SHA／解碼／Metadata／尺寸限制；不得因部分下載成功就假報 69 張完成。
2. **匯入器授權支援：** 現有 `prepare-question-import.mjs` 只允許已審核 PD／CC0。這批為 CC BY 2.0×24、CC BY-SA 4.0×15、CC BY-SA 2.0×13、CC BY 4.0×1、CC BY-SA 3.0×9、CC BY-SA 2.5×1、Attribution×4、PD×1、CC0×1。**67 張不在舊匯入器白名單**。這不是宣稱 BY／SA 不能使用，而是仍須保留各自授權、明確署名／衍生使用條件，不能靠偽造 review=true 或 license='Public domain' 通過舊 guard。
3. **資料完整性：** 現有候選有 9 張未填授權條款 URL，技術上可填來源提供的具體證據／條款，但不能猜測或把 Google 搜尋當證明。真實人物審核工具目前仍為 0 APPROVED；它與使用者新提出的「批次啟用請求」是兩件不同事，不互相偽造紀錄。
4. **實際呈現：** 原 Game Engine 只在 Host／揭曉後提供署名／來源，未揭曉 Player 不帶答案 Metadata。擴充 BY／SA 支援時須確認署名方案與答案隔離同時成立，不能以公開原始姓名檔名解決署名，也不能本次擅自發布前端或 Function。

## 本機產物

```text
data/question-bank/prepared/athletes-private-assets-request-20261024/
  asset-preparation.json
  images/（2 張中性 PNG）
```

收據 `requestedDatabaseApproved=true` 僅記錄使用者要求；每張 staging entry 的 approved=false 表示尚未完成正式匯入條件，不是假稱已將 Database 設為 approved。沒有修改原本本機審核結果或政治人物。

## 測試與結果

- 新素材工具隔離測試 **3／3 PASS**：69 唯一人物、匿名 PNG／權限、保留真實 pending 狀態、來源 SHA 變動／429 即停止、不覆寫既有輸出、不自動寫雲端。
- 完整 `npm test` **279 項 PASS**；Edge TypeScript PASS；`npm run build` PASS。
- 記錄：`/tmp/guess-who-athlete-assets-tests.log`、`/tmp/guess-who-athlete-assets-build.log`。
- Database 新增人物／分類關聯／私有圖片均 **0**。沒有開始雲端 Transaction，不存在已 COMMIT 的部分批次；亦未修改 Migration、權限、Secrets、Functions，未 Git Commit／Push。

下一步應先完成過大原圖安全處理、授權／署名支援及完整 69 張驗證，再產生確切 207 列的單交易 SQL、SHA-256 與唯讀 verifier。現階段不可回報「69 位已入庫並啟用」。
