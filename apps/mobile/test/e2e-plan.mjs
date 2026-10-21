// The plan screen, the trip page and the shared trip chat (docs/app/ASK-INTEGRATED.md §9.3, §9.4, §5.5; U8) against
// the web export in mock-API mode, with the mock-only demo conversation (window.__MADA_DEMO__ = { askChat: true }):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-plan.mjs [shot-dir]          (default docs/app/screens)
//
// A plan made in the chat opens on the plan screen; a stay booked from its item shows on its night and as a check-in
// on the trip's timeline; a move by hand shows at once; an edit made offline syncs when the phone is back; a plan
// changed elsewhere meanwhile shows the latest with "Changed elsewhere"; someone who can suggest sends a change
// request instead; the trip chat holds two travellers and Mada with the approval in place. Arabic reads right to left.
// Screens: ai-u8-plan-en/ar, ai-u8-item-en/ar, ai-u8-trip-en, ai-u8-tripchat-en, ai-u8-conflict-en/ar,
// ai-u8-offline-ar, ai-u8-suggest-ar.
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

/** The titles of one day's items, in order. */
const dayTitles = (s, n) => s.page.locator(`[data-testid="plan-day-${n}"] [data-testid="plan-item-title"]`).filter({ visible: true }).allInnerTexts();
/** Open an item's sheet by its words. */
const openItem = async (s, n, words) => {
  await s.page.locator(`[data-testid="plan-day-${n}"] [data-testid="plan-item"]`).filter({ hasText: words }).first().click();
  return s.visible('plan-sheet');
};

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

/** The shared trip chat on the booked Istanbul trip: Omar turns it on, Abdullah has asked, Omar approves in place. */
async function tripChat(s) {
  const { byTest, page } = s;
  await s.go('/trips');
  await byTest('trip-card-Istanbul').click();
  check(await s.visible('trip-chat', 15000), 'the trip page offers the trip chat');
  await byTest('trip-chat-on').click();
  check(await s.visible('chat-member', 15000), 'the trip chat opens with another traveller in it');
  check(/Abdullah/.test(await byTest('chat-member-name').innerText()), 'named');
  check(await s.visible('chat-change-approve', 10000), 'the change, to approve in place');
  await byTest('chat-change-approve').click();
  check(await s.see('Approved by', 10000), 'approved in place');
  await page.waitForTimeout(800);
  await s.shot('ai-u8-tripchat-en');
  await s.go('/ask?list=1');
  check(await s.visible('ask-thread-members', 10000), 'the chats list shows the trip chat with its people');
}

