import { NextResponse } from 'next/server'
import { getMonetaStatus } from '@/lib/moneta/queries'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getMonetaStatus(await createClient()))
  } catch (err: any) {
    return NextResponse.json({ alert: `Could not read Moneta sync status: ${err.message}` }, { status: 500 })
  }
}
