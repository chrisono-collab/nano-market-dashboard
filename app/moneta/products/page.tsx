'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Unmapped {
  product_name: string
  units: number
  revenue: number
  last_sold_at: string
  machines: string[]
}

interface Mapped {
  moneta_name: string
  sku: string
}

const fmt$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default function MonetaProductsPage() {
  const [unmapped, setUnmapped] = useState<Unmapped[]>([])
  const [mapped, setMapped] = useState<Mapped[]>([])
  const [skus, setSkus] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/moneta/products')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setUnmapped(json.unmapped)
      setMapped(json.mapped)
      setSkus(json.skus)
      // Pre-fill an exact name match, or the only one of our names that starts
      // with the Moneta name (e.g. "Coke Zero" -> "Coke Zero 16.9oz").
      const skuList = json.skus as string[]
      const guess = (name: string) => {
        const n = name.toLowerCase()
        const exact = skuList.find((s) => s.toLowerCase() === n)
        if (exact) return exact
        const starts = skuList.filter((s) => s.toLowerCase().startsWith(n + ' '))
        return starts.length === 1 ? starts[0] : ''
      }
      setDrafts((d) => {
        const next = { ...d }
        for (const u of json.unmapped as Unmapped[]) {
          if (next[u.product_name] === undefined) next[u.product_name] = guess(u.product_name)
        }
        return next
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (monetaName: string, sku: string) => {
    setSaving(monetaName)
    setError(null)
    try {
      const res = await fetch('/api/moneta/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monetaName, sku }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-100 p-6 md:p-10">
      <div className="mb-8">
        <Link href="/" className="mono text-xs text-gray-500 hover:text-green-400">← Sales Dashboard</Link>
        <p className="mono text-xs tracking-[0.2em] text-green-400 uppercase mt-4 mb-1">Moneta Market</p>
        <h1 className="text-2xl font-semibold text-white">Unmapped Products</h1>
        <p className="text-sm text-gray-400 mt-2 max-w-2xl">
          Products sold at Moneta kiosks that are not yet matched to our product names. Their sales are still counted;
          mapping lines them up with VendSoft and inventory. Type or pick our name and press Save.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-900/20 border border-red-500/30 rounded-lg p-4 mono text-sm text-red-400">⚠ {error}</div>
      )}

      <datalist id="sku-options">
        {skus.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {loading ? (
        <p className="mono text-sm text-gray-500">Loading…</p>
      ) : unmapped.length === 0 ? (
        <p className="mono text-sm text-gray-500 mb-10">Every Moneta product is mapped.</p>
      ) : (
        <div className="bg-[#111827] border border-[#1f2937] rounded-lg overflow-x-auto mb-10">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1f2937]">
                <th className="text-left px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest">Moneta product</th>
                <th className="text-right px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest">Units</th>
                <th className="text-right px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest hidden md:table-cell">Revenue</th>
                <th className="text-left px-4 py-3 mono text-xs text-gray-500 uppercase tracking-widest">Our product name</th>
              </tr>
            </thead>
            <tbody>
              {unmapped.map((u) => (
                <tr key={u.product_name} className="border-b border-[#1f2937]/50">
                  <td className="px-4 py-3 text-sm text-gray-100">
                    {u.product_name}
                    <div className="mono text-xs text-gray-500 mt-0.5">{u.machines.join(', ')}</div>
                  </td>
                  <td className="px-4 py-3 text-right mono text-sm text-gray-300">{u.units}</td>
                  <td className="px-4 py-3 text-right mono text-sm text-green-400 hidden md:table-cell">{fmt$(Number(u.revenue))}</td>
                  <td className="px-4 py-3">
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        save(u.product_name, drafts[u.product_name] ?? '')
                      }}
                    >
                      <input
                        list="sku-options"
                        value={drafts[u.product_name] ?? ''}
                        onChange={(e) => setDrafts({ ...drafts, [u.product_name]: e.target.value })}
                        className="flex-1 min-w-[10rem] bg-[#0a0e1a] border border-[#1f2937] rounded px-2 py-1 text-sm text-gray-200"
                      />
                      <button
                        type="submit"
                        disabled={!drafts[u.product_name]?.trim() || saving === u.product_name}
                        className="px-3 py-1 rounded text-xs mono bg-green-500 text-black font-semibold disabled:opacity-40"
                      >
                        {saving === u.product_name ? 'Saving…' : 'Save'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mapped.length > 0 && (
        <>
          <h2 className="mono text-xs text-gray-500 uppercase tracking-widest mb-3">Mapped ({mapped.length})</h2>
          <div className="bg-[#111827] border border-[#1f2937] rounded-lg overflow-x-auto">
            <table className="w-full">
              <tbody>
                {mapped.map((m) => (
                  <tr key={m.moneta_name} className="border-b border-[#1f2937]/50">
                    <td className="px-4 py-2 text-sm text-gray-300">{m.moneta_name}</td>
                    <td className="px-4 py-2 text-sm text-gray-100">→ {m.sku}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => save(m.moneta_name, '')}
                        disabled={saving === m.moneta_name}
                        className="mono text-xs text-gray-500 hover:text-red-400"
                      >
                        Unmap
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
