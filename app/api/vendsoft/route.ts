import { NextRequest, NextResponse } from 'next/server'
import { getAllLocationsSales, getMachines, type SalesSummary } from '@/lib/vendsoft'
import { getDateRange, Preset } from '@/lib/dates'
import { getHistoryTotals, splitRange } from '@/lib/salesHistory'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customFrom = searchParams.get('from') ?? undefined
  const customTo = searchParams.get('to') ?? undefined
  // Explicit from/to (YYYY-MM-DD) always wins; otherwise fall back to a preset.
  const preset = (searchParams.get('preset') ?? 'today') as Preset

  const range = getDateRange(preset, customFrom, customTo)
  const { history, live } = splitRange(range)

  try {
    // Recent days come live from VendSoft; older days from the Supabase history.
    const [liveData, historyTotals] = await Promise.all([
      live
        ? getAllLocationsSales(live)
        : getMachines().then((ms) =>
            ms.map<SalesSummary>((m) => ({
              machineCode: m.machineCode,
              machineName: m.machineName,
              locationName: m.locationName || m.machineName,
              machineType: m.machineType,
              totalAmount: 0,
              totalTransactions: 0,
            }))
          ),
      history ? createClient().then((sb) => getHistoryTotals(sb, history)) : null,
    ])

    const data = historyTotals
      ? liveData.map((d) => {
          const h = historyTotals.get(String(d.machineCode))
          return h ? { ...d, totalAmount: d.totalAmount + h.amount, totalTransactions: d.totalTransactions + h.transactions } : d
        })
      : liveData
    return NextResponse.json({ data, range })
  } catch (err: any) {
    console.error('Sales error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
