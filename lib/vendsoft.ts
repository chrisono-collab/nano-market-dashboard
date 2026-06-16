const VENDSOFT_BASE = 'https://secure.vendsoft.com/api/v2'
const API_KEY = process.env.VENDSOFT_API_KEY ?? ''
const CUSTOMER_ID = process.env.VENDSOFT_CUSTOMER_ID ?? ''

export interface Machine {
  machineCode: string
  machineName: string
  locationName: string
  locationCode: string
  machineType: string // "Soda/Snack" (combo), "Snack", or "Soda"
}

export interface SalesSummary {
  machineCode: string
  machineName: string
  locationName: string
  machineType: string
  totalAmount: number
  totalTransactions: number
}

export interface DateRange {
  from: string // YYYY-MM-DD
  to: string
}

export interface TransactionItem {
  name: string
  quantity: number
  price: number
}

export interface Transaction {
  transactionId: string
  timestamp: string // raw "20260616113916" (for sorting)
  time: string // display "2026-06-16 11:39"
  items: TransactionItem[]
  amount: number
  card: boolean // paid by card vs cash
}

/* ------------------------------------------------------------------ *
 * Auth strategies
 *
 * VendSoft's docs say "api_key header", but the exact mechanism has
 * been unreliable in practice. Rather than guess, we try each known
 * mechanism in order until one returns a 2xx, then remember the winner
 * so subsequent calls go straight to it. Every attempt is logged
 * (with the key masked) so the request can be debugged from the
 * server console.
 * ------------------------------------------------------------------ */

interface AuthStrategy {
  name: string
  build: (path: string) => { url: string; headers: Record<string, string> }
}

