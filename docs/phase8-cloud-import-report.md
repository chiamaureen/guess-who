# Phase 8 — PostgreSQL Cloud Import Report

2026-10-23（Asia/Taipei）。**本次授權重試 PASS / IMPORTED AND VERIFIED**。以下先列最新結果，再保留第一次停止的歷史紀錄。

## 本次重試結果

- 使用者已明確批准修正 `--linked` 後重試原批次，目標仍為 `fgvajdnzrnptdjurhjfo`。
- CLI 2.121.0 的版本／help 與同參數唯讀查詢均先確認通過；linked ref、原批次 SHA-256、15 筆完整審核資料、圖片 SHA-256、純 INSERT 及單一交易均再次確認。
- 使用下方原定修正命令，**只執行一次**匯入。2026-10-23 21:24:40（Asia/Taipei）CLI 成功，後續獨立 Cloud 查詢確認資料可見且精確匹配，證實 COMMIT；不是僅以 CLI 成功當作驗收。

| 項目 | 本次實際結果 |
| --- | --- |
| celebrities | 0 → 15，新增 15 |
| celebrity_categories | 0 → 15，新增 15，均為既有啟用政治人物分類 |
| game_image_assets | 0 → 15，新增 15，均為私有 PNG |
| 新增總列數 | **45** |
| Transaction | **COMMITTED**；單一 BEGIN／COMMIT，沒有拆批、覆寫或清理 |
| 原 verify-import.sql | **PASS**，expected_subjects=15、verified_subjects=15 |
| 圖片／人物關聯 | **PASS**，逐一核對 receipt 的人物／圖片 UUID、Wikidata、PNG SHA-256、格式、approved 與分類集合 |
| 授權資訊 | **PASS**，15 人皆保留完整來源、作者、授權及署名 |
| anon／authenticated 直接圖片 SELECT | **PASS**，實際切換兩角色測試，均遭拒絕；RLS／FORCE RLS 啟用 |
| 遊戲可用且未被任何 Host 使用 | **15**，已審核人物／圖片與啟用分類符合條件、無歷史使用紀錄 |
| 原 Game Engine 權限 verifier | **PASS**，RPC／RLS／GRANT／Realtime 隔離未異常 |
| npm run check:db | **PASS**，differences=[]、210 項表權限比對、無非預期 public function／view；本機 PG18.6、Cloud PG17.11 |
| npm test／npm run build | **PASS**，173 項自動化、Edge TypeScript、110 modules Build；沒有 lint script |
| 完整 15 題 Cloud 遊戲驗收 | **NOT EXECUTED**，需要另行授權 |

既有 categories=7、hosts=2、rooms=2、room_categories=3、room_players=1、room_questions=0、host_question_history=0，匯入前後均一致。三個已部署 Migration 雜湊未變；沒有修改 Migration、RPC、RLS、GRANT、Edge Functions、Secrets 或 Storage，沒有 Commit／Push／發布 Pages。

`check:db` 保留既有已審查平台 `rls_auto_enable` event trigger 的 public EXECUTE 警告，來源與屬性符合原基準；不是本次新增，也未擅自修改平台權限。私有執行／驗證收據位於 ignored prepared 目錄，未記錄憑證或 Token。

**結論：題庫匯入完成，已達政治人物分類 15 題雲端驗收的最低題庫條件。** 下一步只待使用者另行批准測試房間與主持人／玩家 QA 資料寫入，詳見 [Cloud 15 Question Acceptance](cloud-15-question-acceptance.md)。本次到此停止，不代表完整 Cloud 遊戲已通過。

## 歷史：第一次匯入停止（21:19）

以下 0 列／FAIL 為先前未帶 `--linked` 的歷史，不是本次重試結果。

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

## 第一次停止時的修正方案（本次已批准並執行）

如使用者批准重試，只需重新核對 project、批次 SHA-256 及當下庫存，再執行原 SQL；不需要新 Migration、架構更動或 Secrets：

```sh
npx --no-install supabase db query --linked --project-ref fgvajdnzrnptdjurhjfo --file data/question-bank/prepared/review-20261023/reviewed-import.sql
npx --no-install supabase db query --linked --project-ref fgvajdnzrnptdjurhjfo --file data/question-bank/prepared/review-20261023/verify-import.sql
npx --no-install supabase db query --linked --project-ref fgvajdnzrnptdjurhjfo --file supabase/tests/verify_question_bank_access.sql
```

以上命令現已在本次重試授權下執行完成；**不可再次執行匯入**，同批次已存在且重複防護會拒絕。私有本機執行收據位於 ignored prepared 目錄；未記錄原始 CLI 錯誤、憑證或 Token。
