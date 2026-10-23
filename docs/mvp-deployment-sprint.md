# Guess Who — MVP Deployment Sprint

2026-10-23，台灣時間。首次實查約 19:57，**未能在 20:00 前完成公開可玩的 MVP**；不以未審核題庫或本機 PASS 冒充正式上線。

**後續更新：** 以下保留當時候選尚未審核的部署收據。現已完成 15 位本機來源／視覺審核與匯入批次（原 13＋補 2），見 [Phase 8 Review](phase8-minimum-bank-review.md)；Cloud 仍為 0，匯入、QA 寫入與 Git／Pages 仍待批准。

## Current Status

| 項目 | 實際結果 |
| --- | --- |
| Phase 6 Dry Run | **PASS**，唯一 20261023120000_game_engine.sql；無 seed／roles／Vault |
| Migration | 使用者另外明確批准後已部署；三個版本 local／remote history 一致 |
| 新私表／RLS／GRANT／RPC | **PASS**，Cloud READ ONLY verify_game_engine.sql 全部 guard 通過 |
| Schema drift | **PASS**，原 checker 十表範圍零差異，新圖片表另由 verify_game_engine.sql 覆蓋 |
| game-engine | **ACTIVE v1，verify_jwt=false**，自訂匿名憑證仍必須通過 |
| Secrets | 沿用 ROOM_SYSTEM_SIGNING_KEY、ROOM_SYSTEM_ALLOWED_ORIGINS；僅核對名稱，沒有設定或輪替 |
| Cloud CORS／公開角色隔離 | **PASS**，Pages Origin OPTIONS 204、非法 Origin 403、asset SELECT／直接 game RPC 皆 42501 |
| 雲端人物／審核通過／審核圖片／實際可用 | **0／0／0／0**（PG17.11 真正唯讀查詢） |
| 候選題庫 | 15 位真人，Wikidata／Commons Metadata 可追溯且均標示 Public domain；**人工審核通過仍為 0** |
| GitHub Pages Workflow | 已建立且本機 YAML 驗證通過；**尚未 Push 或執行** |
| 公開前端環境變數 | 本機設定驗證 PASS、Workflow 已接 Actions vars；GitHub 遠端 vars 尚待使用者設定 |
| 完整 Cloud 15 題多人流程 | **BLOCKED**，缺正式審核題庫／安全 PNG 與題庫寫入、遊戲測試授權 |
| 正式公開網址 | **尚未發布／未驗證**；預期 https://chiamaureen.github.io/guess-who/ |

## Phase 6 Deployment Receipt

使用者只批准：唯一 Migration、唯讀 Schema／RLS／GRANT／RPC 驗證、部署 game-engine。**不包含題庫寫入、Secrets 更動、Commit／Push 或 Pages 發布。**

