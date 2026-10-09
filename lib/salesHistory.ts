import type { SupabaseClient } from '@supabase/supabase-js'
import { businessDay } from '@/lib/dates'
import type { DateRange, Transaction } from '@/lib/vendsoft'

// VendSoft's live window is ~30 days (its oldest day can be partial). Days
// older than this come from the Supabase history instead.
const LIVE_DAYS = 25

// Retired USAT terminal numbers -> current VendSoft machineCode.
const RETIRED_CODES: Record<string, string> = { '6': '26' }

export function splitRange(range: DateRange): { history: DateRange | null; live: DateRange | null } {
  const liveStart = businessDay(-LIVE_DAYS)
  const historyEnd = businessDay(-LIVE_DAYS - 1)
  return {
    history: range.from < liveStart ? { from: range.from, to: range.to < historyEnd ? range.to : historyEnd } : null,
    live: range.to >= liveStart ? { from: range.from > liveStart ? range.from : liveStart, to: range.to } : null,
  }
}

interface Row {
  source: string
  machine_label: string
  product_name: string
  quantity: number
  price: number | null
  sold_at: string
}

function machineCodeOf(r: Row): string | null {
  if (r.source === 'vendsoft') return r.machine_label
  const code = /^\[(\d+)\]/.exec(r.machine_label)?.[1]
  return code ? RETIRED_CODES[code] ?? code : null
}

async function fetchRows(sb: SupabaseClient, range: DateRange, machineCode?: string): Promise<Row[]> {
  const { data: last, error: lastErr } = await sb
    .from('sales_line_items')
    .select('sale_day')
    .eq('source', 'usat')
    .order('sale_day', { ascending: false })
    .limit(1)
  if (lastErr) throw new Error(lastErr.message)
  const usatLast = last?.[0]?.sale_day as string | undefined

  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb
      .from('sales_line_items')
      .select('source, machine_label, product_name, quantity, price, sold_at')
      .gte('sale_day', range.from)
      .lte('sale_day', range.to)
    // USAT wins for any day it covers; VendSoft snapshots fill in after.
    if (usatLast) q = q.or(`and(source.eq.usat,sale_day.lte.${usatLast}),and(source.eq.vendsoft,sale_day.gt.${usatLast})`)
    if (machineCode) {
      const codes = [machineCode, ...Object.keys(RETIRED_CODES).filter((k) => RETIRED_CODES[k] === machineCode)]
      q = q.or(codes.flatMap((c) => [`machine_label.eq.${c}`, `machine_label.like."[${c}] *"`]).join(','))
    }
    const { data, error } = await q.order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }
  return machineCode ? rows.filter((r) => machineCodeOf(r) === machineCode) : rows
}

// Line items sharing a machine and timestamp count as one purchase
// (history rows don't keep VendSoft's transactionId).
export async function getHistoryTotals(sb: SupabaseClient, range: DateRange) {
  const totals = new Map<string, { amount: number; txns: Set<string> }>()
  for (const r of await fetchRows(sb, range)) {
    const code = machineCodeOf(r)
    if (!code) continue
    const t = totals.get(code) ?? { amount: 0, txns: new Set<string>() }
    t.amount += Number(r.price ?? 0) * Number(r.quantity)
    t.txns.add(r.sold_at)
    totals.set(code, t)
  }
  return new Map(Array.from(totals, ([code, t]) => [code, { amount: t.amount, transactions: t.txns.size }]))
}

const chicagoParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function chicagoStamp(iso: string) {
  const p = Object.fromEntries(chicagoParts.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  return {
    timestamp: `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`,
    time: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`,
  }
}

export async function getHistoryTransactions(sb: SupabaseClient, machineCode: string, range: DateRange): Promise<Transaction[]> {
  const groups = new Map<string, Transaction>()
  for (const r of await fetchRows(sb, range, machineCode)) {
    const price = Number(r.price ?? 0)
    const qty = Number(r.quantity)
    const g = groups.get(r.sold_at) ?? { transactionId: r.sold_at, ...chicagoStamp(r.sold_at), items: [], amount: 0, card: false }
    g.items.push({ name: r.product_name, quantity: qty, price })
    g.amount += price * qty
    groups.set(r.sold_at, g)
  }
  return Array.from(groups.values())
}
