# Guess Who — Cloud 15 Question Acceptance Plan

**狀態：READY TO EXECUTE AFTER APPROVAL，不是已通過。** 本文件只準備測試流程，尚未對 Cloud 建立任何 Host／Room／Player／題目或歷史。

## 授權與前置條件

1. 題庫匯入需單獨批准；匯入完成先執行同批 `verify-import.sql`（READ ONLY），應為 expected_subjects=15、verified_subjects=15，再核對可用題庫。
2. 再取得 **可辨識 QA 業務資料寫入** 授權：建議一個新專用 Host、兩個新房間、一位 Player；第一房完整 15 題、第二房驗證不足與手動 reset 後第 1 題。Reset 只影響此專用 Host；不使用既有主持人、舊房間或 Phase 5 留存資料。
3. 不清除既有 Cloud 資料／限流桶、不改 cap、不輪替 Signing Key。測試憑證只留在獨立 browser context／本機私密備份，不寫 URL、報告、截圖、console 或 HAR。
4. 使用兩個獨立瀏覽器 profile／context 模擬 Host 與 Player；新 Host 必須沒有舊 history。只使用已核對的 Project fgvajdnzrnptdjurhjfo 與允許的 Origin。
5. 目前題庫只提供政治人物；Host 勾選「政治人物」。不選沒有已審人物的分類冒充庫存。

## 測試步驟與預期

| Step | 操作 | 必須確認 |
| --- | --- | --- |
| 1 | 新 Host 建立 QA 房，記錄代碼與非敏感 room ID | waiting、0/15、分類正確；邀請 URL 只含房碼 |
| 2 | 獨立 Player 以邀請連結／暱稱加入 | 同房、名單一人；Player 無任何 Host 控制 |
| 3 | Host 開始 | playing、1/15，Host 看得到答案與照片，只有一筆第 1 題 |
| 4 | Player Refresh State | 顯示同題照片、尚未揭曉；實際 Response 的 question **只有 id／number／revealed** |
| 5 | 檢查 Player DOM、網路回應與圖片 | 沒有 answer／來源／作者／人物 ID／Wikidata ID／原檔名；照片 URL 為 Blob 或中性 API，PNG 無文字／EXIF chunk |
| 6 | 未揭曉先 Next，並嘗試 Player 修改操作 | Host 被 ANSWER_NOT_REVEALED 拒絕；Player 控制 API 被拒，進度不變 |
| 7 | 揭曉前刷新 Host、Player | 原題 UUID／照片／題號不變、Host 控制保留，Player 仍無答案 |
| 8 | Host Reveal，Player Refresh State | Player 此時才拿到正確姓名與署名／來源；Host Next 變為可用 |
| 9 | 揭曉後刷新兩角色 | 仍是同題且 revealed=true，答案保持一致 |
| 10 | Host Next | 恰好前進一題；Player Refresh 後相同新題，答案欄位重新消失 |
| 11 | 模擬一次 Next 成功但 HTTP 回應遺失，沿用原 questionId 重送 | 仍只前進一題，不多消耗人物；舊 Reveal 不得揭曉新題 |
| 12 | 逐題重複「Player 隔離→Reveal→Player 更新→Next」到第 15 題 | 題號完整 1–15，照片可解碼、不缺圖，沒有題內／跨分類重複 |
| 13 | 第 15 題 Reveal，再嘗試 Next | LAST_QUESTION；資料庫無第 16 題 |
| 14 | Host 確認 Finish，兩角色刷新 | finished、15/15；已揭曉答案保留，不能再次開始／換題 |
| 15 | 執行第一房 READ ONLY verifier，**在任何 reset 之前** | 15 questions、15 distinct_people、15 revealed、專用 Host history=15 |
| 16 | 同 Host 建第二房並開始 | 只有 15 人且已用盡，因此 INSUFFICIENT_QUESTIONS；第二房仍 waiting／0/15，歷史仍 15 |
| 17 | Host 明確確認只重置自己的歷史 | 專用 Host history=0；第一房 15 題不刪除，其他 Host／Room 不變 |
| 18 | 第二房 Start 並刷新 | 可重新產生第 1 題，history=1；可提前 Finish 收尾，保留該一筆歷史 |

只有全程真正 Cloud Request 與 Cloud PostgreSQL 回應才可標記 PASS。網路攔截至本機、空題庫拒絕、本機 RPC 測試、Auth Health 或 Client 初始化都不能替代本流程。

## 真正限流與重試

- state／image 共用來源 cap，目前 30 次／分鐘；修改共用 cap 也是 30 次／分鐘，還與對應的房間操作共用。
- 不以高速自動連點跑完 15 題。**第 8 題後至少等滿 61 秒**，並保留正常玩家口頭回答時間；其他 429 依 Retry-After 等候，原操作沿用同一 questionId。
- 不從不可信 X-Forwarded-For 分散來源、不清空 rate table 或調高門檻。任一非預期 5xx、權限異常、跳題／洩漏即停止，保留原狀並報告，不 reset／repair。

## 唯讀遊戲收據

本機先產生只鎖定本次第一房代碼的 SQL；不可省略代碼或改成掃描所有業務資料：

```sh
node scripts/make-game-verification.mjs ACTUAL_QA_CODE /tmp/guess-who-qa-game.sql
```

`ACTUAL_QA_CODE` 必須替換成六位真實 QA 代碼；工具拒絕 SQL 字串與覆蓋既有輸出。完成測試且未 reset 前再唯讀執行：

```sh
npx --no-install supabase db query --linked --file /tmp/guess-who-qa-game.sql
```

輸出只有房碼、status／題號／筆數，不讀 Host Hash、Token 或姓名。Verifier 是 READ ONLY、預期 15 題與 15 筆來源歷史；任一不符會 FAIL，而非看見 HTTP 200 就當成功。Reset 後要另外保存「歷史 0／原題仍 15」收據，不拿原 verifier 錯誤當引擎壞掉。

## 驗收紀錄欄位

- 時間（Asia/Taipei）、Project Ref、部署 Function version、題庫 SQL SHA-256。
- QA room code／room ID、步驟結果、HTTP status／安全錯誤碼、匿名的問題 UUID／進度。
- 不含 Token／Hash／未揭曉答案的截圖及選擇性 DTO keys 收據；不要匯出含憑證的 raw HAR。
- 第一房完成前後 history、第二房不足、reset 保留題目、最後可辨識 QA 留存資料。
- 任何未執行項目一律 NOT TESTED／BLOCKED；未來 Realtime 不在本次範圍，Player 仍手動 Refresh State。
