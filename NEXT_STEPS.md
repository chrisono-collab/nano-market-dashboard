# Next Steps: HaHa velocity integration (Phase 2)

_Last updated: 2026-10-09_

Branch: `haha-velocity-integration` (local commits, not pushed yet). Do not merge to `main` until Chris reviews the preview.

## Built and verified

- Supabase schema: `supabase/migrations/0001_haha_velocity.sql` (sales_line_items, restock_events, restock_scan_state; RLS read for signed-in users, writes via service role only)
- HaHa API client ported to `lib/haha/` (fetches marked no-store so Next 14 never caches them)
- Velocity engine ported to `lib/velocity.ts`. Checked against the Python prototype on The Bowen: 36 of 38 products match exactly; the other 2 have 6 days of history and are now flagged "Too new" (under 7 days) with velocity blank
- Known data gaps (spans with no sales from any source) count as unknown days, never in stock
- Daily sync: `/api/cron/daily-sync` + `vercel.json` cron (11:00 UTC). Re-snapshots VendSoft's last 7 completed days (handles upload lag), then scans new HaHa restock logs within a 240s budget
- Pages: `/machines` (HaHa's live list, name + street address, framed as velocity reports) and `/machines/[marketId]` (sortable table, default velocity descending, every column sortable, flags: Variety estimate, Too new, Short window, Much unknown, Unmapped, No restock history)
- Product naming: `displayName` added to `data/product-name-mapping.json` for 37 products, auto-matched to the warehouse sheet; others fall back to the USAT/VendSoft sales name. Variety rows show the warehouse line name with the HaHa flavor underneath
- One-time bootstrap scripts: `scripts/bootstrap_usat_sales.py`, `scripts/bootstrap_restock_events.py`. USAT labels resolve to HaHa marketIds via VendSoft machineCode -> telemetryId (all 27 labels resolve)
- `npx tsc --noEmit` and `npm run build` pass
- Existing files touched (minimal): `lib/supabase/middleware.ts` (lets `/api/cron/*` through; route checks CRON_SECRET), `lib/vendsoft.ts` (new `getRawMachineSales` export only), `.gitignore`, `CLAUDE.md`, `.env.local.example`

## Waiting on Chris

1. OK to add to Vercel (Production + Preview): HAHA_APP_KEY, HAHA_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET

## Then (Claude)

1. Push branch, check the Vercel preview URL (Chris logs in; Claude can't use real credentials)
2. Review together; merge only on Chris's approval. Cron runs only on production, so it starts after merge

## Done 2026-10-09

- Schema applied, service key added, restock events loaded (21,741 + 176 caught up), USAT history loaded (Jan 1 to Oct 8, from two exports layered), VendSoft Sep 11 to Oct 8 snapshotted. No data gaps remain
- No more USAT exports needed: daily VendSoft snapshots prevent gaps from now on
- Safety net if a day is ever missed: HaHa's GET /open/api/v1/sales has full history back to Feb 2025 (oldest-first paging, saleItems carry productId). Not wired in yet

## Open questions

- Nutella &Go! (A2024091800011) was "pending Chris's input" in the prototype; the new code treats it like any other product (no special exclusion)
- HaHa no longer lists Johnstone Plumbing (B71976) or Johnstone Metric (B85236) but VendSoft still shows sales for them; new HaHa machines Sqarq on Rio and Baer Manufacturing have little or no history yet
- Optional: add a "Velocity reports" link to the main dashboard header (left out to keep existing pages untouched)
