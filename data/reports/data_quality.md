# 資料品質報告

匯入時間：2026-10-28T23:53:29.818Z
來源：https://doi.org/10.7910/DVN/RSAYV5、https://github.com/SahilMotyar/bwf-match-data 與 https://statshub.sportradar.com/taiwansportslottery/en/sport/31

## 原始檔

- `sun2026/matches.xlsx`：178896 列，轉成 3×21 候選 169385 列，日期 2006-09-18 至 2025-12-26，SHA-256 `331714d95311884be081d7a0bc053fb32835dc64f3f7755d4f820e2ccb5c5300`
- `sun2026/players.xlsx`：19164 列，SHA-256 `192a9a4d2111918e1fa5fc984399acf73ba71897b3f3306037931eef33952ed9`
- `sun2026/tournaments.xlsx`：1847 列，SHA-256 `450d723cfabd8d5f8db403551b49e7222640f1b16849382013ec55e1ce9a56af`
- `ms.csv`：28270 列，日期 2007-01-16 至 2026-07-05，SHA-256 `983d6127026819fa89cb463da7ac45b88d153199fdbff2533c19b5cbc3122000`
- `ws.csv`：21372 列，日期 2007-01-16 至 2026-07-05，SHA-256 `e29f01b5e8f21c645f8377e28441c6135c1fb7dfb094fe281f1953ab9bd6a9cf`
- `statshub/`：79 頁，單打完賽 1128 場（另有 88 場棄權、取消或未開打），日期 2026-07-05 至 2026-10-28

bwf-match-data 原始 `winner = 1` 的比例（男單、女單且日期早於 2027-01-04）：25267 / 49642（0.5090）。Sun & Zhang 檔以勝方、負方分欄，匯入時勝方放在 team1。

## 層級

- 國際系列賽：50659
- 國際挑戰賽：48421
- 未來系列賽：18975
- 黃金大獎賽：11402
- 超級系列賽：7929
- 大獎賽：6608
- 超級 100：5721
- 超級 300：5261
- 超級 500：3987
- 超級系列賽 Premier：2848
- 超級 750：2211
- 超級 1000：1740
- 世錦賽：1615
- 未標層級：1123
- 奧運：519
- 超級系列賽總決賽：285
- 年終總決賽：226

## 納入資料庫

- 選手：18395
- 賽事：1847
- 日期範圍：2006-09-18 至 2026-10-28
- 男單合法全場：102531
- 女單合法全場：66559
- 男單合法第一局：102817
- 女單合法第一局：66713
- 勝方欄與局分矛盾、因此不納入全場樣本：162

## 排除筆數

- 日期已在各層級資料內，不重複匯入菁英賽：48264
- 不是 3×21（15 分、11 分、棄權或未知）：9599
- 比分無法解析：2290
- 沒有合法全場或合法第一局：66
- 重複比賽：5

比分只保留能解析的局。全場樣本必須是合法的 3×21 完賽：兩局且同一方連勝，或三局且前兩局沒有同一方連勝。第一局只要該局合法就保留。

## Sportradar 賽果

來源：https://statshub.sportradar.com/taiwansportslottery/en/sport/31。只收錄台灣運彩有開盤的場次，不是完整賽果；同一站可能只有男單或只有女單。日期取開賽時間的 UTC 日期。賽事沒有層級資料。

- 對上既有選手：500
- 新建選手（id 為 `sportradar:<uid>`）：68

