export type Preset = 'today' | 'yesterday' | 'week' | 'mtd'

export function getDateRange(preset: Preset, customFrom?: string, customTo?: string) {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  // Explicit from/to (e.g. direct API calls) always win.
  if (customFrom && customTo) return { from: customFrom, to: customTo }

  switch (preset) {
    case 'today':
      return { from: fmt(now), to: fmt(now) }
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { from: fmt(y), to: fmt(y) }
    }
    case 'week': {
      const w = new Date(now)
      w.setDate(w.getDate() - 6)
      return { from: fmt(w), to: fmt(now) }
    }
    case 'mtd': {
      // Month to date: 1st of the current month → today.
      const today = fmt(now)
      return { from: today.slice(0, 8) + '01', to: today }
    }
  }
}
