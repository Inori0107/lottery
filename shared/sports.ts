/**
 * 運動項目設定
 * 支援羽球（badminton）、排球（volleyball）與足球（football）的投注估計
 */

export type Sport = 'badminton' | 'volleyball' | 'football'

export const SPORTS: Sport[] = ['badminton', 'volleyball', 'football']

export const sportLabel: Record<Sport, string> = {
  badminton: '羽球',
  volleyball: '排球',
  football: '足球',
}

export const sportIcon: Record<Sport, string> = {
  badminton: '🏸',
  volleyball: '🏐',
  football: '⚽',
}

/** StatsHub 頁面仍會夾雙打，解析時略過。 */
export const isDoublesEvent = (label: string) =>
  /雙打|混雙|double|mixed/i.test(label) || /,\s*(md|wd|xd)\b/i.test(label)

export type BadmintonDiscipline = 'MS' | 'WS'
export type VolleyballDiscipline = 'M' | 'W'
export type FootballDiscipline = 'FM' | 'FW'
export type Discipline = BadmintonDiscipline | VolleyballDiscipline | FootballDiscipline

export const BADMINTON_DISCIPLINES: BadmintonDiscipline[] = ['MS', 'WS']
export const VOLLEYBALL_DISCIPLINES: VolleyballDiscipline[] = ['M', 'W']
export const FOOTBALL_DISCIPLINES: FootballDiscipline[] = ['FM', 'FW']

export const disciplineLabel: Record<Discipline, string> = {
  MS: '男單',
  WS: '女單',
  M: '男排',
  W: '女排',
  FM: '男足',
  FW: '女足',
}

export const disciplineLabelFull: Record<Discipline, string> = {
  MS: '男子單打',
  WS: '女子單打',
  M: '男子排球',
  W: '女子排球',
  FM: '男子足球',
  FW: '女子足球',
}

export type BadmintonCorrectScore = '2:0' | '2:1' | '1:2' | '0:2'
export type VolleyballCorrectScore = '3:0' | '3:1' | '3:2' | '2:3' | '1:3' | '0:3'
export type FootballCorrectScore =
  | '0:0' | '1:0' | '2:0' | '3:0' | '4:0'
  | '0:1' | '1:1' | '2:1' | '3:1' | '4:1'
  | '0:2' | '1:2' | '2:2' | '3:2'
  | '0:3' | '1:3' | '2:3'
  | '0:4' | '1:4'
  | 'other'
export type CorrectScore = BadmintonCorrectScore | VolleyballCorrectScore | FootballCorrectScore

export const BADMINTON_CORRECT_SCORES: BadmintonCorrectScore[] = ['2:0', '2:1', '1:2', '0:2']
export const VOLLEYBALL_CORRECT_SCORES: VolleyballCorrectScore[] = ['3:0', '3:1', '3:2', '2:3', '1:3', '0:3']
export const FOOTBALL_CORRECT_SCORES: FootballCorrectScore[] = [
  '0:0', '1:0', '2:0', '3:0', '4:0',
  '0:1', '1:1', '2:1', '3:1', '4:1',
  '0:2', '1:2', '2:2', '3:2',
  '0:3', '1:3', '2:3',
  '0:4', '1:4',
  'other',
]

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
  isGoalSport?: boolean
  has1X2Market?: boolean
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
    tslSportCodeAliases: ['BDM', 'BADM'],
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
    tslSportCodeAliases: ['VOLL', 'VB', 'VBL', 'VLB'],
    sportradarSportId: 23,
  },
  football: {
    sport: 'football',
    disciplines: FOOTBALL_DISCIPLINES,
    correctScores: FOOTBALL_CORRECT_SCORES,
    setsPerMatch: 1,
    setsToWin: 1,
    gamesPerSet: 0,
    tiebreakAt: 0,
    hasHomeAdvantage: true,
    tslSportCode: 'SOC',
    tslSportCodeAliases: ['SOCCER', 'FTB', 'FB', 'FOOT', 'FOOTBALL'],
    sportradarSportId: 1,
    isGoalSport: true,
    has1X2Market: true,
  },
} as const

export const tslSportCodes = () => {
  const codes: string[] = []
  for (const sport of SPORTS) {
    const config = SPORT_CONFIG[sport]
    codes.push(config.tslSportCode)
    codes.push(...(config.tslSportCodeAliases ?? []))
  }
  return codes
}

export const getSportByTslCode = (code: string): Sport | null => {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9\u4e00-\u9fff]/g, '')
  if (!normalized) return null
  if (
    normalized === 'BAD'
    || normalized === 'BDM'
    || normalized === 'BADM'
    || normalized.startsWith('BAD')
    || normalized.includes('BADMINTON')
    || normalized.includes('羽球')
  ) return 'badminton'
  if (
    normalized === 'VOL'
    || normalized === 'VB'
    || normalized === 'VLB'
    || normalized === 'VOLL'
    || normalized === 'VBL'
    || normalized.startsWith('VOL')
    || normalized.includes('VOLLEY')
    || normalized.includes('排球')
  ) return 'volleyball'
  if (
    normalized === 'SOC'
    || normalized === 'SOCCER'
    || normalized === 'FTB'
    || normalized === 'FB'
    || normalized === 'FOOT'
    || normalized.startsWith('SOC')
    || normalized.includes('SOCCER')
    || normalized.includes('FOOTBALL')
    || normalized.includes('足球')
  ) return 'football'
  for (const sport of SPORTS) {
    const config = SPORT_CONFIG[sport]
    if (config.tslSportCode === normalized) return sport
    if (config.tslSportCodeAliases?.includes(normalized)) return sport
  }
  return null
}

export const getSportBySportradarId = (id: number): Sport | null => {
  for (const sport of SPORTS) {
    if (SPORT_CONFIG[sport].sportradarSportId === id) return sport
  }
  return null
}

export const isBadmintonDiscipline = (d: Discipline): d is BadmintonDiscipline => d === 'MS' || d === 'WS'

export const isVolleyballDiscipline = (d: Discipline): d is VolleyballDiscipline => d === 'M' || d === 'W'

export const isFootballDiscipline = (d: Discipline): d is FootballDiscipline => d === 'FM' || d === 'FW'

export const getSportForDiscipline = (d: Discipline): Sport => {
  if (isVolleyballDiscipline(d)) return 'volleyball'
  if (isFootballDiscipline(d)) return 'football'
  return 'badminton'
}

export const getCorrectScoresForSport = (sport: Sport, _tournament = '', _discipline?: Discipline): readonly CorrectScore[] =>
  SPORT_CONFIG[sport].correctScores

export const setsToWinFor = (sport: Sport, _tournament = '', _discipline?: Discipline) =>
  SPORT_CONFIG[sport].setsToWin

export const isGoalSport = (sport: Sport) => SPORT_CONFIG[sport].isGoalSport === true

export const has1X2Market = (sport: Sport) => SPORT_CONFIG[sport].has1X2Market === true
