// Looking around without an account, end to end in headless Chromium against the web export (mock API):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-guest.mjs [shot-dir]
//
// 1. Welcome → "Look around": Today, Ask, real prices for a flight, a second option picked, Book → "Sign in to book
//    this" → phone, code, name, alerts → back in Ask on the same search with the same option, and the order sheet
//    prices it (the guest's offer became the account's).
// 2. Links a guest opens: a hotel page, a curated plan, Discover on the phone's city (never blank), Talk to Mada.
// 3. Language mid-flow: the Ask chip switches to Arabic and back; the search and the picked option survive the restart.
// 4. Per message: Arabic typed in the English app gets Arabic back; on the Arabic hotel page the hotel's English
//    words show as written with "Translate".
// Fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-guest');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
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
const fail = (s) => { errors.push(s); console.log('FAIL', s); };

async function newPage(locale = 'en-GB') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|contract/.test(m.text())) console.log('console.error', m.text().slice(0, 300)); });
  return { context, page };
}

function kit(page) {
  const shot = async (name, wait = 600) => { n += 1; await page.waitForTimeout(wait); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 10000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { fail(`${what}: expected "${text}"`); return false; }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const press = async (loc) => { loc = loc.filter({ visible: true }); await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); await loc.first().click(); };
  const ask = async (q) => { await byTest('ask-input').fill(q); await byTest('ask-send').click(); };
  /** The flight cards on screen, by testID, with their price ("flynas, SAR 1,745"). */
  const flights = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="flight-"]')]
    .map((el) => ({ id: el.getAttribute('data-testid'), price: (el.getAttribute('aria-label') ?? '').split(', ').slice(1).join(', ') }))
    .filter((x) => !/^flight-(rules|where|when)/.test(x.id)));
  const review = async () => (await byTest('ask-review').innerText()).trim();
  /** The picked flight: the one whose price the one action carries ("Review · SAR 1,745"). */
  const picked = async () => { const r = await review().catch(() => ''); const l = await flights(); return l.find((f) => f.price && r.includes(f.price) && l.filter((x) => x.price === f.price).length === 1)?.id; };
  return { shot, see, byTest, press, ask, flights, review, picked };
}

/** Ask for a flight as a guest, pick the second option; returns its testID and the action's words. */
async function searchAndPick(page, k) {
  await k.ask('Istanbul for Eid, just me');
  if (!(await k.see('SAR', 'flight prices', 15000))) return null;
  await page.waitForTimeout(800);
  const list = await k.flights();
  if (list.length < 2) { fail(`expected several flights, saw ${list.length}`); return null; }
  await k.press(k.byTest(list[1].id));
  await page.waitForTimeout(500);
  const on = await k.picked();
  if (on !== list[1].id) fail(`picking ${list[1].id} didn't select it (selected: ${on})`);
  return { id: list[1].id, label: await k.review() };
}

