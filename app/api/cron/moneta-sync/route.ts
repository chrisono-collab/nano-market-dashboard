import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runScheduledSync, scheduleSkipReason } from '@/lib/moneta/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Called every 30 min by Supabase pg_cron (supabase/moneta-schedule.sql), with
// GitHub Actions and a daily Vercel Cron as backups, all sending
// `Authorization: Bearer $CRON_SECRET`. Runs every 30 min 6am-11pm Central and
// every 3 h overnight; extra calls are skipped. Failures are recorded in
// moneta_sync_state and shown as a dashboard banner.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  try {
    const admin = createAdminClient()
    const skip = await scheduleSkipReason(admin)
    if (skip) return NextResponse.json({ ok: true, skipped: skip })
    const result = await runScheduledSync(admin)
    return NextResponse.json({ ok: true, ...result, ms: Date.now() - started })
  } catch (err) {
    console.error('[moneta-sync] failed:', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
