# CLAUDE.md

Context for future Claude Code sessions working on the **Nano Market ATX — Operations Dashboard**.

## What this is

A live sales dashboard for a vending business (Nano Market ATX / Smart Vending ATX LLC). It pulls machine + sales data from the **VendSoft API** server-side and renders a per-location revenue/transaction view, gated behind email/password login.

## Tech stack

- **Next.js 14.2.x** (App Router) — pinned to a patched 14.2 release (≥14.2.25 fixed CVE-2025-29927, a middleware auth-bypass; do not downgrade)
- **React 18**, **TypeScript**, **Tailwind CSS**
- **Supabase Auth** via `@supabase/ssr` (email/password)
- **VendSoft API** as the data source (server-side only)
- Deployed on **Vercel** (auto-deploys on push to `main`)
- `@anthropic-ai/sdk` is installed but not yet used (reserved for a planned Claude Q&A feature)

## Project layout

```
app/
  layout.tsx                      # root layout; signed-in bar + sign-out; wraps getUser in try/catch
  page.tsx                        # dashboard (client component): presets, summary cards, table, transaction drawer
  login/page.tsx                  # email/password form
  login/actions.ts                # 'use server' login action (signInWithPassword)
  globals.css
  api/
    vendsoft/route.ts             # GET: all locations w/ revenue + txn counts for a date range
    transactions/route.ts         # GET ?machine=&preset=: chronological transactions for one machine
    test/route.ts                 # GET ?path=: raw auth-probe diagnostic (tries all auth strategies)
lib/
  vendsoft.ts                     # VendSoft client: auth, machines, sales aggregation, transactions
  dates.ts                        # Preset type + getDateRange()
  supabase/
    server.ts                     # server client (cookies via next/headers)
    client.ts                     # browser client
    middleware.ts                 # updateSession(): refresh cookie + gate routes (fails closed, never 500s)
middleware.ts                     # runs updateSession on all routes except static assets
```

## VendSoft API — how auth works

- Base URL: `https://secure.vendsoft.com/api/v2` (server-side only; never call from the browser).
- **Auth is HTTP Basic**, NOT the `api_key` header their docs describe. The working scheme is:
  `Authorization: Basic base64("<VENDSOFT_API_KEY>:<VENDSOFT_CUSTOMER_ID>")` — API key as username, customer ID as password. **Both env vars are required.**
- `lib/vendsoft.ts` `vsGet()` tries multiple auth strategies in order (header `api_key`, query `?api_key=`, `X-Customer-ID` header, Basic auth), logs each attempt (key masked), and **caches the first one that returns 2xx**. This is defensive — if VendSoft changes auth, it self-discovers again. The probe route `/api/test` exposes all attempts with raw bodies for debugging.

### Key data quirks (important)
- **The sales endpoint ignores `from`/`to` query params.** It always returns a rolling **~30-day window** of raw vend line-items. So date filtering is done **client-side** by parsing each row's `transactionTime` ("YYYYMMDDHHMMSS"). **Consequence: date ranges older than ~30 days return no data.**
- A sales record is one **line item**: `{ transactionId, transactionTime, productName, price, quantity, creditCard, ... }`.
- **Revenue** = Σ(`price` × `quantity`). **Transaction count** = distinct `transactionId` (one card swipe can buy several line-items).
- Machine list lives at `/machines`; `machineCode` values are small integers ("2", "3", ...).

## Dashboard features

- **Date presets** (`lib/dates.ts`): Today, Yesterday, Last 7 Days, Month To Date. (Custom range was removed from the UI, but `/api/vendsoft?from=&to=` still works for direct calls.)
- **Summary cards**: total revenue, transactions, avg ticket, top location.
- **Locations table**: per-machine revenue, txn count, avg ticket; sortable by amount / transactions / name; mini revenue bar.
- **Transaction detail drawer**: click any row → right-side drawer lists that machine's transactions for the active range, newest first (date/time, items purchased w/ qty, amount, cash/card), with a footer total. Locations whose machine name contains "freezer" show an "F" badge in the table. Note: the drawer reflects the preset at click time; switching presets while open doesn't auto-refresh.

## Supabase auth setup

- Every page and API route is gated by `middleware.ts` → `updateSession()`. Unauthenticated → redirect to `/login`; `/api/*` → 401.
- Uses `getUser()` (validates token server-side) — never `getSession()` — in middleware.
- **Fails closed, never crashes**: missing/invalid Supabase config redirects to `/login?error=...` (or 503 for API) instead of throwing `MIDDLEWARE_INVOCATION_FAILED`. Layout `getUser()` is also wrapped in try/catch.
- **No public sign-up.** Create users manually in Supabase → Authentication → Users → Add user (enable "Auto Confirm User"). This is the access whitelist.
- Project uses the new Supabase key format (`sb_publishable_...`) — supabase-js ≥2.108 supports it.

### Deployment gotcha
`NEXT_PUBLIC_*` vars are **inlined at build time**. After setting/changing them in Vercel you must **redeploy**, and they must be scoped to the **Production** environment. A common 500 cause is vars set after the build, or scoped only to Preview.

## Environment variables

Local: `.env.local` (gitignored). Production: Vercel → Settings → Environment Variables. See `.env.local.example`.

| Variable | Required | Purpose |
|---|---|---|
| `VENDSOFT_API_KEY` | yes | VendSoft Basic-auth username |
| `VENDSOFT_CUSTOMER_ID` | yes | VendSoft Basic-auth password |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon / publishable key (RLS-gated, browser-safe) |
| `ANTHROPIC_API_KEY` | no | Reserved for the planned Claude Q&A feature |

## Conventions / notes

- `@/*` path alias maps to the project root (see `tsconfig.json`).
- VendSoft logging in `vsGet()` masks the key (first/last chars + length) — keep secrets out of logs.
- Run `npx tsc --noEmit` to typecheck and `npm run build` before pushing; clear `.next/types` if stale type errors reference deleted routes.
- Commits in this repo are pushed to `main`, which triggers Vercel deploys.

## Security debt (address when touching these)

- The original VendSoft API key was committed in `README.md` in git **history** (commit `52caba5`); it's scrubbed from the working tree but still in history. **Rotate the VendSoft key** if the repo is/was public; a history rewrite (`git filter-repo`) would be needed to fully purge it.
- The `sb_publishable_...` key was shared in a chat session; consider rolling it in Supabase → Settings → API.

## Planned next features

- **Claude Q&A** over the sales data (the reason `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` exist). Use the latest model (e.g. Opus 4.x); see the `claude-api` skill for current model IDs/pricing.
- **Historical data beyond ~30 days** — the VendSoft sales window is rolling, so true history needs caching daily snapshots (e.g. a Supabase table + a daily cron) or a different VendSoft endpoint.
- **Live drawer refresh** — re-fetch the transaction drawer when the preset changes while it's open.
- **Per-location grouping** — multiple machines share a location name (e.g. "415 Colorado" + "415 Colorado Freezer"); consider aggregating by location.
- **CSV export** of the current view.
- **Charts** — revenue trend over time once historical data exists.
