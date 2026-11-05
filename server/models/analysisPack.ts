import type Database from 'better-sqlite3'
import { formatAnalysisPack, INSUFFICIENT_MODEL_FLAG, type AdjustmentLookup } from '../../shared/analysisPack'
import type { FixtureOdds, FixtureSummary, Participant, QuoteResponse } from '../../shared/types'
import { taipeiDate } from '../../shared/tslTime'
import { quoteBadminton } from './badmintonQuote'
import {
  emptyHandicapMarket,
  emptyMarket,
  emptyScoreMarket,
  emptyTotalsMarket,
} from './quote'
import { quoteVolleyball } from './volleyballQuote'

type Sqlite = Database.Database

const dummyParticipant = (name: string, existing: Participant | null, fallbackId: string): Participant =>
  existing ?? {
    id: fallbackId,
    name,
    elo: 1500,
    matchCount: 0,
    set1Count: 0,
    lastPlayedOn: null,
  }

const filledScores = (odds: FixtureOdds['correctScore']) => {
  if (!odds) return undefined
  const entries = Object.entries(odds).flatMap(([key, value]) => (
    typeof value === 'number' && value > 1 ? [[key, value] as const] : []
  ))
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries) as Record<string, number>
}

const handicapInput = (odds: FixtureOdds['handicap'] | FixtureOdds['setHandicap'] | FixtureOdds['set1Handicap']) =>
  odds ? { awayLine: -odds.homeLine, away: odds.away, home: odds.home } : undefined

export const oddsOnlyQuote = (fixture: FixtureSummary): QuoteResponse => {
  const reason = INSUFFICIENT_MODEL_FLAG
  const away = dummyParticipant(fixture.awayName, fixture.away, fixture.away?.id ?? `away:${fixture.sportradarId}`)
  const home = dummyParticipant(fixture.homeName, fixture.home, fixture.home?.id ?? `home:${fixture.sportradarId}`)
  const scores = filledScores(fixture.odds.correctScore)
  return {
    sport: fixture.sport,
    discipline: fixture.discipline,
    modelVersion: 'none',
    set1Method: 'bins',
    dataThrough: '—',
    asOf: taipeiDate(new Date()),
    shrinkEnabled: false,
    sourceUrl: '',
    away,
    home,
    isHome: false,
    warnings: [INSUFFICIENT_MODEL_FLAG],
    matchWinner: emptyMarket(reason, fixture.odds.match ?? undefined),
    set1Winner: emptyMarket(reason, fixture.odds.set1 ?? undefined),
    totalPoints: fixture.odds.totals ? emptyTotalsMarket(reason, fixture.odds.totals) : null,
    pointsHandicap: fixture.odds.handicap
      ? emptyHandicapMarket(reason, handicapInput(fixture.odds.handicap)!, away.name, home.name)
      : null,
    correctScore: scores ? emptyScoreMarket(reason, scores) : null,
    setHandicap: fixture.odds.setHandicap
      ? emptyHandicapMarket(reason, handicapInput(fixture.odds.setHandicap)!, away.name, home.name)
      : null,
    set1TotalPoints: fixture.odds.set1Totals ? emptyTotalsMarket(reason, fixture.odds.set1Totals) : null,
    set1PointsHandicap: fixture.odds.set1Handicap
      ? emptyHandicapMarket(reason, handicapInput(fixture.odds.set1Handicap)!, away.name, home.name)
      : null,
  }
}

export const quoteFixture = (
  sqlite: Sqlite | null,
  fixture: FixtureSummary,
): QuoteResponse => {
  const away = fixture.away
  const home = fixture.home
  const confirmed = fixture.awayMatchStatus === 'confirmed'
    && fixture.homeMatchStatus === 'confirmed'
    && away
    && home
  if (!confirmed || !sqlite || !away || !home) return oddsOnlyQuote(fixture)
  try {
    if (fixture.sport === 'badminton' && (fixture.discipline === 'MS' || fixture.discipline === 'WS')) {
      return quoteBadminton(sqlite, {
        discipline: fixture.discipline,
        awayPlayerId: away.id,
        homePlayerId: home.id,
        matchOdds: fixture.odds.match ?? undefined,
        game1Odds: fixture.odds.set1 ?? undefined,
        totalOdds: fixture.odds.totals ?? undefined,
        handicapOdds: handicapInput(fixture.odds.handicap),
        correctScoreOdds: filledScores(fixture.odds.correctScore) as BadmintonScores | undefined,
      })
    }
    if (fixture.sport === 'volleyball' && (fixture.discipline === 'M' || fixture.discipline === 'W')) {
      return quoteVolleyball(sqlite, {
        discipline: fixture.discipline,
        awayTeamId: away.id,
        homeTeamId: home.id,
        matchOdds: fixture.odds.match ?? undefined,
        set1Odds: fixture.odds.set1 ?? undefined,
        totalOdds: fixture.odds.totals ?? undefined,
        handicapOdds: handicapInput(fixture.odds.handicap),
        correctScoreOdds: filledScores(fixture.odds.correctScore) as VolleyballScores | undefined,
        setHandicapOdds: handicapInput(fixture.odds.setHandicap),
        set1TotalOdds: fixture.odds.set1Totals ?? undefined,
        set1HandicapOdds: handicapInput(fixture.odds.set1Handicap),
      })
    }
  } catch {
    return oddsOnlyQuote(fixture)
  }
  return oddsOnlyQuote(fixture)
}

type BadmintonScores = Record<'2:0' | '2:1' | '1:2' | '0:2', number>
type VolleyballScores = Record<'3:0' | '3:1' | '3:2' | '2:3' | '1:3' | '0:3', number>

export const buildAnalysisPackText = (
  sqlite: Sqlite | null,
  fixture: FixtureSummary | null,
  quote: QuoteResponse | null,
  adjustments: AdjustmentLookup[] = [],
) => {
  const resolvedQuote = quote ?? (fixture ? quoteFixture(sqlite, fixture) : null)
  if (!resolvedQuote) throw new Error('沒有可複製的分析包')
  return formatAnalysisPack({ quote: resolvedQuote, fixture, adjustments })
}
