// Customer 360 and ⌘K search on the desk (DESK-PLAN U3), in headless Chromium against a running platform with demo data.
//
//   (the setup in test/e2e-desk.mjs, then) DATABASE_URL=… npx tsx --conditions=react-server src/lib/app/desk/seed-customers.ts
//   BASE=http://localhost:3100 node test/e2e-desk-customers.mjs [shot-dir]
//
// As Faisal's login (support agent): finds Sara by phone, PNR and ICCID on the list and in ⌘K, opens her profile,
// sees passports masked, opens the Ask conversation handed to the desk and is refused Yousef's, which wasn't. As Bader
// (lead): reads Yousef's, gives goodwill credit, blocks and unblocks. Screenshots light, dark and Arabic. Fails on any
// page error.
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
const check = (ok, what) => { if (!ok) problems.push(what); else console.log(`ok  ${what}`); };

async function session(email, { locale = 'en', theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: 'mada_locale', value: locale, domain: host, path: '/adminwork' }, { name: 'mada_theme', value: theme, domain: host, path: '/adminwork' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${email} ${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Download the React DevTools|favicon|status of 404/.test(m.text())) problems.push(`${email} console ${page.url()}: ${m.text().slice(0, 300)}`); });
  await page.goto(`${BASE}/adminwork/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 }), page.click('button[type=submit]')]);
  return { ctx, page };
}

async function go(page, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (!res || res.status() >= 400) problems.push(`${path}: HTTP ${res?.status()}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  const body = await page.innerText('body');
  if (/Application error|Unhandled Runtime Error|Something went wrong/.test(body ?? '')) problems.push(`${path}: error page`);
  return body;
}

