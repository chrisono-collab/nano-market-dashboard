import { NextRequest, NextResponse } from 'next/server'
import mapping from '@/data/product-name-mapping.json'
import { createClient } from '@/lib/supabase/server'

// Our sales product names (the names VendSoft/USAT use), offered as suggestions.
function knownSkus(): string[] {
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

export async function GET() {
  const sb = await createClient()
  const [unmapped, mapped] = await Promise.all([
    sb.from('moneta_unmapped_products').select('*').order('units', { ascending: false }),
    sb.from('moneta_product_map').select('moneta_name, sku, updated_at').not('sku', 'is', null).neq('sku', '').order('moneta_name'),
  ])
  if (unmapped.error || mapped.error) {
    return NextResponse.json({ error: (unmapped.error ?? mapped.error)!.message }, { status: 500 })
  }
  return NextResponse.json({ unmapped: unmapped.data, mapped: mapped.data, skus: knownSkus() })
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
