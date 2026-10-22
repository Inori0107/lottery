import { describe, expect, it } from 'vitest'
import {
  createDrawResult,
  createTeams,
  generateId,
  generateKnockoutMatches,
  generateRoundRobinMatches,
  getTeamStats,
  shuffleArray,
  SPORT_DEFAULTS,
  updateMatchScore,
  validatePlayerCount,
} from '../shared/draw'
import type { DrawConfig, Player, Team } from '../shared/draw'

describe('抽籤分組模組', () => {
  const createPlayers = (count: number): Player[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `player-${i + 1}`,
      name: `選手${i + 1}`,
    }))

  describe('generateId', () => {
    it('產生不重複的 ID', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()))
      expect(ids.size).toBe(100)
    })
  })

  describe('shuffleArray', () => {
    it('打亂陣列順序', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const shuffled = shuffleArray(original)
      expect(shuffled).toHaveLength(original.length)
      expect(new Set(shuffled)).toEqual(new Set(original))
    })

    it('不修改原始陣列', () => {
      const original = [1, 2, 3]
      const originalCopy = [...original]
      shuffleArray(original)
      expect(original).toEqual(originalCopy)
    })
  })

  describe('validatePlayerCount', () => {
    it('羽球單打至少需要 2 人', () => {
      expect(validatePlayerCount(1, 'badminton', 'singles').valid).toBe(false)
      expect(validatePlayerCount(2, 'badminton', 'singles').valid).toBe(true)
    })

    it('羽球雙打至少需要 4 人', () => {
      expect(validatePlayerCount(3, 'badminton', 'doubles').valid).toBe(false)
      expect(validatePlayerCount(4, 'badminton', 'doubles').valid).toBe(true)
    })

    it('排球至少需要 12 人（2 隊各 6 人）', () => {
      expect(validatePlayerCount(11, 'volleyball', 'team').valid).toBe(false)
      expect(validatePlayerCount(12, 'volleyball', 'team').valid).toBe(true)
    })

    it('人數無法整除時提示候補人數', () => {
      const result = validatePlayerCount(5, 'badminton', 'doubles')
      expect(result.valid).toBe(true)
      expect(result.message).toContain('1')
      expect(result.message).toContain('候補')
    })

    it('排球 14 人有 2 人候補', () => {
      const result = validatePlayerCount(14, 'volleyball', 'team')
      expect(result.valid).toBe(true)
      expect(result.message).toContain('2')
    })
  })

  describe('createTeams', () => {
    it('羽球單打每隊 1 人', () => {
      const players = createPlayers(4)
      const teams = createTeams(players, 1)
      expect(teams).toHaveLength(4)
      teams.forEach(team => expect(team.players).toHaveLength(1))
    })

    it('羽球雙打每隊 2 人', () => {
      const players = createPlayers(6)
      const teams = createTeams(players, 2)
      expect(teams).toHaveLength(3)
      teams.forEach(team => expect(team.players).toHaveLength(2))
    })

    it('排球每隊 6 人', () => {
      const players = createPlayers(18)
      const teams = createTeams(players, 6)
      expect(teams).toHaveLength(3)
      teams.forEach(team => expect(team.players).toHaveLength(6))
    })

    it('不滿一隊的選手不會被分配', () => {
      const players = createPlayers(7)
      const teams = createTeams(players, 2)
      expect(teams).toHaveLength(3)
      const assignedCount = teams.reduce((sum, t) => sum + t.players.length, 0)
      expect(assignedCount).toBe(6)
    })
  })

  describe('generateRoundRobinMatches', () => {
    it('循環賽每隊都會與其他隊伍比賽', () => {
      const teams: Team[] = [
        { id: '1', name: 'A', players: [] },
        { id: '2', name: 'B', players: [] },
        { id: '3', name: 'C', players: [] },
      ]
      const matches = generateRoundRobinMatches(teams, 1)
      expect(matches).toHaveLength(3)
      
      const pairings = matches.map(m => [m.teamA.id, m.teamB.id].sort().join('-'))
      expect(new Set(pairings)).toEqual(new Set(['1-2', '1-3', '2-3']))
    })

    it('4 隊循環賽有 6 場比賽', () => {
      const teams: Team[] = Array.from({ length: 4 }, (_, i) => ({
        id: String(i + 1),
        name: `Team ${i + 1}`,
        players: [],
      }))
      const matches = generateRoundRobinMatches(teams, 2)
      expect(matches).toHaveLength(6)
    })
  })

  describe('generateKnockoutMatches', () => {
    it('淘汰賽第一輪配對一半的隊伍', () => {
      const teams: Team[] = Array.from({ length: 4 }, (_, i) => ({
        id: String(i + 1),
        name: `Team ${i + 1}`,
        players: [],
      }))
      const matches = generateKnockoutMatches(teams, 1)
      expect(matches).toHaveLength(2)
    })
  })

  describe('createDrawResult', () => {
    it('羽球雙打循環賽正確產生結果', () => {
      const players = createPlayers(8)
      const config: DrawConfig = {
        sport: 'badminton',
        mode: 'doubles',
        courtCount: 2,
        rotationEnabled: true,
      }
      const result = createDrawResult(config, players, 'roundRobin')
      
      expect(result.teams).toHaveLength(4)
      expect(result.matches).toHaveLength(6)
      expect(result.currentRound).toBe(1)
    })

    it('排球循環賽正確產生結果', () => {
      const players = createPlayers(18)
      const config: DrawConfig = {
        sport: 'volleyball',
        mode: 'team',
        courtCount: 1,
        rotationEnabled: true,
      }
      const result = createDrawResult(config, players, 'roundRobin')
      
      expect(result.teams).toHaveLength(3)
      expect(result.matches).toHaveLength(3)
    })
  })

  describe('updateMatchScore', () => {
    it('更新比賽分數並標記為已結束', () => {
      const players = createPlayers(4)
      const config: DrawConfig = {
        sport: 'badminton',
        mode: 'singles',
        courtCount: 1,
        rotationEnabled: true,
      }
      const result = createDrawResult(config, players, 'roundRobin')
      const firstMatch = result.matches[0]!
      
      const updated = updateMatchScore(result, firstMatch.id, 21, 18)
      const updatedMatch = updated.matches.find(m => m.id === firstMatch.id)!
      
      expect(updatedMatch.scoreA).toBe(21)
      expect(updatedMatch.scoreB).toBe(18)
      expect(updatedMatch.status).toBe('finished')
    })
  })

  describe('getTeamStats', () => {
    it('正確計算勝負與得失分', () => {
      const players = createPlayers(4)
      const config: DrawConfig = {
        sport: 'badminton',
        mode: 'singles',
        courtCount: 1,
        rotationEnabled: true,
      }
      let result = createDrawResult(config, players, 'roundRobin')
      
      result = updateMatchScore(result, result.matches[0]!.id, 21, 15)
      result = updateMatchScore(result, result.matches[1]!.id, 21, 18)
      
      const stats = getTeamStats(result)
      expect(stats.length).toBeGreaterThan(0)
      
      const totalWins = stats.reduce((sum, s) => sum + s.wins, 0)
      const totalLosses = stats.reduce((sum, s) => sum + s.losses, 0)
      expect(totalWins).toBe(totalLosses)
    })
  })

  describe('SPORT_DEFAULTS', () => {
    it('羽球預設正確', () => {
      const badminton = SPORT_DEFAULTS.badminton
      expect(badminton.modes).toContain('singles')
      expect(badminton.modes).toContain('doubles')
      expect(badminton.teamSize.singles).toBe(1)
      expect(badminton.teamSize.doubles).toBe(2)
      expect(badminton.defaultCourts).toBe(2)
    })

    it('排球預設正確', () => {
      const volleyball = SPORT_DEFAULTS.volleyball
      expect(volleyball.modes).toContain('team')
      expect(volleyball.teamSize.team).toBe(6)
      expect(volleyball.defaultCourts).toBe(1)
    })
  })
})
