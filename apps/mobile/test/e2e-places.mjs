// Places, end to end, in headless Chromium against the web export (mock API mode is fine).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-places.mjs [shot-dir]          (DIST=… for another export; API_TARGET=… for a real server)
//
// Walks: city search (near you, popular, names, typos, airport codes, accents, a true no-match with the closest names,
// recent searches), a city with its open guide and sources (Rome), "Plan it with Mada" by hand (sheet → request → the
// chat with the message), one of our cities (Tbilisi → Ask), a city with no photo (Tokyo), a city linked by name
// (Baku, as Discover links it) and an unknown one. Screenshots every screen at 390×844.
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-places');
const API = process.env.API_TARGET ?? null;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) {
    if (!API) { res.writeHead(502).end('No API_TARGET'); return; }
    const target = new URL(url.pathname + url.search, API);
    const p = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    p.on('error', (e) => res.writeHead(502).end(String(e)));
    req.pipe(p);
    return;
  }
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

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  return { context, page };
}
function kit(page) {
  const shot = async (name) => { n += 1; await page.waitForTimeout(600); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 8000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  const tap = async (name, exact = true) => page.getByRole('button', { name, exact }).filter({ visible: true }).first().click();
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  const text = (s) => page.getByText(s, { exact: true }).filter({ visible: true }).first();
  // In-app navigation (a reload would start the in-app mock API over).
  const go = async (path) => { await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await page.waitForTimeout(700); };
  return { shot, see, tap, byTest, text, go };
}
/** Scroll the screen under the thumb. */
async function scroll(page, dy) { await page.mouse.move(195, 420); await page.mouse.wheel(0, dy); await page.waitForTimeout(400); }

async function signIn(page, phone, { returning, name = 'Omar' }) {
  const { see, byTest } = kit(page);
  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill(phone);
  await byTest('phone-send').click();
  await see('Enter the code', 'otp');
  await byTest('otp-input').fill('123456');
  if (returning) { await see('Welcome back', 'welcome back'); await byTest('welcome-back-open').click(); }
  else { await see('What should we call you?', 'name'); await byTest('name-input').fill(name); await byTest('name-go').click(); await byTest('alerts-allow').click(); }
  await page.waitForTimeout(1200);
}


async function places() {
  const { page } = await newPage();
  const { shot, see, byTest, go } = kit(page);
  await signIn(page, '500004127', { returning: true });

  step('search before typing: near you, where people go');
  await go('/city');
  await see('Where to?', 'search title');
  await see('Near you', 'near you');
  await see('Where people go', 'popular');
  await shot('search-start');

  const first = async (q, name) => {
    await byTest('place-search').fill(q);
    await page.waitForTimeout(700);
    const names = await page.locator('[data-testid="place-results"] [role="button"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    if (!names[0] || !names[0].startsWith(name)) { errors.push(`search "${q}": got ${JSON.stringify(names.slice(0, 3))}, expected ${name} first`); console.log('BAD', q, names.slice(0, 3)); }
  };
  step('typeahead: names, typos, airport codes, accents');
  await first('tbilisi', 'Tbilisi');
  await shot('search-tbilisi');
  await first('tbilsi', 'Tbilisi');
  await first('tbs', 'Tbilisi');
  await first('LHR', 'London');
  await shot('search-lhr');
  await first('zurich', 'Zürich');
  await first('rome', 'Rome');

  step('a true no-match');
  await byTest('place-search').fill('sd');
  await see('No city called ‘sd’.', 'no match');
  await see('Try a city or an airport code.', 'no match body');
  await see('Closest we know', 'closest');
  await shot('search-none');

  step('any city: Rome, with its open guide');
  await byTest('place-search').fill('rome');
  await page.waitForTimeout(700);
  await page.locator('[data-testid="place-results"] [role="button"]').first().click();
  await see('Italy', 'country');
  await see('Local time', 'local time');
  await see('Nearest airport', 'airport');
  await shot('city-rome');
  await see('Situated on the River Tiber', 'wikipedia or wikivoyage text');
  await scroll(page, 700);
  await see('From Wikivoyage, CC BY-SA', 'attribution');
  await shot('city-rome-guide');
  await scroll(page, 2400);
  await see('Places from GeoNames, CC BY 4.0', 'sources');
  await shot('city-rome-sources');

  step('plan it with Mada: by hand, chat opens with the message');
  await byTest('plan-it').click();
  await see('Plan Rome with Mada', 'plan sheet');
  await page.getByRole('button', { name: 'May', exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
  const msg = await byTest('plan-message').inputValue();
  if (!/^Rome, \d of us, sometime in May$|^Rome, just me, sometime in May$/.test(msg)) errors.push('plan message: ' + msg);
  await shot('plan-sheet');
  await byTest('plan-send').click();
  await see('A trip to Rome', 'request title');
  await see(msg, 'first message in the chat');
  await shot('request-thread');

  step('our city: Tbilisi, our photo, Ask');
  await go('/city/611717');
  await see('Tbilisi', 'tbilisi');
  await see('Georgia', 'country');
  await shot('city-tbilisi');
  await byTest('plan-it').click();
  await page.waitForTimeout(1200);
  await see('A trip to Tbilisi', 'ask prefilled');
  await shot('ask-tbilisi');

  step('a city with no photo: the typographic hero');
  await go('/city/1850147');
  await see('Tokyo', 'tokyo');
  await see('Japan', 'japan');
  await shot('city-tokyo');

  step('Discover links by name');
  await go('/city/baku');
  await see('Azerbaijan', 'baku by name');
  await shot('city-baku');

  step('an unknown city');
  await go('/city/qqqzzz');
  await see('We can’t find that city.', 'not found');
  await shot('city-missing');

  step('recent searches');
  await go('/city');
  await see('Recent', 'recent');
  await see('Rome', 'recent rome');
  await shot('search-recent');
}

try {
  try { await places(); } catch (e) { errors.push(`places: ${String(e?.message ?? e).split('\n')[0]}`); console.log(e); }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nPlaces passed. ${n} screenshots in ${OUT}`);
