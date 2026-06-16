# Nano Market ATX — Operations Dashboard

Live sales dashboard pulling directly from VendSoft API.

## Features (v1)
- Google sign-in, restricted to a whitelist of emails
- All locations with revenue + transaction count
- Date presets: Today, Yesterday, Last 7 Days, Month To Date
- Click a location for its chronological transaction detail
- Sort by revenue, transactions, or name
- Portfolio summary cards (total revenue, txns, avg ticket, top location)

## Local Development

```bash
npm install
cp .env.local.example .env.local
# Fill in your keys in .env.local
npm run dev
```

Open http://localhost:3000

## Authentication (Supabase, email/password)

Every page and API route is gated by [Supabase Auth](https://supabase.com/auth)
(`@supabase/ssr`) via `middleware.ts`. Unauthenticated visitors are redirected
to `/login`; API routes return `401`.

**Set up:**

1. Create a project at https://supabase.com
2. **Project Settings → API** — copy the **Project URL** and **anon key** into
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. There is **no public sign-up** — create each user yourself under
   **Authentication → Users → Add user** (set "Auto Confirm User" so they can
   log in immediately). This keeps access locked to people you add.

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → New Project → Import your repo
3. Add Environment Variables:
   - `VENDSOFT_API_KEY` = (your VendSoft API key)
   - `VENDSOFT_CUSTOMER_ID` = (your VendSoft customer ID)
   - `NEXT_PUBLIC_SUPABASE_URL` = (your Supabase project URL)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = (your Supabase anon key)
   - `ANTHROPIC_API_KEY` = (optional, future Claude Q&A feature)
4. Deploy

## VendSoft API
Base URL: `https://secure.vendsoft.com/api/v2`
Auth: HTTP Basic — API key as username, customer ID as password.
Both `VENDSOFT_API_KEY` and `VENDSOFT_CUSTOMER_ID` are required.
