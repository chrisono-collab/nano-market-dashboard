import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scanRestocks, snapshotVendSoft } from '@/lib/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const admin = createAdminClient()
  try {
    const sales = await snapshotVendSoft(admin)
    // Leave headroom under maxDuration for the final state writes.
    const restocks = await scanRestocks(admin, started + 240_000)
    return NextResponse.json({ ok: true, sales, restocks, ms: Date.now() - started })
  } catch (err) {
    console.error('[daily-sync] failed:', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
