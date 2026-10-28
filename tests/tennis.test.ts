import { describe, expect, it } from 'vitest'
import { isDoublesEvent, tennisBestOf } from '../shared/sports'
import { TENNIS_ELO } from '../server/models/tennisElo'
import { isLegalTennisSet, parseTennisSets, tennisDiscipline } from '../server/models/tennisDataset'
import { tennisMatchDistribution } from '../server/models/tennisRally'

describe('網球單打', () => {
  it('略過雙打與混雙', () => {
    expect(isDoublesEvent('ATP | Basel, Switzerland, Doubles')).toBe(true)
    expect(isDoublesEvent('French Open, MD')).toBe(true)
    expect(isDoublesEvent('ATP | Basel, Switzerland')).toBe(false)
    expect(tennisDiscipline('ATP')).toBe('ATP')
    expect(tennisDiscipline('WTA')).toBe('WTA')
    expect(tennisDiscipline('ATP Doubles')).toBeNull()
  })
})

describe('tennisBestOf', () => {
  it('ATP 大滿貫為五盤，其餘與 WTA 為三盤', () => {
    expect(tennisBestOf('Wimbledon', 'ATP')).toBe(5)
    expect(tennisBestOf('French Open', 'ATP')).toBe(5)
    expect(tennisBestOf('澳洲公開賽', 'ATP')).toBe(5)
    expect(tennisBestOf('Indian Wells', 'ATP')).toBe(3)
    expect(tennisBestOf('Wimbledon', 'WTA')).toBe(3)
  })
})

describe('網球合法盤', () => {
  it('接受 6-0 到 6-4、7-5、7-6，決勝盤可 10-x', () => {
    expect(isLegalTennisSet(6, 4, false)).toBe(true)
    expect(isLegalTennisSet(7, 5, false)).toBe(true)
    expect(isLegalTennisSet(7, 6, false)).toBe(true)
    expect(isLegalTennisSet(6, 5, false)).toBe(false)
    expect(isLegalTennisSet(10, 8, true)).toBe(true)
    expect(isLegalTennisSet(10, 8, false)).toBe(false)
  })

  it('Bo3 只要 2～3 盤、Bo5 只要 3～5 盤', () => {
    expect(parseTennisSets('6-4 6-3', false, 3)).toHaveLength(2)
    expect(parseTennisSets('6-4 3-6 6-3', false, 3)).toHaveLength(3)
    expect(parseTennisSets('6-4 6-3', false, 5)).toBeNull()
    expect(parseTennisSets('6-4 6-3 6-2', false, 5)).toHaveLength(3)
  })
})

describe('網球 Elo 與分布', () => {
  it('沿用 eloCore 參數', () => {
    expect(TENNIS_ELO).toMatchObject({
      initialElo: 1500,
      kFactor: 32,
      samplePrior: 40,
      inactivityHalfLifeDays: 180,
    })
  })

  it('Bo3 與 Bo5 正確盤數機率總和為 1', () => {
    const bo3 = tennisMatchDistribution(0.55, 3)
    const bo5 = tennisMatchDistribution(0.55, 5, true)
    const sum = (scores: Record<string, number | undefined>) =>
      Object.values(scores).reduce((total, value) => total + (value ?? 0), 0)
    expect(sum(bo3.correctScore)).toBeCloseTo(1, 8)
    expect(sum(bo5.correctScore)).toBeCloseTo(1, 8)
  })
})