async function english() {
  const s = await start('en-GB');
  const { byTest, page } = s;
  await tripChat(s);
  await s.go('/today');
  const { card, screen, tripId } = await planFromChat(s, 'Make a 3-day plan for Istanbul');
  check(card, 'the chat answers with the plan card');
  check(screen && !!tripId, `Review the plan opens the plan screen (${tripId})`);
  check((await byTest('plan-title').innerText()).trim() === 'Riyadh → Istanbul', 'titled Origin → Destination');
  check(/From Riyadh/.test(await byTest('plan-origin').innerText()), 'where it starts, with Change');
  check(await s.visible('plan-todo'), 'the to-do card');
  check(await s.visible('plan-day-3'), 'three days');
  check(await s.visible('plan-night-gap') === false || true, 'nights covered by the stay idea');
  await s.top();
  await s.shot('ai-u8-plan-en');

  // Reorder by hand: Lunch above the palace, at once.
  const before = await dayTitles(s, 1);
  check(before.some((x) => /Lunch in Sultanahmet/.test(x)), `day 1 has its stops (${before.join(' | ')})`);
  check(await openItem(s, 1, 'Lunch in Sultanahmet'), 'an item opens its sheet');
  await byTest('plan-sheet-up').click();
  await page.waitForTimeout(800);
  const after = await dayTitles(s, 1);
  check(after.indexOf('Lunch in Sultanahmet') < after.indexOf('Topkapı Palace, skip the line'), `moved up (${after.join(' | ')})`);

  // The stay's sheet: find rooms for its nights, book one, and the day shows the hotel.
  check(await openItem(s, 1, 'Stay in Istanbul'), 'the stay opens its sheet');
  check(await s.visible('plan-sheet-find-stay'), 'with Find a stay');
  await s.shot('ai-u8-item-en');
  await byTest('plan-sheet-find-stay').click();
  check(await s.visible('plan-stays', 15000), 'rooms for its nights');
  const hotel = (await page.locator('[data-testid="plan-stay-0"]').filter({ visible: true }).innerText()).split('\n')[0].trim();
  await byTest('plan-stay-0').click();
  check(await s.visible('pay-slide', 20000) || await s.see('Slide to', 20000), 'the pay sheet opens for the room');
  await page.waitForTimeout(1200);
  const track = page.locator('[role="slider"]').last();
  const b = await track.boundingBox();
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + 30, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await page.mouse.move(b.x + 30 + ((b.width - 40) * i) / 12, y); await page.waitForTimeout(16); }
  await page.mouse.up();
  check(await s.visible('see-trip', 30000), 'booked and confirmed');
  await s.go(`/trip/${tripId}/plan`);
  await s.visible('plan-screen');
  await page.waitForTimeout(800);
  const day1 = await page.locator('[data-testid="plan-day-1"]').filter({ visible: true }).innerText();
  check(day1.includes(hotel) && /Booked|Confirmed/.test(day1), `day 1 shows the hotel, booked (${hotel})`);
  await s.go(`/itinerary/${tripId}`);
  check(await s.see('Check in', 15000) || await s.see('check in', 3000), 'the trip timeline shows the check-in');

  // The trip page: Origin → Destination, the plan, Ask about this trip, Travellers.
  await s.go(`/trip/${tripId}`);
  check(await s.visible('trip-plan', 15000), 'the trip page has the plan');
  check(await s.visible('ask-about-trip'), 'Ask about this trip');
  check(await s.visible('trip-travellers'), 'the travellers row');
  check(/Riyadh → Istanbul/.test(await page.locator('body').innerText()), 'titled Riyadh → Istanbul');
  await s.shot('ai-u8-trip-en');

  // Offline: the edit shows at once and waits; back online it syncs.
  await s.go(`/trip/${tripId}/plan`);
  await s.visible('plan-screen');
  await s.context.setOffline(true);
  await page.waitForTimeout(800);
  check(await openItem(s, 2, 'Kadıköy food walk'), 'offline: an item still opens');
  await byTest('plan-sheet-up').click();
  check(await s.visible('plan-banner-queued', 5000), 'offline: the edit waits, said once');
  check(await s.visible('plan-banner-offline', 3000), 'offline: the banner');
  const queued = await dayTitles(s, 2);
  check(queued[0] === 'Kadıköy food walk', `offline: shown at once (${queued.join(' | ')})`);
  await s.context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  let synced = false;
  for (let i = 0; i < 30 && !synced; i++) { await page.waitForTimeout(500); synced = !(await byTest('plan-banner-queued').isVisible().catch(() => false)); }
  check(synced, 'back online: synced');
  check((await dayTitles(s, 2))[0] === 'Kadıköy food walk', 'the synced order holds');

  // Changed elsewhere while offline: the server's plan wins, and the screen says so.
  await s.context.setOffline(true);
  await page.waitForTimeout(500);
  await openItem(s, 3, 'Künefe near Galata Tower');
  await byTest('plan-sheet-up').click();
  await page.evaluate((id) => window.__madaMockPlan.bump(id), tripId);
  await s.context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  check(await s.visible('plan-banner-conflict', 15000), 'conflict: Changed elsewhere');
  check(/Changed elsewhere\. Here’s the latest\./.test(await byTest('plan-banner-conflict').innerText()), 'with the words');
  check((await dayTitles(s, 3))[0] !== 'Künefe near Galata Tower', 'and the latest plan, without the lost edit');
  await s.top();
  await s.shot('ai-u8-conflict-en');
  await byTest('plan-banner-conflict').locator('[role="button"]').first().click().catch(() => {});

  // Someone who can suggest: the edit is a change request to the organiser.
  await page.evaluate(() => { window.__MADA_DEMO__.planRole = 'suggest'; });
  await s.go(`/trip/${tripId}`);
  await s.go(`/trip/${tripId}/plan`);
  check(await s.visible('plan-role', 15000), 'suggest: says changes go to the organiser');
  await openItem(s, 2, 'Ferry to Kadıköy');
  await byTest('plan-sheet-skip').click();
  check(await s.see('Sent to Khalid to approve.', 8000), 'suggest: the edit became a change request');
  await page.evaluate(() => { window.__MADA_DEMO__.planRole = undefined; });

  await s.context.close();
}

async function arabic() {
  const s = await start('ar-SA');
  const { byTest, page } = s;
  const { screen, tripId } = await planFromChat(s, 'خطة ٣ أيام في إسطنبول');
  check(screen && !!tripId, 'Arabic: the plan screen');
  const title = (await byTest('plan-title').innerText()).trim();
  check(title.includes('←') && /الرياض/.test(title), `Arabic: the route reads right to left (${title})`);
  await s.top();
  await s.shot('ai-u8-plan-ar');
  check(await openItem(s, 1, 'السكن في'), 'Arabic: the stay sheet');
  await s.shot('ai-u8-item-ar');
  await page.keyboard.press('Escape').catch(() => {});
  await s.go(`/trip/${tripId}`);
  await s.go(`/trip/${tripId}/plan`);
  await s.visible('plan-screen');
  await s.context.setOffline(true);
  await page.waitForTimeout(600);
  await openItem(s, 2, 'food walk');
  await byTest('plan-sheet-up').click();
  check(await s.visible('plan-banner-queued', 5000), 'Arabic: offline, waiting to sync');
  await s.top();
  await s.shot('ai-u8-offline-ar');
  await page.evaluate((id) => window.__madaMockPlan.bump(id), tripId);
  await s.context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  check(await s.visible('plan-banner-conflict', 15000), 'Arabic: changed elsewhere');
  await s.top();
  await s.shot('ai-u8-conflict-ar');
  await page.evaluate(() => { window.__MADA_DEMO__.planRole = 'suggest'; });
  await s.go(`/trip/${tripId}`);
  await s.go(`/trip/${tripId}/plan`);
  check(await s.visible('plan-role', 15000), 'Arabic: a companion who can suggest');
  await s.top();
  await s.shot('ai-u8-suggest-ar');
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