已執行順序：核對 linked ref fgvajdnzrnptdjurhjfo→Migration List→Dry Run→批准→再次 Dry Run→實際 push→READ ONLY guard→部署 Function→history／schema drift／ACTIVE／僅名稱 Secrets／無資料寫入的 gateway 隔離測試。

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db push --dry-run --linked --skip-vault
npx --no-install supabase db push --linked --skip-vault --yes
npx --no-install supabase db query --linked --file supabase/tests/verify_game_engine.sql
npx --no-install supabase functions deploy game-engine --project-ref fgvajdnzrnptdjurhjfo --use-api
npm run check:db
```

push 使用 linked ref，沒有無效的 --project-ref，也沒有 include-seed／Vault／reset／repair。原 Phase 4、5 完全不變；已部署 Phase 6 現亦不可改寫：

`20261023120000_game_engine.sql` SHA-256：`4c76a0e386267effe6c2b21f9193a96f08d6350ccfd8bef7b2a2da4aea383589`。

新增一張私有 game_image_assets（十一表）、room_questions.game_image_id／複合 FK、三個 INVOKER／空 search_path／service-only 函式；沒有 SECURITY DEFINER、browser 讀答案權限或 Realtime publication。既有已審平台 event trigger 警告不變。

Cloud OPTIONS 不呼叫業務 RPC；直接 REST／RPC 負向測試在權限層拒絕，沒有建立房間、Host、Player、題目、歷史或限流資料。未執行使用 fixture 的正式題庫寫入。完整資料層答案 DTO 仍只有先前本機證據，沒有空題庫 Cloud 的假 PASS。

## Minimum Corpus Preparation

- `scripts/prepare-question-bank.mjs` 只 GET 官方 Wikidata P18、Commons Imageinfo／extmetadata，保存作者、授權、檔案／Wikidata 版本、來源頁與原始 SHA1。
- 本次 `data/question-bank/prepared/candidates-mvp.json` 為 15 位真人政治人物，Metadata 均 Public domain；不是動畫，也沒有取得不明權利圖充數。**Metadata 是審核線索，不是完整審核。**
- 全部 approved=false；subject／rights／image=false。沒有下載正式圖片、沒有補授權宣稱、沒有把來源 URL 當安全遊戲圖。
- 需要逐檔確認權利及適用範圍、正確人物、署名時機、無答案水印；再產生可解碼、去 Metadata 的中性 PNG，填審核者／時間／相對路徑／SHA-256。
- `scripts/prepare-question-import.mjs` 只產生本機 SQL，拒絕未審核／非白名單授權／重複人物／目錄外圖片／PNG 或摘要不符；純 INSERT、單交易，不用 UPSERT 覆蓋舊資料。不含 Cloud 連線能力。
- 對未審候選實際執行工具，結果 **BLOCKED**，沒有產生可匯入 SQL 或寫入 Cloud。合成 15 人／PNG 的 SQL 正向流程已在獨立 PGlite 測通；不是正式題庫審核。
- prepared 目錄被 Git 忽略且不在 src／public，不會將原始圖片 Metadata 打包給玩家。完整步驟見 [Question Bank](../data/question-bank/README.md)。

## Pages Preparation

`.github/workflows/pages.yml` 只接受 **workflow_dispatch**，不會因 Push 自動發布。分開 build／deploy，最小 permissions、github-pages environment、OIDC 與固定官方 Action commit；checkout 不保留 Git credential。先 npm ci、驗公開設定、npm test、Build，再上傳 dist／deploy。

- Vite base=/guess-who/，HashRouter；重新整理 #/room/CODE 不需伺服器 SPA rewrite。
- 使用 Node .nvmrc=22；本機 check-pages-env 驗證 URL 指向指定專案且只接受 Publishable Key，不輸出 key。
- GitHub Repository → Settings → Secrets and variables → Actions → **Variables**，設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_PUBLISHABLE_KEY（從本機 .env.local 複製；不在報告展示金鑰）。不要將後端 Secrets 放入 VITE。
- 使用者登入 GitHub 後需核對免費 Pages 資格，Settings → Pages → Source=GitHub Actions。若為 GitHub Free，官方文件要求 public Repository；本次未確認 Repository 可見性／方案，不自動公開程式庫或購買方案。
- Workflow／遠端 variables／Pages Source／發布尚未遠端驗證；本機 YAML 能解析不代表 GitHub Actions 已成功執行。

依據：[GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Vite Pages deployment](https://vite.dev/guide/static-deploy.html)。

## Tests and Security

- 本次重新 `npm test`：**168 PASS**＝52 Vitest＋21 Health＋37 Phase 4＋27 Phase 5＋26 Game＋5 題庫工具測試；Edge TypeScript PASS。原 Phase 5 tests 改為只重播其已部署 snapshot，Game tests 重播正式三個 Migration，不重複套草案。
- `npm run build` PASS；`check-pages-env` 對真實本機公開設定 PASS；未審匯入負向測試 BLOCKED（預期安全拒絕）。
- 題庫工具五項包含：未審核拒絕、少於 15／重複拒絕、未知授權／限制拒絕、結構驗證、真正隔離 SQL 插入 15 位與圖片並拒絕覆蓋輸出。
- Workflow YAML 解析／manual-only trigger／job dependency PASS；沒有聲稱已在 Actions 執行。
- 既有 71 browser／六組 PG17 concurrency 是前次本機驗收證據；本次只做 Migration 納管／工具／Workflow，未重跑該瀏覽器與併發全套，不冒稱新跑。
- git diff --check、env 忽略、工作檔／diff／歷史敏感模式掃描通過；沒有私密憑證進前端或 Git。本代理沒有 Commit／Push；不覆寫使用者在 IDE 自行做的 Git 操作。

**未發現新的 Critical／High；但「可公開遊玩的 MVP」仍 NOT READY。** 題庫人工審核、匯入、Cloud 15 題驗收與前端發布關卡未完成。不得為了截止時間跳過。

## Remaining Approval Gates

1. 完成至少 15 位正式素材／授權／圖片審核，審閱 generated SQL；另批准只新增這批題庫資料。未批准不執行遠端匯入。
2. 另批准可辨識的 Cloud Host／Player／Room 整合測試資料：兩角色、15 題、刷新、答案隔離、跨場不足與 reset；未通過不能標記可玩完成。
3. 使用者設定 GitHub 公開 vars 與 Pages Source，確認免費可用資格；必要的 Repository 可見性變更須另決定。
4. 審核所有本機修改後，**另外批准** Commit／Push 的檔案／分支及網站公開發布。此時才可執行 git add／commit／push、手動觸發 Pages Workflow（目前均未執行）。
5. Workflow 成功後讀取 deployment page_url，實測 /guess-who/、HashRouter 刷新、正式 Origin CORS、實際多人遊戲，才能提供「已驗證可用」正式網址。

目前沒有待套用 Migration、待部署 Function 或必須新增的 Secret；待批准的是題庫寫入／Cloud 測試與 Git／Pages 發布。Realtime 尚未開發，現階段玩家仍按 Refresh State 手動更新。
