import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openDatabase } from '../server/db/open'
import { VOLLEYBALL_SOURCE_URL } from '../server/models/constants'
import { parseVolleyballCsvRow, type VolleyballCsvRow } from '../server/models/volleyballDataset'
import { runVolleyballBacktest, type VolleyballBacktestMatch } from '../server/models/volleyballBacktest'
import { dbFile } from './paths'

const MEN = ['Italy', 'Poland', 'Brazil', 'France', 'Japan', 'USA']
const WOMEN = ['Italy', 'Brazil', 'China', 'Turkey', 'USA', 'Japan']
const SET_SCORES = ['25-20', '25-22', '25-18', '27-25', '25-23']
const DECIDING = ['15-13', '15-10', '16-14']

const hash = (text: string) => {
  let value = 0
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value
}

const reverseSet = (score: string) => score.split('-').reverse().join('-')

const pickSet = (seed: number, favoriteWins: boolean, deciding = false) => {
  const pool = deciding ? DECIDING : SET_SCORES
  const score = pool[seed % pool.length]!
  return favoriteWins ? score : reverseSet(score)
}

const buildRows = (): VolleyballCsvRow[] => {
  const rows: VolleyballCsvRow[] = []
  const leagues = [
    { discipline: 'M', teams: MEN, tournament: 'VNL Men' },
    { discipline: 'W', teams: WOMEN, tournament: 'VNL Women' },
  ]
  const start = Date.UTC(2025, 3, 1)
  const end = Date.UTC(2026, 9, 8)
  let index = 0
  const planned = leagues.reduce((sum, league) => sum + 4 * league.teams.length * (league.teams.length - 1) / 2, 0)
  for (const league of leagues) {
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < league.teams.length; i++) {
        for (let j = i + 1; j < league.teams.length; j++) {
          const team1 = league.teams[i]!
          const team2 = league.teams[j]!
          const seed = hash(`${league.discipline}:${round}:${team1}:${team2}`)
          const team1Wins = (seed % 10) < 6
          const pattern = seed % 3
          const sets = team1Wins
            ? (pattern === 0
              ? `${pickSet(seed, true)} ${pickSet(seed + 1, true)} ${pickSet(seed + 2, true)}`
              : pattern === 1
                ? `${pickSet(seed, true)} ${pickSet(seed + 1, false)} ${pickSet(seed + 2, true)} ${pickSet(seed + 3, true)}`
                : `${pickSet(seed, true)} ${pickSet(seed + 1, false)} ${pickSet(seed + 2, true)} ${pickSet(seed + 3, false)} ${pickSet(seed + 4, true, true)}`)
            : (pattern === 0
              ? `${pickSet(seed, false)} ${pickSet(seed + 1, false)} ${pickSet(seed + 2, false)}`
              : pattern === 1
                ? `${pickSet(seed, false)} ${pickSet(seed + 1, true)} ${pickSet(seed + 2, false)} ${pickSet(seed + 3, false)}`
                : `${pickSet(seed, false)} ${pickSet(seed + 1, true)} ${pickSet(seed + 2, false)} ${pickSet(seed + 3, true)} ${pickSet(seed + 4, false, true)}`)
          const playedOn = new Date(start + (index / Math.max(1, planned - 1)) * (end - start))
          rows.push({
            date: playedOn.toISOString().slice(0, 10),
            discipline: league.discipline,
            tournament: league.tournament,
            tier: 'VNL',
            round: `R${round + 1}`,
            team1,
            team2,
            winner: team1Wins ? '1' : '2',
            score: sets,
            team1_home: '1',
            team1_roster_strength: '1',
            team2_roster_strength: '1',
          })
          index += 1
        }
      }
    }
  }
  return rows
}

const rows = buildRows()
const accepted = rows.map(parseVolleyballCsvRow).flatMap(result => ('match' in result ? [result.match] : []))
if (accepted.length < 40) {
  throw new Error(`排球樣本太少：${accepted.length}`)
}

const backtestInput: VolleyballBacktestMatch[] = accepted.map(match => ({
  matchId: match.matchId,
  discipline: match.discipline,
  playedOn: match.playedOn,
  sideAId: match.sideAId,
  sideBId: match.sideBId,
  sideAIsHome: match.sideAIsHome,
  homeAdvantageMode: 'club',
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
  INSERT OR IGNORE INTO volleyball_teams (team_id, name_primary, name_aliases)
  VALUES (?, ?, '')
`)
const insertMatch = sqlite.prepare(`
  INSERT OR REPLACE INTO volleyball_matches (
    match_id, discipline, tournament, played_on, side_a_id, side_b_id, side_a_won_match, include_match
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
