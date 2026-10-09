import { NextRequest, NextResponse } from 'next/server'
import { getMachineTransactions } from '@/lib/vendsoft'
import { getDateRange, Preset } from '@/lib/dates'
import { getHistoryTransactions, splitRange } from '@/lib/salesHistory'
import { createClient } from '@/lib/supabase/server'

// Individual transactions for one machine, newest first.
//   GET /api/transactions?machine=7&preset=today   (or &from=YYYY-MM-DD&to=YYYY-MM-DD)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const machine = searchParams.get('machine')
  if (!machine) {
    return NextResponse.json({ error: 'machine param is required' }, { status: 400 })
  }

  const preset = (searchParams.get('preset') ?? 'today') as Preset
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? undefined
  const range = getDateRange(preset, from, to)
  const { history, live } = splitRange(range)

  try {
    const [liveTxns, historyTxns] = await Promise.all([
      live ? getMachineTransactions(machine, live) : [],
      history ? createClient().then((sb) => getHistoryTransactions(sb, machine, history)) : [],
    ])
    const transactions = [...liveTxns, ...historyTxns].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    return NextResponse.json({ transactions, range })
  } catch (err: any) {
    console.error('Transactions error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
