# Guess Who — 猜猜我是誰

多人即時猜名人照片遊戲，目前為 **Phase 1：前端 UI 與 Mock Data**。

## 本機啟動

使用 Node.js 20.19+ 或 22.12+（或符合 Vite 要求的較新 LTS）。

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

`.env.example` 預留公開 Supabase URL / Publishable Key，本階段不讀取也不需要填寫。不可把 Service Role Key 放進 `VITE_` 變數或前端程式碼。

## GitHub Pages

Vite 設定 `base: '/guess-who/'`，React Router 採 HashRouter，網址如 `/guess-who/#/join`。重新整理時仍請求實體 `index.html`，不需要 404 轉址腳本。可將 `npm run build` 產生的 `dist/` 透過 GitHub Actions 發布至 Pages；本階段尚未設定部署 Workflow 或實際部署。

## 視覺

參考 https://about.miroom.com/ 的大字、留白與鮮明色塊方向，以黑白為主、螢光黃綠點綴，搭配括號式標籤、圓形箭頭及原創 SVG 人物卡片。首頁、主持人及玩家頁採一致的響應式視覺；未重用參考網站的圖片或品牌素材。全站透過 Google Fonts 載入 Poppins 與 Montserrat，以 Poppins 為主、Montserrat 為備援；中文字形及字體載入失敗時使用系統備援字體。

## 後續階段

- Supabase PostgreSQL schema / RLS、匿名 Session、安全主持人憑證與重新整理恢復。
- Edge Functions 房間 API、15 題無重複抽題、主持人控制與 Realtime 同步。
- 分離主持人答案與玩家可讀狀態，防止提前取得答案。
- Wikidata / Wikimedia Commons 題庫匯入、授權標示與圖片容錯。
- 真實等待室、遊戲畫面、邀請連結、端到端測試與 GitHub Pages 部署。
