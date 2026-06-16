import { NextRequest, NextResponse } from 'next/server'
import { getMachineTransactions } from '@/lib/vendsoft'
import { getDateRange, Preset } from '@/lib/dates'

// Individual transactions for one machine, in chronological order.
//   GET /api/transactions?machine=7&preset=today
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

  try {
    const transactions = await getMachineTransactions(machine, range)
    return NextResponse.json({ transactions, range })
  } catch (err: any) {
    console.error('VendSoft transactions error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
