import mapping from '@/data/product-name-mapping.json'

// Ported from haha-dashboard/scripts/analyze_removal_candidates.py.

const DAY_MS = 86_400_000
// A quiet stretch this long with zero corroborating sales is not trusted as in-stock.
const NO_SALES_GAP_THRESHOLD_DAYS = 14
const SHORT_WINDOW_DAYS = 30
const TOO_NEW_DAYS = 7

export interface StockEvent {
  occurredAt: number
  afterNum: number
}

export interface Interval {
  start: number
  end: number
}

export interface StockDays {
  inStock: number
  outOfStock: number
  unknown: number
}

/**
 * Splits [windowStart, windowEnd] into in-stock / out-of-stock / unknown days
 * from restock events (afterNum = stock level after each event), corroborated
 * by sale timestamps. A stretch starting at afterNum 0 is out of stock. A
 * nonzero (or pre-first-event) stretch counts as in stock only if it is short
 * or has at least one sale; long silent stretches are unknown, not in stock
 * (the Skittles Sour case: 200 silent days that were really a stockout).
 * `dataGaps` are spans with no sales data from any source; always unknown.
 */
export function computeStockDays(
  events: StockEvent[],
  saleTimes: number[],
  windowStart: number,
  windowEnd: number,
  dataGaps: Interval[] = []
): StockDays {
  if (windowEnd <= windowStart) return { inStock: 0, outOfStock: 0, unknown: 0 }
  if (events.length === 0) return { inStock: 0, outOfStock: 0, unknown: (windowEnd - windowStart) / DAY_MS }

  const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt)
  const sales = [...saleTimes].sort((a, b) => a - b)
  const hasSaleIn = (t0: number, t1: number) => sales.some((s) => s >= t0 && s < t1)

  let levelAtStart: number | null = null
  for (const e of sorted) {
    if (e.occurredAt <= windowStart) levelAtStart = e.afterNum
    else break
  }

  const breakpoints: { t: number; level: number | null }[] = [{ t: windowStart, level: levelAtStart }]
  for (const e of sorted) {
    if (e.occurredAt > windowStart && e.occurredAt <= windowEnd) breakpoints.push({ t: e.occurredAt, level: e.afterNum })
  }
  breakpoints.push({ t: windowEnd, level: null })

  const result: StockDays = { inStock: 0, outOfStock: 0, unknown: 0 }
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const t0 = breakpoints[i].t
    const t1 = breakpoints[i + 1].t
    const level = breakpoints[i].level
    // Carve known data gaps out of the segment first.
    let gapMs = 0
    for (const g of dataGaps) gapMs += Math.max(0, Math.min(t1, g.end) - Math.max(t0, g.start))
    result.unknown += gapMs / DAY_MS
    const days = (t1 - t0 - gapMs) / DAY_MS

    if (level === 0) result.outOfStock += days
    else if (days <= NO_SALES_GAP_THRESHOLD_DAYS || hasSaleIn(t0, t1)) result.inStock += days
    else result.unknown += days
  }
  return result
}

type DirectEntry = { salesName: string; displayName?: string }
type AggregateEntry = { salesNames: string[]; displayName?: string }
const DIRECT = mapping.direct as Record<string, DirectEntry>
const AGGREGATE = mapping.aggregate as Record<string, AggregateEntry>
const DISCONTINUED = mapping.discontinued as Record<string, unknown>

