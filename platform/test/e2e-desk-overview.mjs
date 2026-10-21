// The desk overview and its alerts (DESK-PLAN U8), end to end in headless Chromium against a running platform with
// demo data:
//
//   DATABASE_URL=… npm run db:migrate && npm run db:seed
//   DATABASE_URL=… npx tsx --conditions=react-server src/lib/app/desk/seed.ts            (and seed-board, seed-agents)
//   DATABASE_URL=… npm run app:jobs -- desk                                                (tickets and alerts)
//   DATABASE_URL=… APP_DATA_KEY=… npm run dev
//   BASE=http://localhost:3100 node test/e2e-desk-overview.mjs [shot-dir]
//
// Signs in as Bader (every desk right), opens the overview and follows its numbers: each backlog cell, priority and age,
// each funnel step and today's drop-offs must equal the count on the list it opens. Opens the bell (the desk's alerts)
// and screenshots the overview in English light and dark and in Arabic. Fails on any page error or failed check.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/desk-shots');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Mada@2026';
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

const shot = async (page, name) => {
  await page.addStyleTag({ content: 'div.fixed.top-20.z-\\[70\\]{display:none!important}' });
  await page.screenshot({ path: `${OUT}/desk-u8-${name}.png`, fullPage: false });
};

/** The number on a list page's summary strip: "{n} tickets", "{n} rows", "{n} drop-offs". */
const summaryCount = (body, word) => Number((body.match(new RegExp(`(\\d+) ${word}`)) ?? [])[1] ?? NaN);

{
  const { ctx, page } = await session();
  const body = await go(page, '/adminwork/desk/overview');
  check(/Desk overview/.test(body), 'overview opens');
  check(await page.locator('nav a[href="/adminwork/desk/overview"]').count() > 0, 'Overview is in the sidebar');

  // Every number that links somewhere: read the number and the link, then the list's own count.
  const links = await page.$$eval('[data-n]', (els) => els.map((e) => ({ n: e.getAttribute('data-n'), v: e.textContent?.trim(), href: e.closest('a')?.getAttribute('href') ?? null })));
  const targets = links.filter((l) => l.href && /^(cell-|priority-|funnel-|backlog$|dropoffs$|urgent$)/.test(l.n));
  check(targets.length >= 6, `the overview's numbers link to lists (${targets.length})`);
  for (const l of targets) {
    const n = Number(l.v);
    const b = await go(page, l.href);
    const word = l.href.includes('/overview/funnel') ? 'rows' : l.href.includes('/drop-offs') ? 'drop-offs' : 'tickets';
    check(summaryCount(b, word) === n, `${l.n} = ${n} matches ${l.href} (${summaryCount(b, word)})`);
  }

  await go(page, '/adminwork/desk/overview');
  await shot(page, 'overview-light');
  await page.click('button[aria-label="Notifications"]');
  await page.waitForTimeout(400);
  const bell = await page.innerText('body');
  check(/is late:/.test(bell), 'the bell shows the SLA breach alerts');
  await page.screenshot({ path: `${OUT}/desk-u8-bell-light.png`, fullPage: false });
  await go(page, '/adminwork/desk/overview/funnel?step=paid');
  await shot(page, 'funnel-light');
  await go(page, '/adminwork');
  check(await page.locator('[data-testid=desk-briefing]').count() === 1, 'the Ops dashboard carries the desk line');
  await ctx.close();
}

for (const [locale, theme] of [['en', 'dark'], ['ar', 'light'], ['ar', 'dark']]) {
  const { ctx, page } = await session({ locale, theme });
  const body = await go(page, '/adminwork/desk/overview');
  if (locale === 'ar') {
    check(/نظرة عامة على الفريق/.test(body), `Arabic overview (${theme})`);
    check(await page.evaluate(() => document.documentElement.dir) === 'rtl', 'Arabic is right to left');
  }
  await shot(page, `overview-${locale === 'ar' ? 'ar' : 'en'}-${theme}`);
  await ctx.close();
}

await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('desk overview e2e: all checks passed');
