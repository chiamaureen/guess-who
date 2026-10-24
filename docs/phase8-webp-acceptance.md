# Phase 8 — 圖片來源、縮圖與 WebP 驗收報告

2026-10-24（Asia/Taipei）。**本機 WebP 技術驗證 PASS；NOT READY FOR CLOUD IMPORT。**

本次沒有連線寫入 Supabase、執行 Migration、部署 Function／Pages、停用政治人物、修改歷史、Commit 或 Push。以下素材處理不是正式授權核准，也不是新的雲端遊戲驗收。

## 1. 124 位候選盤點

完整逐人表：[圖片來源盤點](phase8-athletes-image-inventory.md)。原始批次及審核決定未覆寫；新增收據在 ignored 本機目錄。

| 項目 | 實際結果 |
| --- | ---: |
| 全部候選／唯一候選列 | 124 |
| 原有 Commons 圖片，已重新核對原圖 SHA-1／來源與官方縮圖 | 69 |
| 原缺圖者 Commons 搜尋 | 55（7 有結果，48 無結果；不代表結果是正確人物） |
| Wikipedia 後續查詢 | 56（原缺圖 55＋新排除的銅像 1） |
| Wikipedia 可確認的額外合法人物照片 | 0 |
| Google 備援已確認可用照片 | 0 |
| 新發現 Commons 候選 | 1（Anthony Edwards，仍待人物／權利確認） |
| 排除原有候選 | 1（郭羿含對應的是銅像，不是本人照片） |
| 最終 PENDING／MISSING_IMAGE | 69／55 |
| 正式 APPROVED／可準備匯入 | **0** |

Google 本次取得搜尋 HTML，但未確認第一筆原圖及原始站點權利；其他備援未逐筆完成，明確記為 NOT_ATTEMPTED_PROVIDER_UNVERIFIED。先前曾遇 CAPTCHA，本次不沿用它假稱所有查詢都遭 CAPTCHA，也不把搜尋 HTML 當圖片授權。**全部 124 列已有狀態，不等於全部網路來源已完成權利審核。** MISSING_IMAGE 表示尚未找到可確認的合法照片，不宣稱網路上沒有照片。

工程 contact sheet 另發現：鄧宇成／魏均珩使用相同合照，沒有明確唯一目標；李智凱也為多人物合照，維持 PENDING，不自動裁臉。觀察記錄在 `data/question-bank/athletes-image-observations.json`，不是法律或真人審核者背書。

## 2. 69 張 WebP 真實處理結果

| 項目 | 結果 |
| --- | ---: |
| 實際編碼成功／失敗／未處理 | **69／0／0** |
| Sharp 完整解碼、尺寸／Metadata、SHA-256 與 PostgreSQL 結構驗證 | **69／69 PASS** |
| 原圖合計（Commons API 記錄） | 179,254,675 bytes |
| 實際下載的官方 rendition 合計 | 19,661,690 bytes |
| WebP 合計 | **6,566,494 bytes**（約 6.26 MiB） |
| 相對原圖容量減少 | **96.34%** |
| 平均／最小／最大 | 95,167／11,594／294,782 bytes |
| 小於 100 KiB／100–200 KiB／大於 200 KiB | 43／22／4 |

全部品質 82、最長邊 ≤1024、等比例、不放大、不裁切、不作 AI 修容；依 EXIF orientation 旋正後移除 EXIF／GPS／ICC／XMP。容量超過 300 KiB 才依序縮短長邊，仍使用品質 82；不為達到 100 KiB 下限而放大或填充。WebP 為實際 lossy VP8 編碼，只有 RIFF／WEBP／單一 VP8 chunk，不接受動畫、VP8X、EXIF、ICC 或尾隨內容。

安全上限未放寬：下載 32 MiB、解碼 40,000,000 pixels；批次串行、CLI Sharp cache 16 MiB／單執行緒。此為輸入與工作集限制，不宣稱是作業系統 RSS 硬配額。每張來源原始尺寸／bytes、原圖 SHA-1、來源 revision、下載 rendition SHA-256、輸出 SHA-256、尺寸、bytes、壓縮比皆有收據；原始素材未覆寫。

### Kyrie Irving

- 原圖 5505×8256＝45,449,280 pixels、17,834,001 bytes；直接解碼仍會被既有上限拒絕。
- 先由 Commons 官方 Imageinfo 核對同一檔案 URL、原圖 SHA-1 與 revision，再取官方 bounded rendition，本機重新編碼。
- 真實輸出 **683×1024、146,992 bytes、image/webp**，完整解碼與 Database 結構檢查 PASS。
- 原圖 SHA-1 來自官方 Metadata 比對，不冒稱它是下載縮圖的 byte digest；縮圖另存 SHA-256。

## 3. 授權與署名

