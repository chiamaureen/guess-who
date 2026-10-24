# Guess Who 開發規則

## 架構
- 單一 Repository，前端 React + Vite + TypeScript、Tailwind CSS、React Router。
- `src/pages` 為路由頁面，`components` 為共用元件，`hooks` 統一非同步狀態。
- `src/types` 定義資料契約，`services` 為房間 API／Session 邊界，`lib` 放 Client、驗證與儲存工具；分類動態讀取 Database，不以 Mock 假裝成功。
- Edge Functions 與 SQL migration 放 `supabase/functions` 與 `supabase/migrations`；待審 SQL 在 `supabase/migration-drafts`，不會被 CLI 自動部署。
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
- Phase 5 Room System 已完成本機與 Cloud 驗收：匿名 Host、建立／加入、等待室、Session 恢復／離開／關閉；保留既有視覺／RWD，不重複開發已完成的功能。
- 使用者已明確批准並完成本次限定 Cloud 部署：ref fgvajdnzrnptdjurhjfo、唯一 Phase 5 Migration、兩個自訂 Secrets、room-system v1 與可辨識 QA 新資料。這不是後續變更的永久授權；新 Cloud 寫入／部署需另批准，仍不 Commit／Push 或發布 GitHub Pages。
- Phase 6 本機與 Cloud 完整 15 題驗收均 PASS；Phase 8 已匯入 15 位可用人物，使用者另批准新 QA Host／Player／兩房的真實驗收。兩 QA 房 DPK86G／D5U556 已 finished，15 題不重複、15 筆該 Host 歷史保留、同 Host 第二場題庫不足被拒，沒有 reset。詳見 `docs/phase6-cloud-acceptance-report.md`。Phase 7 僅本機已完成，Cloud 尚未批准或部署。只用本對話，不使用 Subagents／Worktree；不加入多房協調或資料庫單房限制。
- 實際 `supabase db push` 必須取得使用者明確確認；不得以任務授權或 sandbox 指令核准代替部署確認。部署前檢查目標 Project、既有資料、Migration history、SQL 與權限；已部署 Migration 不可修改，只能新增增量 Migration。
- `20261023060000_create_guess_who_schema.sql` 與 `20261023093000_room_system.sql` 均已於 2026-10-23 經使用者確認部署，禁止改寫；後者 digest 為 d4917bd4d103b537a575e87d78e100dda4bf71b0b3865525b3b26954f76ad10f。十表／三 RPC／RLS／GRANT 已驗證，不代表 Phase 6 引擎已實作。
- 不執行 `supabase start`、`supabase db reset`、`supabase db pull`、破壞性清除、強制 Migration repair 或自行刪除既有資料；不啟用付費資源，不自動 Commit／Push。
- Schema 使用 `celebrities` 同時容納真人與虛構人物；七個分類只 seed 分類，不含正式人物或圖片。測試 fixtures 僅供隔離的 PGlite，不得部署到 Cloud。
- 所有應用表 ENABLE／FORCE RLS。瀏覽器角色只能 SELECT 啟用分類；其他表預設拒絕，不以 `auth.uid()` 當匿名主持人身分。service_role 只有明確的資料操作權限，Edge Functions 仍須先驗證匿名憑證與房間控制權。
- Host 長期憑證、單房間 Host Token、玩家 Session 分離，以用途分離 SHA-256 hex hash 存 DB。瀏覽器 localStorage 保存 bearer 憑證，Web Locks 序列化跨分頁首次建立；不得把身分、Token 放在邀請 URL、log 或分析資料。
- `room-system` 單一 Edge Function 提供六個 action。`verify_jwt=false` 不是授權：仍須驗證執行環境的 Publishable Key、Host／Room／Player 憑證、來源與限流，禁止信任 Host ID／Player ID／前端 role。
- 建立房間與分類同交易；requestKey／joinKey 的失敗重試沿用原資料，網路錯誤不得自動清除憑證。Phase 7 私有 Broadcast 保留但暫緩部署；MVP 依 Phase 9 規則使用 Polling，手動按鈕保留作備援。Start 仍走真實遊戲 API，沒有 Mock fallback。
- `ROOM_SYSTEM_SIGNING_KEY` 與 `ROOM_SYSTEM_ALLOWED_ORIGINS` 僅限 Edge 後端設定；新 API Keys 優先讀取執行環境 `SUPABASE_SECRET_KEYS`／`SUPABASE_PUBLISHABLE_KEYS`，不把後端 Secrets 放進 VITE。跨站 Cookie 不是此 MVP 的身分恢復保證。
- Phase 6 單房寫入固定先鎖驗證後的 Host、再鎖 Room，Host 鎖只沿用既有順序並防 reset 與抽題競態，不加入多房調度。題目、歷史及進度同交易；Next 綁定原 questionId，重送不可多前進。重置須二次確認與原 historyRevision、只清自己的歷史、無 playing 房間（含過期尚未結束者），不刪除 room_questions。
- 新增 `game-engine` Function，沿用 Phase 5 signing key／origins／H-01 gate；state／image 共用 get-room-state 限流，修改共用 close-room 限流，不接受任意 scope。七個 action 包含私有 get-question-image，verify_jwt=false 仍須驗證 apikey 與三種自訂憑證。不可自動部署／重設既有 secrets。
- Phase 6 `supabase/migrations/20261023120000_game_engine.sql` 已經使用者批准納管並部署，SHA-256 為 4c76a0e386267effe6c2b21f9193a96f08d6350ccfd8bef7b2a2da4aea383589，現在亦禁止改寫。新增私有 game_image_assets 與 room_questions.game_image_id；RPC／helper 為 INVOKER、空 search_path、service_role-only，未擴大 browser 權限。本次批准不含題庫寫入、Secrets 更動、Git Commit／Push 或 Pages 發布。
- 遊戲只使用已審核的私有中性 PNG asset，512 KiB／1600px 上限，僅 IHDR／IDAT／IEND、CRC 檢查，禁止文字／EXIF／SVG／尾隨資料。service_role 無 asset UPDATE，題目 FK 固定原圖；Edge 不 fetch 任意來源 URL、不回傳未揭曉的姓名／來源／人物 ID／署名。正式素材須事先確認授權允許實際呈現方式，Phase 8 才做匯入／重新編碼；既有原始 URL 不會自動變成合格題目。
- 歷史 FK 不得因房間清除而連帶刪除去重紀錄；完成遊戲紀錄不因歷史重置而刪除。圖片檔名、來源及 Metadata 也需防答案洩漏，不能只靠隱藏姓名欄位。
- Node.js 使用 22.18+（`.nvmrc` 為 22）；最新版 Supabase SDK 不支援 Node.js 20，驗證腳本使用原生 TypeScript 載入。
- `src/lib/supabase.ts` 以 `getSupabaseClient()` 延遲建立唯一 Client；未設定時只在明確使用時回報錯誤，禁止為了測試而在首頁加入 Debug UI 或改接 Mock service。
- 前端只接受 Publishable Key，不接受 Secret／Service Role Key、Database Password 或 CLI Access Token；不要在輸出或錯誤中回顯任何金鑰。
- `.env.local`、CLI `.temp`／`.branches` 與憑證必須忽略；CLI 登入和密碼由使用者在自己的互動終端機處理，不寫入命令參數或 Repository。
- `npm run check:supabase` 只驗證初始化與真實 HTTP 200 Health Response，不代表 PostgreSQL 驗證。缺設定為 BLOCKED、請求或回應失敗為 FAIL。
- `npm run test:db` 使用隔離的 PGlite 執行 SQL／角色測試，不連雲端、不需要 Docker。必須記錄其 PostgreSQL 版本與 Cloud 版本差異；本機 PASS 不代表 Cloud 已部署或多連線併發測試通過。部署後使用 `supabase/tests/verify_schema.sql` 唯讀驗證。
- `npm run test:rooms` 在隔離 PGlite 套用正式 migrations 與待審 Room System SQL，測真實 Fetch handler／交易／權限；`test:db` 保留 Phase 4 snapshot 回歸範圍。只有使用者明確要求才可將草案移入 migrations；本機納管不等於遠端部署授權。
- `scripts/check-room-browser.mjs` 使用 Chrome／Playwright 與自動關閉的隔離本機 fixture，攔截 Supabase 網路請求；不連真實房間 API，不讀 Cloud 憑證。缺少瀏覽器工具為 BLOCKED，不得假設通過；Node fixture 只供測試，不是正式常駐伺服器架構。
- 初次本機驗收見 `docs/phase5-room-system-report.md`；最新 `docs/phase5-cloud-deployment-report.md` 記錄 Phase 5 DONE：129 項自動化、H-01、本機 48 browser、真實 Cloud 11 組多人／API 與 Build 通過；沒有 lint script。Cloud 不是用 fixture 或 Auth Health PASS 冒充。
- H-01 已本機修復：SQL 固定全域→來源→驗證身分→Identity gate，禁止未驗證 Token 建桶；來源只用 runtime connection metadata，不讀 forwarding headers，缺失時用保守共享桶。來源 HMAC 壓至 256 slots，RPC 不接受任意 scope／limit，維持 service_role-only EXECUTE。清理在 gate 之後、有界 SKIP LOCKED；不得回復舊的動態 scope 陣列。
- 安全審核歷史見 `docs/phase5-cloud-deployment-approval.md`；本次實際 db push 採核對 linked ref 後 `--linked --skip-vault`，不使用 `--project-ref`，不含 seed／roles／Vault。未出現非預期 Migration、權限錯誤或部署失敗；不做 reset／repair／強制重試。
- `scripts/check-room-cloud.mjs` 會寫入真實 Cloud，必須有本次明確範圍批准且帶 --allow-test-writes／固定 ref 才可執行，不納入預設 npm test。它不是本機 fixture，不可無授權重跑。留存 QA label P5QA10231042：兩個 finished 房間、兩個已撤銷測試 Host、B 玩家；沒有刪除部署前資料，不可擅自清理或更改。
- 後續 Cloud 驗收預設唯讀；測試資料寫入另確認範圍。`npm run check:db` 比對欄位、限制、索引、GRANT、RLS 與 trigger；既有 `rls_auto_enable` 事件函式仍按已審查來源摘要、型別、擁有者與 search_path 驗證，不能忽略任意額外 SECURITY DEFINER 函式。詳見 `docs/phase4-final-verification.md`。
- TypeScript strict，採可維護元件；共用 Loading / Error / Empty State，支援手機、鍵盤及桌面。
- 視覺參考 https://about.miroom.com/：黑白、大字留白、螢光黃綠與鮮明色塊；沿用原創素材，不複製品牌資產。
- `VITE_` 環境變數均為公開資訊，不可存放任何私密憑證。
- 每次完成工作執行可行的 `npm test`、`npm run build`，並回報結果與未完成項目。
- `npm run test:game` 套用正式 migrations，以獨立 PGlite 與原創合成 PNG 測試；Phase 4／5 snapshot 保持各階段範圍。`game-concurrency.mjs` 用私有 Unix socket PG／20 連線，`check-game-browser.mjs` 用攔截至本機的 Chrome 驗證；不得將本機 fixtures 或 PASS 當成雲端 15 題驗收。
- Phase 8 僅準備候選與離線匯入工具：`prepare-question-bank.mjs` 讀公開 Wikidata／Commons Metadata，一律 pending／approved=false；`prepare-question-import.mjs` 拒絕未審核資料，只產生本機 SQL，不連 Cloud。prepared 目錄須忽略，不進 public／src。人工 subject／rights／image、署名時機與可解碼 PNG 審核不可省略，Metadata Public domain 不代表已完成審核。
- Phase 8 已完成逐頁來源與視覺工程審核：原候選排除兩張 personality 警示、補林肯／格蘭特，ignored reviewed-bank.json 共 15 位。使用者明確批准修正旗標後重試，已單交易純 INSERT 45 列且唯讀驗證 PASS；不得再重跑此批次。其後限定 Cloud QA 已另獲批准並完成：該 QA Host 已用 15 位，新的 Host 仍可用 15 位，去重不是全域。後續 QA 重跑需新授權。不得將 Codex 審核冒稱人類／律師或全球權利保證。
- `scripts/check-game-cloud.mjs` 必須明確 --allow-test-writes／固定 ref 才能寫 Cloud，不納入 npm test；本次成功收據見 Cloud acceptance report。首次 DevTools response.body() 為空但原生 Blob 正常，只修本機驗收工具，--resume-qa 僅用本次私密 QA 備份沿用首題，沒有額外 Host／第一房。圖片驗證取實際 Blob、已審 PNG SHA-256、headers、chunks／解碼；不得因工具錯誤調整後端圖片權限。
- 第一次匯入因漏加 CLI `--linked` 在 SQL 前遭拒；本次經使用者明確批准後，使用 `--linked --project-ref fgvajdnzrnptdjurhjfo` 完成原批次，詳見 `docs/phase8-cloud-import-report.md`。`db query --project-ref` 必須同時帶 `--linked`。`supabase/tests/verify_question_bank_access.sql` 僅唯讀，實際切換 anon／authenticated 驗證直接圖片 SELECT 被拒，不修改權限。
- 圖片處理只限已核對來源：原檔 SHA-1、來源 revision 與 PNG SHA-256 保存，Sharp 作本機解碼與縮放，再以最小 RGB PNG encoder 去 Metadata；中性檔名、每張至多 128 KiB，不改前端設計。Vite server.fs.deny 封鎖題庫目錄，dist 不含原圖／審核 Metadata／SQL。
- `source-review.json`、`prepare-reviewed-images.mjs` 預設不自動核准圖片；只有逐張檢視後的明確確認可 finalize。匯入 SQL 先驗 active category 與重複 Wikidata，與既有 UNIQUE 一同拒絕重跑，無 UPSERT／UPDATE／DELETE。先批准確切 SQL SHA-256 再執行，三個 Migration 均禁止改寫。
- `.github/workflows/pages.yml` 只有 workflow_dispatch，避免 Push 意外發布；使用最小權限、固定 Action commit、Actions 公開 vars。2026-10-24 使用者已設定並批准 Phase 9 發布：public Repository、兩個 Variables、Source=workflow、無自訂網域已唯讀核對。MVP 20987cb 已發布；後續部署與題庫寫入仍須另批准，不改 Repository 可見性或付費方案。