- MS｜Aakash ALOK｜`sportradar:934515`
- MS｜Aditya GAHIRWAL｜`sportradar:1343428`
- MS｜Aditya MENON｜`sportradar:1069918`
- MS｜Aleksa RADOVANOVIC｜`sportradar:1272542`
- MS｜Aleksander JAKOVLEVS｜`sportradar:1204343`
- MS｜Alvaro MORAN｜`sportradar:913047`
- MS｜Anastasios BAMPLEKOS｜`sportradar:1349240`
- MS｜Andrey MARCOV｜`sportradar:1394306`
- MS｜Artem SYNYTSIA｜`sportradar:1357342`
- MS｜Arun KUMAR｜`sportradar:189392`
- MS｜Axel JÄRUP｜`sportradar:1392776`
- MS｜Boris POPOV｜`sportradar:1367088`
- MS｜Conway WONG｜`sportradar:1335120`
- MS｜D. KIM KRISTENSEN｜`sportradar:380266`
- MS｜D. SILVA｜`sportradar:683337`
- MS｜Daniel LEONOVIC｜`sportradar:1272606`
- MS｜Dhivyesh SANKARAN｜`sportradar:1389480`
- MS｜Dominik TANKEVIC｜`sportradar:1357366`
- MS｜E CHRISTOPHERSEN｜`sportradar:321421`
- MS｜Felix KNODEL｜`sportradar:1353014`
- MS｜Filip JAMBROSIC｜`sportradar:1392812`
- MS｜Guanzhang CHEN｜`sportradar:1389478`
- MS｜Henri SAUR｜`sportradar:1389472`
- MS｜Ioannis SAROUGIANNIDIS｜`sportradar:1394286`
- MS｜Jaime HERRERA｜`sportradar:1302062`
- MS｜Jakub MAZUREK｜`sportradar:1336062`
- MS｜Jakub SIDOR｜`sportradar:1335118`
- MS｜Jeppe Bruun CHRISTENSEN｜`sportradar:398098`
- MS｜Jovan PAVLOVSKI｜`sportradar:1394288`
- MS｜Julien VERHEYEN｜`sportradar:1389468`
- MS｜Leon KASCHURA｜`sportradar:1355652`
- MS｜Lukas PATZAK｜`sportradar:1250297`
- MS｜Luke HALL｜`sportradar:1389474`
- MS｜Man Chung NG｜`sportradar:1343420`
- MS｜Marek KASSA｜`sportradar:1360374`
- MS｜Martin CHADES｜`sportradar:1367094`
- MS｜Martin HLEBARSKI｜`sportradar:642872`
- MS｜Maxime BOSMAN｜`sportradar:1389470`
- MS｜Maximilian KAUFFMANN｜`sportradar:1272562`
- MS｜Michal WESLAWOWICZ｜`sportradar:1389616`
- MS｜Mikolaj SASKA｜`sportradar:1391840`
- MS｜Milan ZEISIG｜`sportradar:1272578`
- MS｜Nikolaj Soegaard RASMUSSEN｜`sportradar:1098405`
- MS｜Petr BRIZA｜`sportradar:1272598`
- MS｜Quinn JENS｜`sportradar:1354760`
- MS｜Rex LEE｜`sportradar:1395154`
- MS｜Rik DE BACKER｜`sportradar:1389482`
- MS｜Rotem SILOOK｜`sportradar:957437`
- MS｜Sajan SENTHURAN｜`sportradar:1392778`
- MS｜Samuel FODOR｜`sportradar:1272622`
- MS｜Saneeth Dayanand SHIMOGA｜`sportradar:846918`
- MS｜Sanjeevi PADMANABHAN VASUDEVAN｜`sportradar:962489`
- MS｜Sarvesh MAHESH YADAV｜`sportradar:1399128`
- MS｜Simon TORP｜`sportradar:1251451`
- MS｜Soeren MOELLER｜`sportradar:1098443`
- MS｜Soren MARION GOTHSENER｜`sportradar:1361252`
- MS｜Stanislav IVANOV｜`sportradar:1394314`
- MS｜Vedan STEFANOVSKI｜`sportradar:1272582`
- MS｜Victor LAI｜`sportradar:839190`
- MS｜Vid BOROTA｜`sportradar:1349246`
- MS｜Vojtech STREJCEK｜`sportradar:1262567`
- MS｜Yuanrui LIN｜`sportradar:1389466`
- MS｜Zeno AGAI｜`sportradar:1272662`
- WS｜Caroline MOURITSEN｜`sportradar:1131263`
- WS｜Marie VISCOVICH｜`sportradar:1221867`
- WS｜Marloes SPIERING｜`sportradar:1354892`
- WS｜Mette KOOL｜`sportradar:1395144`
- WS｜Y. F. CHEN｜`sportradar:185150`
