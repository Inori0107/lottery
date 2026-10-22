export const INITIAL_ELO = 1500
export const K_FACTOR = 32
export const SAMPLE_PRIOR = 40
export const INACTIVITY_HALF_LIFE_DAYS = 180
export const STALE_PLAYER_DAYS = 90
export const DATA_LAG_DAYS = 14
export const MIN_MATCH_SAMPLE = 8
export const MIN_GAME1_SAMPLE = 8
export const CUTOFF_DATE = '2027-01-04'
export const BWF_SOURCE_URL = 'https://github.com/SahilMotyar/bwf-match-data'
export const SUN_SOURCE_URL = 'https://doi.org/10.7910/DVN/RSAYV5'
export const STATSHUB_SOURCE_URL = 'https://statshub.sportradar.com/taiwansportslottery/en/sport/31'
export const STATSHUB_START_DATE = '2026-07-06'
export const SOURCE_URL = `${SUN_SOURCE_URL}、${BWF_SOURCE_URL} 與 ${STATSHUB_SOURCE_URL}`
export const RAW_FILE_URLS = {
  'ms.csv': 'https://raw.githubusercontent.com/SahilMotyar/bwf-match-data/main/ms.csv',
  'ws.csv': 'https://raw.githubusercontent.com/SahilMotyar/bwf-match-data/main/ws.csv',
} as const
export const SUN_FILE_URLS = {
  'tournaments.xlsx': 'https://dataverse.harvard.edu/api/access/datafile/13898739',
  'players.xlsx': 'https://dataverse.harvard.edu/api/access/datafile/13898737',
  'matches.xlsx': 'https://dataverse.harvard.edu/api/access/datafile/13898740',
} as const
