# Phase 8 — PostgreSQL Cloud Import Report

2026-10-23 21:19（Asia/Taipei）。**STOPPED / NOT IMPORTED**。

## 授權與批次

- 目標：`fgvajdnzrnptdjurhjfo`，與本機 linked project 相符。
- 使用者批准原批次 15 人、15 分類關聯、15 筆 PostgreSQL 私有 PNG，合計 45 列；不使用 Storage。
- 原匯入 SQL SHA-256：`c9d6d4e72920ac565bbe01de27b2994ea66c5d5b9b6a252595022d8e8fa85fac`。
- 未重新產生批次。已核對 15 筆來源／作者／授權、審核決定、來源 revision、原圖 SHA-1、PNG SHA-256、中性檔名及單一 BEGIN／COMMIT。純 INSERT，無覆寫操作。

## 結果

| 項目 | 實際結果 |
| --- | --- |
| 本機同批 SQL 與唯讀 verifier | PASS，隔離 PGlite 實際執行 |
| 本機 anon／authenticated 圖片 SELECT | PASS，兩角色實際 SELECT 均遭拒絕 |
| Cloud 匯入前 RLS／GRANT／RPC／Realtime 隔離 | PASS，既有 verify_game_engine.sql 未拋出驗證錯誤 |
| 匯入指令 | FAIL，CLI 旗標組合錯誤，未執行 SQL |
| 人物新增 | 0 |
| 分類關聯新增 | 0 |
| 私有圖片新增 | 0 |
| Transaction | 未開始；無 COMMIT，也沒有已開始交易需要 ROLLBACK |
| 既有精確批次 verify-import.sql | FAIL，資料不存在，不能標示匯入成功 |
| Cloud 匯入後唯讀庫存／權限 | PASS，仍為 0／0／0；anon、authenticated 實際圖片 SELECT 均拒絕 |
| 可用且尚未被任何 Host 使用的人物 | 0 |
| 開始完整 15 題 Cloud 驗收 | BLOCKED，題庫未匯入 |
| npm test | PASS，173 項；Edge TypeScript 通過，沒有設定 lint script |
| npm run build | PASS，110 modules；未發布 |
| Git／Migration 安全檢查 | PASS，diff --check 通過、三個已部署 Migration SHA-256 未變、私有執行收據被忽略 |

匯入前後既有資料筆數相同：categories=7、hosts=2、rooms=2、room_categories=3、room_players=1、room_questions=0、host_question_history=0。沒有修改舊資料、Migration、RPC、RLS、GRANT、Functions、Secrets 或 Storage，沒有執行遊戲 QA、Git Commit／Push 或 Pages 發布。

## 原因與停止點

本次執行者在匯入命令使用 `--project-ref` 卻漏加 `--linked`。CLI 2.121.0 要求這兩個旗標搭配使用，否則在執行 SQL 前回報 `DbQueryMutuallyExclusiveFlagsError`。後續以相同旗標執行的唯讀命令明確重現此錯誤；補上 `--linked` 後，僅執行唯讀庫存與既有批次 verifier，確認沒有資料提交。

依使用者「遇非預期錯誤立即停止」要求，**未以修正命令自動重試匯入**，也未拆分交易、清理資源或強制修改資料。

## 待下一次明確指示

如使用者批准重試，只需重新核對 project、批次 SHA-256 及當下庫存，再執行原 SQL；不需要新 Migration、架構更動或 Secrets：

```sh
npx --no-install supabase db query --linked --project-ref fgvajdnzrnptdjurhjfo --file data/question-bank/prepared/review-20261023/reviewed-import.sql
npx --no-install supabase db query --linked --project-ref fgvajdnzrnptdjurhjfo --file data/question-bank/prepared/review-20261023/verify-import.sql
npx --no-install supabase db query --linked --project-ref fgvajdnzrnptdjurhjfo --file supabase/tests/verify_question_bank_access.sql
```

以上修正後的寫入命令**尚未執行**。私有本機執行收據位於 ignored prepared 目錄；未記錄原始 CLI 錯誤、憑證或 Token。此停止狀態不應被其他文件的「本機 READY」誤認為 Cloud 匯入完成。
