import type { SupabaseClient } from '@supabase/supabase-js'
import { getMachines, getRawMachineSales } from '@/lib/vendsoft'
import { getAllMarkets, getRestockOperationLogDetail, getRestockRecordsSince } from '@/lib/haha/api'
import { HahaApiError, sleep } from '@/lib/haha/client'

// ~67 req/min against HaHa's ~100/min per-API-type quota.
const RESTOCK_DETAIL_DELAY_MS = 900
// VendSoft ingests machine telemetry hours late, so recent days keep changing.
const RESNAPSHOT_DAYS = 7

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function insertChunked(admin: SupabaseClient, table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + 1000))
    if (error) throw new Error(`${table} insert failed: ${error.message}`)
  }
}

/**
 * Replaces stored VendSoft rows for recent completed days with VendSoft's
 * current data. The oldest day in VendSoft's window may be cut off mid-day,
 * so it is only written if nothing is stored for it yet.
 */
export async function snapshotVendSoft(admin: SupabaseClient) {
  const today = chicagoToday()
  const machines = await getMachines()
  const byDay = new Map<string, object[]>()
  let skippedNoMarket = 0

  for (const m of machines) {
    for (const row of await getRawMachineSales(m.machineCode)) {
      const t = String(row?.transactionTime ?? '')
      if (!/^\d{14}$/.test(t)) continue
      if (!row?.telemetryId) {
        skippedNoMarket++
        continue
      }
      const day = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
      if (day >= today) continue
      const rows = byDay.get(day) ?? []
      rows.push({
        source: 'vendsoft',
        market_id: String(row.telemetryId),
        machine_label: String(m.machineCode),
        product_name: String(row.productName ?? row.productCode ?? 'Item'),
        quantity: Number(row.quantity ?? 1) || 1,
        price: Number(row.price ?? 0) || 0,
        sold_at: `${day} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)} America/Chicago`,
        sale_day: day,
      })
      byDay.set(day, rows)
    }
  }

  const days = Array.from(byDay.keys()).sort()
  const oldest = days[0]
  const cutoff = addDays(today, -RESNAPSHOT_DAYS)
  const written: string[] = []

  for (const day of days) {
    const { count, error } = await admin
      .from('sales_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'vendsoft')
      .eq('sale_day', day)
    if (error) throw new Error(`count failed: ${error.message}`)
    const stored = (count ?? 0) > 0
    if (stored && (day === oldest || day < cutoff)) continue

    const del = await admin.from('sales_line_items').delete().eq('source', 'vendsoft').eq('sale_day', day)
    if (del.error) throw new Error(`delete failed: ${del.error.message}`)
    await insertChunked(admin, 'sales_line_items', byDay.get(day)!)
    written.push(day)
  }

  return { daysWritten: written, skippedRowsWithoutTelemetryId: skippedNoMarket }
}

/** Incremental HaHa restock-event scan, oldest-first, stopping at `deadline` (ms epoch). */
export async function scanRestocks(admin: SupabaseClient, deadline: number) {
  const markets = await getAllMarkets()
  const { data: states, error } = await admin.from('restock_scan_state').select('*')
  if (error) throw new Error(`scan state read failed: ${error.message}`)

  const watermark = new Map<string, number | null>()
  for (const m of markets) watermark.set(m.marketId, null)
  for (const s of states ?? []) {
    if (watermark.has(s.market_id) && s.last_scanned_created_at) {
      watermark.set(s.market_id, new Date(s.last_scanned_created_at).getTime())
    }
  }
  const marks = Array.from(watermark.values())
  const globalSince = marks.includes(null) ? null : new Date(Math.min(...(marks as number[]))).toISOString()

  const pending = (await getRestockRecordsSince(globalSince))
    .filter((r) => {
      if (!watermark.has(r.marketId)) return false
      const w = watermark.get(r.marketId)
      return w == null || new Date(r.createdAt).getTime() > w
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const progress = new Map<string, { createdAt: string; opLogId: string; count: number }>()
  const skipped: string[] = []
  let processed = 0

  for (const r of pending) {
    if (Date.now() > deadline) break
    try {
      const detail = await getRestockOperationLogDetail(r.marketId, r.restockOpLogId)
      const rows = detail.productChanges.map((c) => ({
        market_id: r.marketId,
        product_id: c.productId,
        product_name: c.productName,
        occurred_at: detail.operatedAt,
        restock_op_log_id: String(r.restockOpLogId),
        change_num: c.changeNum,
        after_num: c.afterNum,
      }))
      if (rows.length) {
        const up = await admin.from('restock_events').upsert(rows)
        if (up.error) throw new Error(`restock upsert failed: ${up.error.message}`)
      }
    } catch (err) {
      if (!(err instanceof HahaApiError)) throw err
      skipped.push(String(r.restockOpLogId))
    }
    const p = progress.get(r.marketId)
    progress.set(r.marketId, { createdAt: r.createdAt, opLogId: String(r.restockOpLogId), count: (p?.count ?? 0) + 1 })
    processed++
    await sleep(RESTOCK_DETAIL_DELAY_MS)
  }

  for (const [marketId, p] of Array.from(progress.entries())) {
    const prev = (states ?? []).find((s) => s.market_id === marketId)
    const { error: upErr } = await admin.from('restock_scan_state').upsert({
      market_id: marketId,
      last_scanned_created_at: p.createdAt,
      last_scanned_restock_op_log_id: p.opLogId,
      last_scanned_at: new Date().toISOString(),
      records_scanned: (prev?.records_scanned ?? 0) + p.count,
    })
    if (upErr) throw new Error(`scan state write failed: ${upErr.message}`)
  }

  return { pending: pending.length, processed, remaining: pending.length - processed, skippedLogIds: skipped }
}
