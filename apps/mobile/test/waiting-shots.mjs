// Screenshots of waiting that engages (components/states/Waiting.tsx) and the Ask chat's cards, in English and Arabic,
// against the web export in mock-API mode:
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/waiting-shots.mjs [out-dir]          (default docs/app/screens; ONLY=hotels,esim,cards to pick)
//
// The hotel and eSIM answers are held back for a few seconds (window.__madaMockHttp sends them over HTTP so page.route
// can wait, then the mock answers), so the staged line has moved on when the picture is taken. The Ask chat uses the
// mock-only demo switch (window.__MADA_DEMO__ = { askChat: true }, lib/ask-chat-demo.ts).
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? '../../docs/app/screens');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };
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
const HOLD_MS = 11000;

async function start(locale, { hold = [], demo = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  await context.addInitScript(({ hold, demo }) => { window.__madaMockHttp = hold; if (demo) window.__MADA_DEMO__ = demo; }, { hold, demo });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  for (const p of hold) {
    await page.route(`**/api/app/v1${p}**`, async (route) => {
      await new Promise((r) => setTimeout(r, HOLD_MS));
      return route.fulfill({ status: 204, headers: { 'x-mada-mock': 'pass' }, body: '' }).catch(() => {});
    });
  }
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  await page.goto(ORIGIN + '/');
  await byTest('welcome-start').waitFor({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await byTest('otp-input').waitFor({ timeout: 10000 });
  await byTest('otp-input').fill('123456');
  await byTest('welcome-back-open').waitFor({ timeout: 10000 });
  await byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
  await byTest('dock-ask').click();
  await page.waitForTimeout(900);
  const ask = async (q) => { await byTest('ask-input').fill(q); await byTest('ask-send').click(); };
  const need = async (id, what, timeout = 12000) => {
    try { await byTest(id).waitFor({ state: 'visible', timeout }); return true; } catch { errors.push(`${what}: no [${id}]`); console.log('MISSING', what, id); return false; }
  };
  const shot = async (name) => { await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('·', name); };
  return { context, page, byTest, ask, need, shot };
}

async function hotels(locale, name) {
  const s = await start(locale, { hold: ['/search/stays'] });
  await s.ask(locale === 'ar-SA' ? 'فندق في إسطنبول' : 'A hotel in Istanbul');
  await s.page.getByRole('button').filter({ hasText: '·' }).filter({ visible: true }).first().click();
  await s.page.waitForTimeout(800);
  await s.byTest('stays-search').click();
  if (await s.need('stays-waiting', `${name}: waiting`)) {
    await s.page.waitForTimeout(3800);
    await s.shot(name);
  }
  await s.need('stay-photo-0', `${name}: results after the wait`, 20000);
  await s.context.close();
}

async function esim(locale, name) {
  const s = await start(locale, { hold: ['/esim/plans'] });
  await s.ask(locale === 'ar-SA' ? 'eSIM لإسطنبول' : 'Internet for Istanbul');
  if (await s.need('esim-loading', `${name}: waiting`)) {
    await s.page.waitForTimeout(3600);
    await s.shot(name);
  }
  await s.context.close();
}

async function cards(locale, name) {
  const s = await start(locale, { demo: { askChat: true } });
  const ar = locale === 'ar-SA';
  await s.ask(ar ? 'إسطنبول الشهر الجاي' : 'Istanbul next month');
  await s.need('chat-flights', `${name}: flights`, 15000);
  await s.page.waitForTimeout(800);
  await s.ask(ar ? 'احجز لنا طاولة في مطعم' : 'Book us a restaurant table');
  if (await s.need('chat-request-card', `${name}: request card`, 15000)) {
    await s.page.waitForTimeout(1200);
    // To the end of the thread, so the card and its next steps sit above the box.
    await s.page.mouse.move(195, 400);
    for (let i = 0; i < 6; i++) { await s.page.mouse.wheel(0, 900); await s.page.waitForTimeout(120); }
    await s.page.waitForTimeout(600);
    await s.shot(name);
  }
  const words = await s.byTest('chat-request-card').innerText().catch(() => '');
  if (/You · You|أنت · أنت/.test(words)) errors.push(`${name}: the request card says "You · You"`);
  await s.context.close();
}

try {
  const want = (x) => !process.env.ONLY || process.env.ONLY.split(',').includes(x);
  if (want('hotels')) { await hotels('en-GB', 'waiting-hotels-en'); await hotels('ar-SA', 'waiting-hotels-ar'); }
  if (want('esim')) { await esim('en-GB', 'waiting-esim-en'); await esim('ar-SA', 'waiting-esim-ar'); }
  if (want('cards')) { await cards('en-GB', 'ask-cards-en'); await cards('ar-SA', 'ask-cards-ar'); }
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nScreens in ${OUT}`);
