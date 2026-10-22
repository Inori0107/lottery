import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Discipline, Game1Method } from '../shared/types'
import { openDatabase } from '../server/db/open'
import {
  runBacktest,
  type BacktestGame,
  type BacktestMatch,
  type DisciplineResult,
  type PointsMarketTest,
} from '../server/models/backtest'
import type { CalibrationBin } from '../server/models/game1'
import { dbFile, reportDir } from './paths'

const { sqlite } = openDatabase(dbFile)

const rows = sqlite.prepare(`
  SELECT
    m.match_id, m.discipline, m.played_on, m.side_a_id, m.side_b_id,
    m.include_match, m.include_game1, m.side_a_won_match, g.side_a_won AS game1_side_a_won
  FROM matches m
  LEFT JOIN games g ON g.match_id = m.match_id AND g.game_number = 1 AND g.is_legal = 1
  WHERE m.include_match = 1 OR m.include_game1 = 1
`).all() as Array<{
  match_id: string
  discipline: Discipline
  played_on: string
  side_a_id: string
  side_b_id: string
  include_match: number
  include_game1: number
  side_a_won_match: number | null
  game1_side_a_won: number | null
}>

const gameRows = sqlite.prepare(`
  SELECT g.match_id, g.points_a, g.points_b
  FROM games g
  JOIN matches m ON m.match_id = g.match_id
  WHERE g.is_legal = 1 AND (m.include_match = 1 OR m.include_game1 = 1)
  ORDER BY g.match_id, g.game_number
`).all() as Array<{ match_id: string, points_a: number, points_b: number }>
const gamesByMatch = new Map<string, BacktestGame[]>()
for (const game of gameRows) {
  const list = gamesByMatch.get(game.match_id) ?? []
  list.push({ pointsA: game.points_a, pointsB: game.points_b })
  gamesByMatch.set(game.match_id, list)
}

const matches: BacktestMatch[] = rows.map(row => ({
  matchId: row.match_id,
  discipline: row.discipline,
  playedOn: row.played_on,
  sideAId: row.side_a_id,
  sideBId: row.side_b_id,
  includeMatch: row.include_match === 1,
  includeGame1: row.include_game1 === 1 && row.game1_side_a_won !== null,
  sideAWonMatch: row.side_a_won_match === null ? null : row.side_a_won_match === 1,
  sideAWonGame1: row.game1_side_a_won === null ? null : row.game1_side_a_won === 1,
  games: gamesByMatch.get(row.match_id) ?? [],
}))

const results = runBacktest(matches)
const format = (value: number | null) => value === null ? '—' : value.toFixed(4)
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`
const label = (discipline: Discipline) => discipline === 'MS' ? '男單' : '女單'
const game1Label = (method: Game1Method) => {
  if (method === 'logistic') return '邏輯斯迴歸'
  if (method === 'bins') return 'Elo 差距分箱'
  return '三局兩勝反推'
}
const calibrationTable = (bins: CalibrationBin[]) => {
  const rows = bins.map(bin =>
    `| ${percent(bin.lo)}–${percent(bin.hi)} | ${bin.n} | ${percent(bin.predicted)} | ${percent(bin.actual)} |`,
  )
  return [
    '| 預測區間 | 樣本 | 預測均 | 實際勝率 |',
    '|---|---:|---:|---:|',
    ...rows,
  ].join('\n')
}
const pointsRow = (title: string, test: PointsMarketTest | undefined, baseline: string) =>
  `| ${title} | ${test?.n ?? 0} | ${format(test?.logLoss ?? null)} | — | ${baseline} ${format(test?.baselineLogLoss ?? null)} |`
const pointsCalibration = (title: string, test: PointsMarketTest | undefined) =>
  `### ${title}校準\n\n${calibrationTable(test?.calibration ?? [])}`

const insertPrediction = sqlite.prepare(`
  INSERT INTO predictions (match_id, market_type, model_version, p_side_a, feature_as_of, split)
  VALUES (@matchId, @marketType, @modelVersion, @pSideA, @featureAsOf, @split)
`)
const insertRating = sqlite.prepare(`
  INSERT INTO player_ratings (
    discipline, player_id, elo, match_count, game1_count, last_played_on, game1_recent
  ) VALUES (
    @discipline, @playerId, @elo, @matchCount, @game1Count, @lastPlayedOn, @game1Recent
  )
`)
const insertModel = sqlite.prepare(`
  INSERT INTO model_state (discipline, model_version, game1_method, payload, data_through)
  VALUES (@discipline, @modelVersion, @game1Method, @payload, @dataThrough)
`)

