import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { applyCarts } from '@/lib/moneta/sync'
import { parseExportFile } from '@/lib/moneta/upload'

export const maxDuration = 60

// Fallback when the sync is broken: a Shopping Cart Report export from the
// portal goes through the same parser and write path as the API sync.
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'File is larger than 10 MB' }, { status: 400 })

  try {
    // Middleware already requires a session; read with it, write with the service role.
    const sb = await createClient()
    const [{ data: names }, { data: state }] = await Promise.all([
      sb.from('moneta_product_map').select('moneta_name'),
      sb.from('moneta_sync_state').select('machines').eq('id', 'default').maybeSingle(),
    ])
    const machineIds = new Map(((state?.machines as { id: string; name: string }[] | null) ?? []).map((m) => [m.name, m.id]))
    const carts = await parseExportFile(file.name, await file.arrayBuffer(), (names ?? []).map((n) => n.moneta_name), machineIds)
    const rows = await applyCarts(createAdminClient(), carts, 'upload')
    const days = carts.map((c) => c.saleDay).sort()
    return NextResponse.json({
      carts: carts.length,
      rows,
      skipped: carts.length && !rows ? 'All carts were already synced from the API' : null,
      from: days[0] ?? null,
      to: days[days.length - 1] ?? null,
    })
  } catch (err: any) {
    console.error('Moneta upload error:', err)
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
