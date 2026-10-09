import type { SupabaseClient } from '@supabase/supabase-js'
import { getAllMarkets, getPlanogram } from '@/lib/haha/api'
import mapping from '@/data/product-name-mapping.json'
import addresses from '@/data/machine-addresses.json'
import { buildMachineReport, isoDay, normName, type Interval, type MachineReport, type StockEvent } from '@/lib/velocity'

const PAGE = 1000

function addressOf(m: { marketId: string; marketLocation?: unknown }): string {
  return (addresses as Record<string, string>)[m.marketId] ?? String(m.marketLocation ?? '')
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

async function edgeSale(sb: SupabaseClient, source: string, ascending: boolean) {
  const { data, error } = await sb
    .from('sales_line_items')
    .select('sold_at, sale_day')
    .eq('source', source)
    .order('sold_at', { ascending })
    .limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] ?? null
}

export interface MachineReportResult extends MachineReport {
  marketId: string
  marketName: string
  marketLocation: string
  dataGaps: { start: string; end: string }[]
}

export async function loadMachineReport(sb: SupabaseClient, marketId: string): Promise<MachineReportResult | null> {
  const markets = await getAllMarkets()
  const market = markets.find((m) => m.marketId === marketId)
  if (!market) return null

  const [planogram, usatLast, vendsoftFirst, events] = await Promise.all([
    getPlanogram(marketId),
    edgeSale(sb, 'usat', false),
    edgeSale(sb, 'vendsoft', true),
    fetchAll<{ product_id: string; occurred_at: string; after_num: number }>((a, b) =>
      sb.from('restock_events').select('product_id, occurred_at, after_num').eq('market_id', marketId).order('occurred_at').range(a, b)
    ),
  ])

  // USAT takes precedence for any day it covers; VendSoft fills in after.
  const sales = await fetchAll<{ product_name: string; quantity: number; sold_at: string; source: string; sale_day: string }>((a, b) =>
    sb.from('sales_line_items').select('product_name, quantity, sold_at, source, sale_day').eq('market_id', marketId).order('id').range(a, b)
  )
  const usatLastDay = usatLast?.sale_day ?? ''
  const usable = sales.filter((s) => s.source === 'usat' || s.sale_day > usatLastDay)

  const dataGaps: Interval[] = []
  if (usatLast && vendsoftFirst) {
    const start = new Date(usatLast.sold_at).getTime()
    const end = new Date(vendsoftFirst.sold_at).getTime()
    if (end - start > 86_400_000) dataGaps.push({ start, end })
  }

  const products = new Map<string, string>()
  for (const rack of planogram.racks ?? []) {
    for (const cell of rack.cells ?? []) {
      if (cell.productId && !products.has(cell.productId)) products.set(cell.productId, cell.productName ?? cell.productId)
    }
  }

  const eventsByProduct = new Map<string, StockEvent[]>()
  for (const e of events) {
    const list = eventsByProduct.get(e.product_id) ?? []
    list.push({ occurredAt: new Date(e.occurred_at).getTime(), afterNum: Number(e.after_num) })
    eventsByProduct.set(e.product_id, list)
  }

  // Unmapped products with no sales here: look for their exact name (any case)
  // in other machines' sales.
  const localNames = new Set(usable.map((s) => normName(s.product_name)))
  const unresolved = Array.from(products.entries()).filter(
    ([id, name]) => !(id in mapping.direct) && !(id in mapping.aggregate) && !localNames.has(normName(name))
  )
  const otherSalesNames = (
    await Promise.all(
      unresolved.map(async ([, name]) => {
        const { data, error } = await sb
          .from('sales_line_items')
          .select('product_name')
          .ilike('product_name', name.replace(/[\\%_]/g, (c) => `\\${c}`))
          .limit(1)
        if (error) throw new Error(error.message)
        return data?.[0]?.product_name as string | undefined
      })
    )
  ).filter((n): n is string => Boolean(n))

  const report = buildMachineReport(
    Array.from(products, ([productId, hahaName]) => ({ productId, hahaName })),
    usable.map((s) => ({ productName: s.product_name, quantity: Number(s.quantity), soldAt: new Date(s.sold_at).getTime() })),
    eventsByProduct,
    dataGaps,
    otherSalesNames
  )

  return {
    ...report,
    marketId,
    marketName: market.marketName,
    marketLocation: addressOf(market),
    dataGaps: dataGaps.map((g) => ({ start: isoDay(g.start), end: isoDay(g.end) })),
  }
}

export async function listMachines() {
  const markets = await getAllMarkets()
  return markets
    .map((m) => ({ marketId: m.marketId, marketName: m.marketName, marketLocation: addressOf(m) }))
    .sort((a, b) => a.marketName.localeCompare(b.marketName))
}
