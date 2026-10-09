import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runScheduledSync } from '@/lib/moneta/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Called hourly by .github/workflows/moneta-sync.yml and daily by Vercel Cron,
// both with `Authorization: Bearer $CRON_SECRET`. Failures are recorded in
// moneta_sync_state and shown as a dashboard banner.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  try {
    const result = await runScheduledSync(createAdminClient())
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started })
  } catch (err) {
    console.error('[moneta-sync] failed:', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
