import { describe, expect, it } from 'vitest'
import { nameMatchClause, nameMatchParams, nameTokens } from '../server/utils/nameSearch'

describe('nameTokens', () => {
  it('splits lottery style names on commas', () => {
    expect(nameTokens('Dong, Tian Yao')).toEqual(['Dong', 'Tian', 'Yao'])
  })

  it('treats full-width commas, hyphens and extra spaces as separators', () => {
    expect(nameTokens('  Dong，Tian-Yao ')).toEqual(['Dong', 'Tian', 'Yao'])
  })

  it('drops SQL wildcard characters', () => {
    expect(nameTokens('Do%ng_')).toEqual(['Dong'])
  })

  it('returns no tokens for blank input', () => {
    expect(nameTokens(' , ')).toEqual([])
  })
})

describe('nameMatchClause', () => {
  it('requires every token to appear in the column', () => {
    const tokens = nameTokens('Dong, Tian Yao')
    expect(nameMatchClause('p.name_primary', tokens)).toBe('p.name_primary LIKE ? AND p.name_primary LIKE ? AND p.name_primary LIKE ?')
    expect(nameMatchParams(tokens)).toEqual(['%Dong%', '%Tian%', '%Yao%'])
  })
})
