# Guess Who — Single Room Game Engine

## Phase9 相容更新（已部署）

2026-10-25 已部署私有WebP／JPEG驗證及群組條件，原PNG繼續有效；沿用game_image_assets.png bytea和RPC的png JSON key，不更換Storage、不公開原圖URL。get-question-image從bytes判別MIME，回傳中性photo.webp／photo.jpg／photo.png、no-store及nosniff。WebP只接受單張metadata-free VP8、≤1024px／300KiB；不得以放寬安全上限處理超大原圖。

新房間選擇的group IDs保存於room_question_groups，game_engine_action在開場DISTINCT計數、分類抽取、人物抽取三處套用game_engine_group_eligible；同交易、Host→Room鎖序、15題、C去重與questionId重試語意保持。舊房沒有群組關聯時走原分類條件。

圖片作者、來源、授權及修改說明保存於人物私有欄位；只有Host或已揭曉Player DTO含credits，未揭曉Player仍只有題號／中性questionId／revealed。英語歌手首批用經來源與視覺工程審核的PD政府照片，不把其他CC或動畫候選自動核准。詳見 [Phase9交付報告](phase9-first-playable-cloud-release.md)。

Phase 6 Migration／game-engine v1 與 15 位題庫已在明確批准下上雲，真正 15 題 [Cloud Acceptance](phase6-cloud-acceptance-report.md) 已 PASS。Phase 7 本機加入私有 Broadcast 失效通知及自動拉取最新狀態，尚待部署批准，見 [Realtime Report](phase7-realtime-report.md)。本文件不取代 [Phase 5 房間授權](room-system.md)。

## 架構

- 保留 `room-system` 六個既有操作與 Session 儲存方式。另建 `game-engine` Edge Function，避免更動已上雲的房間狀態契約；前端房間頁新增 `GamePanel`，不更換網站設計。
- PostgreSQL 是狀態唯一來源；一次只考慮一個 playing 房間，不設全域單房限制、不加入多房調度。每次修改固定 Host→Room 列鎖，同房並行請求序列化，Host 鎖同時防歷史 reset 競態。
- 一個 `game_engine_action` RPC＝一個交易；題目、歷史、進度全部提交或全部回滾。限流用獨立已提交交易，不會跟失敗的遊戲操作一起回滾。
- Phase 6 原本只提供手動更新；Phase 7 本機改為私有 Broadcast 提醒後拉取 Edge 狀態，不輪詢。手動按鈕只作備援，刷新仍重新授權讀取既有題目，不重抽。

## API

入口：`POST /functions/v1/game-engine/{action}`。JSON、8 KiB 上限、精確 Origin allowlist、Publishable `apikey`；OPTIONS 回應允許所需自訂 headers。憑證不放 URL、Cookie 或 JSON body。

Host 帶 `x-host-credential`＋`x-room-token`；Player 只帶 `x-player-session`。歷史重置只用長期 `x-host-credential`，不需要房間 Token，也不能傳其他 Host ID。不接受前端 role、Host ID 或 Player ID 作授權。

| Action | JSON input | 權限／成功回應 |
| --- | --- | --- |
| start-game | roomCode | Host；GameState，第一次建立第 1 題 |
| get-game-state | roomCode | Host／本房 Player；過濾後 GameState |
| get-question-image | roomCode、questionId | Host／本房 Player；當前題目二進位 image/png，不回原始來源 |
| reveal-answer | roomCode、questionId | Host；GameState，重送同題不改 revealed_at |
| next-question | roomCode、questionId | Host；GameState，綁定原題而非不具語意的「再加一」 |
| finish-game | roomCode、questionId | Host；GameState，已完成同題重送不刪資料 |
| reset-question-history | confirm:true、historyRevision | 長期 Host；`{data:{reset:true}}` |

一般成功為 `{data:GameState}`，失敗為 `{error:{code,message}}`；白名單錯誤不含 SQL 原文、Token、Hash 或私密設定。限流回 429＋Retry-After。

