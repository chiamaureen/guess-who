# Guess Who — Phase 4 Final Verification Report

日期：2026-10-23  
規格：Phase 4 Database Design v1.2  
Project：`fgvajdnzrnptdjurhjfo`（既有 Free Project）  
最終 Gate：**READY WITH WARNINGS**

## 1. Executive Summary

九張應用資料表、七分類、C 模式必要資料限制、Migration、GRANT／RLS 與前端回歸均完成實際驗證，可以準備 Phase 5；本次沒有開始 Room System。

- 真實 Cloud PostgreSQL **17.11** 與隔離重播 Migration 的 catalog 比對：九表、55 欄位、62 個結構限制、31 索引、189 個角色表權限檢查，**應用 Schema 差異為零**。
- 本機 Migration／資料／權限與工具測試 **37／37**；連同既有測試，`npm test` 為 **88／88**；Build 通過，瀏覽器回歸 **27／27**。
- 本機／遠端 Migration 同為 `20261023060000`；dry-run 回報 up to date，沒有待部署內容。本次未執行真正 db push 或任何遠端測試資料異動。
- 發現既有 `rls_auto_enable()` SECURITY DEFINER **事件觸發器函式**，已確認用途、來源摘要及安全設定，不是答案 RPC；多餘 EXECUTE 授權與不在應用 Migration 內的設定列為非阻斷警告。
- 本機 PG18 與 Cloud PG17 仍有版本差異；45 題完整遊戲 E2E、實際多連線抽題／重置，以及圖片防洩漏屬後續階段，均未宣稱通過。

## 2. Database Schema Verification

| Table | 欄位數 | Actual Result | 重點 |
| --- | --- | --- | --- |
| categories | 5 | PASS | UUID PK、唯一 slug、啟停狀態、建立時間 |
| celebrities | 13 | PASS | UUID PK、nullable 唯一 Wikidata ID、真人／虛構人物、雙語名、完整圖片授權欄位、審核及更新時間 |
| celebrity_categories | 2 | PASS | UUID 複合 PK／FK、多對多分類 |
| hosts | 4 | PASS | UUID PK、唯一長期憑證 Hash、建立與最後活動時間 |
| rooms | 11 | PASS | UUID PK、唯一六碼代碼、一位 Host、獨立房間 Token Hash、狀態／15 題／時間限制 |
| room_categories | 2 | PASS | UUID 複合 PK／FK、房間複選分類 |
| room_players | 6 | PASS | UUID PK、房間 FK、暱稱界線、唯一 Session Hash、活動時間 |
| room_questions | 7 | PASS | UUID PK、1–15 題號、房間題號／人物各自唯一、有效房間分類及人物分類複合 FK |
| host_question_history | 5 | PASS | UUID PK、Host／人物 FK、跨場唯一、首次房間與實際題目關聯 |

驗證不只比較 migration history：`check:db` 實際比對欄位名稱、順序、型別、NOT NULL、DEFAULT、identity／generated、PK／FK／UNIQUE／CHECK 定義、延遲屬性、索引定義與有效性、GRANT、policy、trigger 與應用 helper 摘要。

- UUID 單欄 PK 預設 `gen_random_uuid()`；兩張關聯表依規格使用 UUID 複合 PK，並非另加無必要的 id。
- 時間欄位為 TIMESTAMPTZ，nullable 欄位與設計一致；Wikidata ID、英文名、遊戲開始／結束、揭曉時間及首次房間可空。
- 62 個限制不包含 PG18 才以獨立 catalog row 表達的 NOT NULL；NULL 約束另以 `attnotnull` 比對，沒有略過 NULL 驗證。
- 刪除 Room 會 CASCADE 清除房間關聯、玩家與題目，但 history 的複合 FK 只將 `first_room_id` 設 NULL，**保留 Host、人物與歷史去重紀錄**；本機動態測試通過。
- 刪除 history 不會反向刪除 room_questions；既有被題目／歷史引用的人物不可直接刪除。
- 同房間已有 15 題時，插入第 16 題遭 `23514` 拒絕；以既有題號塞入另一筆則遭 `23505` 拒絕。

### 必須由未來交易保證的條件

本機特別驗證並確認：**可信高權限程式仍可寫入題目卻沒有同步 history／current_question，也可將合法 finished 快照改回 playing**。這不是已完成的 Game Engine 保護，不能把單筆 CHECK 當成完整狀態機。

