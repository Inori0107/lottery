# 羽球對局估計

用公開賽果估計男單、女單的全場與第一局勝率，以及總分大小、總分讓分、正確比數的機率，再和台灣運彩賠率比較（當天賽事可從運彩頁一鍵帶入，也可手動輸入）。輸出是校準機率、期望值與研究用決策，不是投注指示，也不保證獲利。投注可記錄下來，完賽後自動結算，統計勝率、ROI 與 CLV。

## 範圍

做：歷史賽果匯入 SQLite、全場／第一局不讓分機率、[總分]大小、[總分]讓分、正確比數（客:主 2:0／2:1／1:2／0:2）、與十進位賠率比較、時間切分回測。

不做：2027-01-04 起的 3×15、第一局以外的單局玩法、整數盤口線（會有退款，只收 .5 線）、雙打、自動下注、把全場勝率直接當成第一局。

## 資料

三份資料只做本機研究。賽果權利屬 BWF，第 3 份的資料權利屬 Sportradar。原始檔在 `data/raw/`，不修改。資料庫在 `.data/badminton.sqlite`。

1. [Sun & Zhang, Scientific Data](https://doi.org/10.7910/DVN/RSAYV5)：男單、女單，2006-09 至 2025-12。15 分制、11 分制與棄權場不進模型。
2. [bwf-match-data](https://github.com/SahilMotyar/bwf-match-data) 只補上一份沒有的場次，目前到 2026-07-05。
3. [Sportradar StatsHub（台灣運彩版）](https://statshub.sportradar.com/taiwansportslottery/en/sport/31) 補 2026-07-06 之後的場次。每天存一頁到 `data/raw/statshub/<日期>.html`，每次請求間隔 2 秒，抓過的日期不重抓，仍有進行中比賽的頁面不存檔。網站只保留約半年的日期，所以舊頁要留在本機。只有運彩開盤的場次，不是完整賽果；沒有賽事層級，日期取開賽時間的 UTC 日期。棄權、取消的場次排除。選手名「姓, 名」在同項目內對既有 id；縮寫名（如 `Lin, C.-Y.`）只在姓氏加縮寫唯一時才對上，對不上的建成 `sportradar:<uid>`，列在品質報告裡。

三份依日期接續，不重疊：Sun & Zhang 是歷史主體；bwf-match-data 只取 Sun & Zhang 最後日期之後的列；Sportradar 從 2026-07-06 起。邊界上同日、同項目、同一對選手只留先匯入的那筆。Sportradar 只有約半年且不完整，不能取代前兩份。

只匯入 MS／WS、早於 2027-01-04 的 3×21 合法完賽。全場樣本要整場打完；第一局樣本只要第 1 局合法完賽。選手用 `player_id`，畫面客／主要對上運彩順序，不能假設檔案的 team1 就是客隊。

## 模型

男單與女單分開。特徵只能來自該場日期之前的比賽。

- **全場**：Elo，起始 1500、`K = 32`。賽前分數才用來預測。`E = 1 / (1 + 10^((對手 - 自己) / 400))`。
- **第一局**：邏輯斯迴歸（Elo 差、近 10 場第一局勝率差）。驗證段沒贏過對照時，改用分箱或由全場反推單局。最終測試段第一局誤差仍大於「直接用全場 Elo」，所以第一局候選門檻較高。
- **總分大小、總分讓分、正確比數**：每球模型。每球勝率 = `sigmoid(a + b × Elo 差)`，logit 上再加兩層常態波動：整場共用的狀態 `τ`（同一場各局表現正相關）與每局各自的 `σ`。`a`、`b` 先用每局得分做二項式迴歸，再以訓練段整場比分最大概似，用座標搜尋調整 `b`、`σ`、`τ`。接著精確算出 21 分制（含 deuce、30 分封頂）的比分分布，卷積成全場總分、分差與比數。只用 Elo 差，沒有選手個別的每球特徵。沒有歷史盤口線，所以總分與讓分的回測用每場模型機率落在 15%–85% 的所有 .5 線，不等於真實開盤線的分布。總分是雙峰分布（兩局與三局差很多），平均數不等於 50% 線。

回測依日期切訓練／驗證／最終測試。報告在 `data/reports/backtest.md`。

## 決策

每個玩法只評校準後期望值最高的那一個選項，輸出一個動作。

1. 用最終測試的校準箱，把原始機率線性內插成校準機率。正確比數四項校準後再正規化成總和 1。
2. 盈虧兩平是 `1 / 賠率`。期望值是 `校準機率 × 賠率 - 1`。去水只當盤口看法。
3. 較佳側期望值 ≤ 0，或不估： **不投**。
4. 期望值為正，但不到門檻、雙方樣本 < 40、資料落後 > 14 天、停賽 > 90 天、或與去水盤口差距 > 10%：**觀望**。
5. 全場期望值 ≥ 5%（第一局、總分大小、總分讓分、正確比數 ≥ 8%）且品質通過：**候選**。分數玩法的樣本條件用雙方全場場數。

候選是資料篩選後的紀錄，不是進場指示。沒有賽前歷史賠率，不做獲利回測。

## 運彩賠率與投注紀錄

**賠率來源**：運彩投注頁（`www-talo-ssb-pr.sportslottery.com.tw`，ORAKO 平台）的 `/services/content/get`。這不是公開 API，格式可能隨時改變；使用前請自行確認運彩的使用條款。只讀當天賽事與賠率，不登入、不呼叫任何下注或轉帳功能。網站有 Cloudflare 保護，伺服器直接請求會被擋（403），所以改由瀏覽器在運彩頁讀取：

1. 在 App 的「賠率同步」頁把書籤拖到書籤列。
2. 打開運彩投注頁按書籤。它從導覽樹（`boNavigationList`）找出羽球底下有場次的賽事與其市場群組，用 `eventGroup` 讀當天場次（中、英文各一次），再讀每場的 `event` 詳情。不用 `eventListBySportTypeDay`，因為那份當日清單不完整，會漏掉部分賽事（例如印尼100大師賽），開啟 App 的 `/tsl-sync` 並用 `postMessage` 送過去，再 POST 到 `/api/tsl/import`。瀏覽器擋彈出視窗或 15 秒內沒有回應時，改從運彩頁直接 POST（該路由只對運彩網域開 CORS）。
3. 運彩頁保持開著時每 20 分鐘再送一次，累積賠率快照。

運彩只列當天賽事，所以只抓當天。場次以 `externalreference`（`sr:match:<id>`）對 StatsHub，選手用與匯入賽果相同的規則對資料庫 id。分數賠率 `up/down` 換成十進位 `1 + up/down`，取兩位。運彩讓分市場標題的數字是主隊讓分；資料庫存客隊讓分（主隊的相反數）。只收男單、女單與 .5 線。

**投注紀錄**：存在 `.data/ledger.sqlite`（與賽果資料庫分開，重建賽果資料庫不會清掉）。在計算頁各玩法按「記錄投注」，可改下注賠率、填金額與備註。有對上運彩場次的投注，會在 StatsHub 出現完賽比分後自動結算：伺服器每 20 分鐘抓今天與前後一天的 StatsHub 頁（有未結算場次時往回最多 7 天），棄權或取消算作廢、退回本金。沒對上場次的投注要在「投注紀錄」頁手動改狀態。

**統計**：勝率與 ROI 只算已結算的贏／輸，作廢不計。CLV = `下注賠率 / 收盤賠率 - 1`，收盤賠率是開賽前最後一次快照、同一條線的賠率；線變了就不算。CLV 長期為正，才代表比市場早一步；樣本少時看不出來。依玩法與模型動作（候選／觀望／不投）分組。

## 執行

Nuxt 4、Vue、TypeScript。模型只在伺服器跑。SQLite 用 `better-sqlite3`。

```text
npm run update:data   抓新賽果 → 匯入 → 回測，完成後才換上新資料庫
npm run sync:live     抓 StatsHub 賽果並結算投注
npm test
npm run dev           啟動 5 秒後與每 6 小時自動執行 update:data；15 秒後與每 20 分鐘執行 sync:live
```

`update:data` 一小時內最多抓一次 Sportradar，沒有新頁面就不重建；加 `-- --force` 強制重抓與重建。新資料庫先寫到 `.data/badminton.next.sqlite`，回測完成才換上，伺服器偵測到檔案更換會重新開啟。關閉自動更新：`NUXT_AUTO_UPDATE_HOURS=0 npm run dev`；關閉自動結算：`NUXT_LIVE_SYNC_MINUTES=0`。也可單獨執行 `fetch:statshub`、`import:matches`、`backtest`。

`.env.example` 列了 `TSL_ACCOUNT`、`TSL_PASSWORD`。目前讀賠率不需要登入，程式沒有讀這兩個值；真的要用時只寫在 `.env`（已在 `.gitignore`），不要寫進程式碼或紀錄。

```text
app/pages/              計算、投注紀錄（bets）、賠率同步（tsl-sync）、已匯入賽事
app/utils/tslBookmarklet.ts  運彩頁書籤
shared/decision.ts      校準與不投／觀望／候選
server/models/          Elo、第一局、每球模型（rally.ts）、賠率、報價
server/models/tsl.ts    運彩資料解析
server/models/settle.ts 結算、CLV、統計
server/models/ledgerStore.ts  投注帳本存取
data/raw/               原始檔（tsl/sample.json 是運彩資料樣本，供測試）
.data/badminton.sqlite  執行時產生，不提交
.data/ledger.sqlite     投注帳本，執行時產生，不提交；要自行備份
```

## 參考

- [BWF Statutes](https://corporate.bwfbadminton.com/statutes/)
- [台灣運彩投注規範](https://article.sportslottery.com.tw/zh-tw/about-us/135)
- [台灣運彩各球種投注玩法](https://article.sportslottery.com.tw/zh-tw/innovation/1)
