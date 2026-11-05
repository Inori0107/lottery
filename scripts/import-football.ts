import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openDatabase } from '../server/db/open'
import { FOOTBALL_SOURCE_URL } from '../server/models/constants'
import { parseStatshubPage, type StatshubMatch } from '../server/models/statshub'
import { detectHomeAdvantageMode } from '../server/models/footballElo'
import { parseFootballCsvRow, type FootballCsvRow } from '../server/models/footballDataset'
import { runFootballBacktest, type FootballBacktestMatch } from '../server/models/footballBacktest'
import { dbFile, footballStatshubDir } from './paths'

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

const loadCachedMatches = () => {
  mkdirSync(footballStatshubDir, { recursive: true })
  const files = readdirSync(footballStatshubDir).filter(file => file.endsWith('.html')).sort()
  const matches = new Map<number, StatshubMatch>()
  for (const file of files) {
    const page = parseStatshubPage(readFileSync(join(footballStatshubDir, file), 'utf8'), 'football')
    for (const match of page.matches) {
      if (!match.played || (match.discipline !== 'FM' && match.discipline !== 'FW')) continue
      matches.set(match.sportradarId, match)
    }
  }
  return [...matches.values()]
}

const matches = loadCachedMatches()
const rows = matches.map(toCsvRow)
const accepted = rows.map(parseFootballCsvRow).flatMap(result => ('match' in result ? [result.match] : []))
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

console.log(`足球資料已寫入 ${dbFile}，比賽 ${accepted.length} 場，來源 ${FOOTBALL_SOURCE_URL}，模型 ${results.map(model => `${model.discipline}:${model.ratings.length}`).join(', ')}`)
