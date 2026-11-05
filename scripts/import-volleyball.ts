import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openDatabase } from '../server/db/open'
import { VOLLEYBALL_SOURCE_URL } from '../server/models/constants'
import { parseStatshubPage, type StatshubMatch } from '../server/models/statshub'
import { detectHomeAdvantageMode } from '../server/models/volleyballElo'
import { parseVolleyballCsvRow, type VolleyballCsvRow } from '../server/models/volleyballDataset'
import { runVolleyballBacktest, type VolleyballBacktestMatch } from '../server/models/volleyballBacktest'
import { dbFile, volleyballStatshubDir } from './paths'

const toCsvRow = (match: StatshubMatch): VolleyballCsvRow => ({
  date: match.playedOn,
  discipline: match.discipline,
  tournament: match.tournament,
  tier: '',
  round: match.round,
  team1: `${match.home.name.trim()} [sportradar:${match.home.uid}]`,
  team2: `${match.away.name.trim()} [sportradar:${match.away.uid}]`,
  winner: match.winner,
  score: match.score,
  team1_home: '1',
  team1_roster_strength: '1',
  team2_roster_strength: '1',
})

const loadCachedMatches = () => {
  mkdirSync(volleyballStatshubDir, { recursive: true })
  const files = readdirSync(volleyballStatshubDir).filter(file => file.endsWith('.html')).sort()
  const matches = new Map<number, StatshubMatch>()
  for (const file of files) {
    const page = parseStatshubPage(readFileSync(join(volleyballStatshubDir, file), 'utf8'), 'volleyball')
    for (const match of page.matches) {
      if (!match.played || (match.discipline !== 'M' && match.discipline !== 'W')) continue
      matches.set(match.sportradarId, match)
    }
  }
  return [...matches.values()]
}

const matches = loadCachedMatches()
const rows = matches.map(toCsvRow)
const accepted = rows.map(parseVolleyballCsvRow).flatMap(result => ('match' in result ? [result.match] : []))
if (accepted.length < 20) {
  throw new Error(`排球樣本太少：${accepted.length}（來源頁 ${matches.length} 場）。請先執行 npm run fetch:statshub`)
}

const backtestInput: VolleyballBacktestMatch[] = accepted.map(match => ({
  matchId: match.matchId,
  discipline: match.discipline,
  playedOn: match.playedOn,
  sideAId: match.sideAId,
  sideBId: match.sideBId,
  sideAIsHome: match.sideAIsHome,
  homeAdvantageMode: detectHomeAdvantageMode(match.tournament),
  sideARosterStrength: match.sideARosterStrength,
  sideBRosterStrength: match.sideBRosterStrength,
  includeMatch: match.matchLegal,
  includeSet1: match.set1Legal,
  sideAWonMatch: match.sideAWonMatch,
  sideAWonSet1: match.sideAWonSet1,
  sets: match.sets,
}))

const results = runVolleyballBacktest(backtestInput)
mkdirSync(dirname(dbFile), { recursive: true })
const { sqlite } = openDatabase(dbFile)

const insertTeam = sqlite.prepare(`
  INSERT INTO volleyball_teams (team_id, name_primary, name_aliases)
  VALUES (?, ?, '')
  ON CONFLICT (team_id) DO UPDATE SET
    name_primary = excluded.name_primary,
    name_aliases = CASE
      WHEN volleyball_teams.name_aliases = '' THEN excluded.name_primary
      WHEN instr(volleyball_teams.name_aliases, excluded.name_primary) THEN volleyball_teams.name_aliases
      ELSE volleyball_teams.name_aliases || '|' || excluded.name_primary
    END
`)
const insertMatch = sqlite.prepare(`
  INSERT OR REPLACE INTO volleyball_matches (
    match_id, discipline, tournament, played_on, side_a_id, side_b_id, side_a_won_match, include_match, include_set1, source_url
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertSet = sqlite.prepare(`
  INSERT OR REPLACE INTO volleyball_sets (
    match_id, set_number, points_a, points_b, side_a_won, is_legal
  ) VALUES (?, ?, ?, ?, ?, ?)
`)
const insertRating = sqlite.prepare(`
  INSERT OR REPLACE INTO volleyball_team_ratings (
    discipline, team_id, elo, match_count, set1_count, last_played_on, set1_recent, home_advantage, roster_strength
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertModel = sqlite.prepare(`
  INSERT OR REPLACE INTO volleyball_model_state (discipline, model_version, set1_method, payload, data_through)
  VALUES (?, ?, ?, ?, ?)
`)

sqlite.transaction(() => {
  sqlite.prepare('DELETE FROM volleyball_sets').run()
  sqlite.prepare('DELETE FROM volleyball_matches').run()
  sqlite.prepare('DELETE FROM volleyball_team_ratings').run()
  sqlite.prepare('DELETE FROM volleyball_model_state').run()
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
      match.sideAWonMatch === null ? null : Number(match.sideAWonMatch),
      Number(match.matchLegal),
      Number(match.set1Legal),
      VOLLEYBALL_SOURCE_URL,
    )
    match.sets.forEach((set, index) => {
      insertSet.run(
        match.matchId,
        index + 1,
        set.pointsA,
        set.pointsB,
        Number(set.sideAWon),
        Number(set.isLegal),
      )
    })
  }
  for (const model of results) {
    insertModel.run(model.discipline, model.modelVersion, model.set1Method, JSON.stringify(model.payload), model.dataThrough)
    for (const rating of model.ratings) {
      insertRating.run(
        rating.discipline,
        rating.teamId,
        rating.elo,
        rating.matchCount,
        rating.set1Count,
        rating.lastPlayedOn,
        JSON.stringify(rating.set1Recent),
        rating.homeAdvantage,
        rating.rosterStrength,
      )
    }
  }
})()

console.log(`排球資料已寫入 ${dbFile}，比賽 ${accepted.length} 場，來源 ${VOLLEYBALL_SOURCE_URL}，模型 ${results.map(model => `${model.discipline}:${model.ratings.length}`).join(', ')}`)
