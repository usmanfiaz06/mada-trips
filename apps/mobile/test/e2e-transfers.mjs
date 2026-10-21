// Airport pickups, vouchers and hotel details (Hotelbeds), end to end in headless Chromium against the web export
// (react-native-web, mock API), in English and in Arabic.
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-transfers.mjs [shot-dir]
//
// Signs in as the demo account (the Istanbul family trip), opens the trip: its hotel voucher (reference, essential
// information, the payment statement), cancelling it (what it costs first, then cancelled); the Airport pickup screen
// (private and shared options with prices and rules), choosing one and sending it to the desk, the "with Faisal" state;
// a Hotelbeds hotel's details. Screenshots each at 390×844. Fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-transfers');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
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

const COPY = {
  en: { welcome: "We'll take it from here.", otp: 'Enter the code', back: 'Welcome back', voucher: 'Hotel voucher', ref: 'Booking reference', payable: 'acting as agent for the service operating company', essential: 'Essential information', cancel: 'Cancel this booking', free: 'Cancelling now is free.', cancelled: 'Cancelled', pickup: 'Airport pickup', private: 'Private', shared: 'Shared', send: 'Send to Mada', withAgent: 'With ', facilities: 'At the hotel' },
  ar: { welcome: '', otp: '', back: '', voucher: 'قسيمة الفندق', ref: 'رقم الحجز', payable: 'acting as agent for the service operating company', essential: 'معلومات مهمة', cancel: 'ألغِ هذا الحجز', free: 'الإلغاء الحين مجاني.', cancelled: 'ملغي', pickup: 'الاستقبال من المطار', private: 'خاص', shared: 'مشترك', send: 'أرسله لمادا', withAgent: 'مع ', facilities: 'في الفندق' },
};

async function run(lang) {
  const c = COPY[lang];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'ar' ? 'ar-SA' : 'en-GB', timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${lang} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const shot = async (name) => { n += 1; await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${lang}-${name}.png`) }); };
  const see = async (text, what, timeout = 8000) => {
    try { await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${lang} ${what}: expected "${text}"`); console.log('MISSING', lang, what, '→', text); return false; }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  const go = async (path) => { await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await page.waitForTimeout(1500); };
  const scroll = async (px = 700) => { await page.mouse.move(195, 420); await page.mouse.wheel(0, px); await page.waitForTimeout(500); };

  step(`${lang}: sign in as the demo account`);
  await page.goto(ORIGIN + '/');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').waitFor({ state: 'visible', timeout: 15000 });
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await byTest('otp-input').waitFor({ state: 'visible', timeout: 10000 });
  await byTest('otp-input').fill('123456');
  try { await byTest('welcome-back-open').waitFor({ state: 'visible', timeout: 6000 }); await byTest('welcome-back-open').click(); } catch { /* straight in */ }
  await page.waitForTimeout(1500);

  step(`${lang}: the trip and its voucher`);
  await page.getByRole('tab').nth(1).click().catch(() => {});
  await page.waitForTimeout(800);
  await byTest('trip-card-Istanbul').first().click();
  await page.waitForTimeout(1500);
  const tripId = new URL(page.url()).pathname.split('/').filter(Boolean)[1];
  await scroll(600);
  await see(c.voucher, 'voucher row');
  await shot('trip-vouchers');
  await byTest('voucher-0').click();
  await see(c.ref, 'voucher reference');
  if (!/1-3982401/.test(await byTest('voucher-ref').innerText().catch(() => ''))) errors.push(`${lang} HBX reference missing`);
  await shot('voucher-top');
  await scroll(700);
  await see(c.essential, 'essential information');
  await see(c.payable, 'payment statement');
  await shot('voucher-bottom');
  await byTest('voucher-cancel').click();
  await see(c.free, 'cancellation simulation');
  await shot('voucher-cancel-sheet');
  await byTest('voucher-cancel-confirm').click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (el.scrollTop > 0) el.scrollTop = 0; });
  if (!(await byTest('voucher-ref').innerText().catch(() => '')).includes(c.cancelled)) errors.push(`${lang} cancelled not shown on the voucher`);
  if (await byTest('voucher-cancel').count()) errors.push(`${lang} cancel still offered after cancelling`);
  await shot('voucher-cancelled');

  step(`${lang}: airport pickup`);
  await go(`/trip/${tripId}/pickup`);
  await see(c.pickup, 'pickup title');
  await see(c.private, 'private option');
  await see(c.shared, 'shared option');
  await shot('pickup-options');
  await byTest('pickup-private-1').click().catch(() => {});
  await scroll(500);
  await shot('pickup-picked');
  await byTest('pickup-choose').click();
  await see(c.send, 'send sheet');
  await shot('pickup-send-sheet');
  await byTest('pickup-send').click();
  await page.waitForTimeout(1500);
  await see(c.withAgent, 'with agent');
  await shot('pickup-requested');

  step(`${lang}: hotel details`);
  await go('/hotel/m_mockhotel99701');
  await see('Galata Tower Suites', 'hotel name');
  await see(c.facilities, 'facilities');
  await shot('hotel-details');
  await context.close();
}

try {
  await run('en');
  await run('ar');
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${n} screenshots in ${OUT}`);
if (errors.length) { console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log('e2e transfers: all good');
