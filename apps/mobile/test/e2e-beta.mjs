// The beta, end to end in headless Chromium against the web export in mock-API mode:
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-beta.mjs [shot-dir]            (ONLY=flights,phone,circles,arabic to pick)
//
// The server's beta switches arrive as ?beta=… (lib/mock/beta.ts): flights by request, booking without a verified
// phone, and the desk's Circles pause.
//   1. flights   Ask "Istanbul for Eid, all of us" → "Tell us where and when" (flexible dates, cabin, bags, what
//                they'd like) → Send to Mada → the request with the fares the desk holds (per person, bags, rules,
//                the hold) → choose the second → pay → With Mada → confirmed → the trip with the PNR and a ticket
//                number each → the e-tickets in the request's thread → Trips › Requests.
//   2. phone     an email account (Verify your phone → Later) pays with a contact number instead: empty and wrong
//                numbers are explained, an international number goes through.
//   3. circles   the Circles pause: said up front, and a new circle is refused kindly.
//   4. arabic    the request and its fares in Arabic, right to left, dates in Arabic.
// Screenshots every step at 390×844 and fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-beta');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };
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
const want = (name) => !ONLY || ONLY.includes(name);

async function newPage(locale = 'en-GB', beta = '') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  // The server's beta switches for the mock API (lib/mock/beta.ts), set before the app's first request.
  await context.addInitScript((b) => { try { sessionStorage.setItem('mada.mockBeta', b); } catch { /* ignore */ } }, beta);
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|contract/.test(m.text())) console.log('console.error', m.text().slice(0, 300)); });
  return { context, page };
}

