// Common
export const CUTOFF_DATE = '2027-01-04'
export const DATA_LAG_DAYS = 14
export const STALE_PLAYER_DAYS = 90

// Badminton constants
export const INITIAL_ELO = 1500
export const K_FACTOR = 32
export const SAMPLE_PRIOR = 40
export const INACTIVITY_HALF_LIFE_DAYS = 180
export const MIN_MATCH_SAMPLE = 8
export const MIN_SET1_SAMPLE = 8

// Volleyball constants
export const VOLLEYBALL_INITIAL_ELO = 1500
export const VOLLEYBALL_K_FACTOR = 32
export const VOLLEYBALL_SAMPLE_PRIOR = 30
export const VOLLEYBALL_INACTIVITY_HALF_LIFE_DAYS = 120
export const VOLLEYBALL_MIN_MATCH_SAMPLE = 10
export const VOLLEYBALL_MIN_SET1_SAMPLE = 10
export const VOLLEYBALL_HOME_ADVANTAGE_CLUB = 60
export const VOLLEYBALL_HOME_ADVANTAGE_NATIONAL = 25
export const VOLLEYBALL_ROSTER_STRENGTH_FACTOR = 200

// Badminton data sources
export const BWF_SOURCE_URL = 'https://github.com/SahilMotyar/bwf-match-data'
export const SUN_SOURCE_URL = 'https://doi.org/10.7910/DVN/RSAYV5'
export const BADMINTON_STATSHUB_SOURCE_URL = 'https://statshub.sportradar.com/taiwansportslottery/en/sport/31'
export const STATSHUB_SOURCE_URL = BADMINTON_STATSHUB_SOURCE_URL
export const STATSHUB_START_DATE = '2026-07-06'
export const BADMINTON_SOURCE_URL = `${SUN_SOURCE_URL}、${BWF_SOURCE_URL} 與 ${STATSHUB_SOURCE_URL}`
export const SOURCE_URL = BADMINTON_SOURCE_URL

// Volleyball data sources
// Sportradar sport ID 23 is volleyball
export const VOLLEYBALL_STATSHUB_SOURCE_URL = 'https://statshub.sportradar.com/taiwansportslottery/en/sport/23'
export const VOLLEYBALL_SOURCE_URL = VOLLEYBALL_STATSHUB_SOURCE_URL

/**
 * 排球歷史資料說明：
 * 
 * 訓練/回測資料來源：
 * 1. Sportradar StatsHub (運彩版)：從 VOLLEYBALL_STATSHUB_SOURCE_URL 抓取
 *    - 只有運彩開盤的場次，約半年資料
 *    - 包含職業聯賽（義甲、波蘭聯賽等）與國際賽（VNL、奧運等）
 * 
 * 2. 手動匯入 CSV：放在 data/raw/volleyball/ 目錄
 *    - 格式：date,discipline,tournament,tier,round,team1,team2,winner,score,team1_home,team1_roster_strength,team2_roster_strength
 *    - score 格式：25-22 25-20 25-23（空格分隔）
 * 
 * 資料限制：
 * - 歷史資料量較少，模型可能不如羽球穩定
 * - 陣容強度需要手動估計或使用預設值
 * - 主場優勢因賽事類型而異
 */

export const RAW_FILE_URLS = {
  'ms.csv': 'https://raw.githubusercontent.com/SahilMotyar/bwf-match-data/main/ms.csv',
  'ws.csv': 'https://raw.githubusercontent.com/SahilMotyar/bwf-match-data/main/ws.csv',
} as const

export const SUN_FILE_URLS = {
  'tournaments.xlsx': 'https://dataverse.harvard.edu/api/access/datafile/13898739',
  'players.xlsx': 'https://dataverse.harvard.edu/api/access/datafile/13898737',
  'matches.xlsx': 'https://dataverse.harvard.edu/api/access/datafile/13898740',
} as const
