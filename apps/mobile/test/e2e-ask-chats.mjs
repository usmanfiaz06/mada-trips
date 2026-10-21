// The Ask chats list (docs/app/ASK-INTEGRATED.md §2, U1) against the web export in mock-API mode, with the mock-only
// demo conversation (window.__MADA_DEMO__ = { askChat: true }, lib/ask-chat-demo.ts):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-ask-chats.mjs [shot-dir]          (default docs/app/screens)
//
// The orb opens the list (nothing kept on the phone yet); the chat about the upcoming trip sits under Upcoming trips;
// search finds by title; archive and unarchive; two new chats about two places keep their own turns; a chat the phone
// never kept opens from the server; the orb within 24 hours goes straight into the last chat; the list in Arabic reads
// right to left with the RTL arrow in titles.
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  await context.addInitScript(() => { window.__MADA_DEMO__ = { askChat: true }; });
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

async function english() {
  const s = await start('en-GB');
  const { page, byTest } = s;
  await byTest('dock-ask').click();
  check(await s.visible('ask-list'), 'the orb opens the chats list when no chat was open');
  await s.visible('ask-thread-row');
  let t = await s.titles();
  check(t.length >= 3, `the list has the chats (${t.length})`);
  const upcoming = await byTest('ask-list-upcoming').innerText().catch(() => '');
  check(/Riyadh → Istanbul/.test(upcoming), 'the chat about the upcoming trip is under Upcoming trips, titled with the route');
  check(await s.visible('ask-list-archived'), 'archived chats sit behind a row');
  await page.waitForTimeout(600);
  await s.shot('ai-u1-chats-en');

  // Search by title.
  await byTest('ask-list-search').fill('pakistan');
  await page.waitForTimeout(700);
  t = await s.titles();
  check(t.length === 1 && t[0] === 'eSIM for Pakistan', `search finds by title (${t.join(' | ')})`);
  await byTest('ask-list-search').fill('');
  await page.waitForTimeout(700);

  // Archive and unarchive.
  const row = s.all('ask-thread-row').filter({ hasText: 'eSIM for Pakistan' });
  await row.locator('[data-testid="ask-thread-more"]').click();
  await byTest('ask-thread-archive').click();
  t = await s.titlesWhen((x) => !x.includes('eSIM for Pakistan'));
  check(!t.includes('eSIM for Pakistan'), 'archive takes it off the list');
  await byTest('ask-list-archived').click();
  t = await s.titlesWhen((x) => x.includes('eSIM for Pakistan'));
  check(t.includes('eSIM for Pakistan'), 'the archived view has it');
  await s.all('ask-thread-row').filter({ hasText: 'eSIM for Pakistan' }).locator('[data-testid="ask-thread-more"]').click();
  await byTest('ask-thread-archive').click();
  await page.waitForTimeout(800);
  await byTest('topbar-back').click();
  check((await s.titlesWhen((x) => x.includes('eSIM for Pakistan'))).includes('eSIM for Pakistan'), 'unarchive brings it back');

  // A chat the phone never kept opens from the server, with its own turns.
  await s.all('ask-thread-row').filter({ hasText: 'eSIM for Pakistan' }).locator('[data-testid="ask-thread-title"]').click();
  check(await s.visible('chat-thread'), 'a chat opens from the server');
  const esim = await byTest('chat-thread').innerText();
  check(/Internet in Pakistan/.test(esim) && !/Istanbul/.test(esim), 'it shows its own turns only');
  await byTest('topbar-back').click();
  await page.waitForTimeout(800);

  // Two new chats, two places: each keeps its own turns.
  await byTest('ask-input').fill('Istanbul next month');
  await byTest('ask-send').click();
  check(await s.visible('chat-flights', 15000), 'a new chat from the list composer answers');
  await page.waitForTimeout(800);
  await s.shot('ai-u1-thread-en');
  await byTest('topbar-back').click();
  await page.waitForTimeout(800);
  await byTest('ask-list-new').click();
  await page.waitForTimeout(600);
  await byTest('ask-input').fill('Dubai in December');
  await byTest('ask-send').click();
  check(await s.visible('chat-flights', 15000), 'a second new chat answers');
  await page.waitForTimeout(600);
  await byTest('topbar-back').click();
  t = await s.titlesWhen((x) => x.includes('Istanbul next month') && x.includes('Dubai in December'));
  check(t.includes('Istanbul next month') && t.includes('Dubai in December'), `two chats, two rows (${t.slice(0, 4).join(' | ')})`);
  await s.all('ask-thread-title').filter({ hasText: /^Istanbul next month$/ }).click();
  await s.visible('chat-thread');
  await page.waitForTimeout(800);
  const first = await byTest('chat-thread').innerText();
  check(/Istanbul next month/.test(first) && !/Dubai in December/.test(first), 'the first chat keeps only its own turns');

  // The orb within 24 hours: straight into the last chat.
  // Out to Today inside the app (a reload would sign the mock out).
  await byTest('topbar-back').click();
  await page.waitForTimeout(700);
  await byTest('topbar-back').click();
  await page.waitForTimeout(1200);
  await byTest('dock-ask').click();
  check(await s.visible('chat-thread'), 'the orb opens the last chat when it was under 24 hours ago');
  const again = await byTest('chat-thread').innerText().catch(() => '');
  check(/Istanbul next month/.test(again), 'the same chat');
  await s.context.close();
}

async function arabic() {
  const s = await start('ar-SA');
  await s.byTest('dock-ask').click();
  check(await s.visible('ask-list'), 'Arabic: the chats list');
  await s.visible('ask-thread-row');
  const t = await s.titles();
  check(t.some((x) => x.includes('←')), `Arabic: route titles read with the RTL arrow (${t[0] ?? ''})`);
  const dir = await s.page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
  check(dir === 'rtl', `Arabic: the page is right to left (${dir})`);
  await s.page.waitForTimeout(600);
  await s.shot('ai-u1-chats-ar');
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
