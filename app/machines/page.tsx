import Link from 'next/link'
import { listMachines } from '@/lib/machineReport'

export const dynamic = 'force-dynamic'

export default async function MachinesPage() {
  const machines = await listMachines()

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-100 p-6 md:p-10">
      <div className="mb-8">
        <Link href="/" className="mono text-xs text-gray-500 hover:text-green-400">← Sales Dashboard</Link>
        <p className="mono text-xs tracking-[0.2em] text-green-400 uppercase mt-4 mb-1">Nano Market ATX</p>
        <h1 className="text-2xl font-semibold text-white">Product Sales Velocity Reports</h1>
        <p className="text-sm text-gray-400 mt-2 max-w-2xl">
          Pick a machine to open its velocity report: how fast each product in its current planogram sells per day
          while actually in stock, with stockout days excluded.
        </p>
      </div>

      <div className="bg-[#111827] border border-[#1f2937] rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1f2937]">
              <th className="text-left px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest">Machine</th>
              <th className="text-left px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest hidden md:table-cell">Location</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {machines.map((m) => (
              <tr key={m.marketId} className="border-b border-[#1f2937]/50 hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/machines/${m.marketId}`} className="text-white hover:text-green-400">
                    {m.marketName}
                  </Link>
                  <div className="md:hidden text-xs text-gray-500 mt-0.5">{m.marketLocation}</div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-400 hidden md:table-cell">{m.marketLocation}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/machines/${m.marketId}`} className="mono text-xs text-green-400 hover:text-green-300 whitespace-nowrap">
                    View velocity report →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
