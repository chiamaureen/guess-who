# Phase 6 — Game Engine Preparation

前提：Phase 5 已於 2026-10-23 完成 Cloud 部署與真實多人驗收，見 [部署報告](phase5-cloud-deployment-report.md)。本文件是使用者要求的下一階段準備，不代表引擎已實作或已批准新的雲端變更。

## 可沿用的基礎

- 穩定匿名 Host ID、分離 Host Credential／Room Token／Player Session；Host 跨場及兩角色刷新已在真實 Cloud 驗證。
- service_role-only RPC、十表 RLS／GRANT、安全 state DTO、H-01 固定 gate／有限來源桶／verified Identity counter。
- 原 Schema 已有 room_questions、host_question_history 與 C 模式 UNIQUE／FK；不要重複建表或重寫已部署的兩個 Migration。
- 已部署的 room-system 目前只允許六個 Phase 5 action；新操作必須同時審查 Edge／SQL rate policy／授權，不能直接接受任意 action／scope 或繞過 H-01 gate。

## 優先設計順序

1. **API 與狀態契約**：確認開始、讀取題目、揭曉、下一題、結束、二次確認歷史重置的請求與回應。waiting → playing → finished，初始 0／15；第 15 題後不能有第 16 題。新端點名稱先審核，不預先當作已開放功能。
2. **交易與鎖**：所有開始／抽題／重置操作固定先鎖 hosts，再鎖 rooms；同 Host 跨房間序列化。題目、歷史與進度同交易提交，失敗全回滾；失去 HTTP 回應後的重試必須回原結果，不能多消耗人物。
3. **庫存與抽樣**：選定且啟用分類、已審核人物、排除該 Host 歷史，開場 COUNT(DISTINCT celebrity_id) 至少 15。每題先從仍有未使用人物的分類隨機選一類，再抽人物；不保證分類平均，也不能直接全人物等機率抽樣取代規則。
4. **C 模式**：抽到即記錄 history，跨分類／跨房不重複。提前結束不清歷史；不同 Host 獨立。庫存中途不足要明確失敗，不自動重置、重複舊題或補假題。
5. **答案隔離**：Host 可取得正確姓名，Player 揭曉前的任何回應不得含姓名／人物識別／可推導答案來源。不能靠前端隱藏，圖片檔名、Metadata、授權署名時機需與後續題庫階段共同確認。
6. **歷史重置**：只清自己的 history、二次確認、同 Host 無 playing 房間；保留所有 room_questions 與其他 Host 紀錄。Host 憑證撤銷不是 history reset。
7. **前端整合**：啟用真正的 Host 控制與玩家題目畫面，統一 loading／error／empty／重試。保留已驗收等待室與 RWD；不把 disabled 按鈕改成假成功。

## 驗收與失敗案例

- 至少 15 位去重庫存、分類交疊、一類用盡／中途停用、未審核人物、不同 Host 各自歷史。
- 開始／揭曉／換題／結束的非法狀態與重複請求；finished／過期禁止操作，Host Token 與 ownership 再驗證。
- 同 Host 兩房並行抽題、抽題與 reset 競爭、交易失敗／回應遺失；UNIQUE 是最後防線，不取代鎖與冪等設計。
- Player／匿名／其他 Host 不能控制；揭曉前 API／state／將來 Realtime 不洩漏答案。
- 15 題完整流程、手機／桌面、兩角色刷新與回到原題，不重啟遊戲。
- 正式 Cloud 寫入／題庫 fixtures／高併發壓測的範圍需先確認；不可把測試人物或 fixtures 直接匯入現有 Project。

## 邊界與開始前確認

- 本階段不加入計分、搶答、排行榜或語音辨識。Realtime 留 Phase 7、正式人物／圖片與授權留 Phase 8、GitHub Pages 正式發布留 Phase 9。
- 需要新的 Database RPC／Schema／部署時，只新增增量並提出權限與部署提案，另取得批准；不改寫已部署 Migration、不自行輪替 Signing Key、不修改或刪除 Phase 5 留存資料。
- 開始實作前先確認正式 Phase 6 規格、題目／揭曉狀態的儲存方式、冪等鍵及錯誤碼、缺少題庫時的測試策略。準備工作已完成，引擎程式尚未開發。
