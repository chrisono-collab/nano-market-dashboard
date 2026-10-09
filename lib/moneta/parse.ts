/**
 * Moneta Market report parsing. Pure functions only (no I/O), shared by the
 * API sync (Reports/GetReportData JSON) and the manual CSV/Excel upload path.
 *
 * A Moneta "Shopping Cart" report row is one cart: products are joined with
 * "<br>" (a product bought twice appears twice), and money fields are cart
 * totals. There is no per-item price, so multi-product carts get their total
 * split across lines by reference unit prices (see toLines).
 */
import { createHash } from 'node:crypto'

export const BUSINESS_TZ = 'America/Chicago'

export class MonetaShapeError extends Error {
  constructor(message: string, readonly sample?: string) {
    super(message)
    this.name = 'MonetaShapeError'
  }
}

export interface MonetaCartItem {
  name: string
  quantity: number
}

export interface MonetaCart {
  /** Stable id shared by API and export rows: hash of machine, time, total. */
  cartKey: string
  transactionId: string | null
  machineId: string | null
  machineName: string
  soldAt: string // ISO UTC
  saleDay: string // YYYY-MM-DD, Central calendar day
  paymentMethod: string
  total: number
  unitCost: number
  profit: number
  promotion: number
  items: MonetaCartItem[]
  /** Source row with customer info removed. */
  raw: Record<string, unknown>
}

export interface MonetaLine {
  cart_key: string
  line_no: number
  transaction_id: string | null
  machine_id: string | null
  machine_name: string
  product_name: string
  quantity: number
  line_amount: number
  amount_allocated: boolean
  cart_total: number
  cart_unit_cost: number
  cart_profit: number
  cart_promotion: number
  payment_method: string
  sold_at: string
  sale_day: string
  raw: Record<string, unknown>
}

// Customer-identifying fields never leave the parser.
const PII_FIELDS = ['UserInformation']

const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const cents = (n: number) => Math.round(n * 100) / 100

/* ---------------------------- time zone ---------------------------- */

const tzParts = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function wallClock(ms: number) {
  const p = Object.fromEntries(tzParts.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]))
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second }
}

/** Central wall-clock time -> UTC Date (DST-aware). */
export function centralToUtc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const offsetAt = (ms: number) => {
    const w = wallClock(ms)
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - ms
  }
  let t = guess - offsetAt(guess)
  const second = offsetAt(t)
  if (guess - second !== t) t = guess - second
  return new Date(t)
}

export function centralDay(iso: string): string {
  const w = wallClock(Date.parse(iso))
  return `${w.y}-${String(w.mo).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`
}

/**
 * Moneta timestamps are Central wall-clock, e.g. "10/9/2026 2:48:31 PM".
 * Excel cells may instead arrive as Date objects holding that wall-clock in UTC.
 */
export function parseMonetaDate(v: unknown): Date {
  if (v instanceof Date) {
    return centralToUtc(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds())
  }
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)\s*$/i.exec(String(v ?? ''))
  if (!m) throw new MonetaShapeError(`Unrecognized Moneta date: ${JSON.stringify(v)}`)
  let h = Number(m[4]) % 12
  if (m[7].toUpperCase() === 'PM') h += 12
  return centralToUtc(Number(m[3]), Number(m[1]), Number(m[2]), h, Number(m[5]), Number(m[6] ?? 0))
}

/** "MM-DD-YYYY hh:mm AM" as the report form sends it. */
export function portalDate(day: string, endOfDay: boolean): string {
  const [y, m, d] = day.split('-')
  return `${m}-${d}-${y} ${endOfDay ? '11:59 PM' : '12:00 AM'}`
}

/* ----------------------------- carts ------------------------------ */

export function cartKeyOf(machineName: string, soldAtIso: string, total: number): string {
  return createHash('sha1').update(`${machineName.trim().toLowerCase()}|${soldAtIso}|${total.toFixed(2)}`).digest('hex').slice(0, 24)
}

const ENTITIES: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ' }

