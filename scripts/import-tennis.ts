import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openDatabase } from '../server/db/open'
import { TENNIS_SOURCE_URL } from '../server/models/constants'
import { parseTennisCsvRow, reverseTennisSetScore, type TennisCsvRow } from '../server/models/tennisDataset'
import { runTennisBacktest, type TennisBacktestMatch } from '../server/models/tennisBacktest'
import { toTslPlayerName } from '../server/models/tennisNames'
import { dbFile } from './paths'

const ATP_PLAYERS = [
  'Djokovic, Novak',
  'Alcaraz, Carlos',
  'Sinner, Jannik',
  'Medvedev, Daniil',
  'Zverev, Alexander',
  'Fritz, Taylor',
  'Rublev, Andrey',
  'Tsitsipas, Stefanos',
]

const WTA_PLAYERS = [
  'Swiatek, Iga',
  'Sabalenka, Aryna',
  'Gauff, Coco',
  'Rybakina, Elena',
  'Pegula, Jessica',
  'Zheng, Qinwen',
  'Keys, Madison',
  'Paolini, Jasmine',
]

const SET_SCORES = ['6-3', '6-4', '7-5', '7-6(5)', '6-2', '6-1']

const hash = (text: string) => {
  let value = 0
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0
  return value
}

const pickSet = (seed: number, favoriteWins: boolean) => {
  const score = SET_SCORES[seed % SET_SCORES.length]!
  return favoriteWins ? score : reverseTennisSetScore(score)
}

const buildRows = (): TennisCsvRow[] => {
  const rows: TennisCsvRow[] = []
  const leagues = [
    { discipline: 'ATP', players: ATP_PLAYERS, tournament: 'ATP 500 Beijing' },
    { discipline: 'WTA', players: WTA_PLAYERS, tournament: 'WTA 1000 Beijing' },
  ]
  const start = Date.UTC(2025, 3, 1)
  const end = Date.UTC(2026, 9, 8)
  let index = 0
  const planned = leagues.reduce((sum, league) => sum + 8 * league.players.length * (league.players.length - 1) / 2, 0)
  for (const league of leagues) {
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < league.players.length; i++) {
        for (let j = i + 1; j < league.players.length; j++) {
          const player1 = league.players[i]!
          const player2 = league.players[j]!
          const seed = hash(`${league.discipline}:${round}:${player1}:${player2}`)
          const player1Wins = (seed % 10) < (6 - Math.min(3, Math.max(0, i - j + 3)))
          const sets = player1Wins
            ? (seed % 3 === 0
              ? `${pickSet(seed, true)} ${pickSet(seed + 1, false)} ${pickSet(seed + 2, true)}`
              : `${pickSet(seed, true)} ${pickSet(seed + 1, true)}`)
            : (seed % 3 === 0
              ? `${pickSet(seed, false)} ${pickSet(seed + 1, true)} ${pickSet(seed + 2, false)}`
              : `${pickSet(seed, false)} ${pickSet(seed + 1, false)}`)
          const playedOn = new Date(start + (index / Math.max(1, planned - 1)) * (end - start))
          rows.push({
            date: playedOn.toISOString().slice(0, 10),
            discipline: league.discipline,
            tournament: league.tournament,
            tier: league.discipline === 'ATP' ? 'ATP500' : 'WTA1000',
            round: `R${round + 1}`,
            player1,
            player2,
            winner: player1Wins ? '1' : '2',
            score: sets,
            surface: 'hard',
            best_of: '3',
          })
          index += 1
        }
      }
    }
  }
  return rows
}

const rows = buildRows()
const accepted = rows.map(parseTennisCsvRow).flatMap((result) => ('match' in result ? [result.match] : []))
if (accepted.length < 50) {
  throw new Error(`網球樣本太少：${accepted.length}`)
}

const backtestInput: TennisBacktestMatch[] = accepted.map(match => ({
  matchId: match.matchId,
  discipline: match.discipline,
  playedOn: match.playedOn,
  sideAId: match.sideAId,
  sideBId: match.sideBId,
  surface: match.surface,
  includeMatch: match.matchLegal,
  includeSet1: match.set1Legal,
  sideAWonMatch: match.sideAWonMatch,
  sideAWonSet1: match.sideAWonSet1,
  sets: match.sets,
}))

const results = runTennisBacktest(backtestInput)
mkdirSync(dirname(dbFile), { recursive: true })
const { sqlite } = openDatabase(dbFile)

const insertPlayer = sqlite.prepare(`
  INSERT OR IGNORE INTO tennis_players (player_id, name_primary, name_aliases)
  VALUES (?, ?, '')
`)
const insertMatch = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_matches (
    match_id, discipline, tournament, surface, best_of, played_on,
    side_a_id, side_b_id, side_a_won_match, include_match, include_set1, source_url
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertSet = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_sets (match_id, set_number, games_a, games_b, side_a_won, is_legal)
  VALUES (?, ?, ?, ?, ?, ?)
`)
const insertRating = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_player_ratings (
    discipline, player_id, elo, match_count, set1_count, last_played_on, set1_recent, surface_preference
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const insertModel = sqlite.prepare(`
  INSERT OR REPLACE INTO tennis_model_state (discipline, model_version, set1_method, payload, data_through)
  VALUES (?, ?, ?, ?, ?)
`)

sqlite.transaction(() => {
  sqlite.prepare('DELETE FROM tennis_sets').run()
  sqlite.prepare('DELETE FROM tennis_matches').run()
  sqlite.prepare('DELETE FROM tennis_player_ratings').run()
  sqlite.prepare('DELETE FROM tennis_model_state').run()
  for (const match of accepted) {
    insertPlayer.run(match.sideAId, toTslPlayerName(match.sideAName))
    insertPlayer.run(match.sideBId, toTslPlayerName(match.sideBName))
    insertMatch.run(
      match.matchId,
      match.discipline,
      match.tournament,
      match.surface ?? null,
      match.bestOf,
      match.playedOn,
      match.sideAId,
      match.sideBId,
      match.sideAWonMatch === null ? null : Number(match.sideAWonMatch),
      Number(match.matchLegal),
      Number(match.set1Legal),
      TENNIS_SOURCE_URL,
    )
    match.sets.forEach((set, setIndex) => {
      insertSet.run(match.matchId, setIndex + 1, set.gamesA, set.gamesB, Number(set.sideAWon), Number(set.isLegal))
    })
  }
  for (const model of results) {
    insertModel.run(model.discipline, model.modelVersion, model.set1Method, JSON.stringify(model.payload), model.dataThrough)
    for (const rating of model.ratings) {
      insertRating.run(
        rating.discipline,
        rating.playerId,
        rating.elo,
        rating.matchCount,
        rating.set1Count,
        rating.lastPlayedOn,
        JSON.stringify(rating.set1Recent),
        JSON.stringify(rating.surfacePreference),
      )
    }
  }
})()

console.log(`網球資料已寫入 ${dbFile}，比賽 ${accepted.length} 場，模型 ${results.map(model => `${model.discipline}:${model.ratings.length}`).join(', ')}`)
