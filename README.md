# Guess Who — 猜猜我是誰

一款適合朋友聚會的多人即時猜名人照片遊戲。透過房間代碼或邀請連結一起看照片、口頭猜名字，享受「啊！是他！」的瞬間。

**網站：** [Guess Who](https://chiamaureen.github.io/guess-who/)

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
| 畫面同步 | MVP 使用低頻 Polling；Supabase Realtime 暫緩部署 |
| 題庫來源 | Wikidata、Wikimedia Commons |
| 前端託管 | GitHub Pages |

前端負責畫面與操作；伺服器負責遊戲狀態、隨機出題與主持人權限。房間與遊戲引擎分為獨立 Edge Functions，透過資料隔離、RLS 與伺服器授權保護答案；圖片透過私有入口提供，不公開原始檔名。

**目前進度：** GitHub Pages MVP 已發布，公開網站唯讀 Smoke Test 通過。房間系統、遊戲引擎與 15 位政治人物題庫已上雲，完整 15 題及答案隔離已通過先前雲端驗收；正式網址多人遊戲尚待另行驗收。MVP 使用 Polling 同步，Realtime 程式碼保留、尚未部署。

## 專案結構

```text
src/
  pages/        首頁、建立房間、加入房間與房間頁
  components/   遊戲面板、共用元件與互動效果
  hooks/        共用狀態與互動邏輯
  services/     房間 API、分類讀取與 Session 管理
  lib/          Supabase Client、設定與驗證工具
  types/        資料型別
  styles/       全站樣式與 RWD
supabase/       Edge Functions、SQL migrations／待審草案、分類 seed 與隔離測試
scripts/        連線驗證與測試腳本
docs/           階段驗收與開發紀錄
```

## 本機開發

使用 Node.js **22.18+**，版本設定見 `.nvmrc`。

```sh
npm install
npm run dev
```

開啟 Vite 顯示的 `/guess-who/` 網址。分類與房間服務使用已部署的 Supabase；本機 origin 必須列入後端 allowlist，連線失敗會顯示錯誤，不會假裝成功。

使用分類與房間服務前，依 `.env.example` 在 `.env.local` 填入 Project URL 與 Publishable Key；不要放入私密金鑰或密碼。

`VITE_ENABLE_REALTIME=false` 為 MVP 預設；房間前景約每 10 秒更新，人數較多時降頻，背景／離線暫停，遇限流自動退避。沿用已部署的 Phase 5、6 API，不需 Realtime JWT。2026-10-24 最新唯讀盤點確認：雲端保留 15 位政治人物，但目前僅 2 位可抽題，暫不足開始 15 題；歷史不會自動重置。詳見 [Cloud 題庫盤點](docs/phase8-test-bank-v3-cloud-inventory.md)。

- `npm test`：執行自動化測試。
- `npm run test:db`：在隔離的本機資料庫驗證 Schema 與權限，不連線雲端。
- `npm run test:rooms`：驗證房間 API、匿名身分、權限與待審 SQL，不連線雲端。
- `npm run test:game`：以隔離題庫驗證遊戲交易、答案隔離及跨場歷史，不連線雲端。
- `npm run check:edge`：檢查 Edge Function TypeScript。
- `npm run build`：檢查 TypeScript 並建置前端。
- `npm run check:supabase`：驗證 SDK 初始化與雲端 Auth API 連線。
- `npm run check:db`：重播隔離的本機 Schema，與已連結雲端結構進行唯讀比對。

開發規範見 [AGENTS.md](AGENTS.md)，架構見 [Database Schema](docs/database-schema.md)、[Room System](docs/room-system.md) 與 [Game Engine](docs/game-engine.md)。驗收紀錄見 [Phase 5 Cloud Report](docs/phase5-cloud-deployment-report.md) 與 [Phase 6 Report](docs/phase6-game-engine-report.md)。

目前發布關卡見 [MVP Deployment Sprint](docs/mvp-deployment-sprint.md)；題庫準備見 [Question Bank](data/question-bank/README.md)。

最新題庫規劃為 [Phase 8 測試題庫 v3](docs/phase8-test-bank-v3-report.md)：八組 180 位候選，目前僅完成本機候選與待審 Seed，尚未形成正式可玩或已匯入的新題庫。

優先批次見 [Demo120 準備報告](docs/phase8-demo-120-report.md)：保留其餘60位，目前僅2位完成工程審核，尚未形成可正式匯入的完整批次。

最新 [題庫審核](docs/phase8-minimum-bank-review.md)、[雲端 15 題驗收流程](docs/cloud-15-question-acceptance.md) 與 [Pages 發布清單](docs/pages-release-checklist.md)。
