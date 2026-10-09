/**
 * Moneta Market portal discovery (Phase 1, local only).
 *
 * Opens a visible Chromium, logs into the operator portal with MONETA_EMAIL /
 * MONETA_PASSWORD, and records every request to a HAR while you click through
 * Sales Reports and Special Reports, run a report for a recent range, and try
 * any Export / Download button. Press Enter in the terminal to finish.
 *
 * Outputs (gitignored) in .moneta-discovery/<timestamp>/:
 *   raw.har         full traffic with response bodies; credentials scrubbed
 *   requests.json   compact per-request summary for analysis
 *   downloads/      any exported files (CSV / Excel)
 *   *.png           screenshots after login and at the end
 *
 * Run:  npx tsx --env-file=.env.local scripts/moneta-discover.ts
 *
 * Read only: the script itself only fills the login form. Do not save, edit,
 * or delete anything in the portal while it is recording.
 */
import { chromium, type Page } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'

const BASE_URL = process.env.MONETA_BASE_URL || 'https://www.monetamarket.com/NanoMarketATXWeb/'
const EMAIL = process.env.MONETA_EMAIL
const PASSWORD = process.env.MONETA_PASSWORD

if (!EMAIL || !PASSWORD) {
  console.error('MONETA_EMAIL and MONETA_PASSWORD must be set (e.g. in .env.local).')
  process.exit(1)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = path.join(process.cwd(), '.moneta-discovery', stamp)
const dlDir = path.join(outDir, 'downloads')
fs.mkdirSync(dlDir, { recursive: true })
const harPath = path.join(outDir, 'raw.har')

async function tryLogin(page: Page): Promise<boolean> {
  const pw = page.locator('input[type="password"]').first()
  try {
    await pw.waitFor({ state: 'visible', timeout: 15_000 })
  } catch {
    return false
  }
  const user = page
    .locator(
      'input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i], input[type="text"]',
    )
    .first()
  await user.fill(EMAIL!)
  await pw.fill(PASSWORD!)
  const submit = page
    .locator('button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in")')
    .first()
  if (await submit.count()) await submit.click()
  else await pw.press('Enter')
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
  return (await page.locator('input[type="password"]').count()) === 0
}

function scrub(text: string): string {
  let out = text
  for (const secret of [PASSWORD!, encodeURIComponent(PASSWORD!), EMAIL!, encodeURIComponent(EMAIL!)]) {
    if (secret) out = out.split(secret).join('[REDACTED]')
  }
  return out
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 })
  const context = await browser.newContext({
    acceptDownloads: true,
    recordHar: { path: harPath, content: 'embed', mode: 'full' },
    viewport: { width: 1400, height: 900 },
  })
  const page = await context.newPage()

  context.on('page', (p) => console.log(`[new tab] ${p.url()}`))
  context.on('response', (r) => {
    const ct = r.headers()['content-type'] || ''
    if (!/image|font|css|javascript/.test(ct)) {
      console.log(`${r.request().method().padEnd(6)} ${r.status()} ${ct.split(';')[0].padEnd(28)} ${r.url()}`)
    }
  })
  page.on('download', async (d) => {
    const file = path.join(dlDir, d.suggestedFilename())
    await d.saveAs(file)
    console.log(`[download] saved ${file}`)
  })

  console.log(`Opening ${BASE_URL}`)
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  const ok = await tryLogin(page)
  await page.screenshot({ path: path.join(outDir, 'after-login.png'), fullPage: true })
  console.log(ok ? '\nLogin looks successful.' : '\nCould not confirm login automatically; finish it by hand in the browser if needed.')

  console.log(`
Now, in the browser window:
  1. Open Sales Reports. Run a report for the last 7 days (all locations).
  2. If there is a transaction-level / detail report, run that too.
  3. Click any Export / Download / CSV / Excel button you see.
  4. Open Special Reports and repeat 1 to 3 for anything transaction-level.
  5. Page through results if the report is paginated.
Do NOT edit, save, or delete anything. Press Enter here when done.`)
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  await rl.question('')
  rl.close()

  await page.screenshot({ path: path.join(outDir, 'final.png'), fullPage: true }).catch(() => {})
  await context.close() // flushes the HAR
  await browser.close()

  // Scrub credentials from string values only (a raw text replace can hit bare
  // JSON numbers and corrupt the file), then write a compact summary.
  const scrubDeep = (v: any): any =>
    typeof v === 'string' ? scrub(v)
    : Array.isArray(v) ? v.map(scrubDeep)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)]))
    : v
  const har = scrubDeep(JSON.parse(fs.readFileSync(harPath, 'utf8')))
  fs.writeFileSync(harPath, JSON.stringify(har))
  const summary = har.log.entries
    .filter((e: any) => !/image|font|css|javascript/.test(e.response.content.mimeType || ''))
    .map((e: any) => ({
      time: e.startedDateTime,
      method: e.request.method,
      url: e.request.url,
      status: e.response.status,
      mime: e.response.content.mimeType,
      size: e.response.content.size,
      reqHeaders: Object.fromEntries(
        e.request.headers
          .filter((h: any) => /cookie|token|csrf|xsrf|authorization|x-requested|content-type/i.test(h.name))
          .map((h: any) => [h.name, h.value.length > 60 ? h.value.slice(0, 60) + '...' : h.value]),
      ),
      setCookie: e.response.headers.filter((h: any) => /set-cookie/i.test(h.name)).map((h: any) => h.value.split(';').slice(1).join(';')),
      postData: e.request.postData?.text?.slice(0, 2000),
      bodyPreview: (e.response.content.text || '').slice(0, 500),
    }))
  fs.writeFileSync(path.join(outDir, 'requests.json'), JSON.stringify(summary, null, 2))
  console.log(`\nSaved ${summary.length} requests to ${outDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
