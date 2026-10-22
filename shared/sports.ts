/**
 * 運動項目設定
 * 支援羽球（badminton）與排球（volleyball）的投注估計
 */

export type Sport = 'badminton' | 'volleyball'

export const SPORTS: Sport[] = ['badminton', 'volleyball']

export const sportLabel: Record<Sport, string> = {
  badminton: '羽球',
  volleyball: '排球',
}

export const sportIcon: Record<Sport, string> = {
  badminton: '🏸',
  volleyball: '🏐',
}

export type BadmintonDiscipline = 'MS' | 'WS'
export type VolleyballDiscipline = 'M' | 'W'
export type Discipline = BadmintonDiscipline | VolleyballDiscipline

export const BADMINTON_DISCIPLINES: BadmintonDiscipline[] = ['MS', 'WS']
export const VOLLEYBALL_DISCIPLINES: VolleyballDiscipline[] = ['M', 'W']

export const disciplineLabel: Record<Discipline, string> = {
  MS: '男單',
  WS: '女單',
  M: '男排',
  W: '女排',
}

export const disciplineLabelFull: Record<Discipline, string> = {
  MS: '男子單打',
  WS: '女子單打',
  M: '男子排球',
  W: '女子排球',
}

export type BadmintonCorrectScore = '2:0' | '2:1' | '1:2' | '0:2'
export type VolleyballCorrectScore = '3:0' | '3:1' | '3:2' | '2:3' | '1:3' | '0:3'
export type CorrectScore = BadmintonCorrectScore | VolleyballCorrectScore

export const BADMINTON_CORRECT_SCORES: BadmintonCorrectScore[] = ['2:0', '2:1', '1:2', '0:2']
export const VOLLEYBALL_CORRECT_SCORES: VolleyballCorrectScore[] = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3']

export type SportConfig = {
  sport: Sport
  disciplines: readonly Discipline[]
  correctScores: readonly CorrectScore[]
  gamesPerMatch: number
  gamesToWin: number
  normalGamePoints: number
  decidingGamePoints: number
  pointCap: number | null
  deuceAdvantage: number
  hasHomeAdvantage: boolean
  tslSportCode: string
  sportradarSportId: number
}

export const SPORT_CONFIG: Record<Sport, SportConfig> = {
  badminton: {
    sport: 'badminton',
    disciplines: BADMINTON_DISCIPLINES,
    correctScores: BADMINTON_CORRECT_SCORES,
    gamesPerMatch: 3,
    gamesToWin: 2,
    normalGamePoints: 21,
    decidingGamePoints: 21,
    pointCap: 30,
    deuceAdvantage: 2,
    hasHomeAdvantage: false,
    tslSportCode: 'BAD',
    sportradarSportId: 31,
  },
  volleyball: {
    sport: 'volleyball',
    disciplines: VOLLEYBALL_DISCIPLINES,
    correctScores: VOLLEYBALL_CORRECT_SCORES,
    gamesPerMatch: 5,
    gamesToWin: 3,
    normalGamePoints: 25,
    decidingGamePoints: 15,
    pointCap: null,
    deuceAdvantage: 2,
    hasHomeAdvantage: true,
    tslSportCode: 'VOL',
    sportradarSportId: 23,
  },
} as const

export const getSportByTslCode = (code: string): Sport | null => {
  for (const sport of SPORTS) {
    if (SPORT_CONFIG[sport].tslSportCode === code) return sport
  }
  return null
}

export const getSportBySportradarId = (id: number): Sport | null => {
  for (const sport of SPORTS) {
    if (SPORT_CONFIG[sport].sportradarSportId === id) return sport
  }
  return null
}

export const isBadmintonDiscipline = (d: Discipline): d is BadmintonDiscipline =>
  d === 'MS' || d === 'WS'

export const isVolleyballDiscipline = (d: Discipline): d is VolleyballDiscipline =>
  d === 'M' || d === 'W'

export const getSportForDiscipline = (d: Discipline): Sport =>
  isBadmintonDiscipline(d) ? 'badminton' : 'volleyball'

export const getCorrectScoresForSport = (sport: Sport): readonly CorrectScore[] =>
  SPORT_CONFIG[sport].correctScores
