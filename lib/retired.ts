// Locations we no longer operate. Once a date range starts on or after
// `from`, the location is hidden unless it actually had sales in that range,
// so older ranges (and any trailing sales) still show it.
const RETIRED_LOCATIONS: { match: RegExp; from: string }[] = [
  { match: /johnstone/i, from: '2026-11-01' }, // Johnstone + Johnstone Metric, sold Nov 2026
]

export function isHiddenRetired(
  row: { machineName: string; locationName: string; totalAmount: number; totalTransactions: number },
  rangeFrom: string | undefined
): boolean {
  if (!rangeFrom || row.totalAmount !== 0 || row.totalTransactions !== 0) return false
  const name = `${row.locationName} ${row.machineName}`
  return RETIRED_LOCATIONS.some((r) => r.match.test(name) && rangeFrom >= r.from)
}
