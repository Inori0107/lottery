import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const decodeXml = (value: string) =>
  value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

const readSharedStrings = (xml: string) => {
  const strings: string[] = []
  const pattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  for (const match of xml.matchAll(pattern)) {
    const texts = [...(match[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    strings.push(texts.map(part => decodeXml(part[1] ?? '')).join(''))
  }
  return strings
}

const columnIndex = (ref: string) => {
  let index = 0
  for (const char of ref) {
    if (char < 'A' || char > 'Z') break
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index - 1
}

const cellText = (openTag: string, body: string, shared: string[]) => {
  const type = openTag.match(/\bt="([^"]+)"/)?.[1]
  if (type === 'inlineStr') {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(part => decodeXml(part[1] ?? ''))
      .join('')
  }
  const value = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''
  if (type === 's') return shared[Number(value)] ?? ''
  return decodeXml(value)
}

const readRow = (inner: string, shared: string[]) => {
  const cells = new Map<number, string>()
  let cursor = 0
  while (cursor < inner.length) {
    const start = inner.indexOf('<c', cursor)
    if (start === -1) break
    const next = inner[start + 2]
    if (next !== ' ' && next !== '>' && next !== '/') {
      cursor = start + 2
      continue
    }
    const tagEnd = inner.indexOf('>', start)
    if (tagEnd === -1) break
    const openTag = inner.slice(start, tagEnd + 1)
    const selfClosing = openTag.endsWith('/>')
    let body = ''
    if (selfClosing) {
      cursor = tagEnd + 1
    } else {
      const close = inner.indexOf('</c>', tagEnd)
      if (close === -1) break
      body = inner.slice(tagEnd + 1, close)
      cursor = close + 4
    }
    const ref = openTag.match(/\br="([A-Z]+)\d+"/)?.[1]
    if (!ref) continue
    cells.set(columnIndex(ref), cellText(openTag, body, shared))
  }
  if (cells.size === 0) return null
  const width = Math.max(...cells.keys()) + 1
  return Array.from({ length: width }, (_, index) => cells.get(index) ?? '')
}

export const readSheetRows = (xml: string, shared: string[]) => {
  const rows: string[][] = []
  let cursor = 0
  while (cursor < xml.length) {
    const start = xml.indexOf('<row', cursor)
    if (start === -1) break
    const next = xml[start + 4]
    if (next !== ' ' && next !== '>') {
      cursor = start + 4
      continue
    }
    const tagEnd = xml.indexOf('>', start)
    if (tagEnd === -1) break
    const close = xml.indexOf('</row>', tagEnd)
    if (close === -1) break
    const row = readRow(xml.slice(tagEnd + 1, close), shared)
    if (row) rows.push(row)
    cursor = close + 6
  }
  return rows
}

export const readFirstSheet = (filePath: string) => {
  const directory = mkdtempSync(join(tmpdir(), 'xlsx-'))
  try {
    execFileSync('unzip', ['-q', filePath, '-d', directory], { stdio: 'pipe' })
    const sharedPath = join(directory, 'xl/sharedStrings.xml')
    const shared = readSharedStrings(readFileSync(sharedPath, 'utf8'))
    const sheet = readFileSync(join(directory, 'xl/worksheets/sheet1.xml'), 'utf8')
    return readSheetRows(sheet, shared)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
