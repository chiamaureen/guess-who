# Guess Who — 猜猜我是誰

多人即時猜名人照片遊戲，目前為 **Phase 3：Supabase Setup**。Phase 2 頁面與 Mock 流程維持原狀，尚未串接真正房間或遊戲。

Phase 2 的範圍、實測結果、修正與後續準備事項見 [驗收報告](docs/phase2-acceptance.md)。
Phase 3 的實際驗證結果與待處理事項見 [Supabase Setup Report](docs/phase3-supabase-setup.md)。

## 本機啟動

使用 **Node.js 22.18+**。最新版 Supabase SDK 需要 Node.js 22，驗證腳本亦以此版本的原生 TypeScript 載入能力執行；`.nvmrc` 固定使用 Node.js 22。若使用 nvm：

```sh
nvm install
nvm use
node --version
```

```sh
npm install
npm run dev
npm test
npm run build
npm run preview
```

開啟 Vite 顯示的 `/guess-who/` 網址。首頁、`#/host`、`#/join` 分別為首頁、主持人分類選擇、玩家加入表單；`#/join?code=ABC123` 可預填房間代碼。送出表單只顯示預覽結果，不建立或加入真正房間。

## 結構

```text
src/
  components/  共用 Layout、插畫、回饋元件
  data/        Mock 分類
  hooks/       統一處理 Loading 與 API 錯誤
  lib/         輸入驗證與測試
  pages/       首頁、建立房間、加入房間
  services/    可替換為 Edge Functions 的服務介面
  styles/      Tailwind 與 RWD 樣式
  types/       遊戲資料契約
```

`src/lib/supabase.ts` 提供共用 Client；環境設定與連線驗證方式見下節。不可把 Service Role Key 放進 `VITE_` 變數或前端程式碼。

## Supabase 架構與本階段範圍

- 本階段只安裝 `@supabase/supabase-js`、開發用 CLI、建立本機設定與驗證雲端 Auth Health API。
- 未來後端採 Supabase PostgreSQL、Edge Functions 與 Realtime，前端仍部署 GitHub Pages，不需要常駐 Node.js Server。
- 本階段不建立正式資料表、不查詢 PostgreSQL、不建立房間 API、不實作遊戲引擎或 Realtime，也不部署。
- 使用既有 Free Project，不啟用付費功能。地區依 Dashboard 的可用選項，優先鄰近台灣的 Tokyo／Singapore。

### Project 與環境變數