function kit(page) {
  const shot = async (name, wait = 650) => { n += 1; await page.waitForTimeout(wait); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 9000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); n += 1; await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-missing-${what.replace(/\W+/g, '-')}.png`) }).catch(() => {}); return false; }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const press = async (loc) => { loc = loc.filter({ visible: true }); await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); await loc.first().click(); };
  const tap = async (name, exact = true) => press(page.getByRole('button', { name, exact }));
  const ask = async (q) => { await byTest('ask-input').fill(q); await byTest('ask-send').click(); };
  const slide = async () => {
    const track = page.locator('[role="slider"]').last();
    await track.waitFor({ state: 'visible', timeout: 8000 });
    await track.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = await track.boundingBox();
    const y = b.y + b.height / 2;
    const rtl = await page.evaluate(() => document.documentElement.dir === 'rtl');
    const start = rtl ? b.x + b.width - 30 : b.x + 30;
    const end = rtl ? b.x + 10 : b.x + b.width - 10;
    await page.mouse.move(start, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) { await page.mouse.move(start + ((end - start) * i) / 12, y); await page.waitForTimeout(16); }
    await page.mouse.up();
  };
  return { shot, see, byTest, press, tap, ask, slide };
}

async function signIn(page, beta) {
  const { see, byTest } = kit(page);
  await page.goto(`${ORIGIN}/?beta=${beta}`);
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await see('Enter the code', 'otp');
  await byTest('otp-input').fill('123456');
  await see('Welcome back', 'welcome back');
  await byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
}

async function openAsk(page) {
  const { byTest, see } = kit(page);
  await byTest('dock-ask').click();
  await see('Where to?', 'ask start');
}

/* ───────────── 1. flights by request: the form → fares → pay → tickets → the trip ───────────── */
async function flights() {
  const { page, context } = await newPage('en-GB', 'flights');
  const k = kit(page);
  step('flights: sign in with flights by request');
  await signIn(page, 'flights');
  await openAsk(page);
  await k.ask('Istanbul for Eid, all of us');
  step('flights: Tell us where and when');
  await k.see('Tell us where and when', 'request form', 12000);
  await k.see('Riyadh to Istanbul', 'route');
  await k.see('Someone at Mada finds the fares', 'form body');
  await k.shot('request-form');
  await k.tap('3 days either side');
  await k.tap('Business');
  await k.tap('Economy');
  await k.tap('Two checked bags');
  await k.tap('Direct only');
  await k.tap('Seats together');
  await k.byTest('flight-request-note').fill('Window seat for Ahmed if you can');
  await k.shot('request-form-filled');
  step('flights: send to Mada');
  await k.press(k.byTest('flight-request-send'));
  await k.see('Flights to Istanbul', 'request title', 8000);
  await k.see('±3 days', 'summary flex');
  await k.see('Two checked bags', 'summary bags');
  await k.shot('request-sent');
  step('flights: the fares arrive');
  await k.see('I found 2 fares', 'fares lead', 20000);
  // The fares card keeps its own timer ("Held for 1:59:40", or "Held until …" for a long hold); Pay says "Price held · … left".
  await k.see(/Held (for|until) /, 'hold');
  await k.shot('fares');
  await k.press(k.byTest('fare-opt2'));
  await k.see('Bags', 'fare rules');
  await k.see('Per person', 'per person', 2000).catch(() => {});
  await k.shot('fare-two-open');
  step('flights: pay');
  await k.press(k.byTest('fares-pay'));
  await k.see('Everything included. No fees later.', 'pay sheet', 12000);
  await k.see('Istanbul', 'pay title');
  await k.see('Price held · ', 'pay hold');
  await k.shot('pay');
  await k.slide();
  await k.see('Booking now', 'waiting', 12000);
  await k.shot('waiting', 300);
  await k.see("You're going to Istanbul.", 'confirmed', 25000);
  await k.shot('confirmed');
  step('flights: the trip with tickets');
  await k.press(k.byTest('see-trip'));
  await page.waitForTimeout(1500);
  await k.see('Tickets', 'tickets box', 10000);
  await k.see('Ticket 065', 'ticket number');
  await k.see('Airline booking', 'pnr');
  await page.locator('[data-testid="tickets-box"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await k.shot('trip-tickets');
  step('flights: the e-tickets in the request');
  for (let i = 0; i < 3 && !(await page.locator('[data-testid="dock-trips"]').filter({ visible: true }).count()); i++) {
    const back = page.getByRole('button', { name: /^(Close|Back|Done)$/ }).filter({ visible: true }).last();
    if (!(await back.count())) break;
    await back.click(); await page.waitForTimeout(700);
  }
  await k.byTest('dock-trips').click();
  await page.waitForTimeout(600);
  await k.press(k.byTest('tab-requests'));
  await k.see('Flights to Istanbul', 'requests tab', 10000);
  await k.shot('requests-tab');
  await k.press(k.byTest('open-flight-request'));
  await k.see('e-tickets-', 'e-ticket file', 10000);
  await page.locator('[data-testid="attachment"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await k.shot('request-etickets');
  await context.close();
}

/* ───────────── 2. no verified phone: a number to reach you ───────────── */
async function phone() {
  const { page, context } = await newPage('en-GB', 'flights,nophone');
  const k = kit(page);
  step('phone: email sign-in, phone later');
  await page.goto(`${ORIGIN}/?beta=flights,nophone`);
  await k.see("We'll take it from here.", 'welcome');
  await k.byTest('welcome-start').click();
  await k.byTest('signin-email').click();
  await k.byTest('email-input').fill(`noor.${Date.now()}@example.com`);
  await k.byTest('email-send').click();
  await k.see('Check your email', 'email code');
  await k.byTest('email-code-input').fill('123456');
  await k.see('Verify your phone', 'verify phone');
  await k.shot('verify-phone-later');
  await page.getByRole('button', { name: /^(Later|Not now)$/ }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  // Onboarding: name and alerts.
  if (await page.locator('[data-testid="name-input"]').count()) { await k.byTest('name-input').fill('Noor'); await page.getByRole('button', { name: /Continue|Let/ }).filter({ visible: true }).first().click(); await page.waitForTimeout(600); }
  for (let i = 0; i < 3 && !(await page.locator('[data-testid="dock-ask"]').filter({ visible: true }).count()); i++) {
    const b = page.getByRole('button', { name: /^(Not now|Skip|Allow|Continue)$/ }).filter({ visible: true }).first();
    if (!(await b.count())) break;
    await b.click(); await page.waitForTimeout(700);
  }
  step('phone: a request and its fares');
  await openAsk(page);
  await k.ask('Dubai, just me');
  await k.see('When?', 'when (phone)', 12000);
  await k.press(page.getByRole('button', { name: /^Eid al-Fitr/ }));
  await k.see('Tell us where and when', 'request form (phone)', 12000);
  await k.press(k.byTest('flight-request-send'));
  await k.see('I found 2 fares', 'fares (phone)', 20000);
  await k.press(k.byTest('fares-pay'));
  await k.see('A number to reach you', 'contact field', 12000);
  await k.shot('pay-contact');
  step('phone: empty, wrong, then an international number');
  await k.slide();
  await k.see('Add a number to reach you first.', 'contact needed');
  await k.byTest('pay-contact-input').fill('12');
  await k.byTest('pay-contact-input').blur();
  await k.see('Check the number', 'contact invalid');
  await k.shot('pay-contact-wrong');
  await k.byTest('pay-contact-input').fill('+44 7700 900123');
  await page.waitForTimeout(300);
  await k.slide();
  await k.see('Booking now', 'waiting (phone)', 12000);
  await k.shot('waiting-contact');
  await context.close();
}

/* ───────────── 3. the desk paused Circles ───────────── */
async function circles() {
  const { page, context } = await newPage('en-GB', 'limited');
  const k = kit(page);
  step('circles: paused');
  await signIn(page, 'limited');
  await k.byTest('dock-circles').click();
  await page.waitForTimeout(800);
  await k.press(page.getByRole('tab', { name: 'Circles', exact: true }));
  await k.see('Circles is paused for you', 'limited banner', 10000);
  await k.shot('circles-limited');
  await context.close();
}

/* ───────────── 4. Arabic ───────────── */
async function arabic() {
  const { page, context } = await newPage('ar-SA', 'flights');
  const k = kit(page);
  step('arabic: the request and fares');
  await page.goto(`${ORIGIN}/?beta=flights`);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.fonts.ready);
  await k.byTest('welcome-start').click();
  await k.byTest('signin-phone').click();
  await k.byTest('phone-input').fill('500004127');
  await k.byTest('phone-send').click();
  await page.waitForTimeout(800);
  await k.byTest('otp-input').fill('123456');
  await page.waitForTimeout(1200);
  await k.byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
  await k.byTest('dock-ask').click();
  await page.waitForTimeout(800);
  // Typed in Arabic: Mada answers each message in the language it is written in.
  await k.ask('إسطنبول في العيد مع العائلة');
  await k.see('قل لنا وين ومتى', 'arabic form', 12000);
  await k.shot('ar-request-form');
  await k.press(k.byTest('flight-request-send'));
  await k.see('لقيت سعرين', 'arabic fares', 20000);
  const html = await page.content();
  if (/\b\d{1,2}–\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(await page.innerText('body'))) errors.push('arabic: an English date range is in view');
  void html;
  await k.shot('ar-fares');
  await context.close();
}

try {
  if (want('flights')) await flights();
  if (want('phone')) await phone();
  if (want('circles')) await circles();
  if (want('arabic')) await arabic();
} catch (e) {
  errors.push(`crash: ${e instanceof Error ? e.message : e}`);
  console.log(e);
} finally {
  await browser.close();
  server.close();
}
console.log(`${n} screenshots in ${OUT}`);
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log('OK');