/** The API HTML-encodes names ("Trader Joe&apos;s"); exports do not. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

export function groupItems(names: string[]): MonetaCartItem[] {
  const counts = new Map<string, number>()
  for (const raw of names) {
    const name = decodeEntities(raw).replace(/\s+/g, ' ').trim()
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts, ([name, quantity]) => ({ name, quantity }))
}

const stripPii = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !PII_FIELDS.includes(k)))

function buildCart(row: Record<string, unknown>, items: MonetaCartItem[], machineIds: Map<string, string>): MonetaCart {
  const machineName = decodeEntities(String(row.Machine ?? '')).trim()
  if (!machineName) throw new MonetaShapeError('Cart row has no Machine', JSON.stringify(stripPii(row)).slice(0, 200))
  const soldAt = parseMonetaDate(row.RegistrationDateTime).toISOString()
  const total = cents(num(row.TotalAmount))
  return {
    cartKey: cartKeyOf(machineName, soldAt, total),
    transactionId: row.TransactionId ? String(row.TransactionId) : null,
    machineId: machineIds.get(machineName) ?? null,
    machineName,
    soldAt,
    saleDay: centralDay(soldAt),
    paymentMethod: String(row.PaymentMethods ?? '').trim(),
    total,
    unitCost: cents(num(row.UnitCost)),
    profit: cents(num(row.Profit)),
    promotion: cents(num(row.PromotionAmount)),
    // Keep the money even if Moneta lists no products for the cart.
    items: items.length ? items : [{ name: '(no products listed)', quantity: 1 }],
    raw: stripPii(row),
  }
}

const REQUIRED = ['Machine', 'Products', 'TotalAmount', 'RegistrationDateTime'] as const

/**
 * Parse the body of POST Reports/GetReportData (ReportType=ShoppingCart).
 * The endpoint answers text/plain: a JSON array, or a "No Data..." message.
 */
export function parseReportData(body: string, machineIds = new Map<string, string>()): MonetaCart[] {
  const text = body.trim()
  if (!text || /^"?No Data/i.test(text)) return []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new MonetaShapeError('GetReportData did not return JSON', text.slice(0, 200))
  }
  if (typeof data === 'string') return parseReportData(data, machineIds) // double-encoded
  if (!Array.isArray(data)) throw new MonetaShapeError('GetReportData returned a non-array', text.slice(0, 200))
  return data.map((row, i) => {
    if (!row || typeof row !== 'object') throw new MonetaShapeError(`Row ${i} is not an object`)
    const r = row as Record<string, unknown>
    const missing = REQUIRED.filter((k) => !(k in r))
    if (missing.length) throw new MonetaShapeError(`Row ${i} is missing ${missing.join(', ')}`, Object.keys(r).join(','))
    return buildCart(r, groupItems(String(r.Products ?? '').split(/<br\s*\/?>/i)), machineIds)
  })
}

/**
 * Split an export's Products cell. The portal's Excel/CSV export joins
 * product names with plain spaces, so it is matched greedily (longest first)
 * against names already seen via the API. Unknown text stays one item.
 */
export function splitExportProducts(cell: string, knownNames: Iterable<string>): string[] {
  if (/<br\s*\/?>/i.test(cell)) return cell.split(/<br\s*\/?>/i)
  const words = cell.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const known = new Map<number, Set<string>>() // word count -> lowercased names
  let longest = 0
  for (const n of Array.from(knownNames)) {
    const w = n.replace(/\s+/g, ' ').trim().toLowerCase()
    if (!w) continue
    const len = w.split(' ').length
    longest = Math.max(longest, len)
    if (!known.has(len)) known.set(len, new Set())
    known.get(len)!.add(w)
  }
  const out: string[] = []
  let unknown: string[] = []
  for (let i = 0; i < words.length; ) {
    let matched = 0
    for (let len = Math.min(longest, words.length - i); len > 0; len--) {
      if (known.get(len)?.has(words.slice(i, i + len).join(' ').toLowerCase())) {
        matched = len
        break
      }
    }
    if (matched) {
      if (unknown.length) out.push(unknown.join(' '))
      unknown = []
      out.push(words.slice(i, i + matched).join(' '))
      i += matched
    } else {
      unknown.push(words[i++])
    }
  }
  if (unknown.length) out.push(unknown.join(' '))
  return out
}

