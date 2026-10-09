'use client'

import { useMemo, useState } from 'react'
import type { VelocityRow } from '@/lib/velocity'

type SortKey = 'name' | 'velocity' | 'unitsSold' | 'daysInStock' | 'daysOutOfStock' | 'daysUnknown'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Product', numeric: false },
  { key: 'velocity', label: 'Velocity / day', numeric: true },
  { key: 'unitsSold', label: 'Units sold', numeric: true },
  { key: 'daysInStock', label: 'Days in stock', numeric: true },
  { key: 'daysOutOfStock', label: 'Days out of stock', numeric: true },
  { key: 'daysUnknown', label: 'Days unknown', numeric: true },
]

const BADGE = 'mono text-[10px] font-semibold rounded px-1 leading-tight border whitespace-nowrap'

function Flags({ r }: { r: VelocityRow }) {
  const flags: { label: string; title: string; cls: string }[] = []
  if (r.isAggregateEstimate)
    flags.push({ label: 'Variety estimate', title: 'Sales only exist as a combined variety/multi-flavor SKU, so this is the whole line’s velocity: an upper bound for this one flavor.', cls: 'text-purple-300 bg-purple-500/10 border-purple-500/30' })
  if (r.tooNew)
    flags.push({ label: 'Too new', title: 'Placed under 7 days before the latest sales data; too little history to judge.', cls: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30' })
  else if (r.lowConfidenceShortWindow)
    flags.push({ label: 'Short window', title: 'Under 30 days of history since placement; low confidence.', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' })
  if (r.lowConfidenceMuchUnknown)
    flags.push({ label: 'Much unknown', title: 'Over 25% of the window has unknown stock status.', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' })
  if (r.noDataReason === 'UNMAPPED')
    flags.push({ label: 'Unmapped', title: 'No matching sales SKU yet. Add it to data/product-name-mapping.json.', cls: 'text-red-300 bg-red-500/10 border-red-500/30' })
  if (r.noDataReason === 'NO_RESTOCK_HISTORY')
    flags.push({ label: 'No restock history', title: 'No HaHa restock records for this product here, so no placement date or stock timeline.', cls: 'text-red-300 bg-red-500/10 border-red-500/30' })
  if (!flags.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {flags.map((f) => (
        <span key={f.label} title={f.title} className={`${BADGE} ${f.cls}`}>{f.label}</span>
      ))}
    </div>
  )
}

const fmt = (n: number | null, digits = 1) => (n == null ? '—' : n.toFixed(digits))

export default function VelocityTable({ rows }: { rows: VelocityRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('velocity')
  const [desc, setDesc] = useState(true)

  const sorted = useMemo(() => {
    const dir = desc ? -1 : 1
    return [...rows].sort((a, b) => {
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name)
      const av = a[sortKey]
      const bv = b[sortKey]
      // Rows without a number always sink to the bottom.
      if (av == null && bv == null) return a.name.localeCompare(b.name)
      if (av == null) return 1
      if (bv == null) return -1
      return dir * (av - bv)
    })
  }, [rows, sortKey, desc])

  const onSort = (key: SortKey) => {
    if (key === sortKey) setDesc(!desc)
    else {
      setSortKey(key)
      setDesc(key !== 'name')
    }
  }

  return (
    <div className="bg-[#111827] border border-[#1f2937] rounded-lg overflow-auto max-h-[calc(100vh-4rem)]">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr className="border-b border-[#1f2937]">
            {COLUMNS.map((c) => (
              <th key={c.key} className={`sticky top-0 z-10 bg-[#111827] shadow-[inset_0_-1px_0_#1f2937] px-4 py-3 ${c.numeric ? 'text-right' : 'text-left'}`}>
                <button
                  onClick={() => onSort(c.key)}
                  className={`mono text-xs uppercase tracking-widest hover:text-green-400 ${sortKey === c.key ? 'text-green-400' : 'text-gray-500'}`}
                >
                  {c.label}
                  {sortKey === c.key ? (desc ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.productId} className="border-b border-[#1f2937]/50 hover:bg-white/[0.02] align-top">
              <td className="px-4 py-3">
                <div className="text-white text-sm">{r.name}</div>
                {r.subName && <div className="text-xs text-gray-500">{r.subName}</div>}
                <Flags r={r} />
              </td>
              <td className="px-4 py-3 text-right mono text-sm text-green-400">{fmt(r.velocity, 2)}</td>
              <td className="px-4 py-3 text-right mono text-sm text-gray-300">{r.unitsSold ?? '—'}</td>
              <td className="px-4 py-3 text-right mono text-sm text-gray-300">{fmt(r.daysInStock)}</td>
              <td className="px-4 py-3 text-right mono text-sm text-gray-300">{fmt(r.daysOutOfStock)}</td>
              <td className="px-4 py-3 text-right mono text-sm text-gray-300">{fmt(r.daysUnknown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