const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/desk-u3-${name}.png`, fullPage: false }); };

async function sara(page) {
  await go(page, '/adminwork/desk/customers?q=0500004127');
  const href = await page.locator('a[href^="/adminwork/desk/customers/"]').first().getAttribute('href');
  return href;
}

// ── the support agent ──
{
  const { ctx, page } = await session('counter@madatrips.com');
  for (const [q, who] of [['0500004127', 'Sara Alqahtani'], ['+966 50 000 4127', 'Sara Alqahtani'], ['JED4KT', 'Sultan Aldosari'], ['8997212330012345678', 'Sara Alqahtani'], ['12345678', 'Sara Alqahtani']]) {
    const body = await go(page, `/adminwork/desk/customers?q=${encodeURIComponent(q)}`);
    check(body.includes(who), `list finds ${who} by ${q}`);
  }
  for (const [q, want] of [['500004127', 'Sara'], ['JED4KT', 'O-'], ['8997212330012345678', '8997212330012345678']]) {
    const t0 = Date.now();
    const res = await page.request.get(`${BASE}/adminwork/api/search?q=${encodeURIComponent(q)}`);
    const hits = await res.json();
    check(hits.some((h) => h.label.includes(want)), `⌘K finds ${q} (${Date.now() - t0}ms)`);
  }
  await go(page, '/adminwork/desk/customers');
  await shot(page, 'customers-light');
  await page.keyboard.press('Control+k');
  await page.waitForFunction(() => document.activeElement?.tagName === 'INPUT' && document.activeElement.closest('.fixed'));
  await page.keyboard.type('JED4KT', { delay: 20 });
  await page.waitForTimeout(900);
  check((await page.innerText('body')).includes('JED4KT'), '⌘K palette shows the PNR hit');
  await shot(page, 'search-light');
  await page.keyboard.press('Escape');

  const s = await sara(page);
  const body = await go(page, s);
  check(body.includes('••••••107') && !body.includes('A11493107'), 'passports masked to the last three for an agent');
  check(body.includes('Next step'), 'profile has the next-step rail');
  await shot(page, 'profile-light');
  const chats = await go(page, `${s}?tab=chats`);
  check(chats.includes('Ask Mada conversations'), 'chats tab lists Ask conversations');
  await Promise.all([page.waitForURL(/ask=/), page.locator('a[href*="&ask="]').first().click()]);
  await page.waitForSelector('text=Seats on Saudia SV263', { timeout: 30_000 }).catch(() => {});
  check((await page.innerText('body')).includes('Seats on Saudia SV263'), 'agent reads the handed-off Ask conversation');
  await page.evaluate(() => window.scrollTo(0, document.getElementById('ask').getBoundingClientRect().top + window.scrollY - 110));
  await shot(page, 'ask-light');
  for (const tab of ['bookings', 'payments', 'credit', 'esims', 'requests', 'memory', 'audit']) {
    const b = await go(page, `${s}?tab=${tab}`);
    if (tab === 'bookings') check(/Istanbul/.test(b), 'bookings tab shows the trips');
    if (tab === 'esims') check(b.includes('8997212330012345678'), 'eSIMs tab shows the ICCID');
    if (tab === 'memory') check(b.includes('aisle'), 'memory tab shows what Mada remembers');
    if (tab === 'audit') check(b.includes('Read an Ask Mada conversation'), 'history shows the Ask read');
  }
  await go(page, '/adminwork/desk/customers?q=Yousef');
  const y = await page.locator('a[href^="/adminwork/desk/customers/"]').first().getAttribute('href');
  const ya = await go(page, `${y}?tab=chats`);
  check(ya.includes('Ask Mada conversations') && (await page.locator('a[href*="&ask="]').count()) === 0, "agent can't open Yousef's Ask conversation (not handed over, nothing open)");
  const orders = await go(page, '/adminwork/desk/orders?s=all');
  check((await page.locator('a[href^="/adminwork/desk/customers/"]').count()) > 0 && orders.length > 0, 'traveller names on Orders link to the customer');
  await ctx.close();
}

// ── the lead ──
{
  const { ctx, page } = await session('bader@madatrips.com');
  await go(page, '/adminwork/desk/customers?q=Yousef');
  const y = await page.locator('a[href^="/adminwork/desk/customers/"]').first().getAttribute('href');
  await go(page, `${y}?tab=chats`);
  check((await page.locator('a[href*="&ask="]').count()) > 0, 'a lead can open any Ask conversation');
  await go(page, y);
  await page.fill('input[name=amount]', '75');
  await page.fill('textarea[name=note]', 'For the slow eSIM install');
  await page.getByRole('button', { name: 'Add credit' }).click();
  await page.waitForSelector('text=Goodwill credit added', { timeout: 30_000 }).catch(() => {});
  check((await page.innerText('body')).includes('Goodwill credit added'), 'lead gives goodwill credit');
  page.once('dialog', (d) => d.accept());
  await page.fill('textarea[name=reason]', 'Testing the block from the profile');
  await page.getByRole('button', { name: 'Block account' }).click();
  await page.waitForSelector('text=Lift the block', { timeout: 30_000 }).catch(() => {});
  check((await page.innerText('body')).includes('Lift the block'), 'lead blocks the account');
  await page.getByRole('button', { name: 'Lift the block' }).click();
  await page.waitForSelector('text=Block account', { timeout: 30_000 }).catch(() => {});
  check((await page.innerText('body')).includes('Block account'), 'lead lifts the block');
  await ctx.close();
}

// ── dark and Arabic ──
for (const [locale, theme, tag] of [['en', 'dark', 'dark'], ['ar', 'light', 'ar']]) {
  const { ctx, page } = await session('bader@madatrips.com', { locale, theme });
  await go(page, '/adminwork/desk/customers');
  await shot(page, `customers-${tag}`);
  const s = await sara(page);
  await go(page, s);
  await shot(page, `profile-${tag}`);
  await ctx.close();
}

await browser.close();
if (problems.length) { console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`); process.exit(1); }
console.log('\nCustomer pages: all good.');
