const TAIPEI_OFFSET = '+08:00'

const pad = (value: number) => String(value).padStart(2, '0')

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  parts.find(item => item.type === type)?.value ?? ''

export const taipeiDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hourRaw = part(parts, 'hour')
  return {
    year: part(parts, 'year'),
    month: part(parts, 'month'),
    day: part(parts, 'day'),
    hour: hourRaw === '24' ? '00' : hourRaw,
  }
}

export const taipeiDate = (date: Date) => {
  const { year, month, day } = taipeiDateParts(date)
  return `${year}-${month}-${day}`
}

export const taipeiHour = (date: Date) => Number(taipeiDateParts(date).hour)

export const addCalendarDays = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utc = Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days)
  const next = new Date(utc)
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

export const compactTaipeiDay = (date: Date) => taipeiDate(date).replaceAll('-', '')

const hasTimezone = (value: string) => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)

export const parseTslDateTime = (value: string): Date | null => {
  const text = value.trim()
  if (!text) return null

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) {
    return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00${TAIPEI_OFFSET}`)
  }

  const normalized = text.includes('T') ? text : text.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T')
  const dated = hasTimezone(normalized)
    ? normalized.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
    : /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? `${normalized}T00:00:00${TAIPEI_OFFSET}`
      : `${normalized}${TAIPEI_OFFSET}`

  const parsed = new Date(dated)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export const normalizeCouponDate = (value: string, now = new Date()) => {
  const compact = value.replaceAll('-', '').trim()
  if (/^\d{8}$/.test(compact)) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  const parsed = parseTslDateTime(value)
  return parsed ? taipeiDate(parsed) : taipeiDate(now)
}

export const inTaipeiCouponWindow = (startsAt: Date, now = new Date()) => {
  const startDay = taipeiDate(startsAt)
  const today = taipeiDate(now)
  return startDay === addCalendarDays(today, -1) || startDay === today || startDay === addCalendarDays(today, 1)
}

export const belongsOnTaipeiListingDay = (startsAt: string | Date, listingDate: string) => {
  const date = typeof startsAt === 'string' ? parseTslDateTime(startsAt) ?? new Date(startsAt) : startsAt
  if (Number.isNaN(date.getTime())) return false
  const playDate = taipeiDate(date)
  if (playDate === listingDate) return true
  return playDate === addCalendarDays(listingDate, 1) && taipeiHour(date) < 12
}