開始時至少一個啟用分類、至少 15 個 DISTINCT 可用已審核人物、過期房間禁止操作、合法狀態轉移、每題立即同步 history／進度、二次確認重置與無 playing 房間條件，均須 Phase 5／6 授權交易落實。瀏覽器目前沒有這些表的寫入權限。

## 3. Categories Verification

| Name | Slug | Cloud Actual Result |
| --- | --- | --- |
| 演員 | actors | PASS，存在且啟用 |
| 歌手 | singers | PASS，存在且啟用 |
| 運動員 | athletes | PASS，存在且啟用 |
| 政治人物 | politicians | PASS，存在且啟用 |
| 科學家 | scientists | PASS，存在且啟用 |
| 歷史人物 | historical-figures | PASS，存在且啟用 |
| 動畫人物 | animated-characters | PASS，存在且啟用 |

Seed 以唯一 slug upsert。本機連續重跑兩次仍為七筆，且不重新啟用已停用分類；Cloud 只讀取現有七分類，**沒有重跑 seed**。新增分類只需新增資料，不需要改 Schema。

保留 `celebrities` 命名，支援 `real_person`／`fictional_character`；其他值被 CHECK 拒絕。多筆 NULL Wikidata ID 可共存，非 NULL 重複值被 UNIQUE 拒絕。相同人物只有一個 id，多分類由關聯表表示；可用庫存計算必須 DISTINCT 人物 id。

目前前端仍是六個 Phase 2 Mock 分類，尚未接七分類資料庫；這是已知非阻斷的串接工作，不把 Mock UI 當成正式分類 API。

## 4. C Mode Verification

| Test | Result | Actual Result / Notes |
| --- | --- | --- |
| A：Host A 首次使用 X | PASS | 隔離 fixture 首次題目與 history 寫入成功 |
| B：Host A 再次記錄 X | PASS | `UNIQUE(host_id,celebrity_id)` 拒絕，SQLSTATE `23505` |
| C：Host B 使用 X | PASS | 不同 Host 可各自保留相同人物的歷史 |
| D：Y 同時屬於演員／歌手 | PASS | 20 個已審核人物跨兩分類、排除 1 個歷史後為 19，不重算分類關聯 |
| E：三房間各 15 題的 DB 資料限制 | PASS | 隔離、固定順序的 SQL fixture：45 個題目、45 個不同人物、45 筆對應歷史 |
| E：三場 45 題完整遊戲 E2E | NOT TESTED | 未實作抽題引擎／API；上述 SQL fixture 不代表真實隨機遊戲通過 |
| F：手動清歷史後重用舊題的 DB 策略 | PASS | 只清 Host A history，再於新房間使用 X 成功；舊題目與其他 Host 歷史保留 |
| F：重置 API／二次確認／身分授權 | NOT TESTED | 屬後續 API／引擎，沒有提前實作 |

歷史以 Host ID 而非分類或房間為去重範圍；首次房間複合 FK 確保同一 Host 且確實出過該人物。提前結束或房間清除不會自動重置 history。

### Transaction / Concurrency

文件已規劃：驗證身分後，固定先鎖 Host `FOR UPDATE`、再鎖 Room；同 Host 的開始、不同房間抽題及重置使用同一鎖序。題目、history、進度同一交易 commit；history UNIQUE 為最後防線，衝突整筆 rollback、必要時有界重試。

本機已驗證「先寫另一房間題目及進度，再遇重複 history」會完整回滾，不殘留題目或進度。**真正兩個資料庫連線同時競爭、死鎖／重試／鎖順序的動態驗證為 NOT TESTED**，不可用單一 PGlite 連線的測試取代。

## 5. RLS & Security Audit

| Table | anon / authenticated SELECT | Browser INSERT / UPDATE / DELETE | service_role |
| --- | --- | --- | --- |
| categories | 僅 is_active | 拒絕 | SELECT / INSERT / UPDATE / DELETE |
| celebrities | 拒絕 | 拒絕 | 同上 |
| celebrity_categories | 拒絕 | 拒絕 | 同上 |
| hosts | 拒絕 | 拒絕 | 同上 |
| rooms | 拒絕 | 拒絕 | 同上 |
| room_categories | 拒絕 | 拒絕 | 同上 |
| room_players | 拒絕 | 拒絕 | 同上 |
| room_questions | 拒絕 | 拒絕 | 同上 |
| host_question_history | 拒絕 | 拒絕 | 同上 |

