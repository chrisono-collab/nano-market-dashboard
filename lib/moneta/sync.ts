import type { SupabaseClient } from '@supabase/supabase-js'
import { businessDay } from '@/lib/dates'
import { MonetaClient, type MonetaMachine } from './client'
import { centralToUtc, toLines, type MonetaCart } from './parse'

// Re-pull this many days before the last synced day: catches late kiosk
// uploads and carts voided after we first saw them.
const OVERLAP_DAYS = 2
// With no prior sync, the hourly job starts this far back (backfill covers more).
const FIRST_SYNC_DAYS = 30
// A day "normally has sales" when the trailing average is at least this.
const MIN_DAILY_CARTS_FOR_ALERT = 2

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const dayBounds = (from: string, to: string) => {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return { start: centralToUtc(fy, fm, fd).toISOString(), end: centralToUtc(ty, tm, td, 23, 59, 59).toISOString() }
}

async function refPrices(admin: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await admin.from('moneta_ref_prices').select('product_name, unit_price')
  if (error) throw new Error(`moneta_ref_prices: ${error.message}`)
  return new Map((data ?? []).map((r: any) => [r.product_name as string, Number(r.unit_price)]))
}

/** Write carts as lines. API syncs also prune carts gone from [from, to]. */
export async function applyCarts(
  admin: SupabaseClient,
  carts: MonetaCart[],
  source: 'api' | 'upload',
  window?: { from: string; to: string },
): Promise<number> {
  const lines = toLines(carts, await refPrices(admin))
  // Only prune on a non-empty pull: an empty response could be a portal hiccup.
  const prune = source === 'api' && window && carts.length ? dayBounds(window.from, window.to) : null
  // Large writes (uploads) go in chunks that keep each cart's lines together.
  // Pruning needs the full cart set, so it only runs when one chunk holds it;
  // sync windows (days to a week) are far below the chunk size.
  const CHUNK = 2000
  const chunks: (typeof lines)[] = []
  for (let i = 0; i < lines.length; ) {
    let j = Math.min(i + CHUNK, lines.length)
    while (j < lines.length && lines[j].cart_key === lines[j - 1].cart_key) j++
    chunks.push(lines.slice(i, j))
    i = j
  }
  const pruneNow = prune && chunks.length === 1 ? prune : null
  let written = 0
  for (const chunk of chunks) {
    const { data, error } = await admin.rpc('moneta_apply_sync', {
      p_rows: chunk,
      p_source: source,
      p_prune_from: pruneNow?.start ?? null,
      p_prune_to: pruneNow?.end ?? null,
    })
    if (error) throw new Error(`moneta_apply_sync: ${error.message}`)
    written += Number(data ?? 0)
  }
  return written
}

export interface MonetaSyncResult {
  from: string
  to: string
  carts: number
  rows: number
  machines: MonetaMachine[]
}

/** Pull and store whole Central days [from, to]. */
export async function syncRange(
  admin: SupabaseClient,
  from: string,
  to: string,
  client = new MonetaClient(),
  knownMachines?: MonetaMachine[],
): Promise<MonetaSyncResult> {
  const machines = knownMachines ?? (await client.getMachines())
  const carts = await client.getCarts(machines, from, to)
  const rows = await applyCarts(admin, carts, 'api', { from, to })
  return { from, to, carts: carts.length, rows, machines }
}

/** Yesterday had no carts although the trailing two weeks usually do. */
async function volumeWarning(admin: SupabaseClient): Promise<string | null> {
  const yesterday = businessDay(-1)
  const since = businessDay(-15)
  const { data, error } = await admin
    .from('moneta_transactions')
    .select('cart_key, sale_day')
    .gte('sale_day', since)
    .lte('sale_day', yesterday)
    .eq('line_no', 0)
    .limit(10000)
  if (error) throw new Error(`volume check: ${error.message}`)
  const rows = data ?? []
  const yesterdayCarts = rows.filter((r: any) => r.sale_day === yesterday).length
  const priorAvg = (rows.length - yesterdayCarts) / 14
  if (yesterdayCarts === 0 && priorAvg >= MIN_DAILY_CARTS_FOR_ALERT) {
    return `No Moneta sales recorded for ${yesterday}; the past two weeks averaged ${priorAvg.toFixed(1)} carts/day.`
  }
  return null
}

async function setState(admin: SupabaseClient, patch: Record<string, unknown>) {
  const { error } = await admin.from('moneta_sync_state').upsert({ id: 'default', ...patch, updated_at: new Date().toISOString() })
  if (error) console.error('[moneta-sync] could not write sync state:', error.message)
}

/** The scheduled job: from (last synced day - overlap) through today. */
export async function runScheduledSync(admin: SupabaseClient) {
  const now = new Date().toISOString()
  await setState(admin, { last_attempt_at: now })
  const { data: state } = await admin.from('moneta_sync_state').select('last_cursor').eq('id', 'default').maybeSingle()
  const today = businessDay(0)
  const cursor = (state?.last_cursor as string | null) ?? businessDay(-FIRST_SYNC_DAYS)
  const from = addDays(cursor, -OVERLAP_DAYS)
  try {
    const result = await syncRange(admin, from, today)
    const warning = await volumeWarning(admin)
    const { count } = await admin.from('moneta_transactions').select('id', { count: 'exact', head: true })
    await setState(admin, {
      last_success_at: new Date().toISOString(),
      // Today is still in progress, so the next run re-covers it via the overlap.
      last_cursor: addDays(today, -1),
      last_error: null,
      last_cart_count: result.carts,
      last_row_count: result.rows,
      total_rows: count ?? null,
      warning,
      machines: result.machines,
    })
    if (warning) console.warn('[moneta-sync]', warning)
    return { ...result, machines: result.machines.length, warning }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    await setState(admin, { last_error: message, last_error_at: new Date().toISOString() })
    throw err
  }
}

export { addDays }