/**
 * Parse a Shopping Cart export (Excel or CSV) given as a grid of cells.
 * Layout: title rows, a header row (Machine, Products, ...), cart rows, then
 * a "TOTALS = ..." row.
 */
export function parseExportRows(
  grid: unknown[][],
  knownNames: Iterable<string> = [],
  machineIds = new Map<string, string>(),
): MonetaCart[] {
  const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : v)
  const headerIdx = grid.findIndex((r) => {
    const names = r.map((c) => String(cell(c)).trim())
    return names.includes('Machine') && names.includes('TotalAmount')
  })
  if (headerIdx < 0) throw new MonetaShapeError('No header row with Machine and TotalAmount; is this a Shopping Cart Report export?')
  const header = grid[headerIdx].map((c) => String(cell(c)).trim())
  const missing = REQUIRED.filter((k) => !header.includes(k))
  if (missing.length) throw new MonetaShapeError(`Export is missing column(s): ${missing.join(', ')}`)
  const known = Array.from(knownNames)
  const carts: MonetaCart[] = []
  for (const r of grid.slice(headerIdx + 1)) {
    const row: Record<string, unknown> = {}
    header.forEach((h, i) => h && (row[h] = cell(r[i])))
    const machine = String(row.Machine ?? '').trim()
    if (!machine || /^TOTALS\b/i.test(machine)) continue
    carts.push(buildCart(row, groupItems(splitExportProducts(String(row.Products ?? ''), known)), machineIds))
  }
  return carts
}

/** Minimal RFC 4180 CSV reader (quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') field += s[++i]
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') (row.push(field), (field = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) (row.push(field), rows.push(row))
  return rows
}

/* ------------------------------ lines ----------------------------- */

/**
 * Expand carts into one line per distinct product. Single-product carts get
 * their exact total. Multi-product carts split the total in proportion to
 * reference unit prices (median single-product price per name), falling back
 * to an even split for names with no reference; those lines are flagged
 * amount_allocated. Line amounts always sum to the cart total.
 */
export function toLines(carts: MonetaCart[], refPrices = new Map<string, number>()): MonetaLine[] {
  const refs = new Map(refPrices)
  // Learn from single-product carts in this batch too.
  const seen = new Map<string, number[]>()
  for (const c of carts) {
    if (c.items.length === 1 && c.items[0].quantity > 0 && !refs.has(c.items[0].name)) {
      const list = seen.get(c.items[0].name) ?? []
      list.push(c.total / c.items[0].quantity)
      seen.set(c.items[0].name, list)
    }
  }
  seen.forEach((list, name) => {
    list.sort((a, b) => a - b)
    refs.set(name, list[Math.floor(list.length / 2)])
  })

  const lines: MonetaLine[] = []
  for (const c of carts) {
    const allocated = c.items.length > 1
    const weights = c.items.map((it) => (refs.get(it.name) ?? 0) * it.quantity)
    const useWeights = weights.every((w) => w > 0)
    const units = c.items.reduce((s, it) => s + it.quantity, 0)
    const sum = useWeights ? weights.reduce((a, b) => a + b, 0) : units
    let remaining = c.total
    c.items.forEach((it, i) => {
      const last = i === c.items.length - 1
      const share = useWeights ? weights[i] : it.quantity
      const amount = last ? cents(remaining) : cents((c.total * share) / (sum || 1))
      remaining -= amount
      lines.push({
        cart_key: c.cartKey,
        line_no: i,
        transaction_id: c.transactionId,
        machine_id: c.machineId,
        machine_name: c.machineName,
        product_name: it.name,
        quantity: it.quantity,
        line_amount: amount,
        amount_allocated: allocated,
        cart_total: c.total,
        cart_unit_cost: c.unitCost,
        cart_profit: c.profit,
        cart_promotion: c.promotion,
        payment_method: c.paymentMethod,
        sold_at: c.soldAt,
        sale_day: c.saleDay,
        raw: c.raw,
      })
    })
  }
  return lines
}
