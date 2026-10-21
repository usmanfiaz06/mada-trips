// "Book what's ready" (docs/app/ASK-INTEGRATED.md §7.2, U7) against the web export in mock-API mode: the trip's plan
// priced items each ticked with its own lines, one total that follows the ticks, the demo-fare label on a sample fare
// and on the total, the item whose price ran out with Price again; slide books what's ticked, the rest stays.
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-book-ready.mjs [shot-dir]          (default docs/app/screens)
//
// Screens: ai-u7-book-ready-en.png, ai-u7-book-ready-ar.png.
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
const check = (ok, what) => { if (!ok) { errors.push(what); console.log('FAIL', what); } else console.log('ok  ', what); };

async function start(locale) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
    const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const all = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true });
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
  const shot = async (name) => { await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('·', name); };
  const visible = async (id, timeout = 12000) => { try { await byTest(id).waitFor({ state: 'visible', timeout }); return true; } catch { return false; } };
  const titles = async () => (await all('ask-thread-title').allInnerTexts()).map((s) => s.trim());
  /** Titles once they satisfy `ok` (the list refreshes after each change), or the last ones read after 5 s. */
  const titlesWhen = async (ok) => { let t = []; for (let i = 0; i < 25; i++) { t = await titles(); if (ok(t)) break; await page.waitForTimeout(200); } return t; };
  return { context, page, byTest, all, shot, visible, titles, titlesWhen };
}



const TRIP = '0f6e2d1c-8b3a-4e59-a7c2-3d1b9e8f4a60';
const sar = (s) => Number(s.replace(/[^\d.]/g, ''));

/** In the app, not a reload: the mock keeps its sign-in in memory only. */
async function open(s) {
  await s.page.evaluate((url) => { window.history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, `/pay?plan=${TRIP}`);
  return s.visible('ready-footer', 20000);
}

async function english() {
  const s = await start('en-GB');
  const { byTest, all, page } = s;
  check(await open(s), 'the sheet opens on the plan');
  check((await byTest('ready-title').innerText()).trim() === 'Book what’s ready', 'titled Book what’s ready');
  const items = all('ready-item-demo');
  check(await items.count() >= 1, 'a sample fare says Demo fare on its line');
  check(await s.visible('ready-demo-fare'), 'and on the total');
  const rows = page.locator('[data-testid^="ready-item-"][role="checkbox"]').filter({ visible: true });
  const n = await rows.count();
  check(n === 3, `three priced items (${n})`);
  check(/3 of 3/.test(await byTest('ready-chosen').innerText()), 'all ticked by default');
  check(await s.visible('ready-expired'), 'the price that ran out is apart, with Price again');
  const before = sar(await byTest('ready-total').innerText());
  await s.shot('ai-u7-book-ready-en');
  // Untick the stay: the total follows.
  const stay = rows.nth(1);
  const stayText = await stay.innerText();
  await stay.click();
  await page.waitForTimeout(300);
  check(/2 of 3/.test(await byTest('ready-chosen').innerText()), 'unticked: 2 of 3');
  const after = sar(await byTest('ready-total').innerText());
  check(after < before && after > 0, `the total follows the ticks (${before} → ${after})`);
  // Slide: the two ticked book, the stay stays on the plan.
  const track = page.locator('[role="slider"]').last();
  const b = await track.boundingBox();
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + 30, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await page.mouse.move(b.x + 30 + ((b.width - 40) * i) / 12, y); await page.waitForTimeout(16); }
  await page.mouse.up();
  check(await s.visible('ready-done', 20000), 'booked');
  const done = await all('ready-done-item').allInnerTexts();
  check(done.length === 2 && !done.some((x) => stayText.includes(x.trim())), `the two ticked are booked (${done.join(' | ')})`);
  await s.context.close();
}

async function arabic() {
  const s = await start('ar-SA');
  const { byTest } = s;
  check(await open(s), 'Arabic: the sheet opens');
  check((await byTest('ready-title').innerText()).trim() === 'احجز الجاهز', 'Arabic: titled');
  const page = await byTest('ready-footer').innerText();
  check(/سعر تجريبي/.test(page), 'Arabic: the demo label on the total');
  await s.shot('ai-u7-book-ready-ar');
  await s.context.close();
}

try {
  await english();
  await arabic();
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nAll good. Screens in ${OUT}`);
