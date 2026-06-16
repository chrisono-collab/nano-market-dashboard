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

interface TransactionItem {
  name: string
  quantity: number
  price: number
}

interface Transaction {
  transactionId: string
  time: string
  items: TransactionItem[]
  amount: number
  card: boolean
}

const PRESETS: { label: string; value: Preset }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'week' },
  { label: 'Month To Date', value: 'mtd' },
]

function fmt$(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
}

function fmtNum(n: number) {
  return new Intl.NumberFormat('en-US').format(n)
}

export default function Dashboard() {
  const [preset, setPreset] = useState<Preset>('today')
  const [data, setData] = useState<LocationSummary[]>([])
  const [range, setRange] = useState<{ from: string; to: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'amount' | 'transactions' | 'name'>('amount')

  // Transaction detail drawer
  const [selected, setSelected] = useState<LocationSummary | null>(null)
  const [txns, setTxns] = useState<Transaction[]>([])
  const [txnLoading, setTxnLoading] = useState(false)
  const [txnError, setTxnError] = useState<string | null>(null)

  const openDetail = useCallback(
    async (loc: LocationSummary) => {
      setSelected(loc)
      setTxns([])
      setTxnError(null)
      setTxnLoading(true)
      try {
        const res = await fetch(
          `/api/transactions?machine=${encodeURIComponent(loc.machineCode)}&preset=${preset}`
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed to fetch')
        setTxns(json.transactions)
      } catch (e: any) {
        setTxnError(e.message)
      } finally {
        setTxnLoading(false)
      }
    },
    [preset]
  )

  const closeDetail = useCallback(() => setSelected(null), [])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, closeDetail])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/vendsoft?preset=${preset}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to fetch')
      setData(json.data)
      setRange(json.range)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [preset])

  useEffect(() => {
    fetchData()
  }, [fetchData])

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
                const isFreezer = /freezer/i.test(loc.machineName)
                return (
                  <tr
                    key={loc.machineCode}
                    onClick={() => openDetail(loc)}
                    className="border-b border-[#1f2937]/50 hover:bg-white/[0.02] transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="mono text-xs text-gray-600 w-4">{i + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-100 flex items-center gap-2">
                            {loc.locationName}
                            {isFreezer && (
                              <span
                                title="Freezer"
                                className="mono text-[10px] font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded px-1 leading-tight"
                              >
                                F
                              </span>
                            )}
                          </p>
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

      {/* Transaction detail drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
          onClick={closeDetail}
        >
          <div
            className="h-full w-full max-w-xl bg-[#0d1320] border-l border-[#1f2937] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-start justify-between px-6 py-5 border-b border-[#1f2937]">
              <div>
                <p className="mono text-xs tracking-[0.2em] text-green-400 uppercase mb-1">
                  Transactions
                </p>
                <h2 className="text-lg font-semibold text-white">{selected.locationName}</h2>
                <p className="mono text-xs text-gray-500 mt-1">
                  {selected.machineName}
                  {range && (
                    <>
                      {' · '}
                      {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={closeDetail}
                className="text-gray-500 hover:text-white text-xl leading-none mono px-2"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto">
              {txnLoading && (
                <div className="flex items-center gap-3 py-16 justify-center text-gray-500 mono text-sm">
                  <span className="inline-block w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                  Loading transactions…
                </div>
              )}

              {txnError && (
                <div className="m-6 bg-red-900/20 border border-red-500/30 rounded-lg p-4 mono text-sm text-red-400">
                  ⚠ {txnError}
                </div>
              )}

              {!txnLoading && !txnError && txns.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <p className="mono text-gray-600 text-sm">No transactions for this period.</p>
                </div>
              )}

              {!txnLoading && txns.length > 0 && (
                <table className="w-full">
                  <thead className="sticky top-0 bg-[#0d1320]">
                    <tr className="border-b border-[#1f2937]">
                      <th className="text-left px-6 py-3 mono text-xs text-gray-500 uppercase tracking-widest">
                        Date / Time
                      </th>
                      <th className="text-left px-3 py-3 mono text-xs text-gray-500 uppercase tracking-widest">
                        Items
                      </th>
                      <th className="text-right px-6 py-3 mono text-xs text-gray-500 uppercase tracking-widest">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((t) => (
                      <tr
                        key={t.transactionId}
                        className="border-b border-[#1f2937]/50 hover:bg-white/[0.02] transition-colors align-top"
                      >
                        <td className="px-6 py-3 mono text-xs text-gray-400 whitespace-nowrap">
                          {t.time}
                          {t.card && (
                            <span className="ml-2 text-[10px] text-gray-600 uppercase">card</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-200">
                          {t.items.map((it, j) => (
                            <span key={j} className="block leading-snug">
                              {it.name}
                              {it.quantity > 1 && (
                                <span className="text-gray-500"> ×{it.quantity}</span>
                              )}
                            </span>
                          ))}
                        </td>
                        <td className="px-6 py-3 text-right mono text-sm font-semibold text-green-400 whitespace-nowrap">
                          {fmt$(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Drawer footer */}
            {!txnLoading && txns.length > 0 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-[#1f2937] bg-[#0a0e1a]">
                <span className="mono text-xs text-gray-500 uppercase tracking-widest">
                  {fmtNum(txns.length)} transactions
                </span>
                <span className="mono text-sm font-semibold text-green-400">
                  {fmt$(txns.reduce((s, t) => s + t.amount, 0))}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
