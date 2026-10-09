import { NextRequest, NextResponse } from 'next/server'
import mapping from '@/data/product-name-mapping.json'
import { createClient } from '@/lib/supabase/server'

// Mapping-file names: a fallback if the sales_product_names view is missing.
function mappingFileSkus(): string[] {
  const names = new Set<string>()
  for (const group of ['direct', 'aggregate'] as const) {
    for (const v of Object.values((mapping as any)[group] ?? {}) as any[]) {
      if (v.salesName) names.add(v.salesName)
      for (const n of v.salesNames ?? []) names.add(n)
      if (v.displayName) names.add(v.displayName)
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b))
}

// Every product name in our sales history (VendSoft/USAT), offered as the picklist.
export async function GET() {
  const sb = await createClient()
  const [unmapped, mapped, names] = await Promise.all([
    sb.from('moneta_unmapped_products').select('*').order('units', { ascending: false }),
    sb.from('moneta_product_map').select('moneta_name, sku, updated_at').not('sku', 'is', null).neq('sku', '').order('moneta_name'),
    sb.from('sales_product_names').select('product_name').limit(5000),
  ])
  if (unmapped.error || mapped.error) {
    return NextResponse.json({ error: (unmapped.error ?? mapped.error)!.message }, { status: 500 })
  }
  const skus = new Set(mappingFileSkus())
  if (names.error) console.error('sales_product_names:', names.error.message)
  for (const r of names.data ?? []) skus.add(r.product_name)
  return NextResponse.json({
    unmapped: unmapped.data,
    mapped: mapped.data,
    skus: Array.from(skus).sort((a, b) => a.localeCompare(b)),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const monetaName = typeof body?.monetaName === 'string' ? body.monetaName.trim() : ''
  const sku = typeof body?.sku === 'string' ? body.sku.trim() : ''
  if (!monetaName) return NextResponse.json({ error: 'monetaName is required' }, { status: 400 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const { error } = await sb.from('moneta_product_map').upsert({
    moneta_name: monetaName,
    sku: sku || null,
    updated_by: user?.email ?? null,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
