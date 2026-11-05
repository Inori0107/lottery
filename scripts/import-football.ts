import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openDatabase } from '../server/db/open'
import { FOOTBALL_SOURCE_URL } from '../server/models/constants'
import { parseStatshubPage, type StatshubMatch } from '../server/models/statshub'
import { detectHomeAdvantageMode } from '../server/models/footballElo'
import { parseFootballCsvRow, type FootballCsvRow, type RejectReason } from '../server/models/footballDataset'
import { runFootballBacktest, type FootballBacktestMatch } from '../server/models/footballBacktest'
import { dbFile, footballStatshubDir } from './paths'

type LoadStats = {
  totalOnPages: number
  notFinished: number
  wrongDiscipline: number
  duplicates: number
  uniqueFinished: number
}

const toCsvRow = (match: StatshubMatch): FootballCsvRow => ({
  date: match.playedOn,
  discipline: match.discipline,
  tournament: match.tournament,
  team1: `${match.home.name.trim()} [sportradar:${match.home.uid}]`,
  team2: `${match.away.name.trim()} [sportradar:${match.away.uid}]`,
  winner: match.winner,
  score: match.score,
  team1_home: '1',
})

const loadCachedMatches = (): { matches: StatshubMatch[], stats: LoadStats } => {
  mkdirSync(footballStatshubDir, { recursive: true })
  const files = readdirSync(footballStatshubDir).filter(file => file.endsWith('.html')).sort()
  const matches = new Map<number, StatshubMatch>()
  const stats: LoadStats = {
    totalOnPages: 0,
    notFinished: 0,
    wrongDiscipline: 0,
    duplicates: 0,
    uniqueFinished: 0,
  }

  for (const file of files) {
    const page = parseStatshubPage(readFileSync(join(footballStatshubDir, file), 'utf8'), 'football')
    for (const match of page.matches) {
      stats.totalOnPages++
      if (!match.played) {
        stats.notFinished++
        continue
      }
      if (match.discipline !== 'FM' && match.discipline !== 'FW') {
        stats.wrongDiscipline++
        continue
      }
      if (matches.has(match.sportradarId)) {
        stats.duplicates++
        continue
      }
      matches.set(match.sportradarId, match)
    }
  }
  stats.uniqueFinished = matches.size
  return { matches: [...matches.values()], stats }
}

const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  bad_date: '日期格式錯誤',
  out_of_range: '日期超出範圍',
  bad_discipline: '項目不符',
  missing_result: '缺少勝負結果',
  missing_name: '缺少隊名',
  same_team: '同隊對戰',
  bad_score: '比分格式錯誤或與勝負不符',
  not_in_sample: '不在樣本內',
}

const { matches, stats: loadStats } = loadCachedMatches()
const rows = matches.map(toCsvRow)
const parseResults = rows.map(parseFootballCsvRow)
const accepted = parseResults.flatMap(result => ('match' in result ? [result.match] : []))
const rejected = parseResults.flatMap(result => ('reason' in result ? [result.reason] : []))

const rejectCounts = rejected.reduce((acc, reason) => {
  acc[reason] = (acc[reason] ?? 0) + 1
  return acc
}, {} as Record<RejectReason, number>)

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('足球匯入統計')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log(`  頁面總比賽數：${loadStats.totalOnPages}`)
console.log(`  排除（未完賽/進行中）：${loadStats.notFinished}`)
console.log(`  排除（非FM/FW項目）：${loadStats.wrongDiscipline}`)
console.log(`  排除（重複）：${loadStats.duplicates}`)
console.log(`  已完賽不重複：${loadStats.uniqueFinished}`)

if (Object.keys(rejectCounts).length > 0) {
  console.log('  解析排除：')
  for (const [reason, count] of Object.entries(rejectCounts)) {
    console.log(`    ${REJECT_REASON_LABELS[reason as RejectReason]}：${count}`)
  }
}
console.log(`  最終匯入：${accepted.length}`)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

if (accepted.length < 10) {
  console.warn(`足球樣本較少：${accepted.length}（來源頁 ${matches.length} 場）。模型準確度可能受限。`)
}

const backtestInput: FootballBacktestMatch[] = accepted.map(match => ({
  matchId: match.matchId,
  discipline: match.discipline,
  playedOn: match.playedOn,
  sideAId: match.sideAId,
  sideBId: match.sideBId,
  sideAIsHome: match.sideAIsHome,
  homeAdvantageMode: detectHomeAdvantageMode(match.tournament),
  includeMatch: match.matchLegal,
  goalsA: match.goalsA,
  goalsB: match.goalsB,
  isDraw: match.isDraw,
  sideAWonMatch: match.sideAWonMatch,
}))

const results = runFootballBacktest(backtestInput)
mkdirSync(dirname(dbFile), { recursive: true })
const { sqlite } = openDatabase(dbFile)

const insertTeam = sqlite.prepare(`
  INSERT INTO football_teams (team_id, name_primary, name_aliases)
  VALUES (?, ?, '')
  ON CONFLICT (team_id) DO UPDATE SET
    name_primary = excluded.name_primary,
    name_aliases = CASE
      WHEN football_teams.name_aliases = '' THEN excluded.name_primary
      WHEN instr(football_teams.name_aliases, excluded.name_primary) THEN football_teams.name_aliases
      ELSE football_teams.name_aliases || '|' || excluded.name_primary
    END
`)
const insertMatch = sqlite.prepare(`
  INSERT OR REPLACE INTO football_matches (
    match_id, discipline, tournament, played_on, side_a_id, side_b_id, goals_a, goals_b, is_draw, side_a_won_match, include_match, source_url
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertRating = sqlite.prepare(`
  INSERT OR REPLACE INTO football_team_ratings (
    discipline, team_id, elo, match_count, last_played_on, home_advantage
  ) VALUES (?, ?, ?, ?, ?, ?)
`)
const insertModel = sqlite.prepare(`
  INSERT OR REPLACE INTO football_model_state (discipline, model_version, payload, data_through)
  VALUES (?, ?, ?, ?)
`)

sqlite.transaction(() => {
  sqlite.prepare('DELETE FROM football_matches').run()
  sqlite.prepare('DELETE FROM football_team_ratings').run()
  sqlite.prepare('DELETE FROM football_model_state').run()
  for (const match of accepted) {
    insertTeam.run(match.sideAId, match.sideAName)
    insertTeam.run(match.sideBId, match.sideBName)
    insertMatch.run(
      match.matchId,
      match.discipline,
      match.tournament,
      match.playedOn,
      match.sideAId,
      match.sideBId,
      match.goalsA,
      match.goalsB,
      Number(match.isDraw),
      match.sideAWonMatch === null ? null : Number(match.sideAWonMatch),
      Number(match.matchLegal),
      FOOTBALL_SOURCE_URL,
    )
  }
  for (const model of results) {
    insertModel.run(model.discipline, model.modelVersion, JSON.stringify(model.payload), model.dataThrough)
    for (const rating of model.ratings) {
      insertRating.run(
        rating.discipline,
        rating.teamId,
        rating.elo,
        rating.matchCount,
        rating.lastPlayedOn,
        rating.homeAdvantage,
      )
    }
  }
})()

console.log(`足球資料已寫入 ${dbFile}`)
console.log(`  比賽：${accepted.length} 場`)
console.log(`  球隊評分：${results.map(model => `${model.discipline} ${model.ratings.length} 隊`).join('、')}`)
console.log(`  來源：${FOOTBALL_SOURCE_URL}`)
