import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runScheduledSync } from '@/lib/moneta/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Freshness when someone is looking: GitHub's "hourly" schedule actually fires
// every 4-7 hours, so the dashboard calls this when Moneta data is stale.
// Session-gated by middleware like every other /api route.
const FRESH_MS = 30 * 60_000
const IN_PROGRESS_MS = 2 * 60_000

export async function POST() {
  const admin = createAdminClient()
  const { data: s } = await admin.from('moneta_sync_state').select('last_attempt_at, last_success_at').eq('id', 'default').maybeSingle()
  const lastSuccess = s?.last_success_at ? Date.parse(s.last_success_at) : 0
  const lastAttempt = s?.last_attempt_at ? Date.parse(s.last_attempt_at) : 0
  if (Date.now() - lastSuccess < FRESH_MS) return NextResponse.json({ ok: true, skipped: 'fresh' })
  if (lastAttempt > lastSuccess && Date.now() - lastAttempt < IN_PROGRESS_MS) return NextResponse.json({ ok: true, skipped: 'in progress' })
  try {
    return NextResponse.json({ ok: true, ...(await runScheduledSync(admin)) })
  } catch (err) {
    console.error('[moneta-refresh] failed:', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
