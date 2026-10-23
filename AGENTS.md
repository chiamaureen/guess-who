# Guess Who 開發規則

## 架構
- 單一 Repository，前端 React + Vite + TypeScript、Tailwind CSS、React Router。
- `src/pages` 為路由頁面，`components` 為共用元件，`hooks` 統一非同步狀態。
- `src/types` 定義資料契約，`data` 放 Mock Data，`services` 為未來 API 邊界，`lib` 放驗證工具。
- 未來 Edge Functions 與 SQL migration 放 `supabase/functions` 與 `supabase/migrations`，使用 TypeScript / PostgreSQL。
- GitHub Pages base 為 `/guess-who/`，採 HashRouter，避免直接重新整理路由造成 404。

## 需求與安全
- 一房一主持人、多位匿名玩家；無註冊；每場 15 題，分類可複選。
- C 模式：同一匿名主持人跨場、跨分類不得重複人物，直到手動重置自己的歷史；不同主持人歷史獨立，提前結束不清除已使用紀錄。
- 正式版由伺服器每題先隨機選仍有未使用人物的分類，再隨機選人物，不保證分類平均。開場以 DISTINCT 人物計算至少 15 位已審核、啟用分類、該主持人未使用的題目。
- 只有主持人可開始、揭曉、換題及結束；口頭回答，由主持人判斷；不做計分、搶答、排行榜或語音辨識。
- 正式版主持人安全憑證與狀態須可跨重新整理恢復；玩家使用匿名 Session。
- 答案不得放進揭曉前的玩家回應或 Realtime payload；前端隱藏不構成權限控制。
- 正式版 Supabase RLS 與 Edge Functions 必須驗證權限；Service Role Key 等秘密只能在伺服器環境。
- Phase 4 必須明確設計資料庫 GRANT／RLS 與 Edge Functions 授權，主持人操作由伺服器驗證安全 Host Token；Publishable Key 不代表主持人權限。
- 伺服器是 Game State 的唯一權威來源；前端不可自行修改題目或進度，Realtime 不得把未揭曉的人物姓名／答案傳送給玩家。此處只記錄需求，不代表已實作。
- 題庫來源 Wikidata / Wikimedia Commons，正式匯入需保留授權、作者及來源資訊。
- 雲端服務優先免費方案，不使用常駐 Node.js server 或 Socket.IO。

## 工作規範
- 目前授權 Phase 4 Database Design v1.2：九張應用資料表、七分類 seed、Migration、GRANT／RLS、SQL 測試與設計文件；保留 Phase 2 UI 與 Mock 流程。
- Phase 5 房間 API／匿名身分、Phase 6 抽題／歷史重置實作、Phase 7 Realtime、Phase 8 題庫圖片及 Phase 9 正式部署均不在本階段。
- 實際 `supabase db push` 必須取得使用者明確確認；不得以任務授權或 sandbox 指令核准代替部署確認。部署前檢查目標 Project、既有資料、Migration history、SQL 與權限；已部署 Migration 不可修改，只能新增增量 Migration。
- `20261023060000_create_guess_who_schema.sql` 已於 2026-10-23 經使用者確認部署至既有 Cloud，禁止改寫；七分類與九表 RLS／GRANT 已驗證，不代表 Phase 5／6 功能已實作或已授權繼續開發。
- 不執行 `supabase start`、`supabase db reset`、`supabase db pull`、破壞性清除、強制 Migration repair 或自行刪除既有資料；不啟用付費資源，不自動 Commit／Push。
- Schema 使用 `celebrities` 同時容納真人與虛構人物；七個分類只 seed 分類，不含正式人物或圖片。測試 fixtures 僅供隔離的 PGlite，不得部署到 Cloud。
- 所有應用表 ENABLE／FORCE RLS。瀏覽器角色只能 SELECT 啟用分類；其他表預設拒絕，不以 `auth.uid()` 當匿名主持人身分。service_role 只有明確的資料操作權限，Edge Functions 仍須先驗證匿名憑證與房間控制權。
- Host 長期憑證、單房間 Host Token、玩家 Session 分離，資料庫只存 SHA-256 hex hash；憑證儲存／恢復是 Phase 5 設計，尚未實作。
- Phase 6 須以同一 Host 鎖序列化跨房間抽題、開始與歷史重置；題目、歷史及進度必須在同一交易提交。重置須二次確認、只清自己的歷史、無 playing 房間，不刪除 room_questions；禁止自動重置或重複舊題。
- 歷史 FK 不得因房間清除而連帶刪除去重紀錄；完成遊戲紀錄不因歷史重置而刪除。圖片檔名、來源及 Metadata 也需防答案洩漏，不能只靠隱藏姓名欄位。
- Node.js 使用 22.18+（`.nvmrc` 為 22）；最新版 Supabase SDK 不支援 Node.js 20，驗證腳本使用原生 TypeScript 載入。
- `src/lib/supabase.ts` 以 `getSupabaseClient()` 延遲建立唯一 Client；未設定時只在明確使用時回報錯誤，禁止為了測試而在首頁加入 Debug UI 或改接 Mock service。
- 前端只接受 Publishable Key，不接受 Secret／Service Role Key、Database Password 或 CLI Access Token；不要在輸出或錯誤中回顯任何金鑰。
- `.env.local`、CLI `.temp`／`.branches` 與憑證必須忽略；CLI 登入和密碼由使用者在自己的互動終端機處理，不寫入命令參數或 Repository。
- `npm run check:supabase` 只驗證初始化與真實 HTTP 200 Health Response，不代表 PostgreSQL 驗證。缺設定為 BLOCKED、請求或回應失敗為 FAIL。
- `npm run test:db` 使用隔離的 PGlite 執行 SQL／角色測試，不連雲端、不需要 Docker。必須記錄其 PostgreSQL 版本與 Cloud 版本差異；本機 PASS 不代表 Cloud 已部署或多連線併發測試通過。部署後使用 `supabase/tests/verify_schema.sql` 唯讀驗證。
- TypeScript strict，採可維護元件；共用 Loading / Error / Empty State，支援手機、鍵盤及桌面。
- 視覺參考 https://about.miroom.com/：黑白、大字留白、螢光黃綠與鮮明色塊；沿用原創素材，不複製品牌資產。
- `VITE_` 環境變數均為公開資訊，不可存放任何私密憑證。
- 每次完成工作執行可行的 `npm test`、`npm run build`，並回報結果與未完成項目。