const STRATEGIES: AuthStrategy[] = [
  {
    name: 'header:api_key',
    build: (path) => ({
      url: VENDSOFT_BASE + path,
      headers: { api_key: API_KEY },
    }),
  },
  {
    name: 'query:?api_key=',
    build: (path) => {
      const sep = path.includes('?') ? '&' : '?'
      return {
        url: `${VENDSOFT_BASE}${path}${sep}api_key=${encodeURIComponent(API_KEY)}`,
        headers: {},
      }
    },
  },
  {
    name: 'header:X-Customer-ID + api_key',
    build: (path) => ({
      url: VENDSOFT_BASE + path,
      headers: { api_key: API_KEY, 'X-Customer-ID': CUSTOMER_ID },
    }),
  },
  {
    name: 'basic-auth(key as username)',
    build: (path) => ({
      url: VENDSOFT_BASE + path,
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${API_KEY}:${CUSTOMER_ID}`).toString('base64'),
      },
    }),
  },
]

// Remembered between requests once we find one that works.
let workingStrategy: AuthStrategy | null = null

/** Mask a secret for logging: keep enough to verify it's the right value,
 *  but never print the whole thing. Includes length so trailing-space /
 *  encoding bugs are visible. */
function mask(v: string): string {
  if (!v) return '(empty)'
  if (v.length <= 8) return `${v[0]}***${v[v.length - 1]} (len=${v.length})`
  return `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})`
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(headers)) {
    out[k] = /key|auth|token/i.test(k) ? mask(val) : val
  }
  return out
}

function maskUrl(url: string): string {
  return url.replace(/(api_key=)([^&]+)/i, (_m, prefix, val) => prefix + mask(decodeURIComponent(val)))
}

export interface AuthAttempt {
  strategy: string
  url: string // masked
  headers: Record<string, string> // masked
  status: number | null
  ok: boolean
  body: string // raw response body (text)
  error?: string
}

/** Run a single strategy against a path and return a structured attempt. */
async function tryStrategy(strat: AuthStrategy, path: string): Promise<AuthAttempt> {
  const { url, headers } = strat.build(path)
  const sendHeaders = { Accept: 'application/json', ...headers }
  const maskedUrl = maskUrl(url)
  const maskedHeaders = maskHeaders(sendHeaders)

  console.log(
    `[vendsoft] → GET ${maskedUrl}  auth=${strat.name}  headers=${JSON.stringify(maskedHeaders)}`
  )

  try {
    const res = await fetch(url, { headers: sendHeaders, cache: 'no-store' })
    const body = await res.text()
    console.log(
      `[vendsoft] ← ${res.status} ${res.statusText}  (auth=${strat.name})` +
        (res.ok ? '' : `  body=${body.slice(0, 300)}`)
    )
    return {
      strategy: strat.name,
      url: maskedUrl,
      headers: maskedHeaders,
      status: res.status,
      ok: res.ok,
      body,
    }
  } catch (err: any) {
    console.log(`[vendsoft] ✗ network error (auth=${strat.name}): ${err.message}`)
    return {
      strategy: strat.name,
      url: maskedUrl,
      headers: maskedHeaders,
      status: null,
      ok: false,
      body: '',
      error: err.message,
    }
  }
}

/**
 * GET a VendSoft path, parsed as JSON. Tries each auth strategy until one
 * succeeds (preferring the last known-good one), then caches the winner.
 * Auth failures (401/403) fall through to the next strategy; any other
 * non-2xx status means auth worked but something else is wrong, so we stop
 * and surface it immediately.
 */
async function vsGet(path: string): Promise<any> {
  if (!API_KEY) throw new Error('VENDSOFT_API_KEY is not set')

  const ordered = workingStrategy
    ? [workingStrategy, ...STRATEGIES.filter((s) => s !== workingStrategy)]
    : STRATEGIES

  const attempts: AuthAttempt[] = []

  for (const strat of ordered) {
    const attempt = await tryStrategy(strat, path)
    attempts.push(attempt)

    if (attempt.ok) {
      if (workingStrategy !== strat) {
        console.log(`[vendsoft] ✓ auth strategy locked in: ${strat.name}`)
        workingStrategy = strat
      }
      return attempt.body ? JSON.parse(attempt.body) : null
    }

    // Only keep trying other strategies on auth-type failures.
    if (attempt.status !== 401 && attempt.status !== 403 && attempt.status !== null) {
      throw new Error(`VendSoft ${path} → ${attempt.status}: ${attempt.body.slice(0, 500)}`)
    }
  }

  // If a previously-good strategy started failing auth, clear it so the
  // next call re-probes from scratch.
  workingStrategy = null

  const summary = attempts
    .map((a) => `${a.strategy}=${a.status ?? a.error ?? 'err'}`)
    .join(', ')
  throw new Error(`VendSoft ${path}: all auth strategies failed [${summary}]`)
}

/** Diagnostic probe: run a path through EVERY strategy and return all
 *  attempts (raw bodies included). Used by /api/test. Does not short-circuit
 *  and does not mutate the cached strategy. */
export async function probeAuth(path: string): Promise<{
  path: string
  apiKey: string
  customerId: string
  attempts: AuthAttempt[]
}> {
  const attempts: AuthAttempt[] = []
  for (const strat of STRATEGIES) {
    attempts.push(await tryStrategy(strat, path))
  }
  return {
    path,
    apiKey: mask(API_KEY),
    customerId: CUSTOMER_ID || '(empty)',
    attempts,
  }
}

export async function getMachines(): Promise<Machine[]> {
  const data = await vsGet('/machines')
  // Normalize — VendSoft returns array or wrapped object
  const list = Array.isArray(data) ? data : data?.machines ?? data?.data ?? []
  return list.map((m: any) => ({
    machineCode: m.machineCode ?? m.MachineCode ?? m.code,
    machineName: m.machineName ?? m.MachineName ?? m.name,
    locationName: m.locationName ?? m.LocationName ?? m.location ?? '',
    locationCode: m.locationCode ?? m.LocationCode ?? '',
    machineType: m.machineType ?? m.MachineType ?? m.type ?? '',
  }))
}

/** Convert VendSoft's transactionTime ("20260616113916") to "2026-06-16".
 *  Returns null if it can't be parsed (so the row isn't dropped). */
function txnDay(transactionTime: unknown): string | null {
  if (typeof transactionTime === 'string' && /^\d{8}/.test(transactionTime)) {
    const t = transactionTime
    return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  }
  return null
}

/** Format "20260616113916" as "2026-06-16 11:39"; pass through anything else. */
function txnTimeLabel(transactionTime: unknown): string {
  const t = String(transactionTime ?? '')
  if (!/^\d{12}/.test(t)) return t
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}`
}

/**
 * Individual transactions for one machine within a date range, in
 * chronological order. Raw vend line-items sharing a transactionId are
 * merged into one transaction (a single card swipe can buy several items).
 */
export async function getMachineTransactions(
  machineCode: string,
  range: DateRange
): Promise<Transaction[]> {
  let data: any
  try {
    data = await vsGet(`/machines/${machineCode}/sales?from=${range.from}&to=${range.to}`)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  // Group rows by transactionId (the endpoint ignores date params, so filter
  // by each row's transactionTime — same as getMachineSales).
  const groups = new Map<string, Transaction>()
  data.forEach((row: any, i: number) => {
    const day = txnDay(row?.transactionTime)
    if (day && (day < range.from || day > range.to)) return

    const id =
      row?.transactionId != null
        ? String(row.transactionId)
        : `${row?.transactionTime ?? 't'}-${i}`
    const price = Number(row?.price ?? row?.amount ?? 0) || 0
    const qty = Number(row?.quantity ?? 1) || 1

    const g =
      groups.get(id) ??
      ({
        transactionId: id,
        timestamp: String(row?.transactionTime ?? ''),
        time: txnTimeLabel(row?.transactionTime),
        items: [],
        amount: 0,
        card: false,
      } as Transaction)

    g.items.push({
      name: row?.productName ?? row?.productCode ?? 'Item',
      quantity: qty,
      price,
    })
    g.amount += price * qty
    if (row?.creditCard) g.card = true
    groups.set(id, g)
  })

  // Newest first (most recent transaction at the top).
  return Array.from(groups.values()).sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  )
}

export async function getMachineSales(
  machineCode: string,
  range: DateRange
): Promise<{ amount: number; transactions: number }> {
  try {
    const data = await vsGet(
      `/machines/${machineCode}/sales?from=${range.from}&to=${range.to}`
    )

    // VendSoft returns an array of individual vend line-items, e.g.
    //   { transactionId, transactionTime: "20260616113916", price, quantity, ... }
    //
    // NOTE: the sales endpoint IGNORES from/to query params — it always
    // returns a rolling ~30-day window. So we filter by each row's
    // transactionTime here, client-side. (Ranges older than the window
    // simply have no data to return.)
    // Revenue = Σ(price × quantity); a "transaction" = a distinct
    // transactionId (one card swipe can buy several line-items).
    if (Array.isArray(data)) {
      let amount = 0
      const txnIds = new Set<unknown>()
      for (const row of data) {
        const day = txnDay(row?.transactionTime)
        // Drop rows outside the requested range; keep ones we can't date-parse.
        if (day && (day < range.from || day > range.to)) continue
        const price = Number(row?.price ?? row?.amount ?? 0)
        const qty = Number(row?.quantity ?? 1)
        if (!Number.isNaN(price)) amount += price * (Number.isNaN(qty) ? 1 : qty)
        txnIds.add(row?.transactionId ?? row?.transactionTime ?? Symbol())
      }
      return { amount, transactions: txnIds.size }
    }

    // Fallback: some endpoints may return a pre-summarized object.
    const amount =
      data?.totalAmount ?? data?.TotalAmount ?? data?.total ?? data?.revenue ?? 0
    const transactions =
      data?.totalTransactions ??
      data?.TotalTransactions ??
      data?.transactions ??
      data?.count ??
      0
    return { amount: Number(amount), transactions: Number(transactions) }
  } catch {
    return { amount: 0, transactions: 0 }
  }
}

export async function getAllLocationsSales(range: DateRange): Promise<SalesSummary[]> {
  const machines = await getMachines()
  const results = await Promise.allSettled(
    machines.map(async (m) => {
      const sales = await getMachineSales(m.machineCode, range)
      return {
        machineCode: m.machineCode,
        machineName: m.machineName,
        locationName: m.locationName || m.machineName,
        machineType: m.machineType,
        totalAmount: sales.amount,
        totalTransactions: sales.transactions,
      }
    })
  )
  return results
    .filter((r): r is PromiseFulfilledResult<SalesSummary> => r.status === 'fulfilled')
    .map((r) => r.value)
}
