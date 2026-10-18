// No signal and almost no battery (critique item 14), end to end, in headless Chromium against the web export.
//
//   node scripts/copy-ocr.mjs && EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-offline.mjs [shot-dir]                 (DIST=… for another export)
//
// Walks: the service worker takes over and saves the shell; the trip and Wallet load; the connection goes
// (context.setOffline) and the page is reloaded: the app opens from the shell with the saved trip and "You're offline.
// This is what we had at HH:MM."; Wallet and a deep link open offline. Then the low-battery screen from Today: the next
// flight, the hotel in English and Arabic, Mada's number and a call-back, the suggestion when the battery reads 8%;
// signing out leaves nothing of the account on the device; the screen in Arabic. Fails on any page error or missing text.
import { createServer } from 'node:http';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-offline');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);
if (!existsSync(join(DIST, 'sw.js'))) throw new Error(`No sw.js in ${DIST}: public/ wasn't copied`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
// A deploy: `next` is a folder laid over the export (its own index.html naming a renamed entry bundle, so another
// build id); `slowPage` holds the page back that long, like a weak connection.
let next = null;
let slowPage = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const path = decodeURIComponent(url.pathname);
  const from = next && existsSync(join(next, path)) && !statSync(join(next, path)).isDirectory() ? next : DIST;
  let file = join(from, path);
  if (!file.startsWith(from) || !existsSync(file) || statSync(file).isDirectory()) file = join(next ?? DIST, 'index.html');
  if (file.endsWith('index.html') && slowPage) await new Promise((r) => setTimeout(r, slowPage));
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, ...(file.endsWith('sw.js') || file.endsWith('.html') ? { 'Cache-Control': 'no-cache' } : null) });
  createReadStream(file).pipe(res);
});

/** Another build of the same app: the entry bundle under a new name, and a page that names it. Returns its id. */
function deploy(n) {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const m = /\/_expo\/static\/js\/web\/entry-([A-Za-z0-9]+)\.js/.exec(html);
  if (!m) throw new Error('no entry bundle in index.html');
  const id = `${m[1]}n${n}`;
  const dir = join(OUT, `deploy-${n}`);
  const to = join(dir, `_expo/static/js/web/entry-${id}.js`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(DIST, m[0]), to);
  writeFileSync(join(dir, 'index.html'), html.replace(m[0], `/_expo/static/js/web/entry-${id}.js`));
  next = dir;
  return id;
}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
let n = 0;
const step = (s) => console.log('·', s);

async function newPage({ locale = 'en-GB', battery = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  if (battery !== null) {
    await context.addInitScript((level) => {
      const listeners = {};
      const mgr = { level, charging: false, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: () => {} };
      Object.defineProperty(navigator, 'getBattery', { value: () => Promise.resolve(mgr), configurable: true });
    }, battery);
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) console.log('console.error', m.text().slice(0, 300)); });
  const shot = async (name) => { n += 1; await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 10_000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).first();
  return { context, page, shot, see, byTest };
}

async function signIn(p) {
  await p.page.goto(ORIGIN + '/');
  await p.page.evaluate(() => document.fonts.ready);
  await p.byTest('welcome-start').click();
  await p.byTest('signin-phone').click();
  await p.byTest('phone-input').fill('500004127');
  await p.byTest('phone-send').click();
  await p.byTest('otp-input').fill('123456');
  await p.byTest('welcome-back-open').click();
  await p.page.waitForURL('**/today');
  await p.page.waitForTimeout(1000);
}

/** The worker is in charge and has saved the page and every bundle it names. */
async function shellSaved(p) {
  await p.page.waitForFunction(async () => {
    if (!navigator.serviceWorker?.controller) return false;
    const names = (await caches.keys()).filter((k) => k.startsWith('mada-shell-'));
    for (const name of names) {
      const keys = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
      if (keys.includes('/index.html') && keys.some((k) => k.includes('/entry-')) && keys.some((k) => k.includes('/mock-api-'))) return true;
    }
    return false;
  }, null, { timeout: 20_000, polling: 500 });
}