- 2026-10-24 運動員題庫 v2 最新要求為 link-only：新批次只準備圖片 URL／來源／作者／授權，不新增 game_image_assets、不用 Storage、不刪既有圖片。所有候選仍未核准，不得使用舊 PNG 匯入器直接匯入。現有 Cloud 引擎仍依賴私有 asset；新的 URL 讀圖／答案隔離架構需另審查與批准，不直接把含姓名的圖片網址給未揭曉 Player。尚未匯入或停用政治人物，七分類與題目／C 歷史保留；來源、缺圖與阻擋見 docs/phase8-athletes-v2-plan.md。
- 運動員本機審核：`npm run review:athletes` 僅開 127.0.0.1:5188 的維護頁，固定靜態檔／Host／Origin／記憶體 Session 保護，不是正式 Node Backend。以候選 Markdown＋scope 為權威，sidecar 只補相符 Metadata；輸出 ignored、0600 reviewed JSON，單 writer lock／revision／原子寫入。圖片 GET 僅 Wikimedia HTTPS、禁止 redirect／SSRF、8 MiB／40M pixels／真實解碼，只有單張記憶體預覽、不存圖。429 停止並尊重 Retry-After；不可為查驗繞過限流或自動核准。APPROVE 須人工人物／來源／分類／授權與條件五確認、有效查證、備註、審核者；15 位唯一且有效核准只准備 Metadata，不代表 Cloud 寫入批准／引擎相容。詳見 docs/phase8-athletes-image-review.md，不能把合成 browser 測試的15位核准當成真實題庫。
- 最新使用者另要求69位直接啟用並將圖片實存 PostgreSQL，取代先前 link-only 意向；此為批次請求，不得冒填未做過的授權／人物查證。`prepare-athlete-assets.mjs` 僅本機 staging，已完成2張後因 Kyrie 原圖45.4M pixels超過40M上限停止；未匯入、未改審核決定。現有舊匯入器僅 PD／CC0，67張其他授權須補來源／署名相容性，不可偽造 license/review。完整狀態見 docs/phase8-athletes-private-import-request.md；尚無執行用207列SQL或雲端題庫異動。