const write = sqlite.transaction((models: DisciplineResult[]) => {
  sqlite.prepare('DELETE FROM predictions').run()
  sqlite.prepare('DELETE FROM player_ratings').run()
  sqlite.prepare('DELETE FROM model_state').run()
  for (const model of models) {
    insertModel.run({
      discipline: model.discipline,
      modelVersion: model.modelVersion,
      game1Method: model.game1Method,
      payload: JSON.stringify(model.payload),
      dataThrough: model.dataThrough,
    })
    for (const rating of model.ratings) {
      insertRating.run({
        discipline: rating.discipline,
        playerId: rating.playerId,
        elo: rating.elo,
        matchCount: rating.matchCount,
        game1Count: rating.game1Count,
        lastPlayedOn: rating.lastPlayedOn,
        game1Recent: JSON.stringify(rating.game1Recent),
      })
    }
    for (const prediction of model.predictions) insertPrediction.run(prediction)
  }
})
write(results)

const report = `# 回測報告

K = 32，起始分 1500。預測時可依樣本數與停賽天數把分數拉回 1500。係數只在訓練段估計；驗證段決定是否收縮，以及第一局用邏輯斯迴歸、Elo 差距分箱或三局兩勝反推。最終測試不參與選擇。

總分大小、總分讓分、正確比數用每球模型：訓練段以每局得分擬合「Elo 差 → 每球勝率」，每球勝率在 logit 上另有兩層常態波動：整場共用的狀態 τ 與每局各自的 σ（與 Elo 斜率一起用訓練段整場比分最大概似估計），再精確算出 21 分制（含 deuce、30 分封頂）的比分分布。沒有歷史盤口線，所以總分與讓分的 log loss 與校準表都用每場模型機率在 15%–85% 的所有 .5 盤口線。

${results.map((model) => `
## ${label(model.discipline)}

- 模型版本：\`${model.modelVersion}\`
- 第一局方法：${game1Label(model.game1Method)}
- 收縮：${model.payload.shrink.mode === 'full'
    ? `樣本與停賽，n0 = ${model.payload.shrink.samplePrior}，半衰期 ${model.payload.shrink.halfLifeDays} 天`
    : model.payload.shrink.mode === 'inactivity'
      ? `只計停賽，半衰期 ${model.payload.shrink.halfLifeDays} 天`
      : '未啟用（驗證段未優於原始 Elo）'}
- 訓練截止日期：${model.payload.trainEnd}
- 驗證截止日期：${model.payload.validEnd}
- 資料截至：${model.dataThrough}
- 驗證全場 log loss：原始 Elo ${format(model.payload.validation.matchEloRaw)}、只計停賽 ${format(model.payload.validation.matchEloIdle)}、樣本加停賽 ${format(model.payload.validation.matchEloEff)}
- 驗證第一局 log loss：邏輯斯 ${format(model.payload.validation.logistic)}、分箱 ${format(model.payload.validation.bins)}、三局兩勝反推 ${format(model.payload.validation.bo3)}、直接用全場 Elo ${format(model.payload.validation.matchElo)}

### 最終測試

| 市場 | 樣本 | log loss | Brier | 對照 log loss |
|---|---:|---:|---:|---:|
| 全場不讓分 | ${model.payload.test.match.n} | ${format(model.payload.test.match.logLoss)} | ${format(model.payload.test.match.brier)} | 固定 50% ${format(model.payload.test.match.baselineLogLoss)} |
| 第一局不讓分 | ${model.payload.test.game1.n} | ${format(model.payload.test.game1.logLoss)} | ${format(model.payload.test.game1.brier)} | 直接用全場 Elo ${format(model.payload.test.game1.matchEloLogLoss)} |
${pointsRow('總分大小（所有盤口線）', model.payload.test.totals, '固定 50%')}
${pointsRow('總分讓分（所有盤口線）', model.payload.test.handicap, '固定 50%')}
${pointsRow('正確比數', model.payload.test.correctScore, '訓練段比數頻率')}

- 每球模型：每球勝率 = sigmoid(${format(model.payload.rally?.coefficients[0] ?? null)} + ${model.payload.rally?.coefficients[1]?.toExponential(3) ?? '—'} × Elo 差)，每局波動 σ = ${model.payload.rally?.sigma.toFixed(2) ?? '—'}，整場狀態波動 τ = ${model.payload.rally?.tau?.toFixed(2) ?? '—'}
- 模型公平線實際「大」的比率：${percent(model.payload.test.totals?.fairLineRate ?? null)}；公平讓分線實際過盤比率：${percent(model.payload.test.handicap?.fairLineRate ?? null)}（理想是 50%）

### 全場校準

${calibrationTable(model.payload.test.match.calibration)}

### 第一局校準

${calibrationTable(model.payload.test.game1.calibration)}

${pointsCalibration('總分大小', model.payload.test.totals)}

${pointsCalibration('總分讓分', model.payload.test.handicap)}

${pointsCalibration('正確比數', model.payload.test.correctScore)}
`).join('\n')}
`
mkdirSync(reportDir, { recursive: true })
writeFileSync(join(reportDir, 'backtest.md'), report)
sqlite.close()
console.log('回測已寫入資料庫與 data/reports/backtest.md')
