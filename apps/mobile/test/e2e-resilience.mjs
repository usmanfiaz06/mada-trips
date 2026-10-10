// When things go wrong (FLOWS.md §12), end to end, in headless Chromium against the web export.
//
//   EXPO_PUBLIC_API_MODE=mock EXPO_PUBLIC_MOCK_WIRE=http EXPO_PUBLIC_DEMO_HINTS=yes \
//     npx expo export --platform web --output-dir dist
//   node test/e2e-resilience.mjs [shot-dir]                 (DIST=… for another export)
//
// MOCK_WIRE=http makes every API call a real HTTP request first; this script's server answers "x-mada-mock: pass" so
// the in-app mock replies, and Playwright's network emulation applies for real: context.setOffline, CDP slow 3G, and
// page.route answering 500 / 503 SUPPLIER_DOWN / 503 MAINTENANCE / 429 / 426 / 401 / a broken contract.
// Walks: the offline bar on Today and Trips (and nothing hidden under it), reconnect, a reload with no connection
// (the offline copy), slow (Still working… → Stop waiting → Try again), a server problem with its reference, a
// supplier not answering, busy with Retry-After, maintenance (screen, then the gold bar), update required, the session
// running out (re-sign-in over the screen, typed text kept), a contract mismatch, the outbox (queued, sent on
// reconnect, a refusal with Send again / Remove), a deep link to nothing, a crash, photos that fail or crawl, and the
// states gallery. Screenshots every state at 390×844; fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-resilience');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const PHOTO = resolve('assets/photos/abha-mountains.jpg');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) { res.writeHead(204, { 'x-mada-mock': 'pass', 'x-server-time': String(Date.now()) }).end(); return; }
  if (url.pathname === '/no-such-photo.jpg') { res.writeHead(404).end(); return; }
  if (url.pathname === '/slow-photo.jpg') {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(existsSync(PHOTO) ? readFileSync(PHOTO) : Buffer.alloc(0)); }, 6000);
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
const API = '**/api/app/v1';
const envelope = (code, message, extra = {}) => JSON.stringify({ error: { code, message, ...extra } });

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  const page = await context.newPage();
  page.on('pageerror', (e) => {
    // The crash scenario throws on purpose; the boundary catches it.
    if (/States gallery: a screen that throws/.test(e.message)) return;
    errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message);
  });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|States gallery|The above error|ErrorBoundary/.test(m.text())) console.log('console.error', m.text().slice(0, 300)); });
  const shot = async (name) => { n += 1; await page.waitForTimeout(600); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 10_000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).first();
  return { context, page, shot, see, byTest };
}

/** The demo account (Omar) signs in: welcome → phone → code → welcome back → Today. */
async function signIn(p) {
  await p.page.goto(ORIGIN + '/');
  await p.byTest('welcome-start').click();
  await p.byTest('signin-phone').click();
  await p.byTest('phone-input').fill('500004127');
  await p.byTest('phone-send').click();
  await p.byTest('otp-input').fill('123456');
  await p.byTest('welcome-back-open').click();
  await p.page.waitForURL('**/today');
  p.signedInAt = Date.now();
  await p.page.evaluate(() => document.fonts.ready);
  await p.page.waitForTimeout(800);
}

