# Guess Who — Pages Release Checklist

2026-10-24（Asia/Taipei）。**Polling MVP 本機準備完成，遠端設定與發布尚未驗證。** Phase 5、6 Cloud Acceptance 已 PASS，15 位政治人物與私有圖片已匯入；不需重跑匯入。當前結果、檔案與確切 Git 計畫見 [Phase 9 Report](phase9-mvp-release-report.md)。

## 本次檢查

- `.github/workflows/pages.yml`：YAML 可解析、只有 workflow_dispatch、build→deploy 明確 needs、github-pages environment、最小權限與固定官方 Action commit；不因 Push 自動發布。
- `vite.config.ts`：base=/guess-who/；`src/App.tsx`：HashRouter。以 #/room/CODE 開啟與重新整理不依賴 Pages 路徑 rewrite。
- Workflow 固定 `VITE_ENABLE_REALTIME=false`；不需另建這個 Actions Variable。保留 Phase 7 程式碼，不部署其 Migration／Functions，不設定 ROOM_REALTIME_SIGNING_JWK。MVP 使用十秒基準 Polling，人數多時降頻、背景暫停、429 遵守 Retry-After；waiting 名單自動更新，playing 名單保留開場快照。
- 本機 npm test／Build 通過，dist 僅前端；題庫、原圖、匯入 SQL 在 ignored prepared，不打包入 dist。
- 正式網站 **Origin 是 https://chiamaureen.github.io，不含 /guess-who/**。本次對 room-system 與 game-engine 各做 OPTIONS：允許 Origin 皆 204、非法 Origin 皆 403；實際行為證實兩者目前的 Allowed Origins 已包含它，沒有讀取／展示／修改 Secret 值。
- 未連 GitHub 管理 API，故 Repository 可見性／Pages 方案資格、遠端 Variables 與 Pages Source 狀態仍待使用者登入確認；沒有聲稱 Actions 已執行成功。

## Variables / Secrets

GitHub → Settings → Secrets and variables → Actions → **Variables**：

| 名稱 | 值／用途 |
| --- | --- |
| VITE_SUPABASE_URL | https://fgvajdnzrnptdjurhjfo.supabase.co |
| VITE_SUPABASE_PUBLISHABLE_KEY | 從本機 .env.local 複製公開 Publishable Key；不在文件顯示真值 |

**不需新增 GitHub Repository Secrets。** Actions 的 GITHUB_TOKEN／OIDC 由平台提供；Workflow 不部署 Supabase，不需要 Supabase Access Token、Service Role Key、DB Password 或 ROOM_SYSTEM_SIGNING_KEY。不要把這些放進任何 VITE_。

Supabase 後端已存在：ROOM_SYSTEM_SIGNING_KEY、ROOM_SYSTEM_ALLOWED_ORIGINS，沿用即可；本次沒有新增或輪替需求。未來自訂網域或不同 GitHub owner 改 Origin 時再審查並另批准更改，不盲目加 wildcard。

## 發布前的使用者操作

1. 題庫匯入與真正 Cloud 15 題驗收已通過。尚須確認兩個遠端 Actions Variables 與 Pages Source；本機 `.env.local` 不會自動成為 Actions 設定。
2. 核對免費 Pages 資格；GitHub Free 一般需 public Repository，不自動更改可見性或購買方案。[官方說明](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
3. 設定上述兩個 Actions Variables，Settings → Pages → Build and deployment → Source=GitHub Actions。[Vite 指南](https://vite.dev/guide/static-deploy.html)
4. 審閱 git diff、確認 prepared／.env.local 沒被追蹤，再明確批准 Commit／Push 及公開發布；目前分支 main、origin=chiamaureen/guess-who。不要將以下示意視為已批准或已執行。

```sh
git status --short
git diff --check
git diff
git check-ignore -v .env.local data/question-bank/prepared/review-20261023/reviewed-bank.json
```

批准後，**只加入審核過的程式／文件檔案**，不要 git add . 或強制加入 ignored 題庫／Secrets：

```sh
git add <審核後的程式與文件清單>
git diff --cached --stat
git diff --cached
git commit -m "feat: prepare polling MVP for GitHub Pages"
git push origin main
```

5. Push 不會自動發布。GitHub Actions → Deploy GitHub Pages → Run workflow → main；如果環境有 reviewer，完成該次批准。這個手動步驟也要有明確的網站發布授權。
6. Build／test／公開設定檢查／Pages deploy 全部成功後，讀取該次 deployment page_url。預期 https://chiamaureen.github.io/guess-who/，目前未宣稱已發布。
7. 使用新的匿名 Host profile，只選政治人物；實體手機與另一獨立 Player 由邀請加入，等待室加入／離開名單自動更新。不要清除或重置既有 Host 歷史。
8. Host Start，兩 Player 不按手動刷新，自動取得第一題 PNG。逐題 Reveal→自動取得相同答案→Next→新圖片，完成 15 位不同人物，拒絕第 16 題，Finish 自動結束並停止 Polling。
9. 檢查 Player 未揭曉 question 只有 id／number／revealed，無姓名、來源、人物 ID 或 Hash。Host／Player 在揭曉前後 reload 保持 Session、題號、狀態與主持權；手機背景／斷網後恢復自動補取。429 須依 Retry-After 等待，不放寬限流。
10. 同 QA Host 開第二房應因 15 位已用完而不能開始；關閉必要 QA 房、保留歷史，不 reset。這些新增測試資料也須包含於下一次驗收授權。記錄實際 page_url、Workflow run、裝置與結果，不能以本機 fixtures、桌面手機模擬或先前 Cloud PASS 代替正式網址驗收。Critical／High 立即停止，不擅自更改 Cloud。

## 邊界

本次沒有 Git add／Commit／Push、執行 Workflow、啟用 Pages、修改 Repository 可見性／方案、設定 GitHub Variables／Secrets、變更 Supabase Secrets 或匯入 Cloud 題庫。完整遊戲驗收仍依 [Cloud Acceptance Plan](cloud-15-question-acceptance.md) 另取得可辨識測試資料寫入授權。
