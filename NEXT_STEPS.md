# Next Steps: HaHa velocity integration

_Last updated: 2026-10-09_

## Shipped to production 2026-10-09

- `/machines` and `/machines/[marketId]`: stockout-corrected sales velocity per machine, sortable, frozen headers, flags (Variety estimate, Too new, Short window, Much unknown, Unmapped, No restock history)
- Dashboard: Last Month and Custom Range presets (older days read from Supabase history), link to the velocity reports, purchases counted per shared timestamp instead of per line item
- Supabase history: USAT Jan 1 to Oct 8 (two exports layered), VendSoft snapshots from Sep 11, HaHa restock events from the prototype plus catch-up
- Daily sync: `/api/cron/daily-sync` at 11:00 UTC (6am Central), production only
- Product mapping: unmapped down from 90 to 7 across the fleet, all confirmed by Chris
- Addresses and the Sparq on Rio name come from `data/machine-addresses.json` and `data/machine-names.json`

## Check soon

- Confirm the first cron run on 2026-10-10: Vercel -> Logs, filter `/api/cron/daily-sync`, expect `ok: true` with yesterday in `daysWritten`

## Still unmapped (no sales under any known name)

Nerds Gummy Clusters 5oz, Red Bull Sugar Free Strawberry Apricot, Red Bull Sea Blue Juneberry, Snapple multi-flavor 20oz, Ritz Cheese Sandwich Crackers, Bumble Bee Chicken Salad, Ruffles Baked Cheddar

## Ideas, not started

- Backfill missed days automatically from HaHa's GET /open/api/v1/sales (full history back to Feb 2025, saleItems carry productId)
- A Postgres function to aggregate long custom ranges server-side if multi-month ranges get slow
