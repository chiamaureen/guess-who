# Guess Who 開發規則

## 架構
- 單一 Repository，前端 React + Vite + TypeScript、Tailwind CSS、React Router。
- `src/pages` 為路由頁面，`components` 為共用元件，`hooks` 統一非同步狀態。
- `src/types` 定義資料契約，`data` 放 Mock Data，`services` 為未來 API 邊界，`lib` 放驗證工具。
- 未來 Edge Functions 與 SQL migration 放 `supabase/functions` 與 `supabase/migrations`，使用 TypeScript / PostgreSQL。
- GitHub Pages base 為 `/guess-who/`，採 HashRouter，避免直接重新整理路由造成 404。

## 需求與安全
- 一房一主持人、多位匿名玩家；無註冊；每場 15 題，分類可複選。
- 正式版由伺服器每題先隨機選仍有未使用人物的分類，再隨機選人物，同場人物不重複。
- 只有主持人可開始、揭曉、換題及結束；口頭回答，由主持人判斷；不做計分、搶答、排行榜或語音辨識。
- 正式版主持人安全憑證與狀態須可跨重新整理恢復；玩家使用匿名 Session。
- 答案不得放進揭曉前的玩家回應或 Realtime payload；前端隱藏不構成權限控制。
- 正式版 Supabase RLS 與 Edge Functions 必須驗證權限；Service Role Key 等秘密只能在伺服器環境。
- 題庫來源 Wikidata / Wikimedia Commons，正式匯入需保留授權、作者及來源資訊。
- 雲端服務優先免費方案，不使用常駐 Node.js server 或 Socket.IO。

## 工作規範
- 目前為 Phase 3 Supabase Setup：只允許 SDK／CLI、環境設定、共用 Client 與唯讀 Auth Health 驗證；Phase 2 UI 與 Mock 流程必須保留。
- Phase 4 的資料表、Schema、RLS、資料庫查詢、房間 API、遊戲引擎、Realtime 與正式部署需另行明確授權。
- 不執行 `supabase start`、`supabase db reset`、`supabase db push`、`supabase db pull` 或其他資料庫修改；不啟用付費資源。
- Node.js 使用 22.18+（`.nvmrc` 為 22）；最新版 Supabase SDK 不支援 Node.js 20，驗證腳本使用原生 TypeScript 載入。
- `src/lib/supabase.ts` 以 `getSupabaseClient()` 延遲建立唯一 Client；未設定時只在明確使用時回報錯誤，禁止為了測試而在首頁加入 Debug UI 或改接 Mock service。
- 前端只接受 Publishable Key，不接受 Secret／Service Role Key、Database Password 或 CLI Access Token；不要在輸出或錯誤中回顯任何金鑰。
- `.env.local`、CLI `.temp`／`.branches` 與憑證必須忽略；CLI 登入和密碼由使用者在自己的互動終端機處理，不寫入命令參數或 Repository。
- `npm run check:supabase` 必須區分初始化與真實 HTTP 200 Health Response；缺設定為 BLOCKED、請求或回應失敗為 FAIL，PostgreSQL 留待 Phase 4。模擬測試不能替代真實雲端驗證。
- TypeScript strict，採可維護元件；共用 Loading / Error / Empty State，支援手機、鍵盤及桌面。
- 視覺參考 https://about.miroom.com/：黑白、大字留白、螢光黃綠與鮮明色塊；沿用原創素材，不複製品牌資產。
- `VITE_` 環境變數均為公開資訊，不可存放任何私密憑證。
- 每次完成工作執行可行的 `npm test`、`npm run build`，並回報結果與未完成項目。
