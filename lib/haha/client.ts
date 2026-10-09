import { hahaConfig } from "./config";
import { getHahaToken, invalidateHahaToken } from "./token";
import type { HahaEnvelope } from "./types";

export class HahaApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HahaApiError";
    this.status = status;
  }
}

type QueryParams = Record<string, string | number | boolean | undefined>;

function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Confirmed from HaHa's docs (Rate Limiting page, previously never read —
// this project only ever reacted to 429s after the fact): quotas are
// per-API-type AND per-merchant, both on a rolling ~1-minute window
// (~100 req/min per type, ~600 req/min total). A 429 means that window is
// exhausted, not that a short backoff will help — the window needs to
// actually roll over. Waiting a genuinely-longer-than-60s interval is far
// more likely to succeed on the next attempt than a short exponential ramp;
// batch jobs already throttle themselves proactively between requests (see
// PLACEMENT_SCAN_DELAY_MS in placement.ts) to stay under the per-type quota
// in the first place, so hitting this path at all should be rare. A prior
// run let this run away — 6 retries with only an 8s cap, with no ceiling on
// Retry-After, ran for 20+ minutes before eventually still dying on an
// unretried network error. Fail loudly and fast instead of retrying forever,
// but make each retry actually likely to work.
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BACKOFF_CAP_MS = 65_000; // safely past the ~60s quota window
const RETRY_AFTER_CAP_MS = 90_000; // honor the server's Retry-After, but don't wait forever on it

const NETWORK_ERROR_MAX_RETRIES = 3;
const NETWORK_ERROR_BACKOFF_CAP_MS = 5_000;

// A 5xx from HaHa (confirmed live: 500 on a specific restockOpLogId, distinct
// from the 404s that some operation types legitimately return) might be
// transient — worth a couple of retries before the caller decides to skip it.
const SERVER_ERROR_MAX_RETRIES = 2;
const SERVER_ERROR_BACKOFF_CAP_MS = 4_000;

async function request<T>(
  path: string,
  init: RequestInit,
  attempt = 0,
  rateLimitRetries = 0,
  networkRetries = 0,
  serverErrorRetries = 0
): Promise<T> {
  const token = await getHahaToken();

  let res: Response;
  try {
    res = await fetch(`${hahaConfig.baseUrl}${hahaConfig.apiVersionPath}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch (err) {
    // fetch() itself throwing (not an HTTP error status) means a connection-level
    // failure — e.g. the server dropped the connection after repeated rate-limit
    // hits. Retry a bounded number of times, then give up loudly.
    if (networkRetries >= NETWORK_ERROR_MAX_RETRIES) {
      throw new Error(
        `HaHa API request to ${path} failed after ${networkRetries} network-error retries: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const delayMs = Math.min(1000 * 2 ** networkRetries, NETWORK_ERROR_BACKOFF_CAP_MS);
    await sleep(delayMs);
    return request<T>(path, init, attempt, rateLimitRetries, networkRetries + 1, serverErrorRetries);
  }

  if (res.status === 401 && attempt === 0) {
    // Token may have been rejected server-side despite looking unexpired locally
    // (e.g. revoked). Drop the cache and retry once with a freshly fetched token.
    invalidateHahaToken();
    return request<T>(path, init, attempt + 1, rateLimitRetries, networkRetries, serverErrorRetries);
  }

  if (res.status === 429 && rateLimitRetries < RATE_LIMIT_MAX_RETRIES) {
    // The quota window is fixed (~1 minute), not something a short
    // exponential ramp helps with — 1s/2s/4s retries would all still land
    // inside the same exhausted window. Wait out something close to the
    // full window every time instead (unless the server's Retry-After says
    // otherwise), so each retry actually has a real chance of succeeding.
    const retryAfterHeader = res.headers.get("Retry-After");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const delayMs = Number.isFinite(retryAfterMs)
      ? Math.min(retryAfterMs, RETRY_AFTER_CAP_MS)
      : RATE_LIMIT_BACKOFF_CAP_MS;
    await sleep(delayMs);
    return request<T>(path, init, attempt, rateLimitRetries + 1, networkRetries, serverErrorRetries);
  }

  if (res.status >= 500 && serverErrorRetries < SERVER_ERROR_MAX_RETRIES) {
    // Confirmed live: HaHa can 500 on a specific record (not just 404 for
    // legitimately-unsupported operation types). Worth a couple of quick
    // retries in case it's transient before the caller treats it as fatal.
    const delayMs = Math.min(1000 * 2 ** serverErrorRetries, SERVER_ERROR_BACKOFF_CAP_MS);
    await sleep(delayMs);
    return request<T>(path, init, attempt, rateLimitRetries, networkRetries, serverErrorRetries + 1);
  }

  if (!res.ok) {
    throw new HahaApiError(
      res.status,
      `HaHa API request to ${path} failed: ${res.status} ${res.statusText}`
    );
  }

  const body = (await res.json()) as HahaEnvelope<T>;
  if (body.code !== 0) {
    throw new Error(`HaHa API error on ${path}: ${body.message ?? `code ${body.code}`}`);
  }

  return body.data;
}

export function hahaGet<T>(path: string, params?: QueryParams): Promise<T> {
  return request<T>(`${path}${buildQuery(params)}`, { method: "GET" });
}

export function hahaPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}