### GameState

- `room`：id、code、status、currentQuestion、totalQuestions=15、expiresAt。
- `viewer`：經後端確認的 role、id；不是前端授權依據。
- Phase 7 本機 Edge DTO 另加入經 safeLobby 過濾的 categories／players，與 GameState 同一次 RPC 快照回傳；不新增敏感資料或第二次讀取，舊 parseGameState 仍相容。
- `question`：waiting 為 null；遊戲中為隨機 UUID、number、revealed。
- **Host 或已揭曉**才增加 answer 與 attribution（author、license、text、source）。未揭曉 Player 的 question 完全沒有這些鍵，也沒有 celebrity ID、人物分類映射、Wikidata ID、原始 image_url／檔名；回應外層 categories 僅是房間已選的分類。
- 只有 Host 得到 `historyRevision`，供二次確認時快照；前端不儲存題目、答案或權威進度。
- SQL 先過濾，Edge 再以實際通過驗證的角色白名單過濾，前端型別解析亦不保留隱藏欄位。私表／RPC 不對 browser 開放，沒有 Realtime publication。

## 遊戲與冪等性

1. 第一個 Start 只能從 waiting 開始。選定啟用分類中的已審核人物，必須有已審核私有圖片、非 Host 歷史、非本房已出人物；`COUNT(DISTINCT celebrity.id) >= 15`。
2. 每次抽題先從仍有庫存的選定啟用分類隨機選一類，再從該類隨機選一位人物；不是把所有人物攤平抽樣。多分類人物不重複計算。
3. 同交易插入 room_questions、host_question_history，再更新 Room。保留既有房間人物／題號／Host 人物 UNIQUE 約束與歷史 FK。
4. Start 的回應遺失後重送，playing 房間只回現有狀態，不多抽題。Next 必須傳原題 UUID；第一個成功請求前進一題，並行或重送同一舊題只回當前狀態，不再次前進。不存在／錯房題目拒絕；舊 Reveal／Finish 不得誤操作新題。
5. 未揭曉不能 Next；第 15 題不可產生第 16 題。一般在揭曉第 15 題後確認結束，也能明確確認提前結束；未揭曉題目不會因結束而自動公開答案。
6. 中途停用人物／分類／素材造成無題可抽，回 INSUFFICIENT_QUESTIONS，保持原題與進度。庫存不會自動 reset 或重複舊題。
7. finished 不再出題。過期禁止讀題／抽題／揭曉；有效 Host 仍可用原房 Token 與當前題 UUID執行 Finish，避免不能收尾的資料狀態。

重要錯誤：INSUFFICIENT_QUESTIONS 提示加選分類或手動 reset；ANSWER_NOT_REVEALED、LAST_QUESTION、STALE_STATE、INVALID_STATE、GAME_ACTIVE、CONFIRM_REQUIRED 各自有明確訊息。

## C 模式與重置

同一 Host 抽到即記錄跨場歷史；不等答對／揭曉／完成。不同 Host 獨立，提前結束不清歷史。30 位隔離題庫可連玩兩場各 15 位；只有 15 位時第二場拒絕開始，不假裝有新題。

重置只依長期憑證查出 Host，鎖同 Host 後檢查沒有任何 playing 房間（過期但仍 playing 也不例外）。`confirm:true` 且 historyRevision 必須符合確認前快照，才 DELETE 該 Host 的 history；其他 Host、所有 room_questions、完成房間與圖片不變。延遲重送舊確認不能抹掉後來新增的歷史。UI 在開啟確認時保存 revision，不會隨刷新偷偷換成新版本。

## 私有圖片邊界

原 Commons URL／檔名／EXIF／作者資料可能包含答案，因此 **不代理任意 URL、不讓玩家直接下載原圖**。

