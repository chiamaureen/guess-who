# Phase 6 — Cloud 15-Question Acceptance Report

**結論：PASS。** 2026-10-23 22:17:18（Asia/Taipei）完成。

## 範圍與環境

- Project：`fgvajdnzrnptdjurhjfo`；Cloud PostgreSQL 17.11。
- 已部署 `room-system` v1／`game-engine` v1，均 ACTIVE、verify_jwt=false，使用既有自訂 Host／Room／Player 憑證驗證；沒有重新部署。
- Chrome 155.0.8059.85，Host 1440px、Player 390px，兩個獨立 context。前端為本機 `http://localhost:5173/guess-who/`，所有房間／遊戲 API 與圖片都連真正 Supabase Cloud。
- 沒有 fixtures、Mock、request interception、API 重導向、Realtime 或 Pages 發布。
- QA label：`P6QA1023135631`。只新增一位匿名 Host、一位 Player、兩間政治人物房間。沒有使用既有 Host 或重置任何歷史。
- 題庫仍為原 15 人／15 關聯／15 私有 PNG。匯入批次 SHA-256：`c9d6d4e72920ac565bbe01de27b2994ea66c5d5b9b6a252595022d8e8fa85fac`。

## 驗收結果

| 項目 | 結果 | 實際證據 |
| --- | --- | --- |
| Host 建房／獨立 Player 加入 | PASS | 新 Host、政治人物單選、邀請連結只含房碼；Player 沒有 Host 身分 |
| Host 開始 | PASS | 真正 UI Start 建立第 1 題，playing／1/15，Host 可讀答案 |
| Player 控制權隔離 | PASS | Start／Reveal／Next／Finish 均 HTTP 403 FORBIDDEN |
| 第 1～15 題 | PASS | 逐題驗證題號、隱藏答案、圖片、Reveal、玩家取得答案及 Next；完成 15／15 |
| 揭曉前答案隔離 | PASS | 每題 Player question keys 僅 id／number／revealed；無姓名、署名、來源、人物 ID 或 historyRevision，DOM 無答案 |
| 揭曉後答案 | PASS | 每題 Player 姓名與 Host 相同，來源／署名此時才出現 |
| 私有圖片 API | PASS | 兩角色各取得 15 張不同圖片；HTTP 200、image/png、no-store、固定 photo.png，頁面使用 Blob URL |
| 圖片內容與格式 | PASS | 原生 Blob 全部對上已審 PNG SHA-256；實際解碼、尺寸正確，僅 IHDR／IDAT／IEND，無 EXIF／文字 chunk |
| 未揭曉不能 Next | PASS | 第一題 HTTP 409 ANSWER_NOT_REVEALED，狀態不前進 |
| Next 原 questionId 重送 | PASS | 第一題已前進後重送舊 ID，仍停第 2 題；舊 Reveal 回 409 STALE_STATE |
| 第 16 題拒絕 | PASS | 第 15 題 Next 按鈕停用；直接 API 回 409 LAST_QUESTION，DB 僅 15 題 |
| 真正重新整理／Session 恢復 | PASS | 第 1 題揭曉前後、結束後第 15 題：兩角色 reload 保持憑證、題 UUID／題號、圖片及揭曉狀態；Host 控制保留 |
| 結束／關房 | PASS | 第一房 Finish／Close；第二房拒絕開始後 Close，reload 仍為 finished |
| C 模式 | PASS | 同 Host 第二房 Start 回 409 INSUFFICIENT_QUESTIONS；仍為 0 題，第一房 15 筆歷史保留 |
| PostgreSQL 完整性 | PASS | 既有 exact-room READ ONLY verifier：15 題、15 distinct_people、15 revealed、15 筆來源歷史 |
| 題庫不變 | PASS | 原精確批次 verify-import.sql：expected_subjects=15、verified_subjects=15；最終三張題庫表筆數不變 |
| Schema／RPC／RLS／GRANT | PASS | npm run check:db differences=[]，210 項表權限檢查；無非預期 function／view 或 Realtime table |
| 限流與執行錯誤 | PASS | 六次主動等待 61 秒，429=0；最終瀏覽器 runtime／server／安全驗證錯誤=0，沒有清除或放寬限流 |

