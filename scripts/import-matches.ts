import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'csv-parse/sync'
import {
  BWF_SOURCE_URL,
  RAW_FILE_URLS,
  SOURCE_URL,
  STATSHUB_SOURCE_URL,
  SUN_FILE_URLS,
  SUN_SOURCE_URL,
} from '../server/models/constants'
import { matchPairKey, parseCsvRow, type AcceptedMatch, type CsvRow, type RejectReason } from '../server/models/dataset'
import { parseStatshubPage, statshubMatchesToCsv, type StatshubMatch } from '../server/models/statshub'
import { buildPlayerDirectory, formatLinkedName, sunTablesToCsv } from '../server/models/sun'
import { readFirstSheet } from '../server/models/xlsx'
import { openDatabase } from '../server/db/open'
import { dbFile, rawDir, reportDir, statshubDir } from './paths'

const sunDir = join(rawDir, 'sun2026')

type StoredMatch = AcceptedMatch & { sourceUrl: string }
type ExcludeReason = RejectReason | 'duplicate' | 'other_scoring' | 'covered_by_sun'

const ensureFile = async (dir: string, fileName: string, url: string) => {
  const filePath = join(dir, fileName)
  mkdirSync(dir, { recursive: true })
  if (!statSync(filePath, { throwIfNoEntry: false })) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`下載失敗：${url}`)
    writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  }
  const content = readFileSync(filePath)
  return {
    fileName,
    filePath,
    url,
    content,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

const ensureRawFile = async (fileName: keyof typeof RAW_FILE_URLS) => {
  const file = await ensureFile(rawDir, fileName, RAW_FILE_URLS[fileName])
  return { ...file, rows: parse(file.content, { columns: true, skip_empty_lines: true, bom: true }) as CsvRow[] }
}

const ensureSunFile = async (fileName: keyof typeof SUN_FILE_URLS) => {
  const file = await ensureFile(sunDir, fileName, SUN_FILE_URLS[fileName])
  return { ...file, rows: readFirstSheet(file.filePath) }
}

const readStatshubPages = () => {
  mkdirSync(statshubDir, { recursive: true })
  return readdirSync(statshubDir)
    .filter(file => /^\d{4}-\d{2}-\d{2}\.html$/.test(file))
    .sort()
    .map((fileName) => {
      const bytes = readFileSync(join(statshubDir, fileName))
      return {
        fileName: `statshub/${fileName}`,
        url: `${STATSHUB_SOURCE_URL}?date=${fileName.replace(/\.html$/, '')}`,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        matches: parseStatshubPage(bytes.toString('utf8')).matches,
      }
    })
}

const disciplineDirectories = (matches: StoredMatch[]) => {
  const players = { MS: [] as Array<{ id: string, name: string }>, WS: [] as Array<{ id: string, name: string }> }
  for (const match of matches) {
    players[match.discipline].push(
      { id: match.sourceTeam1Id, name: match.sourceTeam1Name },
      { id: match.sourceTeam2Id, name: match.sourceTeam2Name },
    )
  }
  return { MS: buildPlayerDirectory(players.MS), WS: buildPlayerDirectory(players.WS) }
}

const reasonLabel: Record<ExcludeReason, string> = {
  bad_date: '日期無法解析',
  out_of_range: '日期在 2027-01-04 之後',
  bad_discipline: '不是男單或女單',
  missing_winner: '缺少勝方',
  missing_name: '缺少選手姓名',
  same_player: '雙方為同一人',
  bad_score: '比分無法解析',
  not_in_sample: '沒有合法全場或合法第一局',
  duplicate: '重複比賽',
  other_scoring: '不是 3×21（15 分、11 分、棄權或未知）',
  covered_by_sun: '日期已在各層級資料內，不重複匯入菁英賽',
}

const acceptRows = (
  rows: CsvRow[],
  sourceUrl: string,
  reasons: Map<string, number>,
  accepted: StoredMatch[],
  seenPairs: Set<string>,
) => {
  let conflicts = 0
  const count = (reason: string) => reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  for (const row of rows) {
    const parsed = parseCsvRow(row)
    if ('reason' in parsed) {
      count(parsed.reason)
      continue
    }
    const pair = matchPairKey(
      parsed.match.playedOn,
      parsed.match.discipline,
      parsed.match.sourceTeam1Id,
      parsed.match.sourceTeam2Id,
    )
    if (seenPairs.has(pair)) {
      count('duplicate')
      continue
    }
    seenPairs.add(pair)
    if (parsed.match.winnerConflict) conflicts += 1
    accepted.push({ ...parsed.match, sourceUrl })
  }
  return conflicts
}

const importFiles = async () => {
  const retrievedAt = new Date().toISOString()
  const sunFiles = [
    await ensureSunFile('tournaments.xlsx'),
    await ensureSunFile('players.xlsx'),
    await ensureSunFile('matches.xlsx'),
  ]
  const sunTournaments = sunFiles[0]
  const sunPlayers = sunFiles[1]
  const sunMatches = sunFiles[2]
  if (!sunTournaments || !sunPlayers || !sunMatches) throw new Error('Sun & Zhang 檔案不完整')
  const sun = sunTablesToCsv(sunTournaments.rows, sunPlayers.rows, sunMatches.rows)
  const bwfFiles = [await ensureRawFile('ms.csv'), await ensureRawFile('ws.csv')]
  const reasons = new Map<string, number>()
  const accepted: StoredMatch[] = []
  const seenPairs = new Set<string>()
  let winnerRows = 0
  let winnerOnes = 0
  const fileStats: string[] = []

  if (sun.skippedScoring > 0) reasons.set('other_scoring', sun.skippedScoring)
  const sunConflicts = acceptRows(sun.rows, SUN_SOURCE_URL, reasons, accepted, seenPairs)
  const sunDates = sun.rows.map(row => (row.date ?? '').trim()).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()
  fileStats.push(`- \`sun2026/matches.xlsx\`：${sunMatches.rows.length - 1} 列，轉成 3×21 候選 ${sun.rows.length} 列，日期 ${sunDates[0] || '—'} 至 ${sunDates[sunDates.length - 1] || '—'}，SHA-256 \`${sunMatches.sha256}\``)
  fileStats.push(`- \`sun2026/players.xlsx\`：${sunPlayers.rows.length - 1} 列，SHA-256 \`${sunPlayers.sha256}\``)
  fileStats.push(`- \`sun2026/tournaments.xlsx\`：${sunTournaments.rows.length - 1} 列，SHA-256 \`${sunTournaments.sha256}\``)

  const sunMaxDate = sunDates[sunDates.length - 1] ?? ''
  let conflicts = sunConflicts
  for (const file of bwfFiles) {
    let minDate = ''
    let maxDate = ''
    let covered = 0
    const linkedRows: CsvRow[] = []
    for (const row of file.rows) {
      const date = (row.date ?? '').trim()
      const discipline = (row.discipline ?? '').trim()
      if ((discipline === 'MS' || discipline === 'WS') && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < '2027-01-04') {
        winnerRows += 1
        if ((row.winner ?? '').trim() === '1') winnerOnes += 1
        minDate = minDate === '' || date < minDate ? date : minDate
        maxDate = date > maxDate ? date : maxDate
      }
      if (sunMaxDate && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= sunMaxDate) {
        covered += 1
        continue
      }
      linkedRows.push({
        ...row,
        team1: formatLinkedName(row.team1 ?? '', sun.directory),
        team2: formatLinkedName(row.team2 ?? '', sun.directory),
      })
    }
    reasons.set('covered_by_sun', (reasons.get('covered_by_sun') ?? 0) + covered)
    conflicts += acceptRows(linkedRows, BWF_SOURCE_URL, reasons, accepted, seenPairs)
    fileStats.push(`- \`${file.fileName}\`：${file.rows.length} 列，日期 ${minDate || '—'} 至 ${maxDate || '—'}，SHA-256 \`${file.sha256}\``)
  }

  const statshubPages = readStatshubPages()
  const statshubMatches: StatshubMatch[] = statshubPages.flatMap(page => page.matches)
  const statshub = statshubMatchesToCsv(statshubMatches, disciplineDirectories(accepted))
  reasons.set('other_scoring', (reasons.get('other_scoring') ?? 0) + statshub.skippedScoring)
  conflicts += acceptRows(statshub.rows, STATSHUB_SOURCE_URL, reasons, accepted, seenPairs)
  const statshubDates = statshub.rows.map(row => row.date ?? '').sort()
  fileStats.push(`- \`statshub/\`：${statshubPages.length} 頁，單打完賽 ${statshub.rows.length} 場（另有 ${statshub.skippedScoring} 場棄權、取消或未開打），日期 ${statshubDates[0] || '—'} 至 ${statshubDates[statshubDates.length - 1] || '—'}`)

  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbFile}${suffix}`, { force: true })
  const { sqlite } = openDatabase(dbFile)

  const players = new Map<string, { name: string, aliases: Set<string> }>()
  const events = new Map<string, { name: string, tier: string, location: string, start: string, end: string }>()

  for (const match of accepted) {
    for (const player of [
      { id: match.sourceTeam1Id, name: match.sourceTeam1Name },
      { id: match.sourceTeam2Id, name: match.sourceTeam2Name },
    ]) {
      const existing = players.get(player.id)
      if (!existing) {
        players.set(player.id, { name: player.name, aliases: new Set() })
      } else if (existing.name !== player.name) {
        existing.aliases.add(player.name)
      }
    }

    const event = events.get(match.eventId)
    if (!event) {
      events.set(match.eventId, {
        name: match.tournament,
        tier: match.tier,
        location: match.location,
        start: match.playedOn,
        end: match.playedOn,
      })
    } else {
      if (match.playedOn < event.start) event.start = match.playedOn
      if (match.playedOn > event.end) event.end = match.playedOn
    }
  }

  const insertPlayer = sqlite.prepare(`
    INSERT INTO players (player_id, name_primary, name_aliases)
    VALUES (@playerId, @namePrimary, @nameAliases)
  `)
  const insertEvent = sqlite.prepare(`
    INSERT INTO events (event_id, name, tier, location, start_date, end_date)
    VALUES (@eventId, @name, @tier, @location, @startDate, @endDate)
  `)
  const insertMatch = sqlite.prepare(`
    INSERT INTO matches (
      match_id, event_id, discipline, round, played_on,
      source_team1_id, source_team2_id, side_a_id, side_b_id,
      side_a_won_match, include_match, include_game1, source_url, retrieved_at
    ) VALUES (
      @matchId, @eventId, @discipline, @round, @playedOn,
      @sourceTeam1Id, @sourceTeam2Id, @sideAId, @sideBId,
      @sideAWonMatch, @includeMatch, @includeGame1, @sourceUrl, @retrievedAt
    )
  `)
  const insertGame = sqlite.prepare(`
    INSERT INTO games (match_id, game_number, points_a, points_b, side_a_won, is_legal)
    VALUES (@matchId, @gameNumber, @pointsA, @pointsB, @sideAWon, @isLegal)
  `)

  const write = sqlite.transaction(() => {
    for (const [playerId, player] of players) {
      insertPlayer.run({
        playerId,
        namePrimary: player.name,
        nameAliases: [...player.aliases].join(' | '),
      })
    }
    for (const [eventId, event] of events) {
      insertEvent.run({
        eventId,
        name: event.name,
        tier: event.tier,
        location: event.location,
        startDate: event.start,
        endDate: event.end,
      })
    }
    for (const match of accepted) {
      insertMatch.run({
        matchId: match.matchId,
        eventId: match.eventId,
        discipline: match.discipline,
        round: match.round,
        playedOn: match.playedOn,
        sourceTeam1Id: match.sourceTeam1Id,
        sourceTeam2Id: match.sourceTeam2Id,
        sideAId: match.sideAId,
        sideBId: match.sideBId,
        sideAWonMatch: match.sideAWonMatch === null ? null : Number(match.sideAWonMatch),
        includeMatch: Number(match.matchLegal),
        includeGame1: Number(match.game1Legal),
        sourceUrl: match.sourceUrl,
        retrievedAt,
      })
      match.games.forEach((game, index) => {
        insertGame.run({
          matchId: match.matchId,
          gameNumber: index + 1,
          pointsA: game.pointsA,
          pointsB: game.pointsB,
          sideAWon: Number(game.sideAWon),
          isLegal: Number(game.isLegal),
        })
      })
    }
  })
  write()

  const summary = sqlite.prepare(`
    SELECT
      SUM(CASE WHEN discipline = 'MS' AND include_match = 1 THEN 1 ELSE 0 END) AS ms_match,
      SUM(CASE WHEN discipline = 'WS' AND include_match = 1 THEN 1 ELSE 0 END) AS ws_match,
      SUM(CASE WHEN discipline = 'MS' AND include_game1 = 1 THEN 1 ELSE 0 END) AS ms_game1,
      SUM(CASE WHEN discipline = 'WS' AND include_game1 = 1 THEN 1 ELSE 0 END) AS ws_game1,
      MIN(played_on) AS min_date,
      MAX(played_on) AS max_date
    FROM matches
  `).get() as {
    ms_match: number
    ws_match: number
    ms_game1: number
    ws_game1: number
    min_date: string
    max_date: string
  }

  const auditRows = sqlite.prepare(`
    SELECT m.match_id, m.played_on, m.discipline, m.round, e.name AS event_name,
           pa.name_primary AS side_a, pb.name_primary AS side_b
    FROM matches m
    JOIN events e ON e.event_id = m.event_id
    JOIN players pa ON pa.player_id = m.side_a_id
    JOIN players pb ON pb.player_id = m.side_b_id
    WHERE m.include_match = 1
    ORDER BY m.match_id
  `).all() as Array<{
    match_id: string
    played_on: string
    discipline: string
    round: string
    event_name: string
    side_a: string
    side_b: string
  }>

  const step = Math.max(1, Math.floor(auditRows.length / 30))
  const sample = []
  for (let index = 0; index < auditRows.length && sample.length < 30; index += step) {
    const row = auditRows[index]
    if (row) sample.push(row)
  }
  const scoreStatement = sqlite.prepare(`
    SELECT points_a, points_b FROM games WHERE match_id = ? ORDER BY game_number
  `)

  mkdirSync(reportDir, { recursive: true })
  const reasonLines = [...reasons.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, total]) => `- ${reasonLabel[reason as ExcludeReason] ?? reason}：${total}`)
    .join('\n')

  const tierRows = sqlite.prepare(`
    SELECT e.tier AS tier, COUNT(*) AS total
    FROM matches m
    JOIN events e ON e.event_id = m.event_id
    GROUP BY e.tier
    ORDER BY total DESC
  `).all() as Array<{ tier: string, total: number }>
  const tierLines = tierRows.map(row => `- ${row.tier || '未標層級'}：${row.total}`).join('\n')

  const quality = `# 資料品質報告

匯入時間：${retrievedAt}
來源：${SOURCE_URL}

## 原始檔

${fileStats.join('\n')}

bwf-match-data 原始 \`winner = 1\` 的比例（男單、女單且日期早於 2027-01-04）：${winnerRows === 0 ? '—' : `${winnerOnes} / ${winnerRows}（${(winnerOnes / winnerRows).toFixed(4)}）`}。Sun & Zhang 檔以勝方、負方分欄，匯入時勝方放在 team1。

## 層級

${tierLines || '- 無'}

## 納入資料庫

- 選手：${players.size}
- 賽事：${events.size}
- 日期範圍：${summary.min_date} 至 ${summary.max_date}
- 男單合法全場：${summary.ms_match}
- 女單合法全場：${summary.ws_match}
- 男單合法第一局：${summary.ms_game1}
- 女單合法第一局：${summary.ws_game1}
- 勝方欄與局分矛盾、因此不納入全場樣本：${conflicts}

## 排除筆數

${reasonLines || '- 無'}

比分只保留能解析的局。全場樣本必須是合法的 3×21 完賽：兩局且同一方連勝，或三局且前兩局沒有同一方連勝。第一局只要該局合法就保留。

## Sportradar 賽果

來源：${STATSHUB_SOURCE_URL}。只收錄台灣運彩有開盤的場次，不是完整賽果；同一站可能只有男單或只有女單。日期取開賽時間的 UTC 日期。賽事沒有層級資料。

- 對上既有選手：${statshub.linkedPlayers}
- 新建選手（id 為 \`sportradar:<uid>\`）：${statshub.newPlayers.length}

${statshub.newPlayers.map(player => `- ${player.discipline}｜${player.name}｜\`${player.playerId}\``).join('\n') || '- 無'}
`
  writeFileSync(join(reportDir, 'data_quality.md'), quality)

  const audit = `# 官方賽果抽查清單

