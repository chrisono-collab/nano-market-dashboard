'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Preset } from '@/lib/dates'

interface LocationSummary {
  machineCode: string
  machineName: string
  locationName: string
  totalAmount: number
  totalTransactions: number
}

const PRESETS: { label: string; value: Preset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'week' },
  { label: 'Last 30 Days', value: 'month' },
  { label: 'Custom', value: 'custom' },
]

function fmt$(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
}

function fmtNum(n: number) {
  return new Intl.NumberFormat('en-US').format(n)
}

export default function Dashboard() {
  const [preset, setPreset] = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<LocationSummary[]>([])
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'amount' | 'transactions' | 'name'>('amount')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = `/api/vendsoft?preset=${preset}`
      if (preset === 'custom' && customFrom && customTo) {
        url += `&from=${customFrom}&to=${customTo}`
      }
      const res = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to fetch')
      setData(json.data)
      setRange(json.range)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [preset, customFrom, customTo])

  useEffect(() => {
    if (preset !== 'custom') fetchData()
  }, [preset, fetchData])

  const totalRevenue = data.reduce((s, d) => s + d.totalAmount, 0)
  const totalTx = data.reduce((s, d) => s + d.totalTransactions, 0)
  const avgTx = totalTx > 0 ? totalRevenue / totalTx : 0

  const sorted = [...data].sort((a, b) => {
    if (sortBy === 'amount') return b.totalAmount - a.totalAmount
    if (sortBy === 'transactions') return b.totalTransactions - a.totalTransactions
    return a.locationName.localeCompare(b.locationName)
  })

  const topLocation = sorted[0]

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-100 p-6 md:p-10">
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <p className="mono text-xs tracking-[0.2em] text-green-400 uppercase mb-1">Nano Market ATX</p>
          <h1 className="text-2xl font-semibold text-white">Sales Dashboard</h1>
          {range && (
            <p className="text-sm text-gray-500 mt-1 mono">
              {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
            </p>
          )}
        </div>

        {/* Preset selector */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={`px-3 py-1.5 rounded text-xs mono transition-all ${
                preset === p.value
                  ? 'bg-green-500 text-black font-semibold'
                  : 'bg-[#111827] text-gray-400 border border-[#1f2937] hover:border-green-500/50 hover:text-green-400'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom date inputs */}
      {preset === 'custom' && (
        <div className="mb-6 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block mono text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="bg-[#111827] border border-[#1f2937] text-gray-200 rounded px-3 py-2 text-sm mono focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label className="block mono text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="bg-[#111827] border border-[#1f2937] text-gray-200 rounded px-3 py-2 text-sm mono focus:outline-none focus:border-green-500"
            />
          </div>
          <button
            onClick={fetchData}
            disabled={!customFrom || !customTo}
            className="px-4 py-2 bg-green-500 text-black rounded text-sm mono font-semibold disabled:opacity-40 hover:bg-green-400 transition-colors"
          >
            Apply
          </button>
        </div>
      )}

      {/* Summary cards */}
      {data.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-4">
            <p className="mono text-xs text-gray-500 uppercase tracking-widest mb-2">Total Revenue</p>
            <p className="mono text-2xl font-semibold text-green-400">{fmt$(totalRevenue)}</p>
          </div>
          <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-4">
            <p className="mono text-xs text-gray-500 uppercase tracking-widest mb-2">Transactions</p>
            <p className="mono text-2xl font-semibold text-white">{fmtNum(totalTx)}</p>
          </div>
          <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-4">
            <p className="mono text-xs text-gray-500 uppercase tracking-widest mb-2">Avg Ticket</p>
            <p className="mono text-2xl font-semibold text-white">{fmt$(avgTx)}</p>
          </div>
          <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-4">
            <p className="mono text-xs text-gray-500 uppercase tracking-widest mb-2">Top Location</p>
            <p className="mono text-sm font-semibold text-white truncate">{topLocation?.locationName ?? '—'}</p>
            <p className="mono text-xs text-green-400 mt-0.5">{topLocation ? fmt$(topLocation.totalAmount) : ''}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-900/20 border border-red-500/30 rounded-lg p-4 mono text-sm text-red-400">
          ⚠ {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 py-16 justify-center text-gray-500 mono text-sm">
          <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          Pulling live data from VendSoft…
        </div>
      )}

      {/* Table */}
      {!loading && data.length > 0 && (
        <div className="bg-[#111827] border border-[#1f2937] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f2937]">
            <p className="mono text-xs text-gray-500 uppercase tracking-widest">
              {data.length} Locations
            </p>
            <div className="flex gap-2">
              {(['amount', 'transactions', 'name'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  className={`mono text-xs px-2 py-1 rounded transition-all ${
                    sortBy === s
                      ? 'text-green-400 bg-green-500/10'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {s === 'amount' ? '$ Amount' : s === 'transactions' ? '# Txns' : 'A–Z'}
                </button>
              ))}
            </div>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1f2937]">
                <th className="text-left px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest">Location</th>
                <th className="text-left px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest hidden md:table-cell">Machine</th>
                <th className="text-right px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest">Revenue</th>
                <th className="text-right px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest">Txns</th>
                <th className="text-right px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest hidden md:table-cell">Avg</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((loc, i) => {
                const avg = loc.totalTransactions > 0 ? loc.totalAmount / loc.totalTransactions : 0
                const pct = totalRevenue > 0 ? (loc.totalAmount / totalRevenue) * 100 : 0
                return (
                  <tr
                    key={loc.machineCode}
                    className="border-b border-[#1f2937]/50 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="mono text-xs text-gray-600 w-4">{i + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-100">{loc.locationName}</p>
                          {/* mini bar */}
                          <div className="mt-1 h-0.5 w-full max-w-[120px] bg-[#1f2937] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500/60 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="mono text-xs text-gray-500">{loc.machineName}</span>
                    </td>
                    <td className="px-4 py-3 text-right mono text-sm font-semibold text-green-400">
                      {fmt$(loc.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-right mono text-sm text-gray-300">
                      {fmtNum(loc.totalTransactions)}
                    </td>
                    <td className="px-4 py-3 text-right mono text-xs text-gray-500 hidden md:table-cell">
                      {fmt$(avg)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && data.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="mono text-gray-600 text-sm">No sales data for this period.</p>
          <p className="mono text-gray-700 text-xs mt-1">Try a different date range.</p>
        </div>
      )}

      <p className="mt-8 mono text-xs text-gray-700 text-center">
        Nano Market ATX · Smart Vending ATX LLC · Data via VendSoft
      </p>
    </div>
  )
}
