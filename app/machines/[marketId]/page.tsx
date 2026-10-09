import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadMachineReport } from '@/lib/machineReport'
import VelocityTable from './VelocityTable'

export const dynamic = 'force-dynamic'

export default async function MachineVelocityPage({ params }: { params: { marketId: string } }) {
  const sb = await createClient()
  const report = await loadMachineReport(sb, params.marketId)
  if (!report) notFound()

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-100 p-6 md:p-10">
      <div className="mb-6">
        <Link href="/machines" className="mono text-xs text-gray-500 hover:text-green-400">← All machines</Link>
        <p className="mono text-xs tracking-[0.2em] text-green-400 uppercase mt-4 mb-1">Sales Velocity Report</p>
        <h1 className="text-2xl font-semibold text-white">{report.marketName}</h1>
        <p className="text-sm text-gray-500 mt-1">{report.marketLocation}</p>
        <p className="text-sm text-gray-500 mt-1 mono">
          {report.salesStart ? `Sales data ${report.salesStart} → ${report.salesEnd}` : 'No sales data loaded for this machine yet'}
        </p>
        {report.dataGaps.map((g) => (
          <p key={g.start} className="text-xs text-amber-400/80 mt-1 mono">
            No sales data from any source {g.start} → {g.end}; those days count as unknown, not in stock.
          </p>
        ))}
      </div>

      <VelocityTable rows={report.rows} />

      <div className="mt-6 text-xs text-gray-500 space-y-1 max-w-3xl">
        <p><span className="text-gray-300">Velocity</span> = units sold ÷ days in stock. Days out of stock come from restock logs showing zero units left. Long stretches with no sales and no restock activity count as unknown and are left out of the math.</p>
        <p>Days out of stock is a lower bound: a product can sell out without a log entry.</p>
        {report.discontinuedCount > 0 && <p>{report.discontinuedCount} discontinued product(s) in the planogram are not shown.</p>}
      </div>
    </div>
  )
}
