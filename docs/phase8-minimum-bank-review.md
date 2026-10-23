# Phase 8 — Minimum Question Bank Review

2026-10-23（Asia/Taipei）。**本機題庫審核／匯入準備 READY；已獲 PostgreSQL 批次匯入批准，但本次 CLI 旗標錯誤而停止，雲端可用仍為 0。** 執行結果與待重新確認的命令見 [Cloud Import Report](phase8-cloud-import-report.md)。

## 結果與範圍

- 原候選 15 位已逐頁讀取來源／授權／作者：13 位納入、2 位保守排除。另逐項審核林肯與格蘭特補足，合計 **15 位可匯入**。
- 所有照片重新從 Commons 下載，核對 API 原檔 SHA-1；保留檔案時間、來源頁 revision／固定證據 URL。不是只根據 LicenseShortName 自動核准。
- 已實際檢視原版與最終縮圖聯絡表：照片人物對應正確，無姓名文字水印；只做旋轉、等比例縮放及重新編碼，不用 AI 改造肖像。分類均為既有「政治人物」。
- 審核者明確記錄為 **Codex source and visual review**，不是冒稱使用者／律師已簽署。這是依各來源具體聲明的工程審核，不提供全球法律保證；非背書、廣告或肖像商業代言用途。
- 不因「館藏在 NARA／LOC」就假設可自由使用；[NARA 官方說明](https://www.archives.gov/research/still-pictures/permissions) 也指出收藏本身不保證沒有著作權或其他限制。

## 逐項來源審核

下列每張皆已實際下載／可解碼；作者採來源可確認的姓名或機構，不猜測未知個人。照片連結只用於審核，不會在 Player 未揭曉 DTO 出現。

| 人物／Wikidata | 作者／依據 | 決定與來源 |
| --- | --- | --- |
| 巴拉克·歐巴馬 Q76 | Pete Souza／官方白宮職務攝影，PD-USGov-POTUS | 納入；[檔案聲明](https://commons.wikimedia.org/wiki/File:President_Barack_Obama.jpg) |
| 喬·拜登 Q6279 | Adam Schultz；PD 聲明以外另有 personality warning | **排除**；不刪警示、不將 restrictions 清空；[頁面](https://commons.wikimedia.org/wiki/File:Joe_Biden_presidential_portrait.jpg) |
| 唐納·川普 Q22686 | Daniel Torok／White House，PD-USGov-POTUS | 納入；[檔案聲明](https://commons.wikimedia.org/wiki/File:Official_Presidential_Portrait_of_President_Donald_J._Trump_(2025)_(3x4).jpg) |
| 喬治·沃克·布希 Q207 | Eric Draper／White House，具體政府職務作品聲明 | 納入；[檔案與 DoD 來源](https://commons.wikimedia.org/wiki/File:George-W-Bush.jpeg) |
| 比爾·柯林頓 Q1124 | Bob McNeely／White House；另有 personality warning | **排除**；[檔案頁面](https://commons.wikimedia.org/wiki/File:Bill_Clinton.jpg) |
| 喬治·赫伯特·沃克·布希 Q23505 | David Valdez，PD-USGov／PDM | 納入；[檔案聲明](https://commons.wikimedia.org/wiki/File:George_H._W._Bush_presidential_portrait_(cropped).jpg) |
| 隆納·雷根 Q9960 | Michael Evans／White House，PD-USGov-POTUS | 納入；只縮放衍生檔、不裁切／覆寫 Commons 原件；[聲明](https://commons.wikimedia.org/wiki/File:Ronald_Reagan_1981_presidential_portrait.jpg) |
| 威廉·霍華德·塔夫脫 Q35648 | Pach Brothers；1908 已出版原作 PD；Adam Cuerden 修復 | 納入；[原作頁](https://commons.wikimedia.org/wiki/File:Cabinet_card_of_William_Howard_Taft_by_Pach_Brothers_-_Cropped_to_image.jpg) 與修復者明示的[不可撤銷使用許可](https://commons.wikimedia.org/wiki/Creator:Adam_Cuerden)，仍保留署名 |
| 傑拉德·福特 Q9582 | David Hume Kennerly／White House；修復 Wow，PD-USGov | 納入；對應 NARA 530680；[頁面](https://commons.wikimedia.org/wiki/File:Gerald_Ford_presidential_portrait_(cropped).jpg) |
| 理查·尼克森 Q9588 | U.S. Army Audiovisual Center／DoD；修復 Wow，PD-USGov／PDM | 納入；NARA 530679；[頁面](https://commons.wikimedia.org/wiki/File:Richard_Nixon_presidential_portrait.jpg) |
| 林登·詹森 Q9640 | Arnold Newman；頁面列 PD-USGov-POTUS 及 LBJ Library 來源 | 納入，作者照實記錄，不杜撰政府任職；[檔案聲明](https://commons.wikimedia.org/wiki/File:Lyndon_B._Johnson,_photo_portrait,_leaning_on_chair,_color_cropped.jpg) |
| 約翰·甘迺迪 Q9696 | Cecil W. Stoughton／White House，PD-USGov-POTUS | 納入；不是把館藏來源標籤當授權；[Licensing](https://commons.wikimedia.org/wiki/File:John_F._Kennedy,_White_House_color_photo_portrait.jpg) |
| 德懷特·艾森豪 Q9916 | White House／Eisenhower Library，個人攝影者未指定 | 納入；保留機構作者；[具體職務作品聲明](https://commons.wikimedia.org/wiki/File:Dwight_D._Eisenhower,_official_photo_portrait,_May_29,_1959.jpg) |
| 哈利·杜魯門 Q11613 | Truman Library／NARA 為署名機構，個人未指定；PD-US-no-renewal | 納入依據為該檔具體未續展聲明，**其地理範圍不是全球保證**；[頁面](https://commons.wikimedia.org/wiki/File:TRUMAN_58-766-06_(cropped).jpg) |
| 詹姆斯·布坎南 Q12325 | Mathew Brady；19 世紀原作，作者 1896 年逝世 | 納入；[權利屆滿聲明與 LOC 編號](https://commons.wikimedia.org/wiki/File:James_Buchanan_(cropped).jpg) |
| 亞伯拉罕·林肯 Q91 | Alexander Gardner，PD-scan／PD-old-100-expired／PDM | 補入；[照片及聲明](https://commons.wikimedia.org/wiki/File:Abraham_Lincoln_O-77_matte_collodion_print.jpg)、[人物核對](https://www.wikidata.org/wiki/Q91) |
| 尤利西斯·格蘭特 Q34836 | Mathew Brady／LOC Brady-Handy，PD-Brady-Handy | 補入；[照片及期限依據](https://commons.wikimedia.org/wiki/File:Ulysses_S._Grant_1870-1880.jpg)、[人物核對](https://www.wikidata.org/wiki/Q34836) |

上述「排除」是本次 MVP 的保守選材，不表示這兩張圖片在所有情境都禁止使用；未放寬既有限流／權限或 rights guard。政府作品與部分歷史作品的 PD 聲明有地域範圍，若之後改為廣告、代言或不同司法管轄用途，需另做權利審查。

## 安全圖片與資料

- 原圖／作者／來源 URL 只保存在忽略的 prepared 與資料庫私表；不在 src／public 或 dist，Vite 開發伺服器亦封鎖直接存取題庫目錄。公開的審核紀錄不含任何「題目 UUID→答案」映射。
- 最終 PNG 為中性隨機 UUID 檔名，224–320px 等級縮圖（高度最高 427）；小尺寸不裁掉原畫面，降低匯入大小。每檔最多 128 KiB，15 檔合計 **1,772,134 bytes**。
- Sharp 僅用於本機解碼／旋轉／縮放；再由固定 RGB PNG encoder 只寫 IHDR／IDAT／IEND，刪除 EXIF、文字、原始檔名、ICC／其他 Metadata。CRC／正式 SQL CHECK 及解碼測試均通過。
- Player 圖片仍走已部署的 get-question-image，取得中性 photo.png／Blob；姓名、署名與原始來源只在 Host 或已揭曉時回傳。不能完全阻止人類認出照片／反向圖片搜尋，但不提前由 API／檔名／Metadata 洩漏正解。
- 原候選與權利／圖片未完成的中間產物保留 approved=false；只有實際檢視並確認後的 reviewed-bank.json 15 筆為 approved=true，記錄 reviewer、時間、來源 revision、PNG SHA-256。

## 待批准匯入批次

| 表 | 預計新增 |
| --- | --- |
| celebrities | 15 |
| celebrity_categories | 15，全部連到既有政治人物分類 |
| game_image_assets | 15 |
| categories／rooms／hosts／players／questions／history | **0** |

**總計新增 45 列，不修改 Schema、Migration 或既有業務資料。**

本機產物（均在忽略目錄、owner-only）：

```text
data/question-bank/prepared/review-20261023/
  reviewed-bank.json
  reviewed-import.sql
  verify-import.sql
  import-receipt.json
  commons-evidence.json
  compact-contact-sheet.png
  compact/（15 張中性 PNG）
```

- SQL 大小：2,378,140 bytes。
- **匯入 SQL SHA-256：`c9d6d4e72920ac565bbe01de27b2994ea66c5d5b9b6a252595022d8e8fa85fac`**。
- 僅 INSERT，單一 BEGIN／COMMIT；先確認分類存在且啟用、所有 Wikidata ID 尚未存在。既有 UNIQUE 再防重複；重跑／撞既有資料會整筆拒絕，不 UPSERT／覆寫／刪除。Lock／statement timeout 有界。
- verify-import.sql 為 READ ONLY，依 receipt 中的精確人物／圖片 UUID、SHA-256、approved 與分類集合驗證 15 筆，未符合會失敗；不是只看總筆數或 HTTP 200。
- 三個已部署 Migration SHA-256 全部保持原值；沒有建立新 Migration、套用遠端 SQL、部署 Function 或更改 Secret。

## 實際測試

| 檢查 | 結果 |
| --- | --- |
| 原圖下載與來源 SHA-1 | PASS，15／15 |
| 視覺、人物、無姓名水印 | PASS，逐張原版及最終聯絡表檢視 |
| PNG 原像素編碼、EXIF／描述／方向去除、錯誤輸入拒絕 | PASS，新增測試 |
| Vite 題庫資料隔離 | PASS，實際 HTTP：首頁 200；審核 JSON、approved manifest 與 @fs 路徑均 403 |
| 單批 SQL 與 READ ONLY verifier | PASS，真實本機 PGlite 執行；重複批次被拒 |
| 本批真實照片完整 15 題 | PASS，隔離 PGlite／私有 RPC，15 位不重複、Player 揭曉前無答案、Host 刷新／揭曉／結束 |
| C 模式 | PASS，15 人用盡第二場被拒，確認重置後可開始，原題保留 |
| npm test | PASS，173 項；Edge TypeScript 通過 |
| npm run build | PASS；沒有把題庫／Sharp 打包進前端 |
| 兩 Function 正式 Origin | PASS，實際 Cloud OPTIONS 204、錯誤 Origin 403，零業務操作 |
| Cloud 目前題庫 | 仍是 0 人／0 approved assets／0 usable；真正唯讀盤點 |
| Cloud 匯入／15 題驗收 | **匯入指令遭 CLI 拒絕，SQL 未執行；遊戲驗收 NOT EXECUTED**，詳見 Cloud Import Report |

本機紀錄：`/tmp/guess-who-phase8-tests.log`、`/tmp/guess-who-phase8-build.log`、`/tmp/guess-who-phase8-real-bank.log`。沒有輸出 Secret、Token 或憑證 Hash；素材／SQL 校驗摘要用於審核收據。

## 下一個明確批准

以下為原始建議，使用者已批准此範圍；但本次遇 CLI 旗標錯誤後依指示停止，**不得自行重試寫入**。下一次明確指示與修正後命令見 Cloud Import Report。原建議為：**將上述 SHA-256 的 reviewed-import.sql 套用到 fgvajdnzrnptdjurhjfo，只新增 15 人＋15 關聯＋15 圖片，再跑同批 verify-import.sql 與唯讀庫存檢查**。

批准後仍先核對 linked ref、檔案 hash 與當下重複資料；任何衝突／錯誤停止，不 reset／repair／刪舊資料。示意命令目前**未執行**：

```sh
npx --no-install supabase db query --linked --file data/question-bank/prepared/review-20261023/reviewed-import.sql
npx --no-install supabase db query --linked --file data/question-bank/prepared/review-20261023/verify-import.sql
npx --no-install supabase db query --linked --file supabase/tests/mvp_inventory.sql
```

這個批准不包含 Host／Room／Player QA 寫入、history reset、Commit／Push／Pages。完整 Cloud 測試計畫見 [15 Question Acceptance](cloud-15-question-acceptance.md)，網站準備見 [Pages Release Checklist](pages-release-checklist.md)。

若遇請求大小限制或回應遺失，停止寫入並先用 READ ONLY receipt 確認狀態，不自行拆交易、強制重跑或調整既有題庫。
