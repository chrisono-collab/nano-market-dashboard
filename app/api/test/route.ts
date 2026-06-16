import { NextRequest, NextResponse } from 'next/server'
import { probeAuth } from '@/lib/vendsoft'

// Raw diagnostic endpoint. Hits GET /api/v2/machines (or ?path=...) with every
// auth strategy and returns each attempt's status + raw body so you can see
// exactly what VendSoft is returning.
//
//   GET /api/test
//   GET /api/test?path=/machines/ABC123/sales?from=2026-06-01&to=2026-06-16
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const path = searchParams.get('path') ?? '/machines'

  try {
    const result = await probeAuth(path)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
