# Guess Who — 猜猜我是誰

一款適合朋友聚會的多人即時猜名人照片遊戲。透過房間代碼或邀請連結一起看照片、口頭猜名字，享受「啊！是他！」的瞬間。

## 核心玩法

1. 主持人建立房間，複選想玩的名人分類。
2. 玩家輸入房間代碼與暱稱加入，看照片並口頭回答。
3. 主持人判斷答案、揭曉正解，再切換下一題。

每個房間只有一位主持人，可有多位玩家；每場固定 15 題。同一主持人跨場不重複人物，直到手動重置自己的歷史。不需註冊，也不設計分或排行榜。

## 專案架構

採單一 Repository，前端為靜態網站，遊戲後端使用 Supabase，優先採用免費資源，不需要常駐 Node.js Server。

| 層級 | 技術 |
| --- | --- |
| 前端 | React、Vite、TypeScript |
| 樣式與互動 | Tailwind CSS、GSAP |
| 路由 | React Router（HashRouter） |
| 後端 | Supabase Edge Functions |
| 資料庫 | Supabase PostgreSQL |
| 即時同步 | Supabase Realtime |
| 題庫來源 | Wikidata、Wikimedia Commons |
| 前端託管 | GitHub Pages |

前端負責畫面與操作；伺服器負責遊戲狀態、隨機出題與主持人權限。玩家在揭曉前不能取得正確姓名，未來透過資料隔離、RLS 與伺服器授權保護答案。

**目前進度：** 前端 Mock 流程與 Supabase 基礎連線已完成；Phase 4 資料庫結構與安全規則已部署，通過本機 SQL 測試及雲端權限驗證。真正房間 API、匿名身分、遊戲引擎與 Realtime 尚未實作。

## 專案結構

```text
src/
  pages/        首頁、建立房間、加入房間
  components/   共用元件與互動效果
  hooks/        共用狀態與互動邏輯
  services/     Mock 服務與未來 API 串接
  lib/          Supabase Client、設定與驗證工具
  data/         Mock Data
  types/        資料型別
  styles/       全站樣式與 RWD
supabase/       CLI 設定、SQL migrations、分類 seed 與資料庫測試
scripts/        連線驗證與測試腳本
docs/           階段驗收與開發紀錄
```

## 本機開發

使用 Node.js **22.18+**，版本設定見 `.nvmrc`。

```sh
npm install
npm run dev
```

開啟 Vite 顯示的 `/guess-who/` 網址。目前建立與加入房間仍為 Mock 預覽。

需要驗證 Supabase 時，依 `.env.example` 在 `.env.local` 填入 Project URL 與 Publishable Key；不要放入私密金鑰或密碼。

- `npm test`：執行自動化測試。
- `npm run test:db`：在隔離的本機資料庫驗證 Schema 與權限，不連線雲端。
- `npm run build`：檢查 TypeScript 並建置前端。
- `npm run check:supabase`：驗證 SDK 初始化與雲端 Auth API 連線。

開發規範見 [AGENTS.md](AGENTS.md)，資料庫設計與 ERD 見 [Database Schema](docs/database-schema.md)，各階段驗收結果見 [docs](docs/)。
