# Phase 8 — 本機運動員圖片審核工具

2026-10-24（Asia/Taipei）。**工具已完成本機驗收；真實人物尚未核准，匯入準備仍 BLOCKED。** 不修改政治人物、Cloud Database／圖片／權限／Secrets／Functions，不 Commit／Push。

## 啟動

```sh
nvm use
npm install
npm run review:athletes
```

開啟 **http://127.0.0.1:5188**。必須使用該地址，不以其他 Host 存取。若埠已占用：

```sh
npm run review:athletes -- --port=5189
```

此為本機維護工具，Node 只在審核時執行，Ctrl+C 結束；不是遊戲架構的常駐 Backend，不加入 GitHub Pages Build，不需 `.env.local`、Supabase 登入或任何 Secret。

## 資料與操作

1. 以 `docs/phase8-athletes-v2-candidates.md` 為人物／來源清單權威，解析 124 人，並對照 `athletes-v2-scope.json` 的名單與 athletes 分類；相同正規化姓名／QID 會警告並阻止核准，不自動合併同名人。
2. 若本機有先前 ignored `candidates-links-pending.json`，僅在姓名、組別、QID、來源頁一致時補 URL／授權條款；不照搬其 approval。全新 checkout 缺此檔仍能啟動，有來源者在檢查時以 Commons 官方 API 解析原始圖片。
3. 一次顯示一位；每次開啟先將已完成技術檢查 PASS 的候選排最前（本次原始狀態為 13 位），再排其他圖片、最後缺圖；只改顯示順序，不改 JSON 原始順序或審核狀態，該分頁期間順序固定。有圖片來源時自動檢查並在本機顯示照片，前後切換或下拉選擇其他人物。缺圖者可補 Commons 原始圖片及來源。換圖先儲存 PENDING，再檢查／重新讀取，最後人工確認。
4. 頁面顯示姓名、候選 QID、來源／資格警告、作者、授權、特定圖片證據及授權條款連結。Metadata 擷取日期、HTTP 檢查日期與人工授權查證日期分開，沒有用自動 Metadata 日期假裝權利已核准。
5. APPROVE 須同時符合：圖片檢查 24 小時內 PASS、QID／人物與名單來源齊全、分類正確且無重複、作者／授權／特定圖片證據／條款完整、查證日期有效，並勾選人物／名單資格／分類／權利／使用條件五項確認，填審核者、具體備註與署名計畫。
6. Google／其他搜尋頁不能當授權證據；通用 CC 條款頁只能填「條款」，不能取代該照片的授權聲明。Metadata 的 CC BY／Public domain 字樣本身不構成核准。人工仍須判斷該聲明是否真的適用、署名時機與地域／其他限制。
7. REJECT 必填原因；PENDING 可儲存草稿。結果保存後可換頁／重新啟動恢復；離開未儲存的內容會提示。後端逐次驗證，不靠 disabled 按鈕充當權利檢查。
8. 至少 **15 位不同 QID 的有效 APPROVED** 才顯示可準備連結 Metadata 批次。這不是 Cloud 匯入批准，也不表示現有 Game Engine 已支援 URL 圖片。舊 PNG 匯入器仍不可用於此批次。

本工具只提供工程／人工審核流程，不提供自動辨識人物或全球法律保證。尚未確認的資格／姓名衝突須由審核者補證據，不得為湊 15 人直接勾選。

## URL 檢查與限制

```sh
npm run review:athletes:check
```

- 這是公開圖片唯讀 GET，不是 HEAD 假成功。檢查 HTTP 200、Content-Type、實際 byte 大小、Sharp 解碼／格式一致性、尺寸及 SHA-256；記錄查證時間與錯誤種類。
- 目前下載白名單僅 `upload.wikimedia.org`／`thumb.wikimedia.org` HTTPS；拒絕帳密、非標準埠、HTTP、任意網域／localhost、重新導向、HTML、SVG 與非 JPEG／PNG／WebP。其他來源需先另審查，不以放寬成任意 URL 解決缺圖。
- 原圖每張最多 **8 MiB／4,000 萬像素**，拒絕動畫多頁與解碼錯誤。這是本機審核的資源上限，不是法律拒絕；超限者可找合法適當縮圖或另審查上限，不能冒稱不可取得授權。
- 全批次序列檢查，真實網路請求之間留 1.5 秒；24 小時內已查者略過，單張可另按重查。HTTP 429 立即停止、遵守 Retry-After（無有效值至少等 60 秒）、不換 IP／繞過限制；冷卻後可續查未檢查者。
- URL／DNS／Timeout／HTTP／大小／解碼的失敗只記錄可用性，不自動 REJECT 人物，也絕不自動 APPROVE。
- 圖片只暫存在單張、有界記憶體預覽，不寫圖片檔或 Database。原始 URL 仍可能含姓名；本頁僅供本機審核者，不接入 Player 畫面。

## 輸出