## Phase 7 Realtime 邊界

- 最新 Phase 8 要求改為私有 PostgreSQL WebP，優先於前述 link-only／僅 PNG 的準備描述。69 張本機技術轉換／完整解碼 PASS，不等於權利核准；124 位盤點最終 69 PENDING／55 MISSING_IMAGE，含排除銅像及新 Anthony Edwards 待審候選。不得把技術收據、合成 fixtures 或 presentationReviewed 旗標當作授權證據。詳見 docs/phase8-webp-acceptance.md。
- 新 WebP 僅單一無 Metadata lossy VP8、品質82、最長邊1024、300 KiB，原圖下載32 MiB／解碼40M上限不變；超限取已比對原圖 SHA／URL／revision 的官方 Commons rendition，另記下載 SHA-256，禁止假稱縮圖 SHA 是原圖 SHA。圖片仍中性檔名／ignored，不進 bundle。
- 20261024120000_game_image_formats.sql 只在 migration-drafts：INVОKER／空 search_path helper、service_role-only、替換 image CHECK；png bytea／RPC png key 保留舊名但可存新格式。沒有部署。PNG 舊限制不變，新增 metadata-free JPEG／WebP；不能在新後端／前端通過並另獲批准前先啟用 WebP 題庫。
- 新格式須完整結構化作者／來源／授權版本／條款／處理方式／原始聲明／證據；BY-SA 沿用同一授權。UI 只在 Host／揭曉後提供完整來源，未揭曉 Player 的 Edge DTO 仍無署名或姓名。延後署名的法律相容性尚未確認，原有政治人物及歷史保持不變；目前不產出真實207列SQL，不自動核准／部署／寫Cloud／Commit／Push。

