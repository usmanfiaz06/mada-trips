// Companions (docs/app/ASK-INTEGRATED.md §5, §5.5, U5) against the web export in mock-API mode, with the mock-only demo
// conversation (window.__MADA_DEMO__ = { askChat: true, askPeople: true }, lib/ask-chat-demo.ts, lib/mock/trip-people.ts):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-ask-people.mjs [shot-dir]          (default docs/app/screens)
//
// "Add Abdullah" asks which Abdullah (two rows, never a guess) and the tap adds the one picked; someone not in the circle
// gets the invite card, sent only on its tap; the trip's chat shows the change Abdullah asked for with Approve · Decline ·
// Change it, and approving says so on the card; the Travellers screen sets roles; a trip shared with you opens without
// prices; a change asked as a companion waits for the organiser; the owner's card in Arabic reads right to left.
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
  await context.addInitScript(() => { window.__MADA_DEMO__ = { askChat: true, askPeople: true }; });
  const page = await context.newPage();
  if (process.env.DEBUG) page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 300)));
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

const sizeOk = async (name) => { const { statSync: st } = await import('node:fs'); const kb = st(join(OUT, `${name}.png`)).size / 1024; check(kb < 400, `${name}.png is under 400 KB (${Math.round(kb)} KB)`); };

async function english() {
  const s = await start('en-GB');
  const { page, byTest } = s;
  await byTest('dock-ask').click();
  check(await s.visible('ask-list'), 'the chats list');
  await byTest('ask-input').fill('Add Abdullah to the Istanbul trip');
  await byTest('ask-send').click();
  check(await s.visible('chat-people-card', 15000), 'two Abdullahs: the choice card');
  check(/Which Abdullah\?/.test(await byTest('chat-people-card').innerText().catch(() => '')), 'it asks "Which Abdullah?"');
  check((await s.all('chat-people-person').count()) === 1 && (await s.all('chat-people-user').count()) === 1, 'one from the household, one friend on Mada');
  check(await s.visible('chat-people-other'), 'and Someone else');
  await page.waitForTimeout(700);
  await s.shot('ai-u5-which-en');
  await sizeOk('ai-u5-which-en');
  await byTest('chat-people-person').click();
  const added = await s.visible('chat-people-added');
  check(added, `the tap adds the one picked${added ? '' : ` (${await byTest('chat-people-card').innerText().catch(() => '')})`}`);

  await byTest('topbar-back').click();
  await page.waitForTimeout(700);
  await byTest('ask-list-new').click();
  await page.waitForTimeout(500);
  await byTest('ask-input').fill('And Faisal too');
  await byTest('ask-send').click();
  check(await s.visible('chat-invite-card', 15000), 'nobody by that name: the invite card');
  check(/isn’t in your circle yet/.test(await byTest('chat-thread').innerText().catch(() => '')), 'Mada says he isn’t in the circle yet');
  await page.waitForTimeout(700);
  await s.shot('ai-u5-invite-en');
  await sizeOk('ai-u5-invite-en');
  await byTest('chat-invite-send').click();
  check(/incomplete/.test(await byTest('chat-invite-card').innerText().catch(() => '')), 'no number: nothing sent, a calm line');
  await byTest('chat-invite-phone').fill('0501112233');
  await byTest('chat-invite-send').click();
  check(await s.visible('chat-invite-done'), 'the tap sends the invite');

  // The trip's chat: Abdullah's change waits for Omar.
  await byTest('topbar-back').click();
  await page.waitForTimeout(800);
  await s.all('ask-thread-title').filter({ hasText: /→ Istanbul/ }).first().click();
  check(await s.visible('chat-change-card', 15000), 'the owner’s chat has the change card');
  const card = await byTest('chat-change-card').innerText().catch(() => '');
  check(/Abdullah suggests a change/.test(card) && /1 → 2 nights/.test(card), `the card shows who and what (${card.split('\n').slice(0, 3).join(' | ')})`);
  check(await s.visible('chat-change-approve') && await s.visible('chat-change-decline') && await s.visible('chat-change-edit'), 'Approve · Decline · Change it');
  check(/pay sheet/.test(card), 'it says booking goes to his pay sheet');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(700);
  await s.shot('ai-u5-change-owner-en');
  await sizeOk('ai-u5-change-owner-en');
  await byTest('chat-change-approve').click();
  await page.waitForTimeout(600);
  check(/Approved by Omar/.test(await byTest('chat-change-status').innerText().catch(() => '')), 'approving says so on the card');
  check(!(await byTest('chat-change-approve').isVisible().catch(() => false)), 'and the buttons go');

  // Travellers: roles, owner only.
  await byTest('topbar-back').click();
  await page.waitForTimeout(600);
  await byTest('topbar-back').click().catch(() => {});
  await page.waitForTimeout(600);
  await byTest('dock-trips').click();
  await page.waitForTimeout(1200);
  await s.all('trip-card-Istanbul').first().click();
  await byTest('trip-travellers').waitFor({ timeout: 15000 });
  await byTest('trip-travellers').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await byTest('trip-travellers').click();
  check(await s.visible('travellers-owner'), 'the Travellers screen');
  const roles = s.all('traveller-user').first();
  check(/Can suggest/.test(await roles.innerText().catch(() => '')), 'a friend on Mada has the roles, Can suggest by default');
  await roles.locator('[data-testid$="-edit"]').first().click();
  await page.waitForTimeout(500);
  check((await roles.locator('[data-testid$="-edit"]').first().getAttribute('aria-checked')) === 'true', 'the owner sets Can edit');
  await roles.locator('[data-testid$="-suggest"]').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await s.shot('ai-u5-travellers-en');
  await sizeOk('ai-u5-travellers-en');

  // A trip someone else organised: in Trips, without prices.
  await byTest('topbar-back').click();
  await page.waitForTimeout(600);
  await byTest('topbar-back').click().catch(() => {});
  await page.waitForTimeout(800);
  check(await s.visible('shared-trips'), 'Trips lists the trip shared with him');
  await byTest('shared-trip-going').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await byTest('shared-trip-going').click();
  check(await s.visible('shared-no-prices'), 'the shared trip opens');
  const shared = await page.locator('body').innerText();
  check(/Hegra guided tour/.test(shared) && !/SAR|ر\.س/.test(shared), 'the plan, never prices');

  // Asking for a change on it as a companion: it waits for the organiser.
  await byTest('topbar-back').click();
  await page.waitForTimeout(700);
  await byTest('dock-ask').click();
  await page.waitForTimeout(800);
  // The orb may reopen the last chat: back to the list, then a new chat.
  if (!(await s.visible('ask-list', 2000))) { await byTest('topbar-back').click(); await page.waitForTimeout(700); }
  await byTest('ask-list-new').click();
  await page.waitForTimeout(500);
  await byTest('ask-input').fill('Can we do two nights in AlUla?');
  await byTest('ask-send').click();
  let said = '';
  for (let i = 0; i < 40 && !/We’ll ask Khalid/.test(said); i++) { await page.waitForTimeout(300); said = await byTest('chat-thread').innerText().catch(() => ''); }
  check(await s.visible('chat-change-card', 15000), 'a companion’s change: the card');
  const waiting = await byTest('chat-change-status').innerText().catch(() => '');
  check(/Waiting for Khalid/.test(waiting), `waiting for the organiser (${waiting})`);
  check(/We’ll ask Khalid to confirm/.test(await byTest('chat-thread').innerText().catch(() => '')), 'Mada says she’ll ask him');
  check(!(await byTest('chat-change-approve').isVisible().catch(() => false)), 'the companion can’t approve his own change');
  await s.context.close();
}

async function arabic() {
  const s = await start('ar-SA');
  await s.byTest('dock-ask').click();
  check(await s.visible('ask-list'), 'Arabic: the chats list');
  await s.all('ask-thread-title').filter({ hasText: /← إسطنبول|إسطنبول ←/ }).first().click();
  check(await s.visible('chat-change-card', 15000), 'Arabic: the change card in the trip’s chat');
  check(/يقترح تغيير/.test(await s.byTest('chat-change-card').innerText().catch(() => '')), 'Arabic: who suggests it');
  const dir = await s.page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
  check(dir === 'rtl', `Arabic: right to left (${dir})`);
  await s.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await s.page.waitForTimeout(700);
  await s.shot('ai-u5-change-owner-ar');
  await sizeOk('ai-u5-change-owner-ar');
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
