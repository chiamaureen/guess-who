# Guess Who — Pages Release Checklist

**本機準備 READY，遠端發布尚未執行。** 不代表題庫已匯入或正式網址已可遊玩。

## 本次檢查

- `.github/workflows/pages.yml`：YAML 可解析、只有 workflow_dispatch、build→deploy 明確 needs、github-pages environment、最小權限與固定官方 Action commit；不因 Push 自動發布。
- `vite.config.ts`：base=/guess-who/；`src/App.tsx`：HashRouter。以 #/room/CODE 開啟與重新整理不依賴 Pages 路徑 rewrite。
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

1. 題庫匯入與真正 Cloud 15 題驗收先各取得批准並通過，否則只能發布不能開始遊戲的 UI，不能稱可玩 MVP。
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
git commit -m "Prepare reviewed MVP question bank and release checks"
git push origin main
```

5. Push 不會自動發布。GitHub Actions → Deploy GitHub Pages → Run workflow → main；如果環境有 reviewer，完成該次批准。這個手動步驟也要有明確的網站發布授權。
6. Build／test／公開設定檢查／Pages deploy 全部成功後，讀取該次 deployment page_url。預期 https://chiamaureen.github.io/guess-who/，目前未宣稱已發布。
7. 以兩個真實瀏覽器／手機確認首頁、加入連結、#/room 刷新、正式 Origin CORS、照片、答案隔離與 15 題；不可用 fixture 攔截。任何錯誤停止，不為上線放寬權限或改成假成功。

## 邊界

本次沒有 Git add／Commit／Push、執行 Workflow、啟用 Pages、修改 Repository 可見性／方案、設定 GitHub Variables／Secrets、變更 Supabase Secrets 或匯入 Cloud 題庫。完整遊戲驗收仍依 [Cloud Acceptance Plan](cloud-15-question-acceptance.md) 另取得可辨識測試資料寫入授權。