重新查詢 Commons 後，69 張中 **57 張 Metadata 欄位初步完整，12 張仍有條件阻擋**。12 張包含 4 個僅標 Attribution 且欠缺可確認條款的來源，及 8 個仍須處理的來源使用限制；原先缺少條款 URL 的 9 張，這次已從官方 Metadata 取得其中 5 張條款。Metadata 完整不等於人物／權利／呈現方式已通過。

匯入器新增 PD、CC0，以及 unported CC BY／BY-SA 2.0、2.5、3.0、4.0。保留真實類型／版本，核對 canonical 條款網址；NC、ND、未知版本、籠統 Attribution 或網址不匹配均拒絕。新 WebP／JPEG 必須有結構化權利紀錄，不能套用舊 PD PNG 的相容分支來省略證據。

每張需有作者、原始圖片頁、授權名稱／版本／URL、必要署名、處理方式、原始聲明、證據及查證日期。BY-SA 額外要求處理後圖片沿用相同授權 URL；不將 BY／SA 改標為 Public Domain。收據保留原始 Metadata；正式匯入的結構化紀錄存入既有 `celebrities.image_attribution` text，不新增資料表或人物公開欄位。

Host／揭曉後 Player 可展開「圖片來源與授權」，查看作者、聲明、版本、處理方式、條款、SA 沿用條款及證據；舊文字署名仍相容。揭曉前 Player 的 SQL／Edge 回應仍完全沒有 attribution 或 source，並非用 CSS 隱藏。

**尚未解除的實際授權阻擋：** CC 要求適當署名、條款連結與變更說明；不同版本及特定來源可能有額外條件。工程上實作「Host／揭曉後提供完整署名」，不代表已確認所有來源都允許揭曉前顯圖、揭曉後才署名（尤其提前結束而未揭曉的情形）。匯入器要求明確的 `presentationReviewed` 與原始權利／人物／圖片審核；目前全部保持 PENDING。須先完成此呈現方案審核，或改採允許該使用方式的替代素材。不能只勾一個旗標冒稱已取得權利。

