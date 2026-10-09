export type Preset = 'today' | 'yesterday' | 'week' | 'mtd' | 'lastMonth'

// VendSoft transactionTime values are in local machine time (Central for ATX).
// Use this TZ for presets so "today" matches on Vercel (UTC) and locally.
const BUSINESS_TZ = 'America/Chicago'

function calendarDayInTz(date = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return { y: n('year'), m: n('month'), d: n('day') }
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Shift a calendar date by N days (timezone-agnostic calendar math). */
function shift(y: number, m: number, d: number, days: number): string {
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

export function getDateRange(preset: Preset, customFrom?: string, customTo?: string) {
  // Explicit from/to (e.g. direct API calls) always win.
  if (customFrom && customTo) return { from: customFrom, to: customTo }

  const { y, m, d } = calendarDayInTz()
  const today = fmt(y, m, d)

  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const yday = shift(y, m, d, -1)
      return { from: yday, to: yday }
    }
    case 'week':
      return { from: shift(y, m, d, -6), to: today }
    case 'mtd':
      return { from: fmt(y, m, 1), to: today }
    case 'lastMonth': {
      const firstOfThisMonth = new Date(Date.UTC(y, m - 1, 1))
      const lastOfPrev = new Date(firstOfThisMonth.getTime() - 86_400_000)
      const py = lastOfPrev.getUTCFullYear()
      const pm = lastOfPrev.getUTCMonth() + 1
      return { from: fmt(py, pm, 1), to: fmt(py, pm, lastOfPrev.getUTCDate()) }
    }
  }
}

/** Today's date in the business timezone, shifted by `days`. */
export function businessDay(days = 0): string {
  const { y, m, d } = calendarDayInTz()
  return shift(y, m, d, days)
}
