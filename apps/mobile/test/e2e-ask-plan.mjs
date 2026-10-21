// Ask's plan cards (docs/app/ASK-INTEGRATED.md §3.3, U3) against the web export in mock-API mode, with the mock-only
// demo conversation scripting a plan reply (window.__MADA_DEMO__ = { askChat: true }, lib/ask-chat-demo.ts):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-ask-plan.mjs [shot-dir]          (default docs/app/screens)
//
// "7-day road trip" answers with the plan card: the route, where it starts and a way to change it, a few rows a day with
// the drives (no km or time nobody measured), what's left to do and Review the plan; "Start from Jeddah" answers with
// what changed; in Arabic the route reads right to left. Screens: ai-u3-plan-card-en/ar.png, ai-u3-plan-diff-en.png.
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
  const context = await browser.newContext({ viewport: { width: 390, height: 1180 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
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


/** The card at the top of the screen, so the shot holds all of it. */
async function toCard(s, id) {
  await s.byTest(id).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await s.page.mouse.wheel(0, -90);
  await s.page.waitForTimeout(700);
}

async function english() {
  const s = await start('en-GB');
  const { byTest } = s;
  await byTest('dock-ask').click();
  await s.visible('ask-list');
  await byTest('ask-input').fill('7-day road trip from Singapore to Malaysia');
  await byTest('ask-send').click();
  check(await s.visible('chat-plan-card', 15000), 'a road trip answers with the plan card');
  check((await byTest('chat-plan-title').innerText()).trim() === 'Riyadh → Singapore → Penang', 'the card is titled by its route, start first');
  check(/Starting from Riyadh/.test(await byTest('chat-plan-origin').innerText()), 'it says where it starts');
  check(await s.visible('chat-plan-change'), 'with a way to change the start');
  const drives = await s.all('chat-plan-drive').allInnerTexts();
  check(drives.length >= 3, `three drives (${drives.length})`);
  check(drives.every((x) => !/km|\bh\b|min/.test(x)), 'no km or time nobody measured');
  check(/A car for days 3–6/.test(await byTest('chat-plan-todo').innerText()), 'what is left to do');
  check(await s.visible('chat-plan-review'), 'Review the plan');
  await toCard(s, 'chat-plan-card');
  await s.shot('ai-u3-plan-card-en');

  await byTest('ask-input').fill('Start from Jeddah instead');
  await byTest('ask-send').click();
  check(await s.visible('chat-plan-diff', 15000), 'a new start answers with what changed');
  const diff = await byTest('chat-plan-diff').innerText();
  check(/New start/.test(diff) && /Jeddah → Singapore/.test(diff), `the legs follow the start (${diff.replace(/\s+/g, ' ').slice(0, 80)})`);
  await toCard(s, 'chat-plan-diff');
  await s.shot('ai-u3-plan-diff-en');
  await s.context.close();
}

async function arabic() {
  const s = await start('ar-SA');
  const { byTest } = s;
  await byTest('dock-ask').click();
  await s.visible('ask-list');
  await byTest('ask-input').fill('رحلة برية ٧ أيام من سنغافورة لماليزيا');
  await byTest('ask-send').click();
  check(await s.visible('chat-plan-card', 15000), 'Arabic: the plan card');
  const title = (await byTest('chat-plan-title').innerText()).trim();
  check(title.includes('←') && /الرياض/.test(title), `Arabic: the route reads right to left (${title})`);
  check(/اليوم ١|اليوم 1/.test(await byTest('chat-plan-card').innerText()), 'Arabic: day labels');
  await toCard(s, 'chat-plan-card');
  await s.shot('ai-u3-plan-card-ar');
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
