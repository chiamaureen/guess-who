# Room System API Contract

狀態：**Phase 5 Cloud 部署與真實多人驗收完成**。單一 Function `room-system` v1，全部 action 使用 HTTPS POST 與 JSON；沒有 GET 寫入端點或公開管理 RPC。實際證據見 [Cloud Report](phase5-cloud-deployment-report.md)。

## Transport

```text
POST {VITE_SUPABASE_URL}/functions/v1/room-system/{action}
Content-Type: application/json
apikey: {Publishable Key}
Origin: {允許的網站 origin}
```

憑證使用獨立 headers，不能放 URL／query／邀請連結：

- `x-host-credential`：長期 Host 憑證。
- `x-room-token`：單一房間控制 Token，必須搭配 Host 憑證。
- `x-player-session`：該房間玩家 Session，不能混用 Host headers。

`credentials: omit`，不用 Cookie 或 Supabase Auth JWT。只接受設定中的 Publishable Key，但該 key 是公開的，不是 Host／Player 身分。CORS OPTIONS 需合法 Origin、不要求業務憑證；回 204 且不操作資料庫。

## Endpoints

| Action | Request body | Credentials | Response data |
| --- | --- | --- | --- |
| host-session | `{mode:"bootstrap", bootstrapKey}` | 無；key 為保密的 32 bytes nonce | `{hostId, credential}` |
| host-session | `{mode:"resume"}` | Host Credential | `{hostId}` |
| host-session | `{mode:"revoke", confirm:true}` | Host Credential | `{revoked:true}`；有活動房間則 409 |
| create-room | `{categoryIds:string[], requestKey}` | Host Credential | LobbyState ＋ `hostToken` |
| join-room | `{roomCode, nickname, joinKey}` | 無；保密 join nonce | LobbyState ＋ `playerSession` |
| get-room-state | `{roomCode}` | Host＋Room，或 Player Session | LobbyState |
| leave-room | `{roomCode}` | Player Session | `{left:true}` |
| close-room | `{roomCode}` | Host＋Room | LobbyState（finished） |

成功 `{data: ...}`、HTTP 200。只有建立／首次身分回應有呼叫者自己所需的原始 Token；一般狀態不再傳 Token。所有成功及失敗回應禁止快取。

輸入限制：body 上限 8192 bytes，拒絕未知欄位，包括 `hostId`／`playerId`／`role`。房間代碼 trim 後轉大寫、六碼英數；暱稱 trim＋NFC、1–20 個 Unicode code point，拒絕控制及方向覆寫字元。requestKey／joinKey／bootstrapKey 為 32 bytes canonical base64url；Host／Room／Player 格式分離。

## LobbyState 白名單

```text
room: { id, code, status, currentQuestion, totalQuestions:15, expiresAt }
categories: [{ id, name, slug }]
players: [{ id, nickname, joinedAt }]
viewer: { role:"host"|"player", id }
```

role 由後端憑證驗證結果產生，不來自前端輸入。其他玩家沒有 Session／Hash 欄位；沒有主持人憑證、IP、簽章 key、人物／姓名／題目答案、題目歷史或授權原始來源。

## Errors

```json
{"error":{"code":"ROOM_NOT_FOUND","message":"找不到這個房間，請確認代碼。"}}
```

| HTTP | Codes / meaning |
| --- | --- |
| 400 | INVALID_INPUT、INVALID_CATEGORIES：格式、未知欄位、暱稱或分類錯誤 |
| 401 | UNAUTHORIZED：缺少／無效／已撤銷的必要憑證或未接受的 API key |
| 403 | FORBIDDEN：其他主持人的房間、不符房間 Token、未允許的 Origin |
| 404 | ROOM_NOT_FOUND |
| 405 | METHOD_NOT_ALLOWED：不是 POST／OPTIONS |
| 409 | ROOM_IN_PROGRESS、IDEMPOTENCY_CONFLICT、ROOM_LIMIT、ROOM_FULL、ACTIVE_ROOMS |
| 410 | ROOM_EXPIRED、ROOM_CLOSED |
| 429 | RATE_LIMITED，附 Retry-After（秒） |
| 500 | INTERNAL_ERROR，遮蔽 DB 內部錯誤／SQL／Hash |
| 503 | SERVICE_UNAVAILABLE：後端設定／Secrets 尚未完成 |

不得向玩家輸出 SQLSTATE 細節、constraint 名稱、原始例外或 Token；SQL 已知業務代碼以白名單轉 HTTP，其他統一 500。前端也不直接顯示遠端任意 error.message。

## Retry / Idempotency

- Host bootstrap：保存原 bootstrapKey 再重試，不以網路錯誤當作產生新身分的理由。
- Create：保存原 requestKey／分類集合，Room Token Hash 唯一；重試相同資料回原房間。不同資料回 409，不另開房間；原房間 finished 不會復活。
- Join：保存原 joinKey／暱稱，重試回相同 player；持有 Session 時先驗證既有身分，不另新增。
- Close：同一已授權房間重複關閉仍為 finished。
- Leave：成功刪除自己的 row，後續 Session 無效；若回應遺失、重試得到 401，前端可清除本機已無效 Session。
- 任何 transient network／timeout 都不自動清除 Token 或待確認 key，不自動重新開房。

## Deployment verification

Cloud 驗收不得因 HTTP 200 bootstrap 或 SDK 初始化就宣稱完整整合通過。部署後須用新建且明確批准的測試身分／房間驗證完整 UI、跨瀏覽器恢復、閉房與負向權限、RLS／RPC grants，以及平台真實 CORS／Keys 環境。詳見 [驗收報告](phase5-room-system-report.md)。
