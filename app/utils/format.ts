export { disciplineLabel } from '~~/shared/sports'

export const formatPercent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)

export const formatSigned = (value: number) => (value > 0 ? `+${value}` : `${value}`)

export const formatTaipeiTime = (value: string | null) =>
  value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—'

export const apiErrorMessage = (error: unknown, fallback: string) => {
  const data = (error as { data?: { statusMessage?: string, message?: string } }).data
  return data?.statusMessage || data?.message || fallback
}
