// Design v3 of the plan screen and the trip page (photo header, the day's dotted thread, the row's own action, the
// hotel's Manage) against the web export in mock-API mode, with the mock-only demo conversation:
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir <dir>
//   DIST=<dir> node test/e2e-design-v3.mjs [shot-dir]          (default docs/app/screens)
//
// Screens: design-v3-plan-en/ar, design-v3-trip-en/ar, design-v3-manage-en.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? '../../docs/app/screens');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
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
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
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
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('·', name); };
  const visible = async (id, timeout = 12000) => { try { await byTest(id).waitFor({ state: 'visible', timeout }); return true; } catch { return false; } };
  const see = async (text, timeout = 12000) => { try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); return true; } catch { return false; } };
  /** In the app, not a reload: the mock keeps its sign-in in memory only. */
  const go = async (url) => { await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, url); await page.waitForTimeout(600); };
  const top = async () => { await page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (el.scrollTop) el.scrollTop = 0; window.scrollTo(0, 0); }); await page.waitForTimeout(300); };
  return { context, page, byTest, all, shot, visible, see, go, top };
}

/** "A 3-day plan for Istanbul" in the chat, then Review the plan: the plan screen, and the trip it's on. */
async function planFromChat(s, words) {
  await s.byTest('dock-ask').click();
  await s.visible('ask-list');
  await s.byTest('ask-input').fill(words);
  await s.byTest('ask-send').click();
  const card = await s.visible('chat-plan-card', 15000);
  await s.byTest('chat-plan-review').click();
  const screen = await s.visible('plan-screen', 15000);
  const tripId = /\/trip\/([0-9a-f-]{36})\/plan/.exec(s.page.url())?.[1] ?? null;
  return { card, screen, tripId };
}


/** Book the stay from its row's "Find a stay": the sheet opens already looking; the first room, slide to pay. */
async function bookStay(s, slide) {
  const { byTest, page } = s;
  await page.locator('[data-testid="plan-day-1"] [data-testid="plan-item-act-findStay"]').filter({ visible: true }).first().click();
  check(await s.visible('plan-stays', 15000), 'Find a stay on the row: the sheet opens with rooms');
  await byTest('plan-stay-0').click();
  check(await s.visible('pay-slide', 20000) || await s.see(slide, 20000), 'the pay sheet opens for the room');
  await page.waitForTimeout(1200);
  const track = page.locator('[role="slider"]').last();
  const b = await track.boundingBox();
  const y = b.y + b.height / 2;
  // In Arabic the sun starts at the right and goes left.
  const rtl = slide !== 'Slide to';
  const from = rtl ? b.x + b.width - 30 : b.x + 30;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await page.mouse.move(from + (rtl ? -1 : 1) * ((b.width - 40) * i) / 12, y); await page.waitForTimeout(16); }
  await page.mouse.up();
  check(await s.visible('see-trip', 30000), 'booked');
}

async function run(locale, words, suffix) {
  const s = await start(locale);
  const { byTest, page } = s;
  const { screen, tripId } = await planFromChat(s, words);
  check(screen && !!tripId, `${suffix}: the plan screen`);
  check(await s.visible('plan-item-act-search'), `${suffix}: the flight says Search`);
  check(await s.visible('plan-item-act-findStay'), `${suffix}: the stay says Find a stay`);
  check(await s.visible('plan-item-act-view'), `${suffix}: an idea says View`);
  check(!(await s.see(suffix === 'en' ? 'Idea' : 'فكرة', 1500)), `${suffix}: no "Idea" left on the rows`);
  await bookStay(s, suffix === 'en' ? 'Slide to' : 'اسحب');
  await s.go(`/trip/${tripId}`);
  check(await s.visible('trip-plan', 15000), `${suffix}: the trip page`);
  check(await s.visible('trip-plan-options'), `${suffix}: the flight row says See options`);
  check(await s.visible('stay-manage'), `${suffix}: the hotel card has Manage`);
  check(!(await byTest('voucher-0').isVisible().catch(() => false)), `${suffix}: no separate hotel voucher card`);
  await s.top();
  await s.shot(`design-v3-trip-${suffix}`);
  // Open the plan from the trip page, as a traveller would (Back goes back to it).
  await byTest('trip-plan-open').click();
  await s.visible('plan-screen');
  await page.waitForTimeout(800);
  check(await s.visible('plan-item-act-booked'), `${suffix}: the booked stay says Booked`);
  check(await s.visible('topbar-back'), `${suffix}: Back on the photo`);
  await s.top();
  await s.shot(`design-v3-plan-${suffix}`);
  await page.goBack();
  await s.visible('trip-plan', 15000);
  if (suffix === 'en') {
    await byTest('stay-manage').click();
    check(await s.visible('stay-manage-sheet', 5000), 'Manage opens its sheet');
    check(await s.visible('stay-manage-directions'), 'with Directions');
    check(await s.visible('cancel-stay'), 'and Cancel');
    await s.shot('design-v3-manage-en');
    await byTest('cancel-stay').click();
    check(await s.visible('cancel-stay-confirm', 5000), 'Cancel goes through its confirmation');
  }
  await s.context.close();
}

try {
  await run('en-GB', 'Make a 3-day plan for Istanbul', 'en');
  await run('ar-SA', 'خطة ٣ أيام في إسطنبول', 'ar');
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nAll good. Screens in ${OUT}`);