最終驗收工具 **22 組檢查 PASS**，包含逐題 15 組；沒有把本機 fixture 或健康檢查當成 Cloud 成功。重送測試是成功後以相同原 questionId 再送一次；本次沒有實際丟棄 HTTP 回應，真正丟失回應的 UI 重試另有既有本機瀏覽器覆蓋。

## 保留的 QA 資料

| 房間 | 結果 | 題目 | Host 歷史 |
| --- | --- | --- | --- |
| DPK86G | finished／15/15、全部揭曉 | 15 題／15 位不同人物 | 同一 QA Host 累計 15 |
| D5U556 | 題庫不足拒絕開始後 finished／0/15 | 0 | 仍為 15，沒有重置 |

整次 QA 累計新增必要業務列：Host=1、Room=2、room_categories=2、Player=1、room_questions=15、host_question_history=15；保留作驗收紀錄，沒有刪除任何既有資料。

最終全庫筆數：categories=7、celebrities=15、celebrity_categories=15、game_image_assets=15、hosts=3、rooms=4、room_categories=5、room_players=2、room_questions=15、host_question_history=15。

續測前已存在首題一筆，故最終工具額外比較「恢復時 baseline → 結束」新增 room=1、room_categories=1、questions=14、history=14，其餘筆數不變；第一筆與最初新 Host／第一房／Player 不會重複計入或重建。

**QA Host 已用完 15 位，所以該 Host 第二場被拒是預期結果；去重依 Host 而非全域，新 Host 仍可使用這 15 位。** 本次沒有測試或重置既有 Host 的歷史。

## 驗收工具相容性處理

第一次執行在首題停止，原因是 Chrome／Playwright DevTools 的 response.body() 回空 Buffer，並非 Cloud 回空圖片。停止控制後唯讀比對：Cloud 直接圖片請求及頁面原生 Blob 都是相同的 126,030 bytes 已審 PNG，頁面亦可解碼；DevTools body 為 0 bytes。

僅修正本機驗收工具 `scripts/check-game-cloud.mjs`，改驗證實際頁面 Blob bytes，仍檢查原 Cloud HTTP headers、SHA-256、PNG chunks 與解碼。以 owner-private Session 備份恢復同一 QA Host／Player／第一房，沒有重建身分、重新抽首題、變更前後端正式程式或擴大雲端寫入範圍。首次工具失敗的收據保留，不冒稱從未遇到問題。

## 安全與本機回歸

- npm test：**173 PASS**，Edge TypeScript 通過；npm run build：**PASS**；沒有 lint script。
- node --check／缺少寫入授權旗標的拒絕測試：PASS；Cloud 腳本不納入預設 npm test，任何後續真實寫入仍需新授權。
- git diff --check／cached diff check 通過；三個已部署 Migration SHA-256 維持原值。
- 最終敏感掃描：116 工作檔、237 歷史 blobs，findings=0；沒有追蹤敏感環境檔，.env.example 只含示意值；14 個本機文件連結檢查通過。
- Host／Room／Player 憑證只在獨立 browser context 與 `/tmp` owner-only Session 備份，不輸出、不在 URL／HAR／截圖／Repository。遊戲 DTO 與已檢查 browser console 未見憑證。
- 保留既有已審查平台 rls_auto_enable event trigger 的 public EXECUTE 警告，與原基準一致，不是本次新增；未擅自調整平台權限。這不是全面滲透測試或 Cloud 平台所有 Logs 的稽核保證。

## 收據與停止點

- 成功收據：`/tmp/guess-who-phase6-cloud-A3tHHz/results.json`。
- 首次工具停止及唯讀診斷：`/tmp/guess-who-phase6-cloud-ehw6lE/`。
- Schema／題庫唯讀紀錄：`/tmp/guess-who-phase6-cloud-schema.log`、`/tmp/guess-who-phase6-cloud-bank-readonly.log`。
- 本機回歸：`/tmp/guess-who-phase6-cloud-local-tests.log`、`/tmp/guess-who-phase6-cloud-local-build.log`。

**未發現本次範圍內剩餘 Critical／High 阻斷問題，Phase 6 Cloud Acceptance：PASS。** 沒有修改 Migration、RPC、RLS、GRANT、題庫或 Secrets，沒有重置歷史、Commit／Push／發布 Pages，也沒有開始 Realtime。已停止並等待下一階段發布批准；正式公開網址尚未發布或驗證。
