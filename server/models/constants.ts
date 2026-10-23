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

// Tennis constants
export const TENNIS_INITIAL_ELO = 1500
export const TENNIS_K_FACTOR = 32
export const TENNIS_SAMPLE_PRIOR = 40
export const TENNIS_INACTIVITY_HALF_LIFE_DAYS = 150
export const TENNIS_MIN_MATCH_SAMPLE = 10
export const TENNIS_MIN_SET1_SAMPLE = 10
export const TENNIS_SURFACE_BONUS = 50

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
 *    - 格式：date,discipline,tournament,tier,round,team1,team2,winner,score,team1_home,...
 *    - score 格式：25-22 25-20 25-23（空格分隔）
 * 
 * 資料限制：
 * - 歷史資料量較少，模型可能不如羽球穩定
 * - 陣容強度需要手動估計或使用預設值
 * - 主場優勢因賽事類型而異
 */

// Tennis data sources
// Sportradar sport ID 5 is tennis
export const TENNIS_STATSHUB_SOURCE_URL = 'https://statshub.sportradar.com/taiwansportslottery/en/sport/5'
export const TENNIS_SACKMANN_ATP_URL = 'https://github.com/JeffSackmann/tennis_atp'
export const TENNIS_SACKMANN_WTA_URL = 'https://github.com/JeffSackmann/tennis_wta'
export const TENNIS_SOURCE_URL = `${TENNIS_STATSHUB_SOURCE_URL}、${TENNIS_SACKMANN_ATP_URL} 與 ${TENNIS_SACKMANN_WTA_URL}`

/**
 * 網球歷史資料說明：
 * 
 * 訓練/回測資料來源：
 * 1. Sportradar StatsHub (運彩版)：從 TENNIS_STATSHUB_SOURCE_URL 抓取
 *    - 運彩開盤的 ATP/WTA 賽事
 *    - 包含大滿貫、大師賽、500/250 系列賽
 * 
 * 2. 免費資料來源：
 *    - Jeff Sackmann's tennis_atp / tennis_wta GitHub 資料庫
 *    - https://github.com/JeffSackmann/tennis_atp
 *    - https://github.com/JeffSackmann/tennis_wta
 *    - 包含完整歷史數據（1968年至今）
 * 
 * 3. 手動匯入 CSV：放在 data/raw/tennis/ 目錄
 *    - 格式：date,discipline,tournament,tier,round,player1,player2,winner,score,surface
 *    - score 格式：6-4 6-3 或 6-4 3-6 7-6(5)
 * 
 * 特殊考量：
 * - 場地類型（紅土、草地、硬地）影響選手表現
 * - 大滿貫男單為5盤3勝，其他為3盤2勝
 * - 網球選手個人差異大，需要更多樣本
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
