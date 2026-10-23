# Guess Who — Phase 2 Frontend Setup 驗收報告

- 驗收日期：2026-10-23（Asia/Taipei）
- 驗收範圍：前端設定、首頁、建立／加入房間 UI、Mock Data、RWD、路由、環境檔與安全邊界。
- 驗收結論：在本報告列出的本機 Chrome、自動化測試及靜態部署模擬範圍內通過；最終未通過的執行測試為 0 項。
- 本次未建立 Supabase Project、未修改資料庫、未實作 Phase 3、未部署、未執行 Git Commit 或 Push。
- 限制：lint 尚未設定；Safari、Firefox、實體行動裝置及真正 GitHub Pages 部署尚未驗證，不列為已通過。

## 1. 專案設定與完成項目

以下版本取自本機安裝與 package-lock.json，未變更既有依賴。

| 項目 | 實際版本／設定 | 結果 |
| --- | --- | --- |
| React / React DOM | 19.3.1；createRoot、StrictMode | 通過 |
| Vite | 7.3.7；React Plugin 5.2.0 | 通過 |
| TypeScript | 5.9.3；strict、noUnusedLocals、noUnusedParameters | 通過 |
| Tailwind CSS | 4.3.3；@tailwindcss/vite 與 CSS @import / @theme | 通過 |
| React Router | 7.18.4；HashRouter、巢狀 Layout、未知路由頁 | 通過 |
| GSAP | 3.15.0；跑馬燈、按鈕與人物卡磁吸 | 通過本次互動檢查 |
| 專案結構 | pages、components、hooks、services、lib、types、data、styles | 符合目前前端範圍 |
| 本機環境 | Node.js 20.19.5、npm 10.8.2 | Build 與測試成功 |

### 頁面與 Mock Data

- 首頁：建立房間／加入房間連結、遊戲說明、頁首啟用底線及回到頂端清除錨點均正常。
- 建立房間：6 個 Mock 分類可複選與取消；未選分類時停用送出；選 2 類後回饋正確數量，明確說明未建立真實房間。
- 加入房間：可從 `#/join?code=abc123` 預填並轉大寫；驗證必填、6 碼英數、空白暱稱、21 字拒絕及 20 個 emoji 接受。
- 加入房間的提交按鈕維持一般按鈕，沒有磁吸設定。
- Loading／Error／Empty：以瀏覽器內暫時替換 Mock 的方式，確認 Loading 文字、送出停用、成功後恢復、一般及未知錯誤回饋、無分類提示；未操作任何後端。
- 原生連結、表單標籤、狀態訊息與錯誤提示保留；本次不是完整無障礙合規稽核。

## 2. 測試結果

| 測試 | 最終結果 | 說明 |
| --- | --- | --- |
| npm test | 11 / 11 通過 | 3 個測試檔：輸入／Mock 服務、頁面結構、導覽啟用狀態 |
| npm run build | 通過 | 先執行 TypeScript 檢查，再產生 dist |
| lint | 未設定／未執行 | package.json 無 lint script，Repository 無 lint 設定；未擅自新增工具 |
| 開發版 Chrome 檢查 | 25 / 25 通過 | 含 18 組 RWD、頁面互動、重新整理、字體與資源路徑 |
| 開發版補充 Chrome 檢查 | 9 / 9 通過 | 重複導覽、Loading／Error／Empty、4 種寬度跑馬燈及觸控模式 |
| 正式 dist 靜態檢查 | 25 / 25 通過 | 不提供 SPA fallback，模擬 GitHub Pages 靜態檔案行為 |
| 瀏覽器 JavaScript 錯誤 | 0 | 開發版與正式版完整檢查皆未捕捉到 pageerror |
| 房間 API 請求 | 0 | 完整頁面與表單測試未觀察到 fetch／XHR 請求 |
| Google Fonts | 通過 | 測試時 Poppins 載入成功，未觀察到字體網路失敗 |
| git diff --check | 通過 | 無空白錯誤 |

瀏覽器環境：macOS 上現有 Google Chrome 155.0.8059.85，透過 Playwright headless 執行。Playwright 僅暫存安裝於 `/tmp/guess-who-phase2-qa`，未加入專案依賴。

### 手機／平板／桌面 RWD

三個頁面皆測試以下視窗寬度，測試高度為 1000px：

| 寬度 | 首頁 | 建立房間 | 加入房間 |
| --- | --- | --- | --- |
| 320px | 通過 | 通過，分類單欄 | 通過，單欄 |
| 375px | 通過 | 通過，分類雙欄 | 通過，單欄 |
| 390px | 通過 | 通過，分類雙欄 | 通過，單欄 |
| 768px | 通過 | 通過，分類三欄 | 通過，雙欄 |
| 1024px | 通過 | 通過，分類三欄 | 通過，雙欄 |
| 1440px | 通過 | 通過，分類三欄 | 通過，雙欄 |

- 上述 18 組測試均未出現整頁水平溢出，非跑馬燈內容也未超出視窗左右邊界。
- 已檢視三個頁面各自在 375px 與 1440px 的完整截圖。
- 375／768／1024px 跑馬燈固定向左；1440px 向上捲動後可反向，符合既有規格。
- 模擬 390px 觸控裝置時不啟用磁吸；減少動態效果模式下，跑馬燈與按鈕磁吸回復靜態。
- 這些結果來自 Chrome 視窗與觸控模擬，不等同實體 iPhone／Android 或 Safari 驗證。