參考官方資料：[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)、[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)、[署名實務](https://wiki.creativecommons.org/wiki/Best_practices_for_attribution)、[Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)、[Sharp 輸出](https://sharp.pixelplumbing.com/api-output/)、[WebP RIFF 規格](https://developers.google.com/speed/webp/docs/riff_container)。這是工程相容性檢查，不是法律保證。

## 4. 私有資料庫／API 相容性

新增**待審草案** `supabase/migration-drafts/20261024120000_game_image_formats.sql`，沒有移入正式 migrations 或部署。

- 保留 `game_image_assets.png` bytea 的既有欄位名及 RPC 的 `png` base64 key，僅作向下相容命名，實際 bytes 可為 PNG／JPEG／WebP；既有題目 FK 與圖片 ID 不改。
- 新增三個 INVOKER／空 search_path 的圖片驗證 helper；替換單一 image CHECK constraint。PNG 保留原本 512 KiB／1600px／CRC 檢查；WebP 300 KiB／1024px；metadata-free JPEG 512 KiB／1600px。沒有既有 JPEG 列需要遷移；實際 JPEG API 相容性以隔離 fixture 驗證。
- Database 只做有界容器／尺寸／Metadata 結構檢查，不聲稱 SQL 能完整解碼 VP8／JPEG；匯入器另以 Sharp 完整解碼及 digest 驗證，改副檔名／損壞編碼不能匯入。
- helpers 僅 service_role EXECUTE，RLS／FORCE RLS、表 GRANT、Host／Player 憑證、H-01、15 題與 C 模式完全保留。
- `get-question-image` 按真實 bytes 判定 MIME，回傳 `image/png`／`image/jpeg`／`image/webp`，下載名始終為中性 `photo.*`，no-store／nosniff。前端由受保護 API 取得 Blob，不直接載入來源 URL。
- 未修改 Phase 4～6 已部署 Migration，三份 SHA-256 仍與既有紀錄一致。無新 Secrets／Storage Bucket／Realtime 需求。

## 5. 匯入完整性與數量

| 資料表 | 現在可執行新增 | 原 69 人全部通過時的條件式預估 |
| --- | ---: | ---: |
| celebrities | **0** | 69 |
| celebrity_categories（athletes） | **0** | 69 |
| game_image_assets | **0** | 69 |
| 合計 | **0** | **207** |

**207 尚非可執行批次。** 原 69 人含銅像及重複合照，必須替換並重新審核；新 Anthony Edwards 候選也沒有核准。現在不產出真實題庫的 approved manifest／207 列 mutation SQL。

匯入器維持單一 BEGIN／COMMIT、純 INSERT、active category／既有 Wikidata 預檢、UNIQUE、圖片 byte digest／解碼與授權 guard；任何錯誤整批 Rollback，不 UPSERT／UPDATE／DELETE。唯讀 verifier 比對人物 UUID／QID、分類集合、圖片 digest、授權文字 digest，以及作者／授權名稱／來源；匿名角色仍不能直接 SELECT 私有圖片。以 **69 位原創合成測試身分**，實際執行本機 207 列 SQL，驗證中途錯誤整批 Rollback、成功 Commit、重跑拒絕與唯讀 verifier。沒有把合成測試核准當作真實人物核准。

## 6. 測試結果

| 測試 | 實際結果 |
| --- | --- |
| 真實 69 張圖片處理／解碼／DB 結構／digest | PASS 69／69；技術用途，不代表內容可用 |
| Kyrie 大圖安全處理 | PASS（直接超限拒絕、官方縮圖成功） |
| 完整 `npm test` | **PASS 294 項**；Vitest 101＋Node 193，無 skip／刪除測試 |
| Edge TypeScript／Frontend TypeScript | PASS（check:edge／build） |
| `npm run build` | PASS，117 modules |
| WebP 原有遊戲瀏覽器回歸 | PASS 23 項（含手機／桌面、刷新、揭曉、換題、結束） |
| WebP／署名／答案隔離補充瀏覽器檢查 | PASS 7 項 |
| 本機 15 題／第 16 題拒絕／跨場去重 | PASS（真實 RPC＋合成 WebP fixtures，不是 Cloud） |
| 匿名讀圖／RPC 權限／metadata／不支援授權／交易失敗 | PASS |
| lint | NOT CONFIGURED，未新增 formatter／lint 設定 |
| 雲端 WebP 匯入／遊戲 | NOT TESTED／未授權 |

首次 sandbox 回歸有一項 localhost listen EPERM；取得本機測試執行權限後重跑完整套件，全數通過，沒有略過該測試。原四項箭頭回歸也包含在完整套件內。

執行記錄：`/tmp/gw-webp-regression-final.log`、`/tmp/gw-webp-build-final.log`、`/tmp/guess-who-webp-browser/results.json`、`/tmp/guess-who-webp-credits-browser/results.json`。

## 7. 本機工具與產物

Node 使用 `.nvmrc` 的 22（22.18+），先 `nvm use`。

```bash
node scripts/inventory-athlete-images.mjs NEW-INVENTORY-DIRECTORY
node scripts/prepare-athlete-webp.mjs NEW-WEBP-DIRECTORY [LOCAL-CANDIDATE-MANIFEST.json]
node scripts/verify-athlete-webp.mjs data/question-bank/prepared/NEW-WEBP-DIRECTORY/webp-preparation.json
npm test
npm run build
```

目錄名稱需小寫英數及連字號。每次使用新目錄，不覆寫既有檔案。WebP staging 接受 1～124 位有正確 QID／來源 SHA 的候選，不只限原 69 位；僅做 technical-only 準備，永不自動核准或產生雲端 mutation。

本次實際檔案：

```text
data/question-bank/prepared/athletes-webp-20261024/
  images/（69 個中性 UUID.webp）
  source-evidence.json
  webp-preparation.json
  technical-verification.json
  technical-contact-sheet.png
data/question-bank/prepared/athletes-source-inventory-20261024/
  source-inventory-final.json
  source-inventory-final.md
```

完整素材／digest 到人物的對應、SQL、圖像與收據保持 ignored、0600／0700，Vite deny 題庫路徑，dist 不包含素材。公開文件僅有候選姓名／公開來源，不刊出中性檔名與輸出 digest 的答案對應。

## 8. 未來正確順序（本次全部未執行）

1. 解決缺圖、銅像／合照、4 項不明授權及8項來源限制；完成正確人物、資格及署名時機審核。Google 備援仍須進一步查原始站點，不用搜尋頁當證明。
2. 對最終核准清單重做技術處理與完整 manifest，確認精確人數／分類／圖片及 SQL SHA-256，再請使用者批准確切變更。
3. 批准後才將新格式草案納入正式 Migration，核對 linked ref／migration history／dry-run；只部署新增 constraint/helpers，驗證舊 PNG、RLS／GRANT。
4. 經批准部署 **game-engine** 的格式處理更新，先以既有 PNG smoke test，保持 room-system／Realtime／Secrets 不變。
5. 經 Git／Pages 個別批准發布相容前端及署名介面，確認尚未加入的 WebP 不會使舊前端失敗。
6. 確認後端與前端均支援 WebP 後，才以另批准的單一 Transaction 匯入核准批次，立即執行唯讀數量／digest／授權／RLS verifier。不修改政治人物、舊題目或主持人歷史。
7. 最後另取得 QA 房間／玩家／歷史寫入批准，再執行真實 Cloud 15 題及手機多人驗收。不得直接沿用舊 Phase 6 PNG Cloud PASS 當作 WebP PASS。

**結論：圖片格式與本機遊戲相容性已驗證；授權／來源／內容審核尚未完成，READY FOR CLOUD IMPORT = NO。**
