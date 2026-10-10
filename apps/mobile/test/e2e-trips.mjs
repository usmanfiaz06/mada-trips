// The trip companion (M3), end to end, in headless Chromium against the web export (react-native-web, mock API).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-trips.mjs [shot-dir]
//
// Signs in as the demo account (+966 50 000 4127, which has the Istanbul family trip), then walks Today through every
// phase of the trip clock with the demo panel (Booked → Day before → Travel day → Delayed → Cancelled → In the air →
// Landed → Home), the Trips tab (Upcoming, Requests, Past), the trip detail and its Manage screens (itinerary with its
// sheets, payments, an invoice and the company tax invoice, a refund to Mada credit, flight change, hotel options,
// special requests), the disruption screens (delay, cancellation, and a choice made offline that waits in the outbox),
// screenshotting each at 390×844. Fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-trips');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
let n = 0;
const step = (s) => console.log('·', s);

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
await context.addInitScript(() => { window.print = () => {}; });
const page = await context.newPage();
page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });

const shot = async (name) => { n += 1; await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
const see = async (text, what, timeout = 8000) => {
  try { await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); return true; }
  catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
};
const byTest = (id) => page.locator(`[data-testid="${id}"]`);
const tapText = async (text) => { await page.getByText(text, { exact: false }).first().click(); await page.waitForTimeout(500); };
const scroll = async (px = 700) => { await page.mouse.move(195, 420); await page.mouse.wheel(0, px); await page.waitForTimeout(500); };
const back = async () => { await page.getByRole('button', { name: /^(Back|Close)$/ }).first().click(); await page.waitForTimeout(600); };
const closeSheet = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(300); const c = page.getByRole('button', { name: 'Close' }); if (await c.count()) { await c.last().click().catch(() => {}); } await page.waitForTimeout(400); };
const toTab = async () => { for (let i = 0; i < 6 && (await page.getByRole('button', { name: /^(Back|Close)$/ }).count()); i += 1) await back(); };
const tab = async (name) => { await page.getByRole('tab', { name, exact: true }).first().click().catch(async () => { await tapText(name); }); await page.waitForTimeout(700); };

async function phase(p) {
  await tab('Today');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll('div')) if (el.scrollTop > 0) el.scrollTop = 0; });
    await page.waitForTimeout(400);
    const date = byTest('today-date').first();
    await date.waitFor({ state: 'visible', timeout: 15000 });
    await date.click({ delay: 800 });
    try { await byTest(`demo-${p}`).waitFor({ state: 'visible', timeout: 3000 }); break; } catch { /* the long press didn't land: again */ }
  }
  await byTest(`demo-${p}`).click();
  await page.waitForTimeout(1500);
}

async function signIn() {
  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await see('Enter the code', 'otp');
  await byTest('otp-input').fill('123456');
  if (await see('Welcome back', 'welcome back', 6000)) await byTest('welcome-back-open').click();
  await page.waitForTimeout(1500);
}