```text
data/question-bank/prepared/athletes-local-review/
  phase8-athletes-reviewed.json
  phase8-athletes-review-summary.md
```

JSON 包含每位的狀態、圖片／人物／名單來源、作者、授權名稱與條款、特定圖片證據、擷取／查證日期、審核者、確認旗標、備註、可用性結果及摘要。也可按「下載審核 JSON」。沒有產生 mutation SQL、圖片 bytea、假核准或匯入 Cloud。

目錄受 `.gitignore` 與 Vite fs.deny 保護，目錄 0700、產物 0600。Canonical JSON 先寫暫存檔再原子 rename；revision 拒絕過期分頁寫入；`.review.lock` 拒絕同目錄第二個審核／批次程序。先關閉網頁伺服器再跑 CLI 全批檢查，避免兩個 writer 覆蓋審核。

清單／scope 變動時會拒絕覆寫既有審核；應先備份並將舊輸出目錄改名，再建立新一輪。若強制中止留下 `.review.lock`，須先確認其 PID 已停止，再只移除該鎖檔；不要刪除審核 JSON，也不要同時啟動兩個 writer。

## 安全邊界

- Server 僅綁 `127.0.0.1`，限制 Host，拒絕 cross-site；寫入須同源 Origin＋隨機記憶體 Session，沒有跨網域 CORS。
- 只提供固定 HTML／JS／CSS／Review API，不提供任意檔案路徑；`.env.local`、題庫目錄、AGENTS、Supabase config 均不可透過此工具讀取。
- 資料用 DOM text/value 呈現，不插入作者 HTML。CSP／nosniff／no-store／no-referrer，外連 noreferrer／noopener。
- 審核不代表政治人物停用授權，不變更七分類、題目、房間、主持人歷史或既有圖片。

## 本次真實題庫結果

| 狀態 | 數量 |
| --- | ---: |
| APPROVED | **0** |
| REJECTED | **0** |
| PENDING | **69** |
| MISSING_IMAGE | **55** |
| 合計 | **124** |

已實際檢查 16 張：**13 張 HTTP／型別／大小／解碼 PASS**；Kyrie Irving、Luka Doncic 原圖超過 8 MiB；Joel Embiid 回 HTTP 429，因此停止，剩餘 53 張**尚未完成可用性檢查**。未把上述技術結果當成權利或正確人物已核准。未重試繞過該 429。

目前唯一有效 APPROVED 為 0，距離準備匯入仍缺 15 位人工核准；既有 URL 圖片引擎相容性仍未完成。本次沒有核准真實人物。

## 驗收結果

| 檢查 | 結果 |
| --- | --- |
| `npm test` | **PASS，276 項**：Vitest 97、Health 21、DB 37、Rooms 27、Game 26、Realtime 18、題庫／圖片／審核 50 |
| 新審核工具測試 | **PASS，25 項**，包含解析、來源不符、重複、圖片 bytes／型別、DNS／Timeout、Google 證據、24 小時檢查、15 位門檻、儲存／恢復、CSRF／Host、429／Retry-After 與 PASS 優先排序不改原始資料 |
| 四項箭頭回歸 | **PASS**，既有測試更新為驗證當前 SVG path／currentColor／aria-hidden 與全站復用，保留其他箭頭／無特效斷言；沒有跳過或刪除測試，也沒有改回 Unicode 元件 |
| Chrome 瀏覽器 | **PASS，14 組**，僅隔離合成候選；APPROVE／REJECT／PENDING、重整恢復、Google／localhost 拒絕、14→15 門檻、JSON、PASS 優先且查詢後不跳換人物、390px RWD，無瀏覽器錯誤或外部請求 |
| TypeScript／Edge TypeScript／`npm run build` | **PASS**，116 modules；本機審核頁不加入正式遊戲 bundle |
| 真實圖片全量檢查 | **PARTIAL／BLOCKED**：16／69，遇公開圖片 HTTP 429 停止，非全量 PASS |
| lint | 未設定 lint script |

瀏覽器中的 15 位核准僅是 `/tmp` 的合成測試資料，**不是這 124 位真實人物的核准**。

執行紀錄：`/tmp/guess-who-athlete-review-all-tests.log`、`/tmp/guess-who-athlete-review-browser-final.log`、`/tmp/guess-who-athlete-review-build.log`、`/tmp/guess-who-athlete-real-image-check.log`。無 Supabase Cloud 寫入、Git Commit／Push。

優先顯示更新驗收：`/tmp/guess-who-review-priority-tests.log`、`/tmp/guess-who-review-priority-browser.log`、`/tmp/guess-who-review-priority-build.log`。實際本機 Server 已確認 `/`、`app.js`、`order.js`、`style.css` 與 `/api/state` HTTP 200，現有 13 位 PASS 確認排在顯示清單最前；沒有改動真實人物審核決定。

官方參考：[Commons Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)、[Sharp Metadata](https://sharp.pixelplumbing.com/api-input/)。自動 Metadata／解碼檢查不代替權利審核。
