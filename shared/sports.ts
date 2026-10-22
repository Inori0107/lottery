/**
 * 運動項目設定
 * 支援羽球（badminton）、排球（volleyball）與網球（tennis）的投注估計
 */

export type Sport = 'badminton' | 'volleyball' | 'tennis'

export const SPORTS: Sport[] = ['badminton', 'volleyball', 'tennis']

export const sportLabel: Record<Sport, string> = {
  badminton: '羽球',
  volleyball: '排球',
  tennis: '網球',
}

export const sportIcon: Record<Sport, string> = {
  badminton: '🏸',
  volleyball: '🏐',
  tennis: '🎾',
}

export type BadmintonDiscipline = 'MS' | 'WS'
export type VolleyballDiscipline = 'M' | 'W'
export type TennisDiscipline = 'ATP' | 'WTA'
export type Discipline = BadmintonDiscipline | VolleyballDiscipline | TennisDiscipline

export const BADMINTON_DISCIPLINES: BadmintonDiscipline[] = ['MS', 'WS']
export const VOLLEYBALL_DISCIPLINES: VolleyballDiscipline[] = ['M', 'W']
export const TENNIS_DISCIPLINES: TennisDiscipline[] = ['ATP', 'WTA']

export const disciplineLabel: Record<Discipline, string> = {
  MS: '男單',
  WS: '女單',
  M: '男排',
  W: '女排',
  ATP: '男網',
  WTA: '女網',
}

export const disciplineLabelFull: Record<Discipline, string> = {
  MS: '男子單打',
  WS: '女子單打',
  M: '男子排球',
  W: '女子排球',
  ATP: 'ATP 男子',
  WTA: 'WTA 女子',
}

export type BadmintonCorrectScore = '2:0' | '2:1' | '1:2' | '0:2'
export type VolleyballCorrectScore = '3:0' | '3:1' | '3:2' | '2:3' | '1:3' | '0:3'
export type TennisBo3CorrectScore = '2:0' | '2:1' | '1:2' | '0:2'
export type TennisBo5CorrectScore = '3:0' | '3:1' | '3:2' | '2:3' | '1:3' | '0:3'
export type TennisCorrectScore = TennisBo3CorrectScore | TennisBo5CorrectScore
export type CorrectScore = BadmintonCorrectScore | VolleyballCorrectScore | TennisCorrectScore

export const BADMINTON_CORRECT_SCORES: BadmintonCorrectScore[] = ['2:0', '2:1', '1:2', '0:2']
export const VOLLEYBALL_CORRECT_SCORES: VolleyballCorrectScore[] = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3']
export const TENNIS_BO3_CORRECT_SCORES: TennisBo3CorrectScore[] = ['2:0', '2:1', '1:2', '0:2']
export const TENNIS_BO5_CORRECT_SCORES: TennisBo5CorrectScore[] = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3']
export const TENNIS_CORRECT_SCORES: TennisCorrectScore[] = TENNIS_BO3_CORRECT_SCORES

export type SportConfig = {
  sport: Sport
  disciplines: readonly Discipline[]
  correctScores: readonly CorrectScore[]
  setsPerMatch: number
  setsToWin: number
  gamesPerSet: number
  tiebreakAt: number
  hasHomeAdvantage: boolean
  tslSportCode: string
  tslSportCodeAliases?: readonly string[]
  sportradarSportId: number
}

export const SPORT_CONFIG: Record<Sport, SportConfig> = {
  badminton: {
    sport: 'badminton',
    disciplines: BADMINTON_DISCIPLINES,
    correctScores: BADMINTON_CORRECT_SCORES,
    setsPerMatch: 3,
    setsToWin: 2,
    gamesPerSet: 21,
    tiebreakAt: 20,
    hasHomeAdvantage: false,
    tslSportCode: 'BAD',
    sportradarSportId: 31,
  },
  volleyball: {
    sport: 'volleyball',
    disciplines: VOLLEYBALL_DISCIPLINES,
    correctScores: VOLLEYBALL_CORRECT_SCORES,
    setsPerMatch: 5,
    setsToWin: 3,
    gamesPerSet: 25,
    tiebreakAt: 24,
    hasHomeAdvantage: true,
    tslSportCode: 'VOL',
    sportradarSportId: 23,
  },
  tennis: {
    sport: 'tennis',
    disciplines: TENNIS_DISCIPLINES,
    correctScores: TENNIS_CORRECT_SCORES,
    setsPerMatch: 3,
    setsToWin: 2,
    gamesPerSet: 6,
    tiebreakAt: 6,
    hasHomeAdvantage: false,
    tslSportCode: 'TEN',
    tslSportCodeAliases: ['TENN', 'TE'],
    sportradarSportId: 5,
  },
} as const

export const getSportByTslCode = (code: string): Sport | null => {
  const normalized = code.trim().toUpperCase()
  for (const sport of SPORTS) {
    const config = SPORT_CONFIG[sport]
    if (config.tslSportCode === normalized) return sport
    if (config.tslSportCodeAliases?.includes(normalized)) return sport
  }
  return null
}

export const isTennisGrandSlam = (tournament: string) => {
  const lower = tournament.toLowerCase()
  return (
    lower.includes('australian open') ||
    lower.includes('french open') ||
    lower.includes('roland garros') ||
    lower.includes('wimbledon') ||
    lower.includes('us open') ||
    tournament.includes('澳網') ||
    tournament.includes('法網') ||
    tournament.includes('溫網') ||
    tournament.includes('溫布頓') ||
    tournament.includes('美網')
  )
}

export const tennisBestOf = (discipline: TennisDiscipline, tournament: string): 3 | 5 =>
  discipline === 'ATP' && isTennisGrandSlam(tournament) ? 5 : 3

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

export const isTennisDiscipline = (d: Discipline): d is TennisDiscipline =>
  d === 'ATP' || d === 'WTA'

export const getSportForDiscipline = (d: Discipline): Sport => {
  if (isBadmintonDiscipline(d)) return 'badminton'
  if (isVolleyballDiscipline(d)) return 'volleyball'
  return 'tennis'
}

export const getCorrectScoresForSport = (sport: Sport): readonly CorrectScore[] =>
  SPORT_CONFIG[sport].correctScores