try {
  step('sign in as the demo account');
  await signIn();

  /* ── Today, phase by phase ── */
  for (const [p, text] of [['booked', 'Istanbul'], ['daybefore', 'Istanbul'], ['travelday', 'SV263'], ['delayed', 'SV263'], ['cancelled', 'cancelled'], ['inair', 'Istanbul'], ['landed', 'Istanbul'], ['home', 'Istanbul']]) {
    step(`today: ${p}`);
    await phase(p);
    await see(text, `today ${p}`);
    await shot(`today-${p}-top`);
    await scroll(700);
    await shot(`today-${p}-scroll`);
  }

  step('travel day: the gate change arrives');
  await phase('travelday');
  await page.waitForTimeout(7000);
  await see('C4', 'gate change');
  await shot('today-travelday-gate');

  /* ── Disruption: delay, then a cancellation chosen offline ── */
  step('disruption: delay');
  await phase('delayed');
  await byTest('see-plan').first().click();
  await page.waitForTimeout(1200);
  await see('hours late', 'delay headline');
  await shot('disruption-delay');
  await byTest('dz-confirm').click();
  await page.waitForTimeout(500);
  await shot('disruption-working');
  await see('Back to today', 'disruption done', 10000);
  await shot('disruption-done');
  await byTest('dz-home').click();
  await page.waitForTimeout(3000);
  await shot('today-after-rebook');

  /* ── Trips tab and trip management (booked: everything still changeable) ── */
  await phase('booked');
  step('trips tab');
  await tab('Trips');
  await see('Istanbul', 'trips list');
  await shot('trips-list');
  await byTest('tab-requests').click(); await page.waitForTimeout(600);
  await shot('trips-requests');
  await byTest('tab-past').click(); await page.waitForTimeout(600);
  await shot('trips-past');
  await byTest('tab-upcoming').click(); await page.waitForTimeout(600);

  step('itinerary');
  await byTest('card-itinerary').first().click();
  await page.waitForTimeout(1200);
  await see('day by day', 'itinerary title');
  await shot('itinerary-top');
  await scroll(900);
  await shot('itinerary-free-days');
  await byTest('itin-chip-0').click();
  await page.waitForTimeout(600);
  await page.locator('[data-testid^="itin-item-"]').filter({ hasText: 'SV' }).first().click();
  await page.waitForTimeout(500);
  await shot('itinerary-flight-sheet');
  await closeSheet();
  await byTest('itin-cal').click(); await page.waitForTimeout(500);
  await shot('itinerary-calendar');
  await closeSheet();
  await byTest('itin-share').click(); await page.waitForTimeout(500);
  await see('Passport numbers', 'share hides passports');
  await shot('itinerary-share');
  await closeSheet();
  await back();

  step('trip detail');
  await byTest('trip-card-Istanbul').first().click();
  await page.waitForTimeout(1200);
  await shot('trip-detail');
  await scroll(800);
  await shot('trip-detail-manage');

  step('payments and invoices');
  await tapText('Payments and invoices');
  await page.waitForTimeout(800);
  await see('Tap any payment', 'payments');
  await shot('payments');
  await page.locator('[data-testid^="payment-"]').first().click();
  await page.waitForTimeout(1200);
  await see('Simplified tax invoice', 'invoice');
  await shot('invoice');
  await tapText('Invoice for a company');
  await page.waitForTimeout(500);
  await byTest('co-save').click(); await page.waitForTimeout(300);
  await shot('invoice-company-errors');
  await closeSheet();
  await back(); await back();

  step('refund to Mada credit');
  await tapText('Ask for a refund');
  await page.waitForTimeout(1000);
  await see('What should we refund?', 'refund');
  await shot('refund');
  await page.locator('[data-testid^="refund-"]').filter({ hasNotText: 'Nothing back' }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await tapText('Plans changed');
  await byTest('dest-credit').click().catch(() => {});
  await scroll(600);
  await shot('refund-picked');
  await back();

  step('change flight');
  await tapText('Change flight');
  await page.waitForTimeout(1000);
  await see('What would you like to change?', 'change kinds');
  await shot('change-flight');
  await tapText('Another day');
  await page.waitForTimeout(1000);
  await shot('change-flight-days');
  await back();

  step('hotel options');
  await tapText('Hotel options');
  await page.waitForTimeout(900);
  await shot('hotel-options');
  await byTest('ho-room').click(); await page.waitForTimeout(500);
  await shot('hotel-room-sheet');
  await closeSheet();
  await back();

  step('special requests');
  await tapText('Special requests');
  await page.waitForTimeout(900);
  await see('Anything you need?', 'special requests');
  await shot('special-requests');
  await byTest('sr-bags').click(); await page.waitForTimeout(500);
  await shot('special-bags-sheet');
  await closeSheet();

  /* ── Last, because a refund takes the whole trip away: a cancellation chosen offline, sent on reconnect ── */
  await toTab();
  step('disruption: cancellation, offline');
  await phase('cancelled');
  await byTest('see-options').first().click();
  await page.waitForTimeout(1200);
  await shot('disruption-cancel');
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); });
  await context.setOffline(true);
  await page.waitForTimeout(800);
  await byTest('dz-opt-refund').click().catch(() => {});
  await byTest('dz-confirm').click();
  await page.waitForTimeout(800);
  await see('Saved on your phone', 'queued offline');
  await shot('disruption-queued');
  await context.setOffline(false);
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); });
  await page.waitForTimeout(6000);
  await shot('disruption-sent-after-reconnect');
  await page.waitForTimeout(800);
  await shot('trips-after-refund');

} catch (e) {
  errors.push(`crash: ${e.message}`);
  console.log('CRASH', e.message);
  await page.screenshot({ path: join(OUT, 'zz-crash.png') }).catch(() => {});
}

await browser.close();
server.close();
console.log(`\n${n} screenshots in ${OUT}`);
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log('All good.');
