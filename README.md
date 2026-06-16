# Nano Market ATX — Operations Dashboard

Live sales dashboard pulling directly from VendSoft API.

## Features (v1)
- All locations with revenue + transaction count
- Date presets: Today, Yesterday, Last 7 Days, Last 30 Days, Custom
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

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to vercel.com → New Project → Import your repo
3. Add Environment Variables:
   - `VENDSOFT_API_KEY` = C7WM7TI5DK3LW5DI
   - `ANTHROPIC_API_KEY` = (your key from console.anthropic.com)
4. Deploy

## VendSoft API
Base URL: `https://secure.vendsoft.com/api/v2`
Auth: `api_key` header
