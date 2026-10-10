// Onboarding, end to end, in headless Chromium against the web export (react-native-web).
//
//   npx expo export --platform web --output-dir dist          (EXPO_PUBLIC_API_MODE=mock for the in-app API)
//   API_TARGET=http://localhost:3100 node test/e2e-web.mjs [shot-dir]
//
// Serves dist/ on a local port and proxies /api/* to API_TARGET (the platform's Core API), so the app talks to the
// real server from the same origin. Without API_TARGET the export must have been built with EXPO_PUBLIC_API_MODE=mock.
// Walks Welcome → Sign in → phone (with a short-number problem) → code (one wrong try) → name → alerts → Today, then
// the tabs and Ask, screenshotting each at 390×844. A second pass signs the same number in again: Welcome back.
// Fails on any page error or missing text.
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots');
const API = process.env.API_TARGET ?? null;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SKIP_RETURN = process.env.SKIP_RETURN === '1';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: npx expo export --platform web --output-dir dist`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) {
    if (!API) { res.writeHead(502).end('No API_TARGET'); return; }
    const target = new URL(url.pathname + url.search, API);
    const p = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host, 'x-forwarded-for': '127.0.0.1' } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    p.on('error', (e) => { res.writeHead(502).end(String(e)); });
    req.pipe(p);
    return;
  }
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html'); // SPA fallback
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (range) { // video needs byte ranges
    const start = Number(range[1]); const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
let n = 0;

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(401|410|423)/.test(m.text())) console.log('console.error', m.text()); });
  return { context, page };
}

const step = (s) => console.log('·', s);

async function run({ page, phone, returning }) {
  const shot = async (name) => { n += 1; await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what) => {
    try { await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 }); }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); }
  };
  const tap = async (text, opts = {}) => { await page.getByRole(opts.role ?? 'button', { name: text, exact: opts.exact ?? true }).first().click(); };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);

  step('welcome');
  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  if (!returning) await shot('welcome');

  step('sign in');
  await byTest('welcome-start').click();
  await see('Sign in to book and keep your trips.', 'signin');
  if (!returning) {
    await shot('signin');
    await byTest('signin-apple').click();
    await see('Hide my email', 'apple sheet');
    await shot('signin-apple-sheet');
    await tap('Cancel');
    await see('Sign-in cancelled. Nothing was shared.', 'cancel toast');
    await page.waitForTimeout(500);
  }

  step('phone');
  await byTest('signin-phone').click();
  await see('Your mobile number', 'phone');
  const input = byTest('phone-input');
  if (!returning) {
    await input.fill('50 12');
    await input.blur();
    await see('That number looks short. It needs 9 digits after +966 (you have 4).', 'short number');
    await shot('phone-short');
  }
  await input.fill(phone);
  if (!returning) await shot('phone');
  await byTest('phone-send').click();

  step('code');
  await see('Enter the code', 'otp');
  const otp = byTest('otp-input');
  if (!returning) {
    await otp.fill('000000');
    await see("That code doesn't match. 2 tries left.", 'wrong code');
    await shot('otp-wrong');
  }
  await otp.fill('123456');

  if (returning) {
    step('welcome back');
    await see('Welcome back, Omar.', 'welcome back');
    await shot('welcome-back');
    await byTest('welcome-back-open').click();
    await see('Nowhere planned yet.', 'today after return');
    return;
  }

  step('name');
  await see('What should we call you?', 'name');
  await byTest('name-input').fill('Omar');
  await see('Let’s go, Omar', 'name button');
  await shot('name');
  await byTest('name-go').click();

  step('alerts');
  await see("We'll only interrupt you when it matters.", 'alerts');
  await page.waitForTimeout(2200); // the three banners arrive
  await shot('alerts');
  await byTest('alerts-allow').click();

  step('today');
  await see('Nowhere planned yet.', 'today');
  await see('Where to next?', 'composer');
  await see('Add your passport', 'passport nudge');
  await shot('today');

  step('profile from the avatar');
  await byTest('today-avatar').click();
  await page.waitForURL(/\/profile/, { timeout: 8000 });
  await see('Omar', 'profile name');
  await shot('profile');
  await page.goBack();
  await see('Nowhere planned yet.', 'today again');

  step('tabs');
  await byTest('dock-trips').click();
  await see('Your name’s not on the board yet.', 'trips');
  await shot('trips');
  await byTest('dock-circles').click();
  await see('On this week in', 'circles opens on Discover');
  await shot('circles-discover');
  await page.getByText('Circles', { exact: true }).filter({ visible: true }).first().click();
  await see('Your people, in one place.', 'circles');
  await shot('circles');
  await byTest('dock-wallet').click();
  await see('Your passport isn’t here yet.', 'wallet');
  await shot('wallet');
  await byTest('dock-ask').click();
  await see('Instant answers from Mada. Faisal and the team confirm anything you book.', 'ask');
  await shot('ask');
}

try {
  const phone = process.env.E2E_PHONE ?? `5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  const first = await newPage();
  await run({ page: first.page, phone });
  await first.context.close();
  if (!SKIP_RETURN) {
    // Same number on a fresh phone: the account exists, so it's "Welcome back". The server makes you wait 30 s for a new code.
    if (API) { step('waiting out the 30-second resend window'); await new Promise((r) => setTimeout(r, 31_000)); }
    const second = await newPage();
    await run({ page: second.page, phone: API ? phone : '500004127', returning: true });
    await second.context.close();
  }
} catch (e) {
  errors.push(String(e?.stack ?? e));
  console.log(e);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nOnboarding passed. ${n} screenshots in ${OUT}`);
