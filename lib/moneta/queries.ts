import type { SupabaseClient } from '@supabase/supabase-js'
import type { DateRange, SalesSummary, Transaction } from '@/lib/vendsoft'

// Moneta rows share the dashboard's machine list with VendSoft; this prefix
// keeps their machineCode distinct and routes drawer requests here.
export const MONETA_PREFIX = 'moneta:'

interface LineRow {
  cart_key: string
  machine_name: string
  product_name: string
  quantity: number
  line_amount: number
  payment_method: string | null
  sold_at: string
}

async function fetchLines(sb: SupabaseClient, range: DateRange, machineName?: string): Promise<LineRow[]> {
  const rows: LineRow[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb
      .from('moneta_transactions')
      .select('cart_key, machine_name, product_name, quantity, line_amount, payment_method, sold_at')
      .gte('sale_day', range.from)
      .lte('sale_day', range.to)
    if (machineName) q = q.eq('machine_name', machineName)
    const { data, error } = await q.order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as LineRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

/** Per-machine revenue and cart counts, including machines with no sales. */
export async function getMonetaSummaries(sb: SupabaseClient, range: DateRange): Promise<SalesSummary[]> {
  const [lines, state] = await Promise.all([
    fetchLines(sb, range),
    sb.from('moneta_sync_state').select('machines').eq('id', 'default').maybeSingle(),
  ])
  const totals = new Map<string, { amount: number; carts: Set<string> }>()
  for (const m of ((state.data?.machines as { name: string }[] | null) ?? [])) totals.set(m.name, { amount: 0, carts: new Set() })
  for (const l of lines) {
    const t = totals.get(l.machine_name) ?? { amount: 0, carts: new Set<string>() }
    t.amount += Number(l.line_amount)
    t.carts.add(l.cart_key)
    totals.set(l.machine_name, t)
  }
  return Array.from(totals, ([name, t]) => ({
    machineCode: MONETA_PREFIX + name,
    machineName: 'Moneta kiosk',
    locationName: name,
    machineType: 'Market',
    totalAmount: Math.round(t.amount * 100) / 100,
    totalTransactions: t.carts.size,
  }))
}

const stampFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Carts for one Moneta machine in the shape the transaction drawer expects. */
export async function getMonetaTransactions(sb: SupabaseClient, machineCode: string, range: DateRange): Promise<Transaction[]> {
  const machineName = machineCode.slice(MONETA_PREFIX.length)
  const carts = new Map<string, Transaction>()
  for (const l of await fetchLines(sb, range, machineName)) {
    let t = carts.get(l.cart_key)
    if (!t) {
      const p = Object.fromEntries(stampFmt.formatToParts(new Date(l.sold_at)).map((x) => [x.type, x.value]))
      t = {
        transactionId: l.cart_key,
        timestamp: `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`,
        time: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`,
        items: [],
        amount: 0,
        card: /card/i.test(l.payment_method ?? ''),
      }
      carts.set(l.cart_key, t)
    }
    const qty = Number(l.quantity)
    t.items.push({ name: l.product_name, quantity: qty, price: qty ? Number(l.line_amount) / qty : 0 })
    t.amount = Math.round((t.amount + Number(l.line_amount)) * 100) / 100
  }
  return Array.from(carts.values())
}

export interface MonetaStatus {
  alert: string | null
  lastSuccessAt: string | null
  lastError: string | null
  warning: string | null
  unmappedCount: number
}

// The hourly job should never leave this much of a gap.
const STALE_HOURS = 3

export async function getMonetaStatus(sb: SupabaseClient): Promise<MonetaStatus> {
  const [{ data: s, error }, { count }] = await Promise.all([
    sb.from('moneta_sync_state').select('*').eq('id', 'default').maybeSingle(),
    sb.from('moneta_unmapped_products').select('product_name', { count: 'exact', head: true }),
  ])
  if (error) throw new Error(error.message)
  const lastSuccess = s?.last_success_at ? Date.parse(s.last_success_at) : null
  const failing = s?.last_error && (!lastSuccess || Date.parse(s.last_error_at) > lastSuccess)
  let alert: string | null = null
  if (failing) alert = `Moneta sync is failing: ${s!.last_error}`
  else if (!lastSuccess) alert = 'Moneta sales have not synced yet.'
  else if (Date.now() - lastSuccess > STALE_HOURS * 3_600_000) {
    alert = `Moneta sales last synced ${Math.round((Date.now() - lastSuccess) / 3_600_000)} hours ago.`
  } else if (s?.warning) alert = s.warning
  return {
    alert,
    lastSuccessAt: s?.last_success_at ?? null,
    lastError: s?.last_error ?? null,
    warning: s?.warning ?? null,
    unmappedCount: count ?? 0,
  }
}