- 九表均 ENABLE／FORCE RLS，只有 `categories_read_active` SELECT policy；沒有 PUBLIC 表授權或異常欄位授權。
- Cloud 實際切換 anon／authenticated 驗證分類 SELECT 及八表拒絕，不只是看 RLS Enabled。189 個表權限檢查與本機預期一致；service_role 沒有 TRUNCATE／REFERENCES／TRIGGER 表權限。
- anon／authenticated 不是 superuser，也沒有 BYPASSRLS 或 public schema CREATE。service_role 有 BYPASSRLS，因此後續 Edge Functions 必須自行驗證憑證與 rooms.host_id；房間代碼、Host ID、Publishable Key 均不能授權。
- 真實 Publishable Key REST GET：分類 HTTP 200／七個正確 slug；八張私表 HTTP 401／`42501`。私表使用 `limit=0`，沒有下載姓名、Hash 或歷史內容；404 不算通過。
- 沒有 public View／Materialized View，也沒有應用表 Realtime publication 或自動公開 publication。應用 helper 為 SECURITY INVOKER、固定空 search_path、無瀏覽器 EXECUTE 權限。
- 前端沒有私密高權限 Client；環境與 Git 掃描沒有發現 Secret／Service Role Key、資料庫密碼或 CLI Token 洩漏。只對外輸出狀態與非敏感摘要。

### 既有 SECURITY DEFINER 事件函式的審查例外

Cloud 存在 `public.rls_auto_enable()`，不在本次應用 Migration 內。實際 metadata 與程式碼審查結果：回傳 `event_trigger`、owner `postgres`、`search_path=pg_catalog`，由已啟用 `ensure_rls` 在 CREATE TABLE／CREATE TABLE AS／SELECT INTO 的 ddl_command_end 執行；動態命令以識別符格式化啟用新表 RLS，不讀取答案或憑證資料。

