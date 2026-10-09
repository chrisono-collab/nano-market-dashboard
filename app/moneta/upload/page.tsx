'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Result {
  carts: number
  rows: number
  skipped: string | null
  from: string | null
  to: string | null
}

export default function MonetaUploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/moneta/upload', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      setResult(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-gray-100 p-6 md:p-10">
      <div className="mb-8">
        <Link href="/" className="mono text-xs text-gray-500 hover:text-green-400">← Sales Dashboard</Link>
        <p className="mono text-xs tracking-[0.2em] text-green-400 uppercase mt-4 mb-1">Moneta Market</p>
        <h1 className="text-2xl font-semibold text-white">Upload a Sales Export</h1>
        <p className="text-sm text-gray-400 mt-2 max-w-2xl">
          Backup for when the automatic sync is down. In the Moneta portal, open Sales Reports, pick{' '}
          <span className="text-gray-200">Shopping Cart Report</span>, all machines and your dates, run it, then export to
          Excel or CSV and upload the file here. Carts already synced automatically are left as they are, so re-uploading
          is safe.
        </p>
      </div>

      <div className="bg-[#111827] border border-[#1f2937] rounded-lg p-6 max-w-xl">
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-gray-300 file:mr-4 file:rounded file:border-0 file:bg-[#1f2937] file:px-3 file:py-1.5 file:text-sm file:text-gray-200"
        />
        <button
          onClick={upload}
          disabled={!file || busy}
          className="mt-4 px-4 py-2 rounded text-sm mono bg-green-500 text-black font-semibold disabled:opacity-40"
        >
          {busy ? 'Importing…' : 'Import'}
        </button>

        {error && <p className="mt-4 mono text-sm text-red-400">⚠ {error}</p>}
        {result && (
          <div className="mt-4 mono text-sm text-gray-300 space-y-1">
            <p className="text-green-400">
              Read {result.carts} carts{result.from && ` from ${result.from} to ${result.to}`}.
            </p>
            <p>{result.rows} product lines saved.</p>
            {result.skipped && <p className="text-gray-500">{result.skipped}.</p>}
            <p className="text-gray-500">
              Exports join product names with spaces, so new products may be split imperfectly; check{' '}
              <Link href="/moneta/products" className="text-green-400 hover:text-green-300">unmapped products</Link>.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