## 3. GitHub Pages 適配

- `vite.config.ts` 使用 `base: '/guess-who/'`，正式 HTML 的 CSS／JavaScript 資源均使用此路徑，靜態伺服器實際回應 200。
- `HashRouter` 將前端路由放在 fragment，正式網址如 `/guess-who/#/host`、`/guess-who/#/join?code=ABC123`。
- 在沒有 SPA fallback 的靜態伺服器實測首頁、建立房間、加入房間重新整理，均正常載入，邀請碼保留。
- `#/missing` 可呈現應用程式內的未知路由頁並回首頁；這是前端 fallback，不是伺服器回傳 HTTP 404 頁。
- 不需要 404.html 轉址腳本；不要把正式連結寫成沒有 hash 的 `/guess-who/host`。
- 尚未新增 GitHub Actions Workflow，也未改動 GitHub Pages 設定或實際發布。

## 4. 環境檔與安全邊界

| 檢查項目 | 結果 |
| --- | --- |
| .gitignore | 正確忽略 node_modules、dist、.env、.env.*、*.local、*.tsbuildinfo |
| .env.example | 有被追蹤，且透過例外規則保留；僅有空白的公開 URL／Publishable Key 欄位 |
| 其他環境檔 | git ls-files 未列出實際 .env／.env.local 憑證檔 |
| AGENTS.md | 包含架構、遊戲規則、安全責任、測試規範與 Phase 2／Phase 3 範圍界線 |
| 房間服務 | 僅 createPreview／joinPreview；回傳 Mock 提示，不建立真正房間 |
| 主持人憑證 | 未產生、儲存或驗證 Host Token，未以 localStorage／sessionStorage 實作權限 |
| 題目與答案 | 未在前端建立真正題庫、抽題、揭曉或答案權限控制；插畫僅為展示素材 |
| Supabase | 未引入 SDK、未建立 client、未呼叫 Edge Functions；原始碼未見 Service Role Key 或秘密憑證 |

本項結論只表示目前前端 Mock 未越界。RLS、Host 授權、匿名 Session 與答案隔離尚未實作，不能視為正式多人遊戲的安全驗收已完成。

## 5. 發現問題與本次修正

| 初測發現 | 修正 | 複測 |
| --- | --- | --- |
| 同一路由已在首頁底部，再點首頁連結不會回頂端 | ScrollManager 將 React Router location.key 納入捲動 effect 相依，讓每次導覽重新定位 | 通過 |
| 已在怎麼玩錨點路由、向下捲後再點相同連結，不會回到該區塊 | 同一項根因修正 | 通過 |
| 首頁、README 與環境範例仍稱 Phase 1 | 統一標示 Phase 2 Frontend Setup，AGENTS.md 明定後端另行授權 | 通過 |

最終失敗項目：0。未執行或尚未實作的項目另列如下，未當作通過。

本次修改僅涉及 `src/App.tsx`、`src/pages/HomePage.tsx`、`.env.example`、`AGENTS.md`、`README.md` 與本驗收報告，未變更 CSS 視覺或套件版本。

工作區另有 `src/components/Layout.tsx` 的格式化變更，本次未編輯或覆寫該檔；最終測試與 Build 也包含目前工作區版本，產出雜湊維持一致。

## 6. 待處理問題與驗證限制

- 尚未設定 lint；若要列入下一次必要驗收，需另行決定 ESLint 等規則及 script。
- 尚未驗證 Safari、Firefox、實體行動裝置與作業系統縮放／大字體模式。
- 尚未驗證真正 GitHub Pages 的部署設定與公開網址；已通過本機無 SPA fallback 的替代檢查。
- 完整瀏覽器驗收腳本與證據目前放在本機暫存目錄，尚未納入 Repository 或 CI；暫存檔清除後需重新準備工具。
- Mock 沒有真正網路延遲；Loading／服務錯誤／空分類透過瀏覽器內測試替身驗證，不代表正式 API 已完成。

### 本機證據位置

- 開發版主腳本：`/tmp/guess-who-phase2-qa/check.mjs`。
- 補充腳本：`/tmp/guess-who-phase2-qa/extra.mjs`。
- 開發版結果與 6 張手機／桌面截圖：`/tmp/guess-who-phase2-qa/artifacts/`。
- 正式版結果與 6 張截圖：`/tmp/guess-who-phase2-qa/production-artifacts/`。
- JSON 結果：各目錄的 `results.json`，補充結果為 `artifacts/extra-results.json`。
- 測試完成後已停止本次啟動的 Vite 與臨時靜態伺服器。

## 7. Phase 3 準備事項（只列規劃，尚未實作）

- 確認房間／玩家／題目資料契約、狀態機與 Edge Functions API 規格，之後才替換 Mock service。
- 規劃安全主持人憑證、匿名玩家 Session、重新整理恢復與權限失敗處理。
- 規劃 PostgreSQL schema、migration、RLS 及主持人／玩家可讀資料隔離；秘密金鑰只存在伺服器環境。
- 規劃伺服器每場 15 題、分類先隨機再抽人物、跨分類避免人物重複及題庫不足行為。
- 規劃 Realtime 訊息、斷線恢復、主持人操作授權與揭曉前答案保密。
- 規劃 Wikidata／Wikimedia Commons 匯入、授權標示、來源及圖片載入失敗處理。
- 在獲得下一階段授權後，才建立雲端資源、API／RLS 測試及部署流程。