此用途符合 [Supabase 官方事件觸發器文件](https://supabase.com/docs/guides/database/postgres/event-triggers) 的自動 RLS 模式，但沒有證據判定誰在何時建立，不推定是本專案 Migration 建立。PostgreSQL 的事件觸發器函式不是一般直接可呼叫的函式；本次未呼叫它或觸發 DDL，參考 [PostgreSQL 官方回歸測試](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/test/regress/expected/event_trigger.out)。

anon／authenticated 目前有 EXECUTE，屬不必要授權；無 public CREATE，且該函式不能當一般答案 RPC 使用，未發現目前的資料外洩路徑，列 **Low 非阻斷警告**，不是宣稱「Cloud 完全沒有 SECURITY DEFINER」。`check:db` 嚴格固定已審查來源摘要、型別、owner、search_path 及事件設定，若異動即失敗，不按名稱任意略過。

可選增量 Migration 草案如下，**僅提供建議、未建立待部署 Migration、未執行**；若使用者同意，另建新版本，不修改既有部署檔案：

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
FROM PUBLIC, anon, authenticated;
```

不可依賴此平台事件函式代替應用 Migration 明確設定 RLS／GRANT；後續新表仍須遵守 default deny。

### Phase 8 素材規則

原始 Commons URL／檔名、EXIF、alt、署名或 response metadata 都可能包含答案。玩家 DTO 不傳原始姓名／人物 id／來源；依授權允許範圍規劃中性檔名、重新編碼、清除可識別 Metadata、不透明圖片入口與 SSRF 白名單。授權不允許適當署名時機就不能採用素材，不能為保密違反授權。正式素材管線尚未建立，端到端防洩漏 **NOT TESTED**。

## 6. Migration Status

| Item | Result | Actual Result |
| --- | --- | --- |
| Migration inventory | PASS | 一個合法時間版本，無重複版本或順序歧義 |
| Local history | PASS | `20261023060000` |
| Cloud history | PASS | `20261023060000` |
| `db push --dry-run --skip-vault` | PASS | upToDate=true；migrations／seeds／roles 均為空 |
| 真實 Schema drift | PASS | 應用 catalog 差異零；額外已審查 RLS 事件函式單獨記錄，沒有假裝 Cloud 所有物件完全等同本機 |
| Deployed Migration integrity | PASS | SHA-256 與原部署紀錄一致，未修改 |

檔案：`supabase/migrations/20261023060000_create_guess_who_schema.sql`。SHA-256：`8f5e0ed648794c09ced3b9d221b32ce070bf3b73f936d2f4bbe5b2834bdca07c`，這是檔案摘要，不是秘密憑證。

本次 CLI 只執行 migration list、明確 dry-run 與 READ ONLY SQL；沒有真正 db push、reset、repair、遠端 DROP／TRUNCATE／測試 DML，也沒有重跑雲端 seed。

## 7. Test Results

| Test Name | Result | Actual Result | Notes |
| --- | --- | --- | --- |
| Schema／FK／UNIQUE／CHECK／DEFAULT | PASS | 隔離 Migration 執行與資料限制測試成功 | 真實 SQL，不是純字串搜尋 |
| Categories seed 冪等性 | PASS | 重跑後七筆，停用狀態保留 | 僅本機；Cloud 七筆唯讀確認 |
| 真人／虛構人物與多分類 | PASS | 可空 Wikidata、多語名、審核與圖片欄位限制正確 | 不代表圖片內容／授權完成審核 |
| Room 15 題上限 | PASS | 滿 15 題後，題號 16 為 23514、重複題號為 23505 | 已新增滿額動態測試 |
| C mode／歷史重置資料策略 | PASS | A／B／C／D、三房間 DB fixture、重置後新房重用與舊紀錄保留 | 不代表引擎 E2E |
| anon／authenticated 動態權限 | PASS | 八表 SELECT、九表 INSERT／UPDATE／DELETE 被拒絕 | 本機隔離負向測試 |
| service_role 邊界 | PASS | 明確四種 DML；無 TRUNCATE 等多餘表權限 | BYPASSRLS 後端授權仍待後續實作 |
| Cloud 真實角色 SELECT | PASS | anon／authenticated 的實際 SQL 與預期相符 | READ ONLY，未修改資料 |
| Cloud GRANT／column privilege audit | PASS | 189 項表權限一致、無異常欄位／PUBLIC 授權 | Cloud 寫入權限以 catalog 驗證 |
| Cloud 實際 INSERT／UPDATE／DELETE 測試 | NOT TESTED | 本次明文禁止任何遠端寫入測試 | 沒有以回滾測試作為藉口寫入 Cloud |
| `npm run test:db` | PASS | 37／37 | PGlite 0.5.11、PostgreSQL 18.6 |
| 既有 Vitest | PASS | 30／30 | 前端／設定／Mock 驗證 |
| Health 模擬測試 | PASS | 21／21 | 與真實 Health 結果分開記錄 |
| `npm test` | PASS | 88／88 | 本次最終重跑結果 |
| `npm run check:db` | PASS | Cloud PG17.11 與本機應用結構一致，含已審查事件函式警告 | 不只看 Migration history |
| `npm run build` | PASS | TypeScript 與 Vite production build 成功 | 無前端原始碼變更 |
| `npm run dev`／瀏覽器回歸 | PASS | Chrome 155，27／27 | 六種寬度、三頁、表單／導覽／刷新／動態效果；無 JS 或 console 錯誤 |
| SDK 初始化 | PASS | 實際設定成功初始化共用 Client | 初始化不等於網路／SQL 成功 |
| Auth Health HTTP | PASS | 實際 HTTP 200、GoTrue Response 驗證通過 | 唯讀網路測試 |
| lint | NOT TESTED | 未設定 lint script | 未新增不相關工具 |
| 45 題完整遊戲／實際多連線競爭 | NOT TESTED | 引擎／API 尚未實作 | 已建立規格與資料層測試，未冒稱 E2E 通過 |
| Git Security Review | PASS | 忽略規則／環境示例／檔案與 diff／歷史掃描無敏感發現 | 未自動 Commit／Push，保留使用者既有 staged 狀態 |
| `git diff --check` | PASS | working tree 與 cached 檢查通過 | 無 whitespace 問題 |

瀏覽器實際驗證 320／375／390／768／1024／1440px，三頁無水平溢位；沒有 fetch／XHR 真實房間請求。截圖與測試紀錄位於 `/tmp/guess-who-phase4-final-qa/`，未加入 Git。

測試使用 Node.js 22.23.4。工具 shell 預設 Node 20，不符合專案要求，執行時明確切換到已安裝 Node 22；不宣稱 Node 20 可通過。

## 8. Issues Found

| Severity | Issue | 狀態／處置 |
| --- | --- | --- |
| Critical | 未發現 | 無關鍵 Schema 缺失、去重限制錯誤或已驗證的答案外洩路徑 |
| High | 未發現 | 不需要為通過本次驗收修改 Cloud Schema／RLS |
| Medium | 本機 PG18／Cloud PG17 版本差異，尚無真實多連線競爭驗證 | 非阻斷；已完成 PG17 唯讀 catalog／角色檢查，後續於隔離 PG17 環境補同版 DML／併發測試，不對正式 Cloud 寫測試資料 |
| Low | 既有 RLS 事件函式具多餘 EXECUTE、未納入應用 Migration | 已審查，非答案 RPC；保留警告與可選增量授權收斂草案，未擅改 Cloud |
| Low | 前端六個 Mock 分類與正式七分類不同 | 預期後續串接；Phase 5 以資料庫分類為準，不改 Schema 遷就 Mock |
| Low | 原 updated_at 測試依賴兩次時鐘必須嚴格遞增 | **已修正本機測試**；初次 35／36，發現同時鐘刻度造成誤判。改為刻意提交非法舊 updated_at，驗證 trigger 覆寫且時間不倒序；最終 37／37，不修改正式 trigger 或 Migration |

應用層授權／交易尚未實作與圖片管線未建立屬已明示後續範圍，不把它們誤報成 Phase 4 已完成的遊戲安全功能。

## 9. Files Modified

| File | Change / Reason |
| --- | --- |
| `supabase/tests/database.node-test.mjs` | 修正時鐘精度假設；增加滿 15 題、三場 DB fixture、重置重用、引擎保護邊界、catalog 漂移與事件函式審查測試 |
| `supabase/tests/schema_catalog.sql` | 新增 READ ONLY 結構／權限／函式／View／publication 中繼資料查詢，不讀私表資料列 |
| `scripts/check-database-schema.mjs` | 隔離重播 Migration、核對 linked Project、唯讀擷取 Cloud catalog 並比對；僅輸出差異路徑及安全摘要 |
| `package.json` | 新增 `check:db`，既有 `npm test` 自動包含新增隔離測試 |
| `README.md` | 補一行唯讀比對指令，維持目的／架構導向 |
| `AGENTS.md` | 記錄唯讀驗收、禁止 Cloud 測試 DML 與嚴格平台事件函式審查規則 |
| `docs/database-schema.md` | 補 catalog 比對範圍、目前測試數、事件函式例外與最終報告入口 |
| `docs/phase4-database-report.md` | 保留原始部署紀錄，補最新驗收報告連結 |
| `docs/phase4-final-verification.md` | 本完整 Notion Markdown 報告 |

沒有修改已部署 Migration、seed、config、正式表／權限、前端 `src/` 或私密環境變數；沒有新增套件、啟動 Docker 或安裝大型工具。

## 10. Phase 5 Readiness

### READY WITH WARNINGS

核心 Schema、約束、Migration 部署、資料庫角色隔離、Git 安全與既有前端測試均通過；沒有 Phase 4 阻斷項。已知版本差異與平台事件函式授權／版本控制警告不阻止設計 Room System，但必須保留可見，不宣稱所有安全功能或完整遊戲已實作。

**可以在使用者另行授權後開始 Phase 5。本次沒有實作任何 Phase 5 API／Host Identity／Player Session。**

## 11. Recommended Next Steps

1. 檢查本報告與 Git diff；決定是否另行核准平台事件函式的可選授權收斂 Migration。沒有要求為本次驗收直接改 Cloud。
2. 進入 Phase 5 前先訂定長期匿名 Host 憑證、單房間 Token、Player Session 的安全儲存／Hash／驗證／恢復與速率限制契約；不能把 room code 當主持人授權。
3. Room API 以伺服器驗證與角色分離 DTO 為邊界；正式七分類來自 Database，前端 Mock 保持明確標示直到真正串接。
4. Phase 6 實作 Host 層鎖、同交易出題／歷史／進度、DISTINCT 至少 15 人、庫存不足安全回滾、冪等與二次確認重置；屆時補真實多連線競爭及三場 45 題 E2E。
5. Phase 8 依授權審核與不透明圖片／Metadata 管線防洩漏；不直接將原始 Wikimedia 檔名或提前含姓名的署名傳給玩家。

本次工作到驗收為止，不自動 Commit／Push，不提前開始下一階段。
