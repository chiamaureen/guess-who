# Guess Who — 猜猜我是誰

多人即時猜名人照片遊戲，目前為 **Phase 2 Frontend Setup：前端 UI 與 Mock Data**。

Phase 2 的範圍、實測結果、修正與後續準備事項見 [驗收報告](docs/phase2-acceptance.md)。

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

首頁 `.ticker` 使用 GSAP 與 Observer，參考 https://demos.gsap.com/demo/directional-marquee/：文字持續無縫循環。桌面（1025px 以上）向下捲動時向左、向上捲動時向右，捲動後短暫加速再回到原速；平板與手機（1024px 以下）固定向左、等速播放，不監聽頁面捲動。`DirectionalMarquee` 使用 ResizeObserver 在字體載入及尺寸變更後更新週期，透過 matchMedia 切換尺寸對應模式，並於卸載時清理動畫和監聽；偏好減少動態效果時改為靜態文字。

建立與加入房間的首頁入口及建立房間表單提交按鈕使用 GSAP 磁吸效果，參考 https://demos.gsap.com/demo/magnetic-button-overwrite-modes/ 的 magnetic only：滑鼠移動時按鈕及文字跟隨，離開後彈性回位，使用 `overwrite: true` 避免動畫衝突。觸控、停用狀態與減少動態效果模式不啟用磁吸；保留原生連結與表單提交行為。「預覽加入房間」使用一般按鈕，不啟用磁吸、懸停位移或過渡動畫。

首頁三張人物卡片也使用共用 `useMagnetic` Hook，整張卡片跟隨滑鼠並彈性回位。定位與原始傾斜放在外層，動畫只移動內層卡片，保留重疊順序及傾斜角度；同樣支援觸控與減少動態效果設定。

## 後續階段

- Supabase PostgreSQL schema / RLS、匿名 Session、安全主持人憑證與重新整理恢復。
- Edge Functions 房間 API、15 題無重複抽題、主持人控制與 Realtime 同步。
- 分離主持人答案與玩家可讀狀態，防止提前取得答案。
- Wikidata / Wikimedia Commons 題庫匯入、授權標示與圖片容錯。
- 真實等待室、遊戲畫面、邀請連結、端到端測試與 GitHub Pages 部署。
