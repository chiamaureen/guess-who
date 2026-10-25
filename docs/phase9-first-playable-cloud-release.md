# Phase 9 — First Playable Cloud Release

日期：2026-10-25（Asia/Taipei）。本次使用者已批准必要 Cloud／Git／Pages 操作；最終交付標準已提高為 **八組各15位、120位不同人物、八場真實雲端驗收**。本文件如實區分已部署與尚待驗收，不能把第一組或本機 PASS 當作整體 DONE。

## 1. 網址與目前結論

- 正式網址：https://chiamaureen.github.io/guess-who/
- 已發布程式 Commit：`3e8989d7deb385c0f2bc9e8c620bdb74517a9159`。
- [GitHub Actions 40159628859](https://github.com/chiamaureen/guess-who/actions/runs/40159628859)：build／deploy 均 completed／success；實際公開網址 HTTP200，載入新版 `/guess-who/assets/index-DtKIZ-S9.js`，不是只檢查本機 dist。
- Supabase：三份增量 Migration、room-system／game-engine 相容更新已成功部署；沒有部署 Phase7、設定 Secrets 或更換 Storage 架構。
- 英語歌手：15位已審核、已匯入，**公開網址同一房間15題遊戲驗收 PASS（中途恢復續測）**，新的匿名 Host 可以開局。嚴格「全站資料列增量」測試仍 FAIL，原因與補充核對如下，不能抹除原收據或稱所有檢查皆 PASS。
- **Phase 9 最終120位：NOT DONE**。其餘七組保留、不可選，尚有圖片／授權審核缺口。

## 2. 分組實際人數

以下 Cloud 數字已由匯入後獨立唯讀查詢取得；可抽題是「新Host、未使用歷史」基準，既有Host由API另行扣除自己的C模式歷史。

| 分組 | 本機已核准 | 雲端已匯入本分組 | 雲端可抽題 | 開放 | 距15位缺口 |
|---|---:|---:|---:|---|---:|
| 國外演員 | 1 | 0 | 0 | NOT READY | 15 |
| 台灣演員 | 0 | 0 | 0 | NOT READY | 15 |
| 英語歌手 | 15 | 15 | 15 | 已開放；真實15題 PASS，含恢復續測 | 0 |
| 台灣歌手 | 0 | 0 | 0 | NOT READY | 15 |
| 運動員 | 1 | 0 | 0 | NOT READY | 15 |
| 台灣政治人物 | 0 | 0 | 0 | NOT READY | 15 |
| 台灣 YouTuber | 0 | 0 | 0 | NOT READY，獨立 inactive 分類 | 15 |
| 動畫人物 | 0 | 0 | 0 | NOT READY | 15 |

原15位政治人物完整保留，Q76／Q22686仍approved，但不是台灣政治人物，沒有混入台灣分組充數。原七分類、scientists／historical-figures及所有既有遊戲／歷史均未刪除。Morgan Freeman與譚雅婷為先前本機核准的兩位，沒有因此擅自把其餘素材啟用。

### 第一批英語歌手

碧昂絲、女神卡卡、賈斯汀·提姆布萊克、凱蒂·佩芮、席琳娜·戈梅茲、山姆·史密斯、奧莉維亞·羅德里戈、麥可·傑克森、艾爾頓·強、瑪麗亞·凱莉、史提夫·汪達、艾瑞莎·弗蘭克林、保羅·麥卡尼、巴布·狄倫、辛蒂·露波。

前10位沿用原180候選；後5位為明確政府來源的補充歌手，沒有刪除原名單或把其他60位第二批當作完成。來源具名圖說／QID英文條目／作者與PD-USGov-POTUS、PD-USGov-NASA、PD-USGov-LOC聲明相互核對，工程審核非人臉生物辨識、非法律認證或全球人格權保證。圖片只用於非代言的辨識遊戲，保留來源、作者與修改說明。

15張最終WebP共873,538 bytes，品質82、最長邊≤1024、不放大、無EXIF／ICC／XMP，匿名UUID檔名。多人照片依具名圖說定位主體後裁切並逐張檢視；Sam Smith初版誤裁掉頭部已拒絕並修正，沒有核准舊裁切。Whitney Houston權利警示未解除，John Legend來源雖提到本人但畫面只有家人／副總統，兩張皆排除。Aretha的初步QID錯配也在條目比對時被阻擋，正式批次已用Wikipedia核實的Q125121。

本批用PD而非改標CC，避開尚未解決的CC BY／BY-SA署名呈現時機；既有其他CC素材保留原授權，不假裝已可用。完整證據在ignored prepared／phase9-english-release-v2-20261025，不進public或dist。[Commons再利用指引](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)、[NASA使用指引](https://www.nasa.gov/nasa-brand-center/images-and-media/)提醒仍應核對個別來源及非著作權條件，不能因網站有圖就核准。

## 3. Supabase 部署／備份

目標ref已核對為fgvajdnzrnptdjurhjfo，Cloud PostgreSQL17.11。CLI2.121支援--skip-vault。部署前Migration list只有原三份，Dry Run精確只有以下三份，沒有seed、roles、Vault或Realtime：

| Migration | 結果／用途 |
|---|---|
| 20261024120000_game_image_formats.sql | 已部署；沿用png bytea私有表，新增安全WebP／JPEG驗證，舊PNG不改寫 |
| 20261024160000_add_youtubers_category.sql | 已部署；只新增inactive youtubers，不改原七分類 |
| 20261025010000_question_groups.sql | 已部署；三張私有分組表、八組設定、窄輸出Host-aware選項RPC，抽題加分組條件 |

所有新表ENABLE／FORCE RLS，browser無表／欄位權限；新增RPC／helper為SECURITY INVOKER、空search_path、service_role-only。game_engine_action保持Host→Room鎖序、15題、C歷史、原questionId冪等與交易原子性，僅在三處資格查詢加入群組條件；沒有群組的既有房間仍用舊分類流程。

已更新game-engine支援image/webp的受控Blob回應；room-system新增get-question-groups和groupIds建房，Host Credential必須有效，計數／抽題／圖片仍在伺服器。舊categoryIds入口為相容舊房保留；兩套輸入同傳會拒絕。get-question-groups映射原H-01 read gate，不接受任意limit／scope／Host ID。

verify_jwt=false不等於公開授權，apikey、自訂Host／Room／Player權限、CORS及H-01保持。只沿用ROOM_SYSTEM_SIGNING_KEY／ROOM_SYSTEM_ALLOWED_ORIGINS；沒有設定ROOM_ENABLE_REALTIME或ROOM_REALTIME_SIGNING_JWK，後端預設不讀取Realtime key，私有Broadcast不啟用。原v1 Edge來源備份與部署前函式定義、分類、人物、圖片、關聯及既有遊戲摘要都保存在ignored、owner-private目錄。

### 實際匯入

- 精確SQL SHA-256：82f75f093af27df4945a7a657ee639dd59f418dd07324c5a9270211dc1ef62dd。
- 單交易新增15 celebrities＋15 celebrity_categories＋15 game_image_assets＋15 celebrity_question_groups＝60列。
- 確切批次已在本機實跑首匯、重跑不增列、唯讀驗證及未使用批次回滾；Cloud單次執行後新連線verify-import取得15/15，證實COMMIT。
- 既存QID、姓名、圖片bytes、署名／授權、分類及群組不完全一致即拒絕，不覆寫舊資料。回滾只處理收據新建且未使用的列，有題目／歷史引用就整批拒絕。
- 沒有Supabase Storage、圖片來源URL直傳Player、Cloud Secrets修改或政治人物停用。

## 4. 實際測試與待驗收

| 項目 | 狀態 |
|---|---|
| 自動化／TypeScript／Build | 最終325項PASS：Vitest103、Health21、DB37、Room27、Game26、Group7、Realtime18、題庫86；Edge TypeScript及Build117 modules PASS；沒有lint script |
| 真實本機PG併發 | 6組PASS，20連線，含重送／交易回滾／reset對start，PG18.6與Cloud17.11版本差異保留 |
| Chrome本機UI | 23組PASS，1440／375px、WebP、Session／權限；明確不是Cloud |
| H-01 | 20個不同假憑證皆429，新增限流列0、business action0 |
| 正式Cloud Schema／RLS／GRANT | PASS，唯讀驗證原政治人物與私有表／RPC權限 |
| 正式匯入／關聯 | PASS，15/15、WebP完整性、八組count僅英語歌手15 |
| Git whitespace check | 四份新增SQL僅有EOF空白行警告，其中三份已部署，為保留部署bytes不事後修改；不是程式／安全測試失敗 |
| Pages新版部署 | PASS，程式Commit 3e8989d，Actions 40159628859 的 build／deploy 成功；公開HTTP200與新版JS確認 |
| 公開網址15題遊戲／Session／答案隔離 | PASS，X43BT3 同房續測完成；實際Chrome155、CloudAPI、每張WebP比對已審SHA；不是單次不中斷執行 |
| 公開手機viewport | PASS，390px獨立Player，自動Polling看題／揭曉、圖片與換題；無橫向溢出；不是實體手機 |
| 原驗收工具全域列數 | FAIL，hosts預期8、實際9；另有一個未建房的匿名身分，不能歸因為已確認的其他使用者或自行刪除 |
| 補充唯讀資料完整性 | PASS，QA房15題／15人／15歷史；部署前與匯入後所有舊資料逐列／摘要不變，其他表增量精確；RPC／CHECK／Migration未改 |
| 最後回歸／安全檢查 | 325項、Edge TypeScript、Build重新PASS；第一次sandbox禁止127.0.0.1導致EPERM，取得所需權限重跑後零失敗，未跳過測試；git diff --check乾淨；216工作檔／467歷史blob未發現敏感憑證 |
| 實體iPhone／Android | NOT TESTED，Chrome窄viewport不等於實機 |

正式Cloud QA使用現有check-game-cloud.mjs加--first-playable，固定公開Pages，不Mock、不攔截改用fixtures；新匿名Host＋獨立Player，依序完成15題，驗每張圖SHA／MIME／解碼、揭曉前Player窄DTO、揭曉後署名、Next重送、無第16題、Host／Player reload、C模式15筆歷史及再建房拒絕。QA只新增必要資料，結束房間而不刪除／重設歷史。

### 本次真實公開網站收據

- QA房 `X43BT3`，固定英語歌手分組，一位新的匿名Host、一個獨立390px Player，沒有Cloud攔截／fixture／Mock。Player不能開始；Host可見當前答案，Player未揭曉DTO僅含id／number／revealed，沒有姓名、人物ID、來源、Token或hash。
- 15題均完成揭曉，15個不同人物；Host與Player各取得15張不同的私有WebP，已逐張對照核准檔SHA、實際解碼、MIME、中性檔名、no-store及無Metadata。玩家靠正式Polling自動更新，不按Refresh繼續題目；Host重送Next不跳題，第15題後Next被拒，最終finished、ended_at存在。
- Host與Player在未揭曉、已揭曉和結束後重新載入均恢復原Session／題號／揭曉狀態；結束後game-panel／lobby-panel隱藏。Host歷史保留15位；同Host再到建立頁時英語歌手剩0、卡片／建房鈕disabled，直接帶合法Host Credential建立同分組也回409 INSUFFICIENT_QUESTIONS，沒有建立第二房、沒有reset。
- 第一次測試工具在建房前過早讀取尚未載入的checkbox數而失敗，已修正等待資料完成，不因此重建Host。其後房間測試在第5題揭曉後、最終checkpoint前中斷，當時未保存足夠錯誤診斷，原因未確定；保留FAIL收據，不能假稱整段不中斷通過。續測沿用同房／同Host／同Player，先核對前5題不可變DB與圖片收據，再完成6～15題；第5題揭曉前斷言的依據明載於續測收據。
- 原工具最後的全域精確列數檢查 FAIL：hosts從7到9，預期只有QA新增1位；唯讀查到QA之外的一位身分在QA開始後建立、尚無任何房間，但無法只憑這些資料判定建立者。**保留原FAIL，不刪該身分、不調高期望值假裝原測試PASS，也不重跑整場產生更多資料。**
- 補充唯讀核對證實：QA房15題、15不同人物、15揭曉、15筆first_room_history，其他全域增量均吻合。部署前及匯入後每一筆既有分類／人物／分類關聯／圖片／房間摘要／題目摘要／歷史摘要原封不動；匯入後的函式定義、CHECK與Migration history亦相同。因此「此房真實15題遊戲及既有資料保留」為PASS，「原工具全站唯一寫入假設」仍為FAIL，不混為一談。
- 最終Cloud：categories8、celebrities30、game_image_assets30、rooms12、room_questions39、host_question_history36、question_groups8；舊房11／舊題24／舊歷史21全部保留，本次QA新增房1／題15／歷史15。Private圖片無新增公開Bucket或直接SELECT權限。
- Owner-private收據：`/tmp/guess-who-phase6-cloud-MAQtkC/results.json`（前段失敗）、`/tmp/guess-who-phase6-cloud-l3FCtw/results.json`（原全域檢查FAIL）及同目錄`final-acceptance.json`（補充唯讀／公開頁恢復PASS）。原始憑證僅該私有目錄sessions.json，不提交。長期備份在ignored `data/question-bank/prepared/phase9-cloud-release-20261025/`。

### Git與前端部署安全

- `.env.local`無追蹤，`.env.*`忽略且只保留示意`.env.example`；prepared圖片／SQL／備份忽略，未進Git或dist。後端Secret、Service Role、PAT、資料庫密碼與私鑰未放入VITE。Publishable Key按用途由Actions Variables在Build提供。
- GitHub Pages Source=GitHub Actions、Custom Domain空白；Vite `/guess-who/`、HashRouter、最小權限及固定Action版本保留。正式Origin `https://chiamaureen.github.io` 的兩個Functions OPTIONS204，非授權Origin403且無Allow-Origin。
- Phase7仍DEFERRED，前端Realtime flag=false，沒有部署其Migration或設定JWK；既有H-01與後端Secrets未改。
- 最後的文件／QA工具修正另行Commit與Push；網站仍由上述程式Commit的成功Actions供應。只有文件或QA工具更動不需再發一次Pages，也不宣稱程式Commit等於後續文件Commit。

## 5. 其餘七組阻礙

- 技術WebP通過不等於權利核准；原Demo120的118位未核准不因本次發布變成approved。
- 演員、台灣歌手、運動員仍需逐張解除本人／多人裁切、權利聲明與CC署名時機關卡；台灣政治人物14張自訂Attribution條款不能改標CC。YouTubers另有兩位缺來源圖。
- 動畫角色缺少可公開再利用及改編的權利證據，不能拿官圖／劇照、粉絲頁尾CC條款當成角色授權。
- 使用者補充三個角色網站已逐一查閱：[chiikawa Google Sites](https://sites.google.com/view/chiikawa-hw/)可讀，只有角色介紹與copyright footer，未發現可再利用圖像的授權；[飛天小女警Fandom](https://twami.fandom.com/zh/wiki/%E9%A3%9B%E5%A4%A9%E5%B0%8F%E5%A5%B3%E8%AD%A6%E8%A7%92%E8%89%B2%E5%88%97%E8%A1%A8?variant=zh-tw)是角色名單，有一般社群CC-BY-SA頁尾但沒有逐張角色圖權利證據；[海綿寶寶Fandom](https://spongebob.fandom.com/zh/wiki/%E6%B5%B7%E7%B6%BF%E5%AF%B6%E5%AF%B6%E7%99%BE%E7%A7%91%E5%85%A8%E6%9B%B8)及平台授權頁取得402，未能核驗。三者仍是來源線索，不新增APPROVED。
- 原角色清單與180候選保留，不擅自替換為15個自創角色冒稱真實角色題庫。完整120位與其餘七場Cloud QA因此仍NOT READY。這是保留缺口的階段性交付，不是八組完成；其餘105個Cloud分組席位尚缺核准素材與匯入，不能用本機76張技術通過或兩位既有本機核准充數。

## 6. 回滾程序

1. 先停止新的發布／匯入與QA，不自動清理任何房間或歷史；保留備份及失敗收據。不要db reset、migration repair、CASCADE或改寫已部署Migration。
2. 素材尚未被用過時，才可審核並執行該批rollback-import.sql（db query --linked --project-ref fgvajdnzrnptdjurhjfo --file 私有批次路徑／rollback-import.sql）；它會拒絕有題目／歷史引用、資料已改或不屬於本收據的刪除。Cloud15題QA一旦完成，不再符合此回滾條件，不執行該檔。
3. 素材已使用：保留人物、私有圖片、群組、room_questions與C歷史，採經審核的增量修復；不可為還原PNG-only CHECK而刪WebP。需要暫停某組時，另審核精確group id的inactive資料變更，不刪分類。
4. 前端可git revert本次程式Commit，再經測試／安全審核、push並明確dispatch pages.yml；先確認舊前端／API仍相容，不force push。僅還原前端不應還原資料庫歷史。
5. 後端若需還原，以本機private備份的舊function definition／Edge source準備新的前向Migration／bundle，先Dry Run與資料相容性檢查，再明確部署；舊PNG-only Edge不能直接套回有WebP題庫的環境，應保留新版圖片支援再修正故障邏輯。不得直接刪新表、撤回引用中的圖片或覆寫Migration history。

本次部署授權不構成任意刪除或後續不受限修復授權。所有回滾命令須以當時實際引用與授權範圍再審核；本文件記錄方案，沒有執行Cloud回滾。