- 發布順序已調整：Phase 7 DEFERRED，先發布 Phase 9 Polling MVP。以下是保留的 Phase 7 設計，不是目前正式啟用的同步方式。

- 新增增量草案 `supabase/migration-drafts/20261023180000_room_realtime.sql`，尚未納入 migrations，更沒有部署。禁止改寫 Phase 4～6；原 Cloud 仍為 Phase 6 版本，新的 room-system／game-engine 須另批准部署。
- 採私有 Supabase Broadcast，不用 Postgres Changes，不對 anon 開放任何遊戲表或加入 publication。三個 DB trigger 只傳 `{changed:true}`／invalidate，固定房間 UUID topic；禁止使用會帶出 NEW／OLD row 的 broadcast_changes。
- `get-realtime-ticket` 使用原 Host／Room／Player 憑證與 H-01 get-room-state gate。新 grant RPC 為 service_role-only INVOKER；JWT 固定 anon role、sub=opaque grant ID、rt_room、五分鐘期限，不含 Host／Player Token 或 Hash。不建立 Auth users。
- 新 `ROOM_REALTIME_SIGNING_JWK` 只放後端，必須是 Supabase 信任的 ES256／P-256 key，kid 對應信任公鑰；本機 fixture key 不可當 Cloud key。公開 JWKS 不能簽章，ROOM_SYSTEM_SIGNING_KEY 也不能直接拿來當 Realtime JWT key。信任設定、Secrets、Migration 與兩個 Function 部署仍須明確批准，不能擅自輪替現有 Auth key。
- room_realtime_grants 以房間／驗證後身分唯一，快照留在私表；授權 helper 為空 search_path 的窄輸出 SECURITY DEFINER，只回 boolean。Realtime messages 用 row topic＋JWT grant 的 restrictive SELECT guard，private INSERT 對 anon／authenticated 禁止，即使存在其他寬鬆 policy 也不得繞過。
- Supabase private-channel 授權有快取：離開／撤銷後拒絕新 ticket／重連，既有連線最遲依 JWT 五分鐘到期終止；只能收到常數通知，不代表還能讀答案／照片，所有 Edge 操作仍逐次授權。前端四分鐘左右自動重新授權，JWT 僅記憶體，不進共用 Client、localStorage、URL 或 log。
- useRoomSync 每房一訂閱：先查詢、訂閱後再查詢；重連／回前景／online 後重新拉取；serial read＋mutation epoch 防舊回應覆蓋，重複通知 debounce，訊號絕不直接修改題目。卸載取消 socket、timer、listener。
- H-01 全域／來源／身分限流與可信來源設計不變。HTTP 429 依 Retry-After 自動恢復初始 Lobby、快照與照片，不改 cap，不用假 X-Forwarded-For 分散來源。grants 清理僅在驗證後有界 100 列，無假 Token 動態建桶。
- Phase 7 本機測試以真實 Edge handlers／PGlite 草案／本機 WebSocket 協定 fixture 驗證，不是 Supabase Cloud Realtime／Deno runtime。最終瀏覽器 bridge 不用 connectToServer(url)（該 API 不支援改 URL），必須全面攔截並手動轉送本機，防誤連 Cloud。後續真實 Cloud 寫入／測試另批准。