- 新表 `game_image_assets` 保存已審核中性 PNG bytes，人物 FK 不對玩家公開；原始授權資料仍保留於 celebrities。
- PNG CHECK 僅接受 IHDR／IDAT／IEND，驗證完整邊界、CRC、寬高 1–1600、8-bit RGB／RGBA、非交錯與最大 512 KiB；拒絕文字、EXIF、其他 chunk、SVG、尾隨資料。這不是通用的圖片重新編碼工具，也不取代人工內容／授權與可解碼審查。
- 新題固定 `game_image_id` 並用複合 FK 保證圖片與人物一致。service_role 沒有 asset UPDATE，已引用圖片不能刪除。若選圖時素材已消失，拒絕並回滾，而非建立無圖題目。
- 圖片 action 只能讀該房當前題目；授權與限流後才回 bytes。Content-Type=image/png、固定 filename=photo.png、no-store、nosniff，沒有原始來源 header。前端以帶憑證的 POST 取得 Blob、顯示通用 alt 並釋放 object URL，不把 Token 放進圖片網址。
- 正式照片匯入／縮圖／重新編碼／水印內容／授權審核留 Phase 8；授權必須容許實際署名時機及呈現方式，不符合就不核准。不能為保密違反授權。
- 測試圖片是程式原創的 32×32 幾何臉型 PNG，搭配明確假人物，不是下載的名人照片，不得匯入正式題庫。

## 安全與限流

`verify_jwt=false` 只表示不要求 Supabase Auth JWT，仍須 Publishable Key、來源、長期 Host／房間 Token／Player Session 與 PostgreSQL 再授權。全部新函式 INVOKER＋空 search_path＋service_role-only；不新增 browser policy 或 EXECUTE。

重用已審 H-01 `room_system_rate_limit`：state＋image 共用 get-room-state 固定政策，所有修改共用 close-room 政策。不新增由任意 Credential 衍生的 scope，來源只用 runtime connection metadata（缺失使用共享 fallback），不讀 X-Forwarded-For。全域→有限來源→已驗證身分，拒絕後不新增假身分桶；沿用有界過期清理。

目前同來源 state／image 合計 30 次／分鐘，修改合計 30 次／分鐘；這包含與房間 API 共用的額度。密集測試應等候實際窗口，不調高 production cap 或偽造來源。手動 UI 不是完整 DDoS 防護；localStorage bearer 仍有 XSS／共用裝置風險。

環境變數沿用 `ROOM_SYSTEM_SIGNING_KEY`、`ROOM_SYSTEM_ALLOWED_ORIGINS`；平台提供 SUPABASE_URL 與 Secret／Publishable key maps，沒有新的 VITE 私密變數，也不需要本次輪替現有 Secret。

## 本機驗證與部署邊界

```sh
npm test
npm run build
PG_BIN_DIR=/absolute/postgres/bin PG_DRIVER_MODULE=/absolute/pg/lib/index.js node supabase/tests/game-concurrency.mjs
PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs node scripts/check-game-browser.mjs
```

瀏覽器須先啟動 127.0.0.1:5177 Vite。工具使用隔離本機資料庫／合成圖片並攔截所有 Supabase API；不是 Cloud 成功證據。PostgreSQL 多連線工具僅接受本機 binaries／driver，建立私有 Unix socket cluster，不接受雲端 URL。缺工具為 BLOCKED。

SQL 已納入 `supabase/migrations/20261023120000_game_engine.sql` 並經限定批准部署，現在不可改寫。`verify_game_engine.sql` 已在 Cloud READ ONLY 驗證，RPC／RLS／GRANT 通過；原九表與 Phase 5 規則不變。Cloud 15 題資料流程未測，見最新部署報告。

正式 Cloud 題庫沒有在本次建立或驗證。沒有合格 15 位＋私有圖片前，不可宣稱雲端完整遊戲驗收成功；後續測試寫入及素材匯入必須另外批准。
