/**
 * Moneta Market operator-portal client (server-only, read-only).
 *
 * Moneta has no public API; this talks to the same internal endpoints the
 * portal's own pages call (found by scripts/moneta-discover.ts):
 *   POST Login/Login                 {Email, Password} -> session cookies
 *   GET  Machines/GetMachinesDailySales                 -> [{Id, CustomId, ...}]
 *   POST Reports/GetReportData       {ReportType: "ShoppingCart", ...} -> carts
 *
 * Requests are strictly sequential with a minimum gap, retried with backoff
 * on network/5xx errors, and re-login once when the session has expired.
 */
import { MonetaShapeError, parseReportData, portalDate, type MonetaCart } from './parse'

export class MonetaLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MonetaLoginError'
  }
}

class SessionExpired extends Error {}

export interface MonetaMachine {
  id: string
  name: string
}

const DEFAULT_BASE = 'https://www.monetamarket.com/NanoMarketATXWeb/'
const UA = 'NanoMarketDashboard/1.0 (+read-only sales sync)'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Reused across invocations while a serverless instance stays warm.
const sessionCache = new Map<string, Map<string, string>>()

export class MonetaClient {
  private readonly base: string
  private readonly email: string
  private readonly password: string
  private readonly minGapMs: number
  private cookies: Map<string, string>
  private lastRequestAt = 0

  constructor(opts: { email?: string; password?: string; baseUrl?: string; minGapMs?: number } = {}) {
    this.email = opts.email ?? process.env.MONETA_EMAIL ?? ''
    this.password = opts.password ?? process.env.MONETA_PASSWORD ?? ''
    this.base = (opts.baseUrl ?? process.env.MONETA_BASE_URL ?? DEFAULT_BASE).replace(/\/?$/, '/')
    this.minGapMs = opts.minGapMs ?? 1500
    if (!this.email || !this.password) throw new MonetaLoginError('MONETA_EMAIL and MONETA_PASSWORD must be set')
    const key = `${this.base}|${this.email}`
    if (!sessionCache.has(key)) sessionCache.set(key, new Map())
    this.cookies = sessionCache.get(key)!
  }

  private cookieHeader() {
    return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join('; ')
  }

  private storeCookies(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';')
      const eq = pair.indexOf('=')
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim())) || !value
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  private async throttle() {
    const wait = this.lastRequestAt + this.minGapMs - Date.now()
    if (wait > 0) await sleep(wait)
    this.lastRequestAt = Date.now()
  }

  /** One HTTP call; throws SessionExpired when bounced to the login page. */
  private async raw(path: string, init: { method: 'GET' | 'POST'; json?: unknown }): Promise<Response> {
    await this.throttle()
    const res = await fetch(this.base + path, {
      method: init.method,
      redirect: 'manual',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        ...(init.json !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
        ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(60_000),
    })
    this.storeCookies(res)
    const loc = res.headers.get('location') ?? ''
    if (res.status === 401 || res.status === 403 || ((res.status === 301 || res.status === 302) && /login/i.test(loc))) {
      throw new SessionExpired()
    }
    return res
  }

  async login(): Promise<void> {
    this.cookies.clear()
    const res = await this.withRetry(() => this.raw('Login/Login', { method: 'POST', json: { Email: this.email, Password: this.password } }), 'login')
    const body = await res.text()
    if (!res.ok || !this.cookies.has('MonetaMarketDashboard')) {
      // Never echo credentials; the body is the portal's own message.
      throw new MonetaLoginError(`Moneta login failed (HTTP ${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
  }

  private async withRetry(fn: () => Promise<Response>, label: string, attempts = 4): Promise<Response> {
    let lastErr: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fn()
        if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`)
        return res
      } catch (err) {
        if (err instanceof SessionExpired) throw err
        lastErr = err
        if (i < attempts - 1) await sleep(2000 * 2 ** i)
      }
    }
    throw new Error(`Moneta ${label} failed after ${attempts} attempts: ${lastErr instanceof Error ? lastErr.message : lastErr}`)
  }

  /** Authenticated call: logs in if needed and once more if the session expired. */
  private async call(path: string, init: { method: 'GET' | 'POST'; json?: unknown }): Promise<string> {
    if (!this.cookies.has('MonetaMarketDashboard')) await this.login()
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.withRetry(() => this.raw(path, init), path)
        const text = await res.text()
        if (!res.ok) throw new Error(`Moneta ${path} returned HTTP ${res.status}: ${text.slice(0, 200)}`)
        // An expired session can also come back as the login page with 200.
        if (/^\s*<!DOCTYPE html/i.test(text) && /Login/i.test(text)) throw new SessionExpired()
        return text
      } catch (err) {
        if (err instanceof SessionExpired && attempt === 0) {
          await this.login()
          continue
        }
        if (err instanceof SessionExpired) throw new MonetaLoginError('Moneta session rejected right after logging in')
        throw err
      }
    }
  }

  async getMachines(): Promise<MonetaMachine[]> {
    const text = await this.call('Machines/GetMachinesDailySales', { method: 'GET' })
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new MonetaShapeError('Machine list was not JSON', text.slice(0, 200))
    }
    if (!Array.isArray(data)) throw new MonetaShapeError('Machine list was not an array', text.slice(0, 200))
    return data.map((m: any) => {
      if (!m?.Id || !m?.CustomId) throw new MonetaShapeError('Machine entry missing Id/CustomId', JSON.stringify(m).slice(0, 200))
      return { id: String(m.Id), name: String(m.CustomId).trim() }
    })
  }

  /** Shopping-cart rows for whole Central days [fromDay, toDay] (YYYY-MM-DD). */
  async getCarts(machines: MonetaMachine[], fromDay: string, toDay: string): Promise<MonetaCart[]> {
    if (!machines.length) return []
    const text = await this.call('Reports/GetReportData', {
      method: 'POST',
      json: {
        ReportType: 'ShoppingCart',
        ReportPaymentMethod: 'All Sales',
        SelectedMachines: machines.map((m) => m.id),
        SelectedMachineNames: machines.map((m) => m.name),
        SelectedCategories: [],
        SelectedCategoryNames: [],
        StringFromDate: portalDate(fromDay, false),
        StringToDate: portalDate(toDay, true),
        IncludeDeletedItems: false,
        IncludeDeletedCarts: false,
      },
    })
    return parseReportData(text, new Map(machines.map((m) => [m.name, m.id])))
  }
}
