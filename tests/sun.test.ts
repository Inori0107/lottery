import { describe, expect, it } from 'vitest'
import { normalizeTier, parseCsvRow, parseGames } from '../server/models/dataset'
import {
  buildPlayerDirectory,
  excelSerialToIso,
  formatLinkedName,
  normalizeMatchScore,
  sunTablesToCsv,
} from '../server/models/sun'

describe('各層級賽事轉換', () => {
  it('把菁英賽英文層級收成同一組中文名稱', () => {
    expect(normalizeTier('HSBC BWF World Tour Super 750')).toBe('超級 750')
    expect(normalizeTier('BWF Tour Super 100')).toBe('超級 100')
    expect(normalizeTier('超級 100')).toBe('超級 100')
  })

  it('把 Excel 日期與斜線比分轉成既有賽果格式', () => {
    expect(excelSerialToIso('38978')).toBe('2006-09-18')
    expect(excelSerialToIso('2019-10-23')).toBe('2019-10-23')
    expect(normalizeMatchScore('21-12 / 20-22 / 21-16')).toBe('21-12 20-22 21-16')
    expect(parseGames(normalizeMatchScore('21-12 / 20-22 / 21-16'), false)).toHaveLength(3)
  })

  it('同名只在唯一時併到既有選手', () => {
    const directory = buildPlayerDirectory([
      { id: '1', name: 'SHI Yu Qi' },
      { id: '2', name: 'Viktor AXELSEN' },
      { id: '3', name: 'LI Shi Feng' },
      { id: '4', name: 'LI Shi Feng' },
    ])
    expect(formatLinkedName('Shi Yu Qi', directory)).toBe('Shi Yu Qi [1]')
    expect(formatLinkedName('SHI Yu Qi [999]', directory)).toBe('SHI Yu Qi [1]')
    expect(formatLinkedName('Choong Hann WONG', buildPlayerDirectory([{ id: '9', name: 'WONG Choong Hann' }]))).toBe('Choong Hann WONG [9]')
    expect(formatLinkedName('LI Shi Feng', directory)).toBe('LI Shi Feng')
  })

  it('保留超級 100 與國際挑戰賽，排除棄權和 15 分制', () => {
    const converted = sunTablesToCsv(
      [['tournament_id', 'name', 'country', 'start_date', 'end_date', 'ranking_level'], ['10', 'Indonesia Masters Super 100 2025', 'Indonesia', '45916', '45921', 'S100'], ['11', 'French International 2014', 'France', '41725', '41728', 'IC']],
      [['player_id', 'name'], ['7', 'Anders ANTONSEN'], ['8', 'Kunlavut VITIDSARN']],
      [
        ['match_date', 'tournament_id', 'type', 'round', 'winner_id', 'score', 'loser_id', 'duration', 'winner_rank', 'loser_rank', 'winner_elo', 'loser_elo', 'winner_next_elo', 'loser_next_elo', 'score_format'],
        ['45916', '10', 'MS', 'Final', '7', '21-18 / 21-16', '8', '40', '', '', '', '', '', '', 'BWF21'],
        ['41725', '11', 'MS', 'R16', '8', '15-10 / 15-8', '7', '20', '', '', '', '', '', '', 'pt15'],
        ['41726', '11', 'MS', 'R32', '8', '', '7', '', '', '', '', '', '', '', 'walkover'],
      ],
    )
    expect(converted.skippedScoring).toBe(2)
    expect(converted.rows).toHaveLength(1)
    const parsed = parseCsvRow(converted.rows[0] ?? {})
    if (!('match' in parsed)) throw new Error('應該接受超級 100 的 3×21 比賽')
    expect(parsed.match.tournament).toBe('Indonesia Masters Super 100 2025')
    expect(parsed.match.tier).toBe('超級 100')
    expect(parsed.match.sideAId).toBe('7')
    expect(parsed.match.matchLegal).toBe(true)
  })
})
