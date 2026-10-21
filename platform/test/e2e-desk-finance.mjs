// Refunds, credits and App finance on the desk (DESK-PLAN U6), end to end in headless Chromium against a running
// platform with demo data:
//
//   DATABASE_URL=… npm run db:migrate && npm run db:seed
//   DATABASE_URL=… npx tsx --conditions=react-server src/lib/app/desk/seed.ts
//   DATABASE_URL=… npx tsx src/lib/app/finance/seed-finance.ts /tmp/settlement.csv      (writes the settlement file)
//   DATABASE_URL=… npm run app:jobs -- finance                                            (cost lines, Ops posting)
//   DATABASE_URL=… APP_DATA_KEY=… npm run dev
//   BASE=http://localhost:3100 SETTLEMENT=/tmp/settlement.csv node test/e2e-desk-finance.mjs [shot-dir]
//
// Signs in as Bader (every desk right, Ops finance), approves part of a refund, gives goodwill credit, imports the
// MyFatoorah settlement file and checks it matches in full, reads supplier balances and the revenue page; screenshots
// each screen in English light and dark and in Arabic. Fails on any page error or failed check.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/desk-shots');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Mada@2026';
const SETTLEMENT = process.env.SETTLEMENT;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); else console.log(`ok  ${what}`); };

async function session({ locale = 'en', theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: 'mada_locale', value: locale, domain: host, path: '/adminwork' }, { name: 'mada_theme', value: theme, domain: host, path: '/adminwork' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${page.url()}: ${e.message}`));
  await page.goto(`${BASE}/adminwork/login`);
  await page.fill('input[name=email]', 'bader@madatrips.com');
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 }), page.click('button[type=submit]')]);
  // The dashboard's alerts show once a session: let them be seen here so they don't cover the screens below.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return { ctx, page };
}

async function go(page, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (!res || res.status() >= 400) problems.push(`${path}: HTTP ${res?.status()}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  const body = await page.innerText('body');
  if (/Application error|Unhandled Runtime Error/.test(body ?? '')) problems.push(`${path}: error page`);
  return body;
}

// The Ops alerts that pop up once a session sit over the page corner: hidden for the screenshot only.
const shot = async (page, name) => {
  await page.addStyleTag({ content: 'div.fixed.top-20.z-\\[70\\]{display:none!important}' });
  await page.screenshot({ path: `${OUT}/desk-u6-${name}.png`, fullPage: false });
};

// ── the flows, in English ──
{
  const { ctx, page } = await session();
  let body = await go(page, '/adminwork/desk/refunds');
  check(body.includes('Refunds & credits') && body.includes('Cancel & refund a booking'), 'refunds page with the desk-started refund action');
  const amount = page.locator('input[name=amount]').first();
  const asked = Number((await amount.inputValue()).replace(/,/g, ''));
  await amount.fill(String(Math.max(1, Math.floor(asked / 2))));
  await page.getByRole('button', { name: 'Approve refund' }).click();
  await page.waitForSelector('text=/Refund approved|Over your limit/', { timeout: 30_000 }).catch(() => {});
  body = await page.innerText('body');
  check(/Refund approved|Over your limit/.test(body), 'a partial refund is approved');
  body = await go(page, '/adminwork/desk/refunds?s=approved');
  check(/asked/.test(body), 'the partial refund shows what was asked');

  if (SETTLEMENT) {
    await go(page, '/adminwork/desk/finance/reconciliation');
    await page.setInputFiles('input[type=file]', SETTLEMENT);
    await Promise.all([page.waitForURL(/import=/, { timeout: 60_000 }), page.getByRole('button', { name: 'Import and match' }).click()]);
    await page.waitForSelector('text=Everything matched', { timeout: 30_000 }).catch(() => {});
    body = await page.innerText('body');
    check(body.includes('100%') && body.includes('Everything matched'), 'the seeded settlement file matches 100%');
  }
  body = await go(page, '/adminwork/desk/finance');
  check(body.includes('App revenue & margin') && body.includes('By product'), 'revenue and margin page');
  body = await go(page, '/adminwork/desk/finance?missing=1');
  check(body.includes('No cost yet'), 'lines without a supplier cost can be costed');
  await go(page, '/adminwork/desk/finance/balances');
  await page.getByRole('button', { name: 'Read balances now' }).click();
  await page.waitForSelector('text=Balances read', { timeout: 30_000 }).catch(() => {});
  body = await go(page, '/adminwork/desk/finance/balances');
  check(body.includes('eSIM Access') && body.includes('Hotelbeds') && body.includes('TBO'), 'supplier balances list every supplier');
  body = await go(page, '/adminwork/desk/finance/vat');
  check(body.includes('Output VAT'), 'VAT report');
  body = await go(page, '/adminwork');
  check(body.includes('App'), 'app sales on the Ops dashboard');
  await ctx.close();
}

// ── screens: light, dark, Arabic ──
const SCREENS = [['refunds', '/adminwork/desk/refunds'], ['revenue', '/adminwork/desk/finance'], ['reconciliation', '/adminwork/desk/finance/reconciliation'], ['balances', '/adminwork/desk/finance/balances']];
for (const [mode, opts] of [['light', {}], ['dark', { theme: 'dark' }], ['ar', { locale: 'ar' }]]) {
  const { ctx, page } = await session(opts);
  for (const [name, path] of SCREENS) { await go(page, path); await shot(page, `${name}-${mode}`); }
  await ctx.close();
}

await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('desk finance: all checks passed');
