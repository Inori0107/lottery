/**
 * 抽籤/分組模組 - 支援羽球與排球的休閒比賽安排
 */

export type Sport = 'badminton' | 'volleyball'

export const sportLabel: Record<Sport, string> = {
  badminton: '羽球',
  volleyball: '排球',
}

export type GameMode = 'singles' | 'doubles' | 'team'

export const gameModeLabel: Record<GameMode, string> = {
  singles: '單打',
  doubles: '雙打',
  team: '團隊',
}

export type Player = {
  id: string
  name: string
}

export type Team = {
  id: string
  name: string
  players: Player[]
}

export type Match = {
  id: string
  round: number
  courtNumber: number
  teamA: Team
  teamB: Team
  scoreA?: number
  scoreB?: number
  status: 'pending' | 'playing' | 'finished'
}

export type DrawConfig = {
  sport: Sport
  mode: GameMode
  courtCount: number
  rotationEnabled: boolean
}

export type DrawResult = {
  config: DrawConfig
  teams: Team[]
  matches: Match[]
  currentRound: number
}

export const SPORT_DEFAULTS: Record<Sport, { modes: GameMode[], teamSize: Record<GameMode, number>, defaultCourts: number }> = {
  badminton: {
    modes: ['singles', 'doubles'],
    teamSize: {
      singles: 1,
      doubles: 2,
      team: 2,
    },
    defaultCourts: 2,
  },
  volleyball: {
    modes: ['team'],
    teamSize: {
      singles: 6,
      doubles: 6,
      team: 6,
    },
    defaultCourts: 1,
  },
}

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 9)
}

export const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]!
    shuffled[j] = temp!
  }
  return shuffled
}

export const createTeams = (players: Player[], teamSize: number): Team[] => {
  const shuffled = shuffleArray(players)
  const teams: Team[] = []
  
  for (let i = 0; i < shuffled.length; i += teamSize) {
    const teamPlayers = shuffled.slice(i, i + teamSize)
    if (teamPlayers.length === teamSize) {
      teams.push({
        id: generateId(),
        name: teamPlayers.map(p => p.name).join('／'),
        players: teamPlayers,
      })
    }
  }
  
  return teams
}

export const generateRoundRobinMatches = (teams: Team[], courtCount: number): Match[] => {
  const matches: Match[] = []
  let round = 1
  
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const teamA = teams[i]!
      const teamB = teams[j]!
      
      const courtNumber = (matches.length % courtCount) + 1
      
      matches.push({
        id: generateId(),
        round,
        courtNumber,
        teamA,
        teamB,
        status: 'pending',
      })
      
      if (matches.length % courtCount === 0) {
        round++
      }
    }
  }
  
  return matches
}

export const generateKnockoutMatches = (teams: Team[], courtCount: number): Match[] => {
  const shuffled = shuffleArray(teams)
  const matches: Match[] = []
  let round = 1
  
  for (let i = 0; i < shuffled.length - 1; i += 2) {
    const teamA = shuffled[i]!
    const teamB = shuffled[i + 1]!
    
    if (teamB) {
      const courtNumber = (matches.length % courtCount) + 1
      
      matches.push({
        id: generateId(),
        round,
        courtNumber,
        teamA,
        teamB,
        status: 'pending',
      })
      
      if (matches.length % courtCount === 0) {
        round++
      }
    }
  }
  
  return matches
}

export const createDrawResult = (
  config: DrawConfig,
  players: Player[],
  matchType: 'roundRobin' | 'knockout' = 'roundRobin'
): DrawResult => {
  const teamSize = SPORT_DEFAULTS[config.sport].teamSize[config.mode]
  const teams = createTeams(players, teamSize)
  
  const matches = matchType === 'roundRobin'
    ? generateRoundRobinMatches(teams, config.courtCount)
    : generateKnockoutMatches(teams, config.courtCount)
  
  return {
    config,
    teams,
    matches,
    currentRound: 1,
  }
}

export const validatePlayerCount = (playerCount: number, sport: Sport, mode: GameMode): { valid: boolean, message: string } => {
  const teamSize = SPORT_DEFAULTS[sport].teamSize[mode]
  const minPlayers = teamSize * 2
  
  if (playerCount < minPlayers) {
    return {
      valid: false,
      message: `至少需要 ${minPlayers} 位選手才能組成 2 隊`,
    }
  }
  
  const remainder = playerCount % teamSize
  if (remainder !== 0) {
    return {
      valid: true,
      message: `有 ${remainder} 位選手無法組成完整隊伍，將作為候補`,
    }
  }
  
  return { valid: true, message: '' }
}

export const getNextMatches = (result: DrawResult): Match[] => {
  return result.matches
    .filter(m => m.status === 'pending')
    .slice(0, result.config.courtCount)
}

export const updateMatchScore = (
  result: DrawResult,
  matchId: string,
  scoreA: number,
  scoreB: number
): DrawResult => {
  const updatedMatches = result.matches.map(match => {
    if (match.id === matchId) {
      return {
        ...match,
        scoreA,
        scoreB,
        status: 'finished' as const,
      }
    }
    return match
  })
  
  const finishedCount = updatedMatches.filter(m => m.status === 'finished').length
  const currentRound = Math.floor(finishedCount / result.config.courtCount) + 1
  
  return {
    ...result,
    matches: updatedMatches,
    currentRound,
  }
}

export const getTeamStats = (result: DrawResult): Array<{ team: Team, wins: number, losses: number, pointsFor: number, pointsAgainst: number }> => {
  const stats = new Map<string, { wins: number, losses: number, pointsFor: number, pointsAgainst: number }>()
  
  for (const team of result.teams) {
    stats.set(team.id, { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 })
  }
  
  for (const match of result.matches) {
    if (match.status !== 'finished' || match.scoreA === undefined || match.scoreB === undefined) {
      continue
    }
    
    const statsA = stats.get(match.teamA.id)
    const statsB = stats.get(match.teamB.id)
    
    if (statsA) {
      statsA.pointsFor += match.scoreA
      statsA.pointsAgainst += match.scoreB
      if (match.scoreA > match.scoreB) {
        statsA.wins++
      } else {
        statsA.losses++
      }
    }
    
    if (statsB) {
      statsB.pointsFor += match.scoreB
      statsB.pointsAgainst += match.scoreA
      if (match.scoreB > match.scoreA) {
        statsB.wins++
      } else {
        statsB.losses++
      }
    }
  }
  
  return result.teams
    .map(team => ({
      team,
      ...(stats.get(team.id) ?? { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 }),
    }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins
      return (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst)
    })
}