/** Navigate inside the app (no reload: the mock's memory and the session stay). */
async function go(p, path) {
  await p.page.evaluate((to) => { window.history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
  await p.page.waitForTimeout(500);
}

const scenarios = {
  async offline(p) {
    step('offline bar on Today and Trips');
    await p.shot('today-online');
    await p.context.setOffline(true);
    await p.see("You're offline. Everything for your trips is on this phone.", 'offline bar');
    await p.shot('today-offline');
    // The bar never covers the top of a screen: the first thing under it starts below it.
    const bar = await p.byTest('offline-banner').boundingBox();
    if (!bar || bar.y !== 0) errors.push('offline bar: not at the top');
    await p.byTest('dock-trips').click();
    await p.shot('trips-offline');
    step('a screen with a back button under the bar');
    await go(p, '/states?view=live');
    await p.see('Household', 'live probe title');
    const back = await p.page.getByRole('button', { name: 'Back' }).first().boundingBox();
    if (!back || !bar || back.y < bar.y + bar.height - 1) errors.push(`back button under the offline bar (${back?.y} < ${bar?.y + bar?.height})`);
    await p.shot('live-offline-first-load');
    step('reconnect');
    await p.context.setOffline(false);
    await p.see('Back online.', 'reconnect toast');
    await p.see('Hessa', 'data after reconnect');
    await p.shot('reconnected');
    step('offline after data: the saved copy, with how old it is');
    await p.context.setOffline(true);
    await p.see('Saved on this phone', 'stale badge');
    await p.shot('live-offline-saved-copy');
    step('the app killed and reopened with no connection: the offline copy');
    await go(p, '/today');
    await p.page.waitForTimeout(1500); // the copy is written a second after a change
    // A web page can't itself load offline (no service worker), so the page loads while every API call fails as if
    // the radio were off, then the browser goes offline: what's on screen is only the copy saved on the phone.
    await p.context.setOffline(false);
    await p.page.route('**/api/**', (route) => route.abort('internetdisconnected'));
    await p.page.reload();
    // Fonts and photos ship inside the app on a phone; on the web they load first, then the radio goes off.
    await p.page.evaluate(() => document.fonts.ready);
    await p.page.waitForTimeout(2500);
    await p.context.setOffline(true);
    await p.see("You're offline. Everything for your trips is on this phone.", 'offline bar after reload');
    await p.page.waitForTimeout(1200);
    await p.shot('reopened-offline');
    await p.page.unroute('**/api/**');
    await p.context.setOffline(false);
  },

  async slow(p) {
    step('slow: Still working…, Stop waiting, Try again');
    let hold = true;
    await p.page.route(`${API}/people`, async (route) => { if (hold) { await new Promise((r) => setTimeout(r, 7000)); } await route.fallback(); });
    await go(p, '/states?view=live');
    await p.page.waitForTimeout(700);
    await p.shot('loading-skeleton');
    await p.see('Still working…', 'slow state', 8000);
    await p.shot('slow');
    await p.byTest('slow-cancel').click();
    await p.see('This didn’t load.', 'after stop waiting');
    await p.shot('slow-cancelled');
    hold = false;
    await p.page.unroute(`${API}/people`);
    await p.byTest('state-retry').click();
    await p.see('Hessa', 'data after try again');
    step('weak connection (CDP slow 3G)');
    const cdp = await p.context.newCDPSession(p.page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2800, downloadThroughput: 50_000, uploadThroughput: 20_000 });
    await p.page.evaluate(() => { window.history.pushState({}, '', '/today'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await p.page.waitForTimeout(300);
    await go(p, '/states?view=live');
    await p.page.waitForTimeout(6500);
    await p.shot('slow-3g');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  },

  async server(p) {
    step('our side: 500 with a reference');
    await p.page.route(`${API}/people`, (route) => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'x-request-id': 'm9a1b2c3d4' }, body: envelope('INTERNAL', 'x', { requestId: 'm9a1b2c3d4' }) }));
    await go(p, '/states?view=live');
    await p.see('That didn’t work, and it’s on us.', 'server state', 15_000);
    await p.see('Reference m9a1b2c3d4', 'reference');
    await p.shot('server-problem');
    await p.page.unroute(`${API}/people`);

    step('a supplier not answering');
    await p.page.route(`${API}/people`, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: envelope('SUPPLIER_DOWN', 'x', { details: { supplier: 'flights', label: 'Saudia', reason: 'open' }, retryAfter: 30 }) }));
    await p.byTest('state-retry').click();
    await p.see('Saudia’s system isn’t answering.', 'supplier down');
    await p.shot('supplier-down');
    await p.page.unroute(`${API}/people`);

    step('a newer server: the answer doesn’t match');
    await p.page.route(`${API}/people`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ people: 'v2' }) }));
    await go(p, '/today');
    await go(p, '/states?view=live');
    await p.see('Part of this didn’t load.', 'contract mismatch');
    await p.shot('contract-mismatch');
    await p.page.unroute(`${API}/people`);

    step('busy: 429 with Retry-After, then it works');
    let once = true;
    await p.page.route(`${API}/people`, (route) => {
      if (once) { once = false; return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'Retry-After': '3' }, body: envelope('RATE_LIMITED', 'x', { retryAfter: 3 }) }); }
      return route.fallback();
    });
    await p.byTest('state-retry').click();
    await p.see('Trying again in 3 seconds', 'busy toast');
    await p.shot('busy-wait');
    await p.see('Hessa', 'data after the wait', 12_000);
    await p.shot('busy-then-data');
    await p.page.unroute(`${API}/people`);
  },

  async session(p) {
    step('the session runs out: sign in again over the screen, text kept');
    await go(p, '/states?view=live');
    await p.see('Hessa', 'live data');
    await p.byTest('states-draft').fill('Two nights in Abha in May');
    await p.page.route(`${API}/people`, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: envelope('TOKEN_EXPIRED', 'x') }));
    await p.page.route(`${API}/auth/refresh`, (route) => route.fulfill({ status: 401, contentType: 'application/json', body: envelope('UNAUTHORIZED', 'x') }));
    await p.byTest('states-refresh').click();
    await p.see('Sign in again to carry on.', 'session sheet', 15_000);
    await p.shot('session-expired');
    await p.page.unroute(`${API}/people`);
    await p.page.unroute(`${API}/auth/refresh`);
    // The code from signing in is used up; a new one may be asked for 30 seconds after it.
    await p.page.waitForTimeout(Math.max(0, 31_000 - (Date.now() - p.signedInAt)));
    await p.byTest('reauth-send').click();
    await p.byTest('reauth-code').fill('123456');
    await p.page.waitForTimeout(1500);
    const kept = await p.byTest('states-draft').inputValue().catch(() => '');
    if (kept !== 'Two nights in Abha in May') errors.push(`typed text lost after re-sign-in ("${kept}")`);
    await p.shot('session-back');
  },

  async gates(p) {
    step('maintenance: the screen, then the gold bar');
    const config = (over) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      minVersion: '0.0.0', latestVersion: '0.1.0', maintenance: { on: false, message: null, until: null }, features: { offlineOutbox: true, statusChecks: true, softUpdatePrompt: true },
      serverTime: new Date().toISOString(), storeUrls: { ios: 'https://apps.apple.com/app/mada-trips', android: 'https://play.google.com/store/apps/details?id=sa.madatrips.app' }, ...over }) });
    await p.page.route(`${API}/config`, config({ maintenance: { on: true, message: null, until: null } }));
    await p.page.route(`${API}/people`, (route) => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'Retry-After': '600' }, body: envelope('MAINTENANCE', 'Booking is paused until 03:00 Riyadh time while we make Mada better.', { retryAfter: 600, details: { until: null } }) }));
    await go(p, '/states?view=live');
    await p.see('We’re making Mada better.', 'maintenance screen', 15_000);
    await p.shot('maintenance');
    await p.page.unroute(`${API}/people`);
    await p.byTest('maintenance-trips').click();
    await p.see('Booking is paused for a few minutes.', 'maintenance bar');
    await p.shot('maintenance-bar-trips');

    await p.page.unroute(`${API}/config`);
  },

  async update(p) {
    const config = (over) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      minVersion: '0.0.0', latestVersion: '0.1.0', maintenance: { on: false, message: null, until: null }, features: { offlineOutbox: true, statusChecks: true, softUpdatePrompt: true },
      serverTime: new Date().toISOString(), storeUrls: { ios: 'https://apps.apple.com/app/mada-trips', android: 'https://play.google.com/store/apps/details?id=sa.madatrips.app' }, ...over }) });
    step('update required (426)');
    await p.page.route(`${API}/config`, config({ minVersion: '9.0.0' }));
    await p.page.route(`${API}/people`, (route) => route.fulfill({ status: 426, contentType: 'application/json', body: envelope('UPGRADE_REQUIRED', 'x', { details: { minVersion: '9.0.0' } }) }));
    await go(p, '/states?view=live');
    await p.see('Time for the new Mada.', 'update screen', 15_000);
    await p.shot('update-required');
    await p.page.unroute(`${API}/people`);
  },

  async outbox(p) {
    step('outbox: queued offline, sent on reconnect');
    await go(p, '/states');
    await p.context.setOffline(true);
    await p.byTest('states-queue').click();
    await p.see('Sends when you’re online', 'queued');
    await p.byTest('outbox-list').scrollIntoViewIfNeeded();
    await p.shot('outbox-queued');
    await p.context.setOffline(false);
    await p.see('Back online. Sending the 1 thing you wrote offline.', 'reconnect sending toast');
    await p.shot('outbox-sent');
    step('a refusal: Not sent, Send again, Remove');
    await p.page.route(`${API}/people`, (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 400, contentType: 'application/json', body: envelope('VALIDATION', 'A detail needs another look.') }) : route.fallback()));
    await p.byTest('states-queue').click();
    await p.see('Not sent.', 'failed item');
    await p.byTest('outbox-list').scrollIntoViewIfNeeded();
    await p.shot('outbox-failed');
    await p.byTest('outbox-discard').click();
    await p.page.unroute(`${API}/people`);
  },

  async gallery(p) {
    step('the states gallery');
    await go(p, '/states');
    await p.see('States', 'gallery');
    await p.shot('gallery-top');
    for (const id of ['supplier-down', 'img-failed', 'perm-camera', 'state-server', 'state-gone']) {
      await p.byTest(id).scrollIntoViewIfNeeded().catch(() => errors.push(`gallery: no ${id}`));
      await p.shot(`gallery-${id}`);
    }
    step('a deep link to nothing');
    await go(p, '/trip-that-was-cancelled');
    await p.see('This isn’t here any more.', 'not found');
    await p.shot('not-found');
    step('a crash');
    await go(p, '/states');
    await p.byTest('states-crash').scrollIntoViewIfNeeded();
    await p.byTest('states-crash').click();
    await p.see('Something broke on our side. Your trips are safe.', 'crash');
    await p.shot('crash');
  },
};

try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const p = await newPage();
    await signIn(p);
    await run(p);
    await p.context.close();
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
console.log(`\nResilience passed. ${n} screenshots in ${OUT}`);
