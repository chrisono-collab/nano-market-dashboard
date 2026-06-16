export type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

export function getDateRange(preset: Preset, customFrom?: string, customTo?: string) {
  const now = new Date()
  const fmt = (d: Date) => d.toISOString().split('T')[0]

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
    case 'month': {
      const m = new Date(now)
      m.setDate(m.getDate() - 29)
      return { from: fmt(m), to: fmt(now) }
    }
    case 'custom':
      return { from: customFrom ?? fmt(now), to: customTo ?? fmt(now) }
  }
}
