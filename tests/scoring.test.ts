import { describe, expect, it } from 'vitest'
import { assessMatch, isLegalGame } from '../server/models/scoring'
import { parseGames } from '../server/models/dataset'

describe('3×21 局分', () => {
  it('接受一般局、領先兩分與 30 比 29', () => {
    expect(isLegalGame(21, 19)).toBe(true)
    expect(isLegalGame(21, 0)).toBe(true)
    expect(isLegalGame(22, 20)).toBe(true)
    expect(isLegalGame(29, 27)).toBe(true)
    expect(isLegalGame(30, 28)).toBe(true)
    expect(isLegalGame(30, 29)).toBe(true)
  })

  it('拒絕未領先兩分的比分', () => {
    expect(isLegalGame(21, 20)).toBe(false)
    expect(isLegalGame(22, 21)).toBe(false)
    expect(isLegalGame(30, 27)).toBe(false)
  })

  it('2:0 不把第三局當成合法完賽', () => {
    const finished = parseGames('21-15 21-12', false)
    expect(finished).toHaveLength(2)
    expect(assessMatch(finished!).matchLegal).toBe(true)

    const extra = parseGames('21-15 21-12 21-9', false)
    expect(extra).toHaveLength(3)
    const assessed = assessMatch(extra!)
    expect(assessed.matchLegal).toBe(false)
    expect(assessed.game1Legal).toBe(true)
  })
})