export function normName(s: string): string {
  return s.toLowerCase().replace(/’/g, "'").replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface SaleRow {
  productName: string
  quantity: number
  soldAt: number
}

export interface PlanogramProduct {
  productId: string
  hahaName: string
}

export interface VelocityRow {
  productId: string
  name: string
  subName: string | null
  salesSkus: string[]
  unitsSold: number | null
  velocity: number | null
  daysInStock: number | null
  daysOutOfStock: number | null
  daysUnknown: number | null
  windowStart: string | null
  atHistoryHorizon: boolean
  isAggregateEstimate: boolean
  lowConfidenceShortWindow: boolean
  lowConfidenceMuchUnknown: boolean
  tooNew: boolean
  noDataReason: 'UNMAPPED' | 'NO_RESTOCK_HISTORY' | null
}

export interface MachineReport {
  salesStart: string | null
  salesEnd: string | null
  rows: VelocityRow[]
  discontinuedCount: number
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d
const isoDay = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(t))

export { isoDay }

export function buildMachineReport(
  products: PlanogramProduct[],
  sales: SaleRow[],
  eventsByProduct: Map<string, StockEvent[]>,
  dataGaps: Interval[]
): MachineReport {
  const qtyByName = new Map<string, number>()
  const timesByName = new Map<string, number[]>()
  const normToName = new Map<string, string>()
  let salesStart = Infinity
  let salesEnd = -Infinity
  for (const s of sales) {
    qtyByName.set(s.productName, (qtyByName.get(s.productName) ?? 0) + s.quantity)
    const arr = timesByName.get(s.productName) ?? []
    arr.push(s.soldAt)
    timesByName.set(s.productName, arr)
    normToName.set(normName(s.productName), s.productName)
    salesStart = Math.min(salesStart, s.soldAt)
    salesEnd = Math.max(salesEnd, s.soldAt)
  }

  let historyStartsAt = Infinity
  eventsByProduct.forEach((evs) => {
    for (const e of evs) historyStartsAt = Math.min(historyStartsAt, e.occurredAt)
  })

  const rows: VelocityRow[] = []
  let discontinuedCount = 0

  for (const { productId, hahaName } of products) {
    if (DISCONTINUED[productId]) {
      discontinuedCount++
      continue
    }
    const direct = DIRECT[productId]
    const aggregate = AGGREGATE[productId]
    const isAggregateEstimate = Boolean(aggregate)
    const salesSkus = direct
      ? [direct.salesName]
      : aggregate
        ? aggregate.salesNames
        : normToName.has(normName(hahaName))
          ? [normToName.get(normName(hahaName))!]
          : []
    const name = direct?.displayName ?? aggregate?.displayName ?? direct?.salesName ?? hahaName
    const blank: VelocityRow = {
      productId,
      name,
      subName: isAggregateEstimate && name !== hahaName ? hahaName : null,
      salesSkus,
      unitsSold: null,
      velocity: null,
      daysInStock: null,
      daysOutOfStock: null,
      daysUnknown: null,
      windowStart: null,
      atHistoryHorizon: false,
      isAggregateEstimate,
      lowConfidenceShortWindow: false,
      lowConfidenceMuchUnknown: false,
      tooNew: false,
      noDataReason: null,
    }

    const events = eventsByProduct.get(productId) ?? []
    if (salesSkus.length === 0) {
      rows.push({ ...blank, noDataReason: 'UNMAPPED' })
      continue
    }
    if (events.length === 0 || !Number.isFinite(salesStart)) {
      rows.push({ ...blank, noDataReason: 'NO_RESTOCK_HISTORY' })
      continue
    }

    const earliest = Math.min(...events.map((e) => e.occurredAt))
    const atHistoryHorizon = earliest === historyStartsAt
    const windowStart = atHistoryHorizon ? salesStart : Math.max(earliest, salesStart)
    const units = salesSkus.reduce((sum, n) => sum + (qtyByName.get(n) ?? 0), 0)
    const times = salesSkus.flatMap((n) => timesByName.get(n) ?? [])
    const days = computeStockDays(events, times, windowStart, salesEnd, dataGaps)
    const daysObserved = Math.max(0, (salesEnd - windowStart) / DAY_MS)
    const tooNew = daysObserved < TOO_NEW_DAYS

    rows.push({
      ...blank,
      unitsSold: units,
      velocity: !tooNew && days.inStock >= 0.5 ? round(units / days.inStock, 3) : null,
      daysInStock: round(days.inStock, 1),
      daysOutOfStock: round(days.outOfStock, 1),
      daysUnknown: round(days.unknown, 1),
      windowStart: isoDay(windowStart),
      atHistoryHorizon,
      lowConfidenceShortWindow: daysObserved < SHORT_WINDOW_DAYS,
      lowConfidenceMuchUnknown: daysObserved > 0 && days.unknown / daysObserved > 0.25,
      tooNew,
    })
  }

  return {
    salesStart: Number.isFinite(salesStart) ? isoDay(salesStart) : null,
    salesEnd: Number.isFinite(salesEnd) ? isoDay(salesEnd) : null,
    rows,
    discontinuedCount,
  }
}