這 30 場由合法全場樣本依比賽 ID 等距抽出。狀態維持「未核對」，代表尚未逐場對過 BWF 官方頁。

| 日期 | 項目 | 賽事 | 輪次 | 選手 A | 選手 B | 比分（A-B） | 狀態 |
|---|---|---|---|---|---|---|---|
${sample.map((row) => {
    const games = scoreStatement.all(row.match_id) as Array<{ points_a: number, points_b: number }>
    const score = games.map(game => `${game.points_a}-${game.points_b}`).join(' ')
    return `| ${row.played_on} | ${row.discipline} | ${row.event_name.replaceAll('|', '/')} | ${row.round.replaceAll('|', '/')} | ${row.side_a.replaceAll('|', '/')} | ${row.side_b.replaceAll('|', '/')} | ${score} | 未核對 |`
  }).join('\n')}
`
  writeFileSync(join(reportDir, 'audit_sample.md'), audit)
  writeFileSync(join(rawDir, 'manifest.json'), JSON.stringify({
    retrievedAt,
    sourceUrl: SOURCE_URL,
    files: [...sunFiles, ...bwfFiles, ...statshubPages].map(file => ({
      fileName: file.fileName,
      url: file.url,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
  }, null, 2))

  sqlite.close()
  console.log(`已匯入 ${accepted.length} 場，資料庫：${dbFile}`)
}

await importFiles()