try {
  {
    step('online: sign in, the worker takes over, the trip and Wallet load');
    const p = await newPage();
    await signIn(p);
    await shellSaved(p);
    await p.see('Istanbul', 'trip on Today');
    await p.page.getByRole('tab', { name: 'Wallet', exact: true }).first().click();
    await p.page.waitForTimeout(1500);
    await p.page.getByRole('tab', { name: 'Today', exact: true }).first().click();
    // The offline copy is written a second after the last change.
    await p.page.waitForTimeout(2000);
    await p.shot('online-today');

    step('no signal, reload: the app opens with the saved trip');
    await p.context.setOffline(true);
    await p.page.reload();
    await p.see('Istanbul', 'saved trip after an offline reload', 15_000);
    await p.see('You’re offline. This is what we had at', 'offline line');
    const line = await p.byTest('offline-had').innerText().catch(() => '');
    if (!/\d\d:\d\d/.test(line)) errors.push(`offline line has no time: "${line}"`);
    await p.see('Offline · your trips are on this phone', 'offline pill');
    await p.shot('offline-reload-today');

    step('offline: Wallet opens from what was saved');
    await p.page.getByRole('tab', { name: 'Wallet', exact: true }).first().click();
    await p.page.waitForTimeout(1500);
    const body = await p.page.locator('body').innerText();
    if (/This site can.t be reached|ERR_INTERNET_DISCONNECTED/.test(body)) errors.push('wallet offline: browser error page');
    await p.shot('offline-wallet');

    step('offline: a deep link reload still opens the app');
    await p.page.goto(ORIGIN + '/battery');
    await p.see('+966 56 668 2662', 'battery screen offline');
    await p.see('Saved at', 'saved-at line');
    await p.byTest('battery-callback').click();
    await p.page.waitForTimeout(600);
    const cb = await p.byTest('battery-callback-line').innerText().catch(() => '');
    if (!/Will send when you’re online|Calls still work/.test(cb)) errors.push(`offline call-back: "${cb}"`);
    await p.shot('offline-battery');

    await p.context.setOffline(false);
    await p.context.close();
  }

  {
    step('low battery: from Today, and suggested at 8%');
    const p = await newPage({ battery: 0.08 });
    await signIn(p);
    await p.see('Battery at 8%', 'battery suggestion');
    await p.shot('today-battery-suggest');
    await p.byTest('battery-suggest-open').click();
    await p.byTest('battery-screen').waitFor({ state: 'visible', timeout: 8000 });
    await p.see('Just the essentials', 'battery title');
    await p.see('Next flight', 'battery flight');
    await p.see('Bereketzade', 'battery hotel');
    await p.see('فندق بيريكت زاده', 'battery hotel in Arabic');
    await p.see('+966 56 668 2662', 'Mada number');
    const imgs = await p.page.locator('[data-testid="battery-screen"] img').count();
    if (imgs) errors.push(`battery screen has ${imgs} images`);
    const bg = await p.byTest('battery-screen').evaluate((el) => getComputedStyle(el).backgroundColor);
    if (bg !== 'rgb(0, 0, 0)') errors.push(`battery screen background ${bg}`);
    await p.byTest('battery-callback').click();
    await p.see('Mada calls you by', 'call-back time');
    await p.shot('battery-screen');
    await p.byTest('battery-back').click();
    await p.page.waitForURL('**/today');

    step('sign out: nothing of the account is left on this device');
    await p.page.evaluate(() => { window.history.pushState({}, '', '/profile'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await p.page.waitForTimeout(1200);
    await p.page.getByText('Sign out', { exact: true }).first().click();
    await p.byTest('signout-remove').click();
    await p.page.waitForTimeout(2000);
    const left = await p.page.evaluate(() => ({ cache: localStorage.getItem('mada.cache.v1'), outbox: localStorage.getItem('mada.outbox.v1'), session: localStorage.getItem('mada.session.v1') }));
    if (left.cache || left.session || left.outbox) errors.push(`left after sign-out: ${JSON.stringify(left).slice(0, 200)}`);
    // The worker's caches only ever hold the app itself: the page, its bundles and its own files. Never the API.
    const cached = await p.page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
      return out;
    });
    const foreign = cached.filter((u) => !(u === '/index.html' || u === '/favicon.ico' || u.startsWith('/_expo/') || u.startsWith('/assets/')));
    if (foreign.length) errors.push(`cached outside the app shell: ${foreign.slice(0, 5).join(', ')}`);
    if (!cached.length) errors.push('nothing cached at all');
    await p.shot('signed-out');
    await p.context.close();
  }

  {
    step('a new deploy while the app is open: "A new version is ready · Refresh", then the new build takes over');
    const p = await newPage();
    await signIn(p);
    await shellSaved(p);
    await p.see('Istanbul', 'trip before the deploy');
    const running = () => p.page.evaluate(() => /entry-([A-Za-z0-9]+)\.js/.exec([...document.scripts].map((x) => x.src).join(' '))?.[1] ?? null);
    const first = await running();
    const second = deploy(2);
    // The tab comes back to the front: the app looks for a newer build.
    await p.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.byTest('update-bar').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => errors.push('update bar did not show after a deploy'));
    await p.see('A new version is ready', 'update bar words');
    await p.see('Refresh', 'refresh button');
    if ((await running()) !== first) errors.push('the open tab changed build by itself');
    // Its worker installs, takes over and saves the new build; the old build's files stay for the open tab.
    const tookOver = await p.page.waitForFunction(async (b) => {
      const c = navigator.serviceWorker.controller;
      if (!c || !c.scriptURL.includes(`build=${b}`)) return false;
      const keys = await caches.keys();
      return keys.includes(`mada-shell-${b}`) && !!(await (await caches.open(`mada-shell-${b}`)).match('/index.html'));
    }, second, { timeout: 20_000, polling: 500 }).then(() => true).catch(() => false);
    if (!tookOver) errors.push('the new worker did not take over with the new build saved');
    const kept = await p.page.evaluate(async (b) => (await caches.keys()).includes(`mada-shell-${b}`), first);
    if (!kept) errors.push('the open tab\'s build was dropped while it still runs');
    await p.shot('update-bar');

    await p.byTest('update-refresh').click();
    await p.page.waitForLoadState('load');
    await p.see('Istanbul', 'trip after Refresh', 15_000);
    if ((await running()) !== second) errors.push(`after Refresh still on ${await running()}, not ${second}`);
    if (await p.byTest('update-bar').isVisible().catch(() => false)) errors.push('update bar still showing on the new build');

    step('a deploy on a slow connection: the saved app opens, then says a new one is ready; the next open is the new one');
    const third = deploy(3);
    slowPage = 6000;
    await p.page.reload();
    await p.see('Istanbul', 'trip from the saved app', 15_000);
    if ((await running()) !== second) errors.push(`slow reload did not open the saved build (${await running()})`);
    await p.byTest('update-bar').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => errors.push('no update bar once the slow page arrived'));
    await p.shot('update-bar-slow');
    slowPage = 0;
    await p.page.reload();
    await p.see('Istanbul', 'trip on the newest build', 15_000);
    if ((await running()) !== third) errors.push(`next open was ${await running()}, not ${third}`);
    const builds = await p.page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('mada-shell-')));
    if (builds.length > 2) errors.push(`more than two builds kept: ${builds.join(', ')}`);
    if (builds.includes(`mada-shell-${first}`)) errors.push('the oldest build was not dropped');

    step('offline after the update: the saved trip still opens');
    await p.page.waitForTimeout(2500);
    await p.context.setOffline(true);
    await p.page.reload();
    await p.see('Istanbul', 'saved trip offline on the new build', 15_000);
    await p.context.setOffline(false);
    next = null;
    await p.context.close();
  }

  {
    step('low battery in Arabic, from the small link on Today');
    const p = await newPage({ locale: 'ar-SA' });
    await signIn(p);
    await p.byTest('battery-entry').click();
    await p.byTest('battery-screen').waitFor({ state: 'visible', timeout: 8000 });
    await p.see('المهم بس', 'battery title ar');
    await p.see('رحلتك الجاية', 'battery flight ar');
    await p.see('اتصل على مادا', 'call Mada ar');
    await p.shot('battery-screen-ar');
    await p.context.close();
  }
} catch (e) {
  errors.push(`crashed: ${e.message}`);
  console.log(e);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) { console.log(`\n${errors.length} problem(s):\n${errors.map((e) => `  - ${e}`).join('\n')}`); process.exit(1); }
console.log(`\nAll good. ${n} screenshots in ${OUT}`);