## Phase 9 Polling MVP 發布邊界

- `VITE_ENABLE_REALTIME` 只有精確 true 才啟用 Phase 7；預設 false，Pages Workflow 固定 false，check-pages-env 拒絕提前開啟。保留 Phase 7 草案、Functions 與測試，禁止為本次發布部署它們或設定 ROOM_REALTIME_SIGNING_JWK。
- 每個 Lobby／Game 共用單一 createRoomPolling，完成後 setTimeout、同時最多一個讀取；背景／離線暫停，回前景／online 恢復，離開／finished／失效停止。callback ref 避免重新 render 重建，mutation epoch 防止舊回應覆蓋。
- 來源 get-room-state gate 每分鐘 30 次，room-state／game-state／image 共用。MVP 基準十秒、較大房以（玩家數＋Host）／每分鐘 18 次總狀態預算降頻；三人同來源約 18 次／分，不保證來源碰撞、多分頁或極快換題不會 429。依 Retry-After（秒或 HTTP 日期）及指數退避恢復，不改 H-01 cap／可信來源。
- 相容已部署 Phase 6 DTO：初次最多兩次 API；waiting 通常一次 room-state，playing 通常一次 game-state，開場轉換額外讀 game。遊戲中的玩家名單保留開場快照，避免每輪再加一次 roster API；沒有答案或授權判斷搬到前端。
- 準備階段原本不允許 Commit／Push／Pages。2026-10-24 使用者另批准已審核 MVP 的 Git 與 Pages 發布；偵測程式碼已由使用者 Commit／Push 為 20987cb，沿用而不重複提交。Actions run 40056684258 的 build／deploy 成功，正式網址 https://chiamaureen.github.io/guess-who/，十二項唯讀 Smoke PASS；本次僅補發布文件 Commit／Push，不修改 Supabase Database／RPC／RLS／GRANT／Secrets／Functions，不部署 Phase 7。
- 此次公開 Smoke 僅真實 GET categories／OPTIONS 與靜態網站，不攔截改用 fixtures，也不建立 QA Host／Player／Room。真實公開網址 15 題與實體手機測試 NOT TESTED；雲端業務寫入需另明確授權，不因前次驗收或本次 Pages 發布而自動重跑。首頁／加入頁仍有過時未開放／手動刷新文案，記為非阻斷待辦，不偷偷更動本次已審核程式碼。詳見 docs/phase9-mvp-release-report.md。