1. 至 [Supabase Dashboard](https://supabase.com/dashboard) 建立或選擇 Free Project。
2. 從專案網址 `/dashboard/project/<project-ref>` 或 Project Settings 取得 Reference ID。
3. 從 **Connect** 面板取得 Project URL 與 Publishable Key，或至 **Settings > API Keys** 查詢 Publishable Key。
4. 第一次設定時將 `.env.example` 複製為 `.env.local`；若檔案已存在，直接編輯，避免覆蓋有效設定。

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

替換所有示意值，Publishable Key 應以 `sb_publishable_` 開頭。更動後重新啟動 Vite。

- Publishable Key 是可公開的應用程式金鑰，**不代表主持人或玩家身分，也不授予主持人權限**。
- 所有 `VITE_` 變數都可能進入前端產物；禁止使用 Secret Key、Service Role Key、Database Password 或 CLI Access Token。
- `.env.local` 被 Git 忽略；`.env.example` 只保留示意值。不要把真實金鑰貼到對話、報告或命令參數。
- 本階段只接受標準 `https://<20-character-ref>.supabase.co` 雲端 URL，不接受自訂網域、路徑、查詢參數或 URL 登入資訊，避免誤將 apikey 送往其他網域。

### 共用 Client

```ts
import { getSupabaseClient } from './lib/supabase'

const supabase = getSupabaseClient()
```

一般前端程式不傳入參數，由 `import.meta.env` 讀取設定。Client 只在第一次明確呼叫時建立並共用；匯入模組不會因缺少設定破壞既有 UI。設定無效時提供不包含金鑰的錯誤訊息。

目前關閉 `persistSession`、`autoRefreshToken` 與 `detectSessionInUrl`，不讀寫登入 Session，也不把 HashRouter fragment 當作 Auth callback。未來匿名 Session／主持人認證需在後續階段另行設計，不能把目前 Client 視為完成認證。既有 Mock service 不呼叫此 Client。

### Supabase CLI

SDK 為 runtime dependency，CLI 為鎖定版本的 dev dependency；`npm install` 會安裝兩者，不使用全域 CLI。

```sh
npm ls @supabase/supabase-js supabase
npx --no-install supabase --version
```

只有 `supabase/config.toml` 不存在時才初始化，不使用 `--force`：

```sh
npx --no-install supabase init
```

登入必須由你在自己的互動終端機執行並完成瀏覽器授權：

```sh
npx --no-install supabase login
npx --no-install supabase projects list
npx --no-install supabase link --project-ref YOUR_PROJECT_REF
```

若要求資料庫密碼，只在本機安全互動提示輸入；Reference ID 不是密碼。不要使用 `--token`／`--password` 參數，也不要把 CLI Access Token 存入 Repository。CLI 的登入憑證由 CLI 管理在使用者層級；本機連結記錄在被忽略的 `supabase/.temp/`。

`config.toml` 是 CLI 初始化產生的設定範本；其中本機服務設定不代表服務已啟動或雲端設定已套用。**不執行 `supabase start`、`supabase db reset`、`supabase db push`、`supabase db pull`，也不需要 Docker 或本機 PostgreSQL。**

### 真實雲端連線測試

在 Node.js 22.18+ 與 `.env.local` 就緒後執行：

```sh
npm run check:supabase
npm test
npm run build
```

`check:supabase` 從 `.env.local` 安全解析設定，也支援同名環境變數覆寫，以便未來 CI 使用；不執行 env 檔內容、不載入其他憑證。它以相同共用 Client 函式進行 SDK 初始化，然後另行發送 `GET /auth/v1/health`，只在 `apikey` header 帶入 Publishable Key，不跟隨重新導向、不輸出金鑰，逾時為 10 秒。

| 檢查 | 通過標準 |
| --- | --- |
| SDK Initialization | 使用提供的真實設定建立 Client；不代表連線成功 |
| Cloud Auth API Connectivity | 實際 HTTP 200，且 JSON 的 name 為 GoTrue、version 符合版本格式、description 為認證 API 說明 |
| PostgreSQL Query | NOT TESTED，Phase 4 才驗證 |

缺少設定或仍為示意值回報 BLOCKED，HTTP 401／403／404、DNS、網路、逾時、無效 JSON 或非 Health Response 回報 FAIL。結束碼為 PASS=`0`、FAIL=`1`、BLOCKED=`2`。若執行環境的沙箱限制網路，需取得網路授權後重跑，不可將失敗改寫成 PASS。

`npm test` 包含 Vitest 與 Node 原生測試；腳本中的 fixture-only 測試只驗證判斷邏輯，不能替代上述真實 Health Check。Repository 尚未設定 lint script。

官方參考：[API Keys](https://supabase.com/docs/guides/getting-started/api-keys)、[Auth Health Endpoint](https://supabase.com/kb/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR)、[CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)、[SDK Node.js 支援政策](https://github.com/supabase/supabase-js#support-policy)。

## GitHub Pages

Vite 設定 `base: '/guess-who/'`，React Router 採 HashRouter，網址如 `/guess-who/#/join`。重新整理時仍請求實體 `index.html`，不需要 404 轉址腳本。可將 `npm run build` 產生的 `dist/` 透過 GitHub Actions 發布至 Pages；本階段尚未設定部署 Workflow 或實際部署。

未來 GitHub Actions **建置時**必須提供 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。本機 `.env.local` 不會上傳，GitHub Pages 也沒有執行時的伺服器環境變數；更新設定需重新建置。不得將任何 Secret／Service Role Key、Database Password 或 CLI Access Token 作為 `VITE_` 變數傳入。本階段不新增部署 Workflow。

## 視覺

參考 https://about.miroom.com/ 的大字、留白與鮮明色塊方向，以黑白為主、螢光黃綠點綴，搭配括號式標籤、圓形箭頭及原創 SVG 人物卡片。首頁、主持人及玩家頁採一致的響應式視覺；未重用參考網站的圖片或品牌素材。全站透過 Google Fonts 載入 Poppins 與 Montserrat，以 Poppins 為主、Montserrat 為備援；中文字形及字體載入失敗時使用系統備援字體。

首頁 `.ticker` 使用 GSAP 與 Observer，參考 https://demos.gsap.com/demo/directional-marquee/：文字持續無縫循環。桌面（1025px 以上）向下捲動時向左、向上捲動時向右，捲動後短暫加速再回到原速；平板與手機（1024px 以下）固定向左、等速播放，不監聽頁面捲動。`DirectionalMarquee` 使用 ResizeObserver 在字體載入及尺寸變更後更新週期，透過 matchMedia 切換尺寸對應模式，並於卸載時清理動畫和監聽；偏好減少動態效果時改為靜態文字。

建立與加入房間的首頁入口及建立房間表單提交按鈕使用 GSAP 磁吸效果，參考 https://demos.gsap.com/demo/magnetic-button-overwrite-modes/ 的 magnetic only：滑鼠移動時按鈕及文字跟隨，離開後彈性回位，使用 `overwrite: true` 避免動畫衝突。觸控、停用狀態與減少動態效果模式不啟用磁吸；保留原生連結與表單提交行為。「預覽加入房間」使用一般按鈕，不啟用磁吸、懸停位移或過渡動畫。

首頁三張人物卡片也使用共用 `useMagnetic` Hook，整張卡片跟隨滑鼠並彈性回位。定位與原始傾斜放在外層，動畫只移動內層卡片，保留重疊順序及傾斜角度；同樣支援觸控與減少動態效果設定。

## Phase 4 與後續階段（尚未實作）

- Supabase PostgreSQL schema / RLS、匿名 Session、安全主持人憑證與重新整理恢復。
- Edge Functions 房間 API、15 題無重複抽題、主持人控制與 Realtime 同步。
- 分離主持人答案與玩家可讀狀態，防止提前取得答案。
- Wikidata / Wikimedia Commons 題庫匯入、授權標示與圖片容錯。
- 真實等待室、遊戲畫面、邀請連結、端到端測試與 GitHub Pages 部署。
