// The event map (docs/app/ASK-INTEGRATED.md §1.3, U9) walked through the app against the web export in mock-API mode,
// with the mock-only demo conversation (window.__MADA_DEMO__ = { askChat: true }):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-event-map.mjs [shot-dir]          (default docs/app/screens)
//
// Each write, and every screen §1.3 says it updates: a plan made in the chat (the chat's card, its title in the chats
// list, a Planning trip on Trips) → a stay booked from its item (the plan's day shows the hotel, the trip's timeline
// the check-in) → Today the day before (the check-in card, above the ideas) → a companion's change that costs money,
// approved by the payer (the payer's chat gets "Abdullah's change needs booking" with Book · Not now, Book opens the
// pay sheet). The desk's side (board, customer page, Ask list) is platform/test/app/event-map.test.ts.
// `__MADA_DEMO__.planToday = n` (mock only) reads Today as n days from the plan's start.
// Screens: ai-u9-today-trip-en, ai-u9-today-trip-ar, ai-u9-pay-change-en.
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

async function start(locale, demo = { askChat: true }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  await context.addInitScript((d) => { window.__MADA_DEMO__ = d; }, demo);
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
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, `${name}.png`), scale: 'css' }); console.log('·', name); };
  const visible = async (id, timeout = 12000) => { try { await byTest(id).waitFor({ state: 'visible', timeout }); return true; } catch { return false; } };
  const see = async (text, timeout = 12000) => { try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); return true; } catch { return false; } };
  /** In the app, not a reload: the mock keeps its sign-in in memory only. */
  const go = async (url) => { await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, url); await page.waitForTimeout(600); };
  const top = async () => { await page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (el.scrollTop) el.scrollTop = 0; window.scrollTo(0, 0); }); await page.waitForTimeout(300); };
  return { context, page, byTest, all, shot, visible, see, go, top };
}


const sizeOk = (name) => { const kb = statSync(join(OUT, `${name}.png`)).size / 1024; check(kb < 400, `${name}.png is under 400 KB (${Math.round(kb)} KB)`); };
const openItem = async (s, n, words) => {
  await s.page.locator(`[data-testid="plan-day-${n}"] [data-testid="plan-item"]`).filter({ hasText: words }).first().click();
  return s.visible('plan-sheet');
};
const slide = async (page) => {
  await page.waitForTimeout(1200);
  const track = page.locator('[role="slider"]').last();
  const b = await track.boundingBox();
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + 30, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await page.mouse.move(b.x + 30 + ((b.width - 40) * i) / 12, y); await page.waitForTimeout(16); }
  await page.mouse.up();
};
const textOf = async (s, id) => (await s.byTest(id).innerText().catch(() => '')).replace(/\s+/g, ' ');

async function english() {
  const s = await start('en-GB');
  const { byTest, page } = s;

  // 1. Plan created in the chat: the plan card; Review opens the plan screen on its new planning trip.
  await byTest('dock-ask').click();
  await s.visible('ask-list');
  await byTest('ask-input').fill('Make a 3-day plan for Istanbul');
  await byTest('ask-send').click();
  check(await s.visible('chat-plan-card', 15000), 'plan created: the chat has the plan card');
  await byTest('chat-plan-review').click();
  check(await s.visible('plan-screen', 15000), 'plan created: Review opens the plan screen');
  const tripId = /\/trip\/([0-9a-f-]{36})\/plan/.exec(page.url())?.[1] ?? null;
  check(!!tripId, `plan created: on its trip (${tripId})`);
  check((await textOf(s, 'plan-title')).trim() === 'Riyadh → Istanbul', 'plan created: titled Origin → Destination');
  await s.go('/ask?list=1');
  check(await s.visible('ask-list', 10000) && /Riyadh → Istanbul/.test(await page.locator('body').innerText()), 'plan created: the chats list has the chat by its route');
  await s.go('/trips');
  await page.waitForTimeout(1200);
  check(/Istanbul/.test(await page.locator('body').innerText()), 'plan created: Trips has the planning trip');

  // 2. A stay booked from its item: the plan's day shows the hotel; the trip's timeline the check-in.
  await s.go(`/trip/${tripId}/plan`);
  await s.visible('plan-screen');
  check(await openItem(s, 1, 'Stay in Istanbul'), 'stay booked: the stay item opens');
  await byTest('plan-sheet-find-stay').click();
  check(await s.visible('plan-stays', 15000), 'stay booked: rooms for its nights');
  const hotel = (await page.locator('[data-testid="plan-stay-0"]').filter({ visible: true }).innerText()).split('\n')[0].trim();
  await byTest('plan-stay-0').click();
  check(await s.visible('pay-slide', 20000) || await s.see('Slide to', 20000), 'stay booked: the pay sheet');
  await slide(page);
  check(await s.visible('see-trip', 30000), 'stay booked: booked and confirmed');
  await s.go(`/trip/${tripId}/plan`);
  await s.visible('plan-screen');
  // The plan is read again when its screen opens: give it a moment to land.
  let day1 = '';
  for (let i = 0; i < 20 && !(day1.includes(hotel) && /Booked|Confirmed/.test(day1)); i++) {
    await page.waitForTimeout(500);
    day1 = await page.locator('[data-testid="plan-day-1"]').filter({ visible: true }).innerText().catch(() => '');
  }
  check(day1.includes(hotel) && /Booked|Confirmed/.test(day1), `the plan’s day shows the hotel (${hotel} in: ${day1.replace(/\s+/g, " ").slice(0, 300)})`);
  await s.go(`/itinerary/${tripId}`);
  check(await s.see('Check in', 15000) || await s.see('check in', 3000), 'the trip timeline shows the check-in');

  // 3. Today, the day before: the check-in card, above the ideas; the plan opens from it.
  await page.evaluate(() => { window.__MADA_DEMO__.planToday = -1; });
  await s.go('/trips');
  await s.go('/today');
  check(await s.visible('today-plan', 15000), 'Today: the plan cards when the trip is near');
  const card = await textOf(s, 'today-plan-checkin');
  check(card.includes(`Check in at ${hotel}`) && /Tomorrow/.test(card), `Today: the check-in card, tomorrow (${card})`);
  const planY = (await byTest('today-plan').boundingBox())?.y ?? 0;
  const ideas = page.locator('[data-testid="today-ideas"]').filter({ visible: true }).first();
  const ideasY = (await ideas.boundingBox().catch(() => null))?.y ?? Infinity;
  check(planY < ideasY, 'Today: the plan outranks the ideas');
  await s.top();
  await s.shot('ai-u9-today-trip-en');
  sizeOk('ai-u9-today-trip-en');
  await byTest('today-plan-days').click();
  check(await s.visible('plan-screen', 10000), 'Today: the card opens the plan');
  await s.context.close();
}