try {
  /* ───────────── 1. guest search → prices → book → sign in → back on the same option ───────────── */
  {
    step('guest: welcome → look around');
    const { page, context } = await newPage();
    const k = kit(page);
    await page.goto(ORIGIN + '/');
    await k.see("We'll take it from here.", 'welcome');
    await k.see('Already with Mada? Sign in', 'welcome sign-in line');
    await k.shot('welcome');
    await k.byTest('welcome-browse').click();
    await k.see('Where to?', 'guest today');
    await k.shot('guest-today');

    step('guest: Ask, real prices, pick the second flight');
    await k.byTest('dock-ask').click();
    await k.see('Where to?', 'ask start');
    const first = await searchAndPick(page, k);
    await k.shot('guest-results');
    if (first) {
      step('guest: Book → "Sign in to book this"');
      await k.press(k.byTest('ask-review'));
      await k.see('Sign in to book this', 'sign-in sheet');
      await k.see('Your search and the option you picked stay just as they are.', 'sheet promise');
      await k.shot('signin-sheet');
      await k.byTest('signin-sheet-go').click();

      step('guest: phone, code, name, alerts');
      await k.byTest('signin-phone').click();
      await k.byTest('phone-input').fill(`5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`);
      await k.byTest('phone-send').click();
      await k.see('Enter the code', 'otp');
      await k.byTest('otp-input').fill('123456');
      await k.see('What should we call you?', 'name');
      await k.byTest('name-input').fill('Noura');
      await k.byTest('name-go').click();
      await k.see("We'll only interrupt you when it matters.", 'alerts');
      await page.waitForTimeout(1200);
      await k.byTest('alerts-allow').click();

      step('guest: back in Ask, same search, same option');
      await k.see('Back where you were.', 'resume toast');
      await k.see('Istanbul for Eid, just me', 'same words');
      await k.see('SAR', 'prices again', 15000);
      await page.waitForTimeout(1200);
      const after = await k.picked();
      if (after !== first.id) fail(`after sign-in the picked flight is ${after}, expected ${first.id}`);
      const label = await k.review().catch(() => '');
      if (label !== first.label) fail(`after sign-in the action reads "${label}", expected "${first.label}"`);
      await k.shot('back-same-option');
      await k.press(k.byTest('ask-review'));
      await k.see('Everything included. No fees later.', 'order sheet for the same option', 15000);
      await k.shot('order-sheet');
    }
    await context.close();
  }

  /* ───────────── 2. links a guest opens ───────────── */
  {
    step('guest: links (hotel, plan, Discover, Mada)');
    const { page, context } = await newPage();
    const k = kit(page);
    await page.goto(ORIGIN + '/hotel/99701');
    await k.see('Galata Tower Suites', 'hotel page');
    await k.see('Rooms on a quiet lane', 'hotel description');
    await k.shot('guest-hotel');
    await page.goto(ORIGIN + '/plan/alula2');
    await k.see('Two days in AlUla', 'shared plan');
    await k.shot('guest-plan');
    await page.goto(ORIGIN + '/');
    await k.byTest('welcome-browse').click();
    await page.waitForTimeout(800);
    await page.goto(ORIGIN + '/circles');
    await k.see('On this week in', 'discover');
    await k.see('Riyadh', 'discover on the phone’s city');
    const city = (await k.byTest('city-switch').innerText().catch(() => '')).trim();
    if (!city) fail('Discover says "On this week in" with no city');
    await k.shot('guest-discover');
    await page.goto(ORIGIN + '/support');
    await k.see('Sign in to talk to Mada', 'support for a guest');
    await k.shot('guest-support');
    await context.close();
  }

  /* ───────────── 3. switching language mid-flow keeps the search ───────────── */
  {
    step('language: switch mid-flow, search and pick survive');
    const { page, context } = await newPage();
    const k = kit(page);
    await page.goto(ORIGIN + '/');
    await k.byTest('welcome-browse').click();
    await k.byTest('dock-ask').click();
    const first = await searchAndPick(page, k);
    if (first) {
      await k.byTest('ask-lang').click();
      await page.waitForLoadState('load');
      await page.waitForFunction(() => document.documentElement.dir === 'rtl', null, { timeout: 15000 }).catch(() => fail('Arabic: the page did not turn right to left'));
      await k.see('Istanbul for Eid, just me', 'Arabic: the same words', 15000);
      await k.see('ر.س', 'Arabic: prices again', 15000);
      await page.waitForTimeout(1500);
      const ar = await k.picked();
      if (ar !== first.id) fail(`Arabic: the picked flight is ${ar}, expected ${first.id}`);
      await k.shot('switched-to-arabic');
      await k.byTest('ask-lang').click();
      await page.waitForLoadState('load');
      await page.waitForFunction(() => document.documentElement.dir === 'ltr', null, { timeout: 15000 }).catch(() => fail('English: the page did not turn left to right'));
      await k.see('SAR', 'English: prices again', 15000);
      await page.waitForTimeout(1500);
      const en = await k.picked();
      if (en !== first.id) fail(`English again: the picked flight is ${en}, expected ${first.id}`);
      await k.shot('switched-back');
    }

    step('per message: Arabic typed in the English app');
    await page.goto(ORIGIN + '/ask');
    await k.ask('ابي فندق في دبي');
    await k.see('كتبت بالعربي، فمادا ترد عليك بالعربي.', 'Arabic answer note');
    await k.shot('arabic-in-english');
    await context.close();
  }

  /* ───────────── 4. the hotel's English words on the Arabic page ───────────── */
  {
    step('Arabic hotel page: Translate');
    const { page, context } = await newPage('ar-SA');
    const k = kit(page);
    await page.goto(ORIGIN + '/hotel/99701');
    await k.see('Galata Tower Suites', 'hotel name');
    await k.see('الفندق كاتب هذا بالإنجليزي.', 'says who wrote it');
    await k.shot('ar-hotel-original');
    await k.byTest('hotel-translate').click();
    await k.see('غرف في زقاق هادئ', 'translated description');
    await k.see('ترجمناه لك. الفندق كاتبه بالإنجليزي.', 'says it was translated');
    await k.shot('ar-hotel-translated');
    await k.byTest('hotel-translate').click();
    await k.see('Rooms on a quiet lane', 'back to the original');
    await context.close();
  }
} catch (e) {
  fail(`crashed: ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nGuests and language: all good (${n} screenshots in ${OUT}).`);
