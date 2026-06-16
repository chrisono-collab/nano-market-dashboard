import { NextRequest, NextResponse } from 'next/server'
import { getAllLocationsSales } from '@/lib/vendsoft'
import { getDateRange, Preset } from '@/lib/dates'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customFrom = searchParams.get('from') ?? undefined
  const customTo = searchParams.get('to') ?? undefined
  // Explicit from/to (YYYY-MM-DD) always wins; otherwise fall back to a preset.
  const preset = (searchParams.get('preset') ?? 'today') as Preset

  const range = getDateRange(preset, customFrom, customTo)

  try {
    const data = await getAllLocationsSales(range)
    return NextResponse.json({ data, range })
  } catch (err: any) {
    console.error('VendSoft error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
