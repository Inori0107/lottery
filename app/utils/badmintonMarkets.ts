import { BADMINTON_MARKETS } from '~~/shared/fixtureMarkets'
import {
  CORRECT_SCORES,
  marketLabelFor,
  type BetMarket,
  type FixtureMarket,
  type FixtureSummary,
} from '~~/shared/types'
import { isHalfLine } from '~~/shared/decision'

export type MarketInput = {
  kind: BetMarket
  sourceMarketId: string | null
  line: string | number
  selections: Array<{ key: string; label: string; value: string | number }>
}
export const hasLine = (kind: BetMarket) =>
  ['totals', 'handicap', 'set1Totals', 'set1Handicap'].includes(kind)
export const isHandicap = (kind: BetMarket) =>
  kind === 'handicap' || kind === 'set1Handicap'
const keysFor = (kind: BetMarket): string[] =>
  kind === 'correctScore'
    ? [...CORRECT_SCORES]
    : kind === 'setCount'
      ? ['2', '3']
      : kind === 'totals' || kind === 'set1Totals'
        ? ['over', 'under']
        : ['away', 'home']
const labels: Record<string, string> = {
  away: '客隊',
  home: '主隊',
  over: '大',
  under: '小',
  '2': '2 局',
  '3': '3 局',
}
const keyLabel = (key: string) => labels[key] ?? key

export const inputForMarket = (
  kind: BetMarket,
  market?: FixtureMarket,
): MarketInput => ({
  kind,
  sourceMarketId: market?.id ?? null,
  line:
    market?.line == null ? '' : isHandicap(kind) ? -market.line : market.line,
  selections: keysFor(kind).map((key) => ({
    key,
    label: keyLabel(key),
    value: market?.selections.find((s) => s.key === key)?.odds ?? '',
  })),
})

export const inputsForFixture = (
  fixture?: FixtureSummary | null,
  selected: Partial<Record<BetMarket, string>> = {},
): MarketInput[] => {
  if (!fixture) return BADMINTON_MARKETS.map((kind) => inputForMarket(kind))
  if (fixture.markets)
    return BADMINTON_MARKETS.flatMap((kind) => {
      const options = fixture.markets!.filter(
        (m) => m.market === kind && m.status === 'available',
      )
      const picked =
        options.find((m) => m.id === selected[kind]) ??
        options.find((m) => m.isMainline) ??
        options[0]
      return picked ? [inputForMarket(kind, picked)] : []
    })
  // Existing ledgers remain readable; simulation requires a fresh provider snapshot.
  return BADMINTON_MARKETS.flatMap((kind) => {
    const value = fixture.odds[kind]
    if (!value) return []
    const row = inputForMarket(kind)
    const record = value as unknown as Record<string, number>
    row.line = record.homeLine ?? record.line ?? ''
    for (const s of row.selections) s.value = record[s.key] ?? ''
    return [row]
  })
}

export const buildBadmintonOdds = (inputs: MarketInput[]) => {
  const body: Record<string, unknown> = {}
  const errors: Partial<Record<BetMarket, string>> = {}
  for (const row of inputs) {
    const values = row.selections.map((s) => s.value)
    if (hasLine(row.kind)) values.push(row.line)
    if (values.every((v) => String(v).trim() === '')) continue
    const line = Number(row.line)
    if (
      values.some(
        (v) => String(v).trim() === '' || !Number.isFinite(Number(v)),
      ) ||
      row.selections.some((s) => Number(s.value) <= 1) ||
      (hasLine(row.kind) &&
        (!isHalfLine(line) || (!isHandicap(row.kind) && line <= 0)))
    ) {
      errors[row.kind] =
        `${marketLabelFor('badminton', row.kind)}未填完整或格式不符，已略過此玩法`
      continue
    }
    const v = Object.fromEntries(
      row.selections.map((s) => [s.key, Number(s.value)]),
    )
    if (row.kind === 'match' || row.kind === 'set1') {
      body[row.kind === 'match' ? 'matchOdds' : 'game1Odds'] = v
    } else if (row.kind === 'totals' || row.kind === 'set1Totals') {
      body[row.kind === 'totals' ? 'totalOdds' : 'set1TotalOdds'] = {
        line,
        ...v,
      }
    } else if (isHandicap(row.kind)) {
      body[row.kind === 'handicap' ? 'handicapOdds' : 'set1HandicapOdds'] = {
        awayLine: -line,
        ...v,
      }
    } else {
      body[row.kind === 'correctScore' ? 'correctScoreOdds' : 'setCountOdds'] =
        v
    }
  }
  return { body, errors }
}

export const sourcesForInputs = (
  inputs: MarketInput[],
  capturedAt: string | null,
  errors: Partial<Record<BetMarket, string>>,
) =>
  Object.fromEntries(
    inputs
      .filter((row) => row.sourceMarketId && capturedAt && !errors[row.kind])
      .map((row) => [
        row.kind,
        { marketId: row.sourceMarketId!, capturedAt: capturedAt! },
      ]),
  )

export const sameFixtureVersion = (a: FixtureSummary, b: FixtureSummary) =>
  a.sportradarId === b.sportradarId &&
  a.sport === b.sport &&
  a.discipline === b.discipline &&
  a.away?.id === b.away?.id &&
  a.home?.id === b.home?.id &&
  a.awayName === b.awayName &&
  a.homeName === b.homeName &&
  a.startsAt === b.startsAt &&
  a.status === b.status &&
  a.oddsCapturedAt === b.oddsCapturedAt &&
  JSON.stringify(a.markets ?? a.odds) === JSON.stringify(b.markets ?? b.odds)
