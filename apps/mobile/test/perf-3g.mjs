// First open on a slow connection (critique #5), measured in headless Chromium against the web export.
//
//   node scripts/copy-ocr.mjs && EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/perf-3g.mjs                                (DIST=… for another export, RUNS=… per case, default 2,
//                                                         VERBOSE=1 lists every file loaded)
//
// The export is served brotli-compressed (as Vercel does) behind "Slow 3G"-like throttling over CDP: 400 kbit/s down
// and up, 400 ms round trip, every run in a fresh context (cold HTTP cache, no service worker). Two cases:
//   guest      Welcome: first paint (the page's own sun, then the app), the welcome line on screen (its buttons work
//              from then), and its first button ("Look around", tapped as soon as the welcome shows) answered by Today.
//   signed in  the demo account's saved session (signed in once, unthrottled, before): Today with the trip on it.
//              With the mock API the trip comes from the copy saved on the device (the mock's sessions live in memory,
//              so the reopened app is then asked to sign in again: that sheet doesn't hide the trip under it).
// Prints a table (median of the runs) and the bytes on the wire. Nothing fails; it is a measurement.
import { createServer } from 'node:http';
import { brotliCompressSync, constants } from 'node:zlib';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const RUNS = Number(process.env.RUNS ?? 2);
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const TEXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.ttf']);
const packed = new Map();
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const ext = extname(file);
  let body = readFileSync(file);
  const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' };
  if (TEXT.has(ext) && /\bbr\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    if (!packed.has(file)) packed.set(file, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
    body = packed.get(file);
    headers['Content-Encoding'] = 'br';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME });
const VIEW = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US', serviceWorkers: 'block' };

async function throttled(context) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 400_000 / 8, uploadThroughput: 400_000 / 8 });
  let bytes = 0;
  const urls = new Map();
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
    if (process.env.VERBOSE) console.log(`  ${String(Math.round(e.encodedDataLength / 1024)).padStart(5)} KB ${urls.get(e.requestId)?.replace(ORIGIN, '')}`);
  });
  return { page, bytes: () => bytes };
}

const sinceStart = (page) => page.evaluate(() => performance.now());
const fcp = (page) => page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null);

async function guest() {
  const context = await browser.newContext(VIEW);
  const { page, bytes } = await throttled(context);
  await page.goto(ORIGIN + '/', { waitUntil: 'commit' });
  await page.getByText("We'll take it from here.").first().waitFor({ state: 'visible', timeout: 180_000 });
  const welcome = await sinceStart(page);
  await page.locator('[data-testid="welcome-browse"]').click({ timeout: 180_000 });
  await page.locator('[data-testid="today-scroll"]').waitFor({ state: 'visible', timeout: 180_000 });
  const interactive = await sinceStart(page);
  const out = { fcp: await fcp(page), welcome, interactive, kb: bytes() / 1024 };
  await context.close();
  return out;
}

/** Signs the demo account in once, unthrottled, and keeps what the browser saved (the session, the mock's data). */
async function signedInState() {
  const context = await browser.newContext(VIEW);
  const page = await context.newPage();
  await page.goto(ORIGIN + '/');
  await page.getByText("We'll take it from here.").first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.locator('[data-testid="welcome-start"]').click();
  await page.locator('[data-testid="signin-phone"]').click();
  await page.locator('[data-testid="phone-input"]').fill('500004127');
  await page.locator('[data-testid="phone-send"]').click();
  await page.locator('[data-testid="otp-input"]').fill('123456');
  const back = page.locator('[data-testid="welcome-back-open"]');
  await back.waitFor({ state: 'visible', timeout: 8000 }).then(() => back.click()).catch(() => {});
  await page.getByText('Istanbul').first().waitFor({ state: 'visible', timeout: 30_000 });
  // The offline copy is written a second after the trip lands (lib/net/persist.ts).
  await page.waitForTimeout(3000);
  const state = await context.storageState();
  await context.close();
  return state;
}

async function signedIn(storageState) {
  const context = await browser.newContext({ ...VIEW, storageState });
  const { page, bytes } = await throttled(context);
  await page.goto(ORIGIN + '/', { waitUntil: 'commit' });
  await page.getByText('Istanbul').first().waitFor({ state: 'visible', timeout: 180_000 });
  const trip = await sinceStart(page);
  const out = { fcp: await fcp(page), trip, kb: bytes() / 1024 };
  await context.close();
  return out;
}

const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const sec = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`);
try {
  const g = [];
  for (let i = 0; i < RUNS; i += 1) g.push(await guest());
  const state = await signedInState();
  const s = [];
  for (let i = 0; i < RUNS; i += 1) s.push(await signedIn(state));
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const entry = /\/_expo\/static\/js\/web\/entry-[A-Za-z0-9]+\.js/.exec(html)?.[0];
  const raw = entry ? statSync(join(DIST, entry)).size : 0;
  const br = entry ? brotliCompressSync(readFileSync(join(DIST, entry)), { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length : 0;
  console.log(`\nDIST ${DIST} · ${RUNS} runs each · median`);
  console.log(`| Measure | Value |\n|---|---|`);
  console.log(`| Entry JS, raw / brotli | ${(raw / 1e6).toFixed(2)} MB / ${(br / 1e6).toFixed(2)} MB |`);
  console.log(`| Guest: first paint | ${sec(median(g.map((r) => r.fcp)))} |`);
  console.log(`| Guest: welcome on screen | ${sec(median(g.map((r) => r.welcome)))} |`);
  console.log(`| Guest: "Look around" answered (Today drawn) | ${sec(median(g.map((r) => r.interactive)))} |`);
  console.log(`| Guest: bytes on the wire | ${Math.round(median(g.map((r) => r.kb)))} KB |`);
  console.log(`| Signed in: first paint | ${sec(median(s.map((r) => r.fcp)))} |`);
  console.log(`| Signed in: trip on Today | ${sec(median(s.map((r) => r.trip)))} |`);
  console.log(`| Signed in: bytes on the wire | ${Math.round(median(s.map((r) => r.kb)))} KB |`);
} finally {
  await browser.close();
  server.close();
}
