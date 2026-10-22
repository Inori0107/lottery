const NAME_SEPARATORS = /[\s,，、.．·'’-]+/
const MAX_NAME_TOKENS = 6

export const nameTokens = (text: string) =>
  text
    .replace(/[%_]/g, '')
    .split(NAME_SEPARATORS)
    .filter(Boolean)
    .slice(0, MAX_NAME_TOKENS)

export const nameMatchClause = (column: string, tokens: string[]) =>
  tokens.map(() => `${column} LIKE ?`).join(' AND ')

export const nameMatchParams = (tokens: string[]) => tokens.map(token => `%${token}%`)
