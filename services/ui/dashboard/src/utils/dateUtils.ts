export const formatUtc = (utc?: string | null) => {
  if (!utc) return '—'
  const m = utc.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)
  if (!m) return utc
  const [_, y, mo, d, h, mi, s] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
  try {
    const dt = new Date(iso)
    return dt.toLocaleString()
  } catch {
    return utc
  }
}

export const toTime = (utc?: string | null) => {
  if (!utc) return 0
  const m = utc.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)
  if (!m) return 0
  const [_, y, mo, d, h, mi, s] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/**
 * Parse UTC string in YYYYMMDDTHHMMSSZ format to Date object
 * @param utc UTC string to parse
 * @returns Date object or null if parsing fails
 */
export function parseUtcString(utc: string): Date | null {
  const match = utc.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  return new Date(
    Date.UTC(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second || '0')
    )
  )
}

