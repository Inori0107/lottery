/**
 * 網球選手名稱對應
 *
 * TSL 常見格式：Surname, Given（例如 Djokovic, Novak）
 * Jeff Sackmann / ATP 常見格式：Given Surname（例如 Novak Djokovic）
 */

import { foldPlayerName } from './sun'

export const TENNIS_NAME_ALIASES: Record<string, string[]> = {
  'Djokovic, Novak': ['Novak Djokovic', '喬科維奇', 'Djokovic'],
  'Alcaraz, Carlos': ['Carlos Alcaraz', '阿爾卡拉斯', 'Alcaraz'],
  'Sinner, Jannik': ['Jannik Sinner', '辛納', 'Sinner'],
  'Medvedev, Daniil': ['Daniil Medvedev', '梅德維德夫', 'Medvedev'],
  'Zverev, Alexander': ['Alexander Zverev', '茲維列夫', 'Zverev'],
  'Swiatek, Iga': ['Iga Swiatek', '斯威雅蒂', 'Swiatek'],
  'Sabalenka, Aryna': ['Aryna Sabalenka', '薩巴倫卡', 'Sabalenka'],
  'Gauff, Coco': ['Coco Gauff', '高芙', 'Gauff'],
  'Zheng, Qinwen': ['Qinwen Zheng', '鄭欽文', 'Zheng Qinwen'],
  'Rybakina, Elena': ['Elena Rybakina', '雷巴金娜', 'Rybakina'],
}

export const toTslPlayerName = (name: string) => {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (trimmed.includes(',')) return trimmed
  const parts = trimmed.split(' ')
  if (parts.length < 2) return trimmed
  const surname = parts[parts.length - 1]!
  const given = parts.slice(0, -1).join(' ')
  return `${surname}, ${given}`
}

export const fromTslPlayerName = (name: string) => {
  const trimmed = name.trim()
  const comma = trimmed.indexOf(',')
  if (comma < 0) return trimmed
  const surname = trimmed.slice(0, comma).trim()
  const given = trimmed.slice(comma + 1).trim()
  return given ? `${given} ${surname}` : surname
}

export const tennisNameKeys = (name: string) => {
  const tsl = toTslPlayerName(name)
  const natural = fromTslPlayerName(name)
  const keys = new Set([
    foldPlayerName(name),
    foldPlayerName(tsl),
    foldPlayerName(natural),
  ])
  for (const candidate of [name, tsl, natural]) {
    const trimmed = candidate.trim()
    if (trimmed && foldPlayerName(trimmed) === '') keys.add(trimmed)
  }
  return [...keys].filter(Boolean)
}

export const aliasKeysFor = (canonicalTslName: string) => {
  const aliases = TENNIS_NAME_ALIASES[canonicalTslName] ?? []
  return [...new Set([
    ...tennisNameKeys(canonicalTslName),
    ...aliases.flatMap(tennisNameKeys),
  ])]
}

export const buildTennisAliasIndex = (players: Array<{ id: string, name: string }>) => {
  const index = new Map<string, string>()
  for (const player of players) {
    for (const key of tennisNameKeys(player.name)) {
      if (!index.has(key)) index.set(key, player.id)
    }
    const extra = TENNIS_NAME_ALIASES[toTslPlayerName(player.name)] ?? TENNIS_NAME_ALIASES[player.name]
    if (extra) {
      for (const alias of extra) {
        for (const key of tennisNameKeys(alias)) {
          if (!index.has(key)) index.set(key, player.id)
        }
      }
    }
  }
  return index
}

export const resolveTennisPlayerId = (
  names: string[],
  index: Map<string, string>,
) => {
  for (const name of names) {
    for (const key of tennisNameKeys(name)) {
      const id = index.get(key)
      if (id) return id
    }
  }
  return null
}
