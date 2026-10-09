import { NextRequest, NextResponse } from 'next/server'
import { getDateRange, type Preset } from '@/lib/dates'
import { getMonetaSummaries } from '@/lib/moneta/queries'
import { createClient } from '@/lib/supabase/server'

// Per-machine Moneta revenue for a range, same shape as /api/vendsoft.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const range = getDateRange(
    (searchParams.get('preset') ?? 'today') as Preset,
    searchParams.get('from') ?? undefined,
    searchParams.get('to') ?? undefined,
  )
  try {
    const data = await getMonetaSummaries(await createClient(), range)
    return NextResponse.json({ data, range })
  } catch (err: any) {
    console.error('Moneta sales error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