/** Arabic, the road trip on its drive day: "3h 25m to Melaka" from the drive measured, right to left. */
async function arabic() {
  const s = await start('ar-SA');
  const { byTest, page } = s;
  await byTest('dock-ask').click();
  await s.visible('ask-list');
  await byTest('ask-input').fill('رحلة برية ٧ أيام من سنغافورة لماليزيا');
  await byTest('ask-send').click();
  check(await s.visible('chat-plan-card', 15000), 'Arabic: the road trip plan card');
  await byTest('chat-plan-review').click();
  check(await s.visible('plan-screen', 15000), 'Arabic: the plan screen');
  await page.evaluate(() => { window.__MADA_DEMO__.planToday = 2; });
  await s.go('/trips');
  await s.go('/today');
  check(await s.visible('today-plan', 15000), 'Arabic: Today has the plan cards');
  const drive = (await page.locator('[data-testid="today-plan-drive"]').filter({ visible: true }).first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  check(/ملقا/.test(drive) && /اليوم/.test(drive) && /س/.test(drive), `Arabic: the drive day, with its time (${drive})`);
  check(!/اطلع قبل/.test(drive), 'Arabic: no "leave by" when the plan has no time');
  const dir = await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
  check(dir === 'rtl', 'Arabic: right to left');
  await s.top();
  await s.shot('ai-u9-today-trip-ar');
  sizeOk('ai-u9-today-trip-ar');
  await s.context.close();
}

/** A companion's change that costs money: approved by the payer, his chat gets the card with Book · Not now. */
async function payChange() {
  const s = await start('en-GB', { askChat: true, askPeople: true });
  const { byTest, page, all } = s;
  await byTest('dock-ask').click();
  await s.visible('ask-list');
  await all('ask-thread-title').filter({ hasText: /→ Istanbul/ }).first().click();
  check(await s.visible('chat-change-card', 15000), 'the payer’s chat has the change');
  await byTest('chat-change-approve').click();
  await page.waitForTimeout(800);
  await byTest('topbar-back').click();
  await page.waitForTimeout(800);
  await all('ask-thread-title').filter({ hasText: /→ Istanbul/ }).first().click();
  check(await s.visible('chat-pay-change', 15000), 'approved, it costs money: the pay card');
  const card = await textOf(s, 'chat-pay-change');
  check(/Abdullah’s change needs booking/.test(card) && /SAR/.test(card), `with who and the price (${card})`);
  check(await s.visible('chat-pay-change-book') && await s.visible('chat-pay-change-later'), 'Book · Not now');
  await byTest('chat-pay-change').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  await s.shot('ai-u9-pay-change-en');
  sizeOk('ai-u9-pay-change-en');
  await byTest('chat-pay-change-later').click();
  check(await s.visible('chat-pay-change-parked', 5000), 'Not now folds it to one line');
  await s.context.close();
  // Book, on a fresh card: the pay sheet with the team's price.
  const t = await start('en-GB', { askChat: true, askPeople: true });
  await t.byTest('dock-ask').click();
  await t.visible('ask-list');
  await t.all('ask-thread-title').filter({ hasText: /→ Istanbul/ }).first().click();
  await t.visible('chat-change-card', 15000);
  await t.byTest('chat-change-approve').click();
  await t.page.waitForTimeout(800);
  await t.byTest('topbar-back').click();
  await t.page.waitForTimeout(800);
  await t.all('ask-thread-title').filter({ hasText: /→ Istanbul/ }).first().click();
  await t.visible('chat-pay-change-book', 15000);
  await t.byTest('chat-pay-change-book').click();
  check(await t.visible('pay-slide', 20000) || await t.see('Slide to', 20000), 'Book opens the pay sheet');
  check(/650/.test(await t.page.locator('body').innerText()), 'with the price on the card');
  await t.context.close();
}

try {
  await english();
  await arabic();
  await payChange();
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nAll good. Screens in ${OUT}`);
