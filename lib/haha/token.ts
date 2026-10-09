import { hahaConfig } from "./config";
import { ENDPOINTS } from "./endpoints";
import type { HahaEnvelope, TokenData } from "./types";

// Token validity per the brief: 15 days, refreshable 2 days before expiry.
// Refresh a bit earlier than that to leave margin for a slow request.
// All values here are UNIX SECONDS (matching expires_at from the API), not ms —
// deliberately avoiding Date parsing/ms conversion for this comparison.
const REFRESH_MARGIN_SEC = 3 * 24 * 60 * 60; // 3 days
const DEFAULT_TTL_SEC = 15 * 24 * 60 * 60; // 15 days, if the API ever omits expires_at

// Module-level cache. This persists across requests within a single running
// process (dev server, or a warm serverless instance) but is NOT shared across
// serverless instances/regions and resets on cold start — acceptable for a
// prototype given the 15-day token lifetime, but note if this moves to
// production with heavier traffic, a shared cache (e.g. KV/Redis) would be sturdier.
let cachedToken: { token: string; expiresAt: number } | null = null;
let inFlightFetch: Promise<string> | null = null;

async function fetchNewToken(): Promise<{ token: string; expiresAt: number }> {
  // Obtain Token lives under a different base path than the rest of the API
  // (/open/auth/token, not /open/api/v1/...) — built from baseUrl directly,
  // skipping apiVersionPath.
  const res = await fetch(`${hahaConfig.baseUrl}${ENDPOINTS.obtainToken}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appkey: hahaConfig.appKey,
      appsecret: hahaConfig.appSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`HaHa token request failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as HahaEnvelope<TokenData>;
  if (body.code !== 0 || !body.data?.token) {
    throw new Error(`HaHa token request returned an error: ${body.message ?? "unknown error"}`);
  }

  const expiresAt = body.data.expires_at ?? Date.now() / 1000 + DEFAULT_TTL_SEC;
  return {
    token: body.data.token,
    expiresAt,
  };
}

export async function getHahaToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - REFRESH_MARGIN_SEC > Date.now() / 1000) {
    return cachedToken.token;
  }

  // Coalesce concurrent callers into a single outstanding fetch.
  if (!inFlightFetch) {
    inFlightFetch = fetchNewToken()
      .then(({ token, expiresAt }) => {
        cachedToken = { token, expiresAt };
        return token;
      })
      .finally(() => {
        inFlightFetch = null;
      });
  }

  return inFlightFetch;
}

export function invalidateHahaToken(): void {
  cachedToken = null;
}
