/**
 * One-time Moneta history backfill, one week per portal request.
 *
 *   npx tsx --env-file=.env.local scripts/moneta-backfill.ts 2026-01-01 [2026-10-09]
 *   npx tsx --env-file=.env.local scripts/moneta-backfill.ts 2026-10-01 --dry-run
 *
 * --dry-run only logs in and counts carts per week (no Supabase needed), to
 * check the portal connection before running the migration.
 * Needs MONETA_EMAIL, MONETA_PASSWORD, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. Safe to re-run: carts are replaced, not duplicated.
 * Requests are sequential with a pause between weeks to keep portal load light.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { businessDay } from '@/lib/dates'
import { MonetaClient } from '@/lib/moneta/client'
import { toLines } from '@/lib/moneta/parse'
import { addDays, syncRange } from '@/lib/moneta/sync'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const [from, to = businessDay(0)] = args.filter((a) => !a.startsWith('--'))
if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error('Usage: scripts/moneta-backfill.ts <from YYYY-MM-DD> [to YYYY-MM-DD]')
  process.exit(1)
}

async function main() {
  const client = new MonetaClient({ minGapMs: 3000 })
  if (dryRun) {
    const machines = await client.getMachines()
    console.log(`Logged in. Machines: ${machines.map((m) => m.name).join(', ')}`)
    for (let start = from; start <= to; start = addDays(start, 7)) {
      const end = addDays(start, 6) < to ? addDays(start, 6) : to
      const carts = await client.getCarts(machines, start, end)
      const total = carts.reduce((s, c) => s + c.total, 0)
      console.log(`${start} -> ${end}: ${carts.length} carts, ${toLines(carts).length} lines, $${total.toFixed(2)}`)
    }
    return
  }
  const admin = createAdminClient()
  const machines = await client.getMachines()
  console.log(`Logged in. Machines: ${machines.map((m) => m.name).join(', ')}`)
  let carts = 0
  let rows = 0
  for (let start = from; start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6) < to ? addDays(start, 6) : to
    const r = await syncRange(admin, start, end, client, machines)
    carts += r.carts
    rows += r.rows
    console.log(`${start} -> ${end}: ${r.carts} carts, ${r.rows} lines (${new Date().toLocaleTimeString()})`)
  }
  // Record the run so the dashboard's sync banner reflects it.
  const { count } = await admin.from('moneta_transactions').select('id', { count: 'exact', head: true })
  await admin.from('moneta_sync_state').upsert({
    id: 'default',
    last_success_at: new Date().toISOString(),
    last_cursor: addDays(businessDay(0), -1) < to ? addDays(businessDay(0), -1) : to,
    last_error: null,
    total_rows: count ?? null,
    machines,
    updated_at: new Date().toISOString(),
  })
  console.log(`Done: ${carts} carts, ${rows} lines across ${from} -> ${to}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
