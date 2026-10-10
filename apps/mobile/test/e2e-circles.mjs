// Circles and Discover, end to end, in headless Chromium against the web export (mock API mode is fine).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-circles.mjs [shot-dir]          (DIST=… to point at another export; API_TARGET=… for a real server)
//
// Walks: Discover (city sheet, a city guide for anywhere else, filters, a tip opened, saved, reported, a tip posted and checked),
// the Circles view (who's around and its privacy choices, circles, friends, people you know, saved, passport stamps),
// a circle's chat (votes cast and closed, @Mada, a cost split, settings, rename, invite link), a new circle in two
// steps (duplicate name, Mada-wide search, nobody found), your people (tabs, contacts, by phone), a friend's page,
// Saved, invite links (signed in, expired, and signed out → sign up → lands in the circle), and a new account's
// empty states. Screenshots every screen at 390×844. Fails on page errors or missing text.
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-circles');
const API = process.env.API_TARGET ?? null;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) {
    if (!API) { res.writeHead(502).end('No API_TARGET'); return; }
    const target = new URL(url.pathname + url.search, API);
    const p = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    p.on('error', (e) => res.writeHead(502).end(String(e)));
    req.pipe(p);
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

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  return { context, page };
}
function kit(page) {
  const shot = async (name) => { n += 1; await page.waitForTimeout(600); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 8000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  const tap = async (name, exact = true) => page.getByRole('button', { name, exact }).filter({ visible: true }).first().click();
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  const text = (s) => page.getByText(s, { exact: true }).filter({ visible: true }).first();
  // In-app navigation (a reload would start the in-app mock API over).
  const go = async (path) => { await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await page.waitForTimeout(700); };
  return { shot, see, tap, byTest, text, go };
}
/** Scroll the screen under the thumb. */
async function scroll(page, dy) { await page.mouse.move(195, 420); await page.mouse.wheel(0, dy); await page.waitForTimeout(400); }

async function signIn(page, phone, { returning, name = 'Omar' }) {
  const { see, byTest } = kit(page);
  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill(phone);
  await byTest('phone-send').click();
  await see('Enter the code', 'otp');
  await byTest('otp-input').fill('123456');
  if (returning) { await see('Welcome back', 'welcome back'); await byTest('welcome-back-open').click(); }
  else { await see('What should we call you?', 'name'); await byTest('name-input').fill(name); await byTest('name-go').click(); await byTest('alerts-allow').click(); }
  await page.waitForTimeout(1200);
}

/* ───────────── the demo account ───────────── */
async function demo() {
  const { context, page } = await newPage();
  const { shot, see, tap, byTest, text, go } = kit(page);
  await signIn(page, '500004127', { returning: true });

  step('discover');
  await byTest('dock-circles').click();
  await see('On this week in', 'discover heading');
  await see('Istanbul', 'trip city first');
  await see('While you’re there, 9–15 Mar', 'trip dates');
  await see('Bosphorus dinner cruise', 'events');
  await shot('discover');
  await scroll(page, 700);
  await see('Trips we’ve planned', 'plans');
  await see('Künefe near Galata Tower', 'friend tip first');
  await shot('discover-tips');

  step('city sheet');
  await scroll(page, -2000);
  await byTest('city-switch').click();
  await see('What’s on where?', 'city sheet');
  await see('Your trips', 'your trips group');
  await shot('city-sheet');
  await byTest('city-search').fill('Tbilisi');
  await see('City guide', 'anywhere else opens its guide');
  await shot('city-guide-row');
  await byTest('city-search').fill('');
  await page.getByRole('button', { name: 'AlUla', exact: true }).first().click();
  await see('Hegra at golden hour', 'alula events');
  await page.getByRole('button', { name: 'Food', exact: true }).first().click();
  await see('No food tips in AlUla yet.', 'empty filter');
  await scroll(page, 900);
  await shot('discover-empty-filter');
  await tap('All tips');
  await see('Maraya at night', 'alula tip');
  await scroll(page, -2000);
  await byTest('city-switch').click();
  await page.getByRole('button', { name: 'Riyadh', exact: true }).first().click();
  await see('Boulevard World at night', 'riyadh events');

  step('a tip: save, open, report');
  await scroll(page, 900);
  await byTest('tip-bookmark').first().click();
  await see('Saved to Riyadh. Find it in Circles → Saved.', 'saved toast');
  await byTest('tip-card').first().click();
  await see('Book a table', 'tip detail');
  await shot('tip-detail');
  await byTest('tip-report').click();
  await see('What’s wrong?', 'report sheet');
  await tap('Something unsafe');
  await shot('tip-report');
  await byTest('report-send').click();
  await see('Thanks. A person will look at this tip within 24 hours.', 'report toast');

  step('post a tip');
  await scroll(page, -2000);
  await byTest('post-tip').click();
  await see('Tips are checked before they show.', 'post sheet');
  await byTest('tip-place').fill('Najdi Village');
  await byTest('tip-text').fill('Book the family room upstairs. The jareesh is the thing to order.');
  await shot('post-tip');
  await byTest('tip-post').click();
  await see('It shows once it’s checked', 'posted toast');
  await see('being checked', 'pending tip');
  await shot('tip-pending');

  step('circles view');
  await text('Circles').click();
  await see('Noor is in Istanbul when you are.', 'who is around');
  await see('Tell friends you’re in Istanbul', 'presence toggle');
  await see('Istanbul for Eid', 'circles');
  await shot('circles');
  await byTest('say-hello').click();
  await see('Sent. Noor will see it next time they open Mada.', 'hello sent');
  await page.getByRole('switch').first().click();
  await see('Who can see you’re in Istanbul?', 'presence sheet');
  await byTest('audience-family').click();
  await shot('presence-sheet');
  await byTest('around-on').click();
  await see('On for family only', 'presence on');
  await page.getByRole('button', { name: 'More options for Noor' }).click();
  await see('Don’t show me Noor here', 'noor sheet');
  await shot('noor-sheet');
  await tap('Cancel');
  await scroll(page, 700);
  await see('From people you know', 'known');
  await see('Saved', 'saved');
  await shot('circles-more');
  await scroll(page, 900);
  await see('Your passport', 'passport');
  await see('Baku', 'stamps');
  await see('You’re 2nd among friends', 'rank');
  await shot('passport');
  await scroll(page, -3000);

  step('a circle: chat, vote, Mada');
  await page.getByRole('button', { name: 'Istanbul for Eid', exact: true }).first().click();
  await see('Which evening for the cruise?', 'vote');
  await see('Open vote', 'pinned vote');
  await see('I’m holding 6 seats', 'agent message');
  await shot('chat-eid');
  await byTest('vote-option').nth(1).click();
  await see('you picked Thu 11 Mar', 'my vote');
  await byTest('vote-close').first().click();
  await see('Wednesday it is. Want us to book it?', 'vote result');
  await shot('chat-vote-closed');
  await byTest('chat-input').fill('@Mada do we need a visa?');
  await byTest('chat-send').click();
  await see('Mada is looking into it', 'typing');
  await see('e-visa', 'mada answer');
  await shot('chat-mada');
  await byTest('chat-input').fill('Who is in for the ferry?');
  await byTest('chat-send').click();
  await see('I’m in.', 'reply', 9000);
  await byTest('chat-input').fill('Thanks');
  await byTest('chat-send').click();
  await see('Seen by', 'read receipt', 9000);
  await shot('chat-seen');

  step('offline: a message waits in the outbox, then goes');
  await context.setOffline(true);
  await page.waitForTimeout(800);
  await byTest('chat-input').fill('See you at the pier');
  await byTest('chat-send').click();
  await see('Sends when you’re online', 'queued message');
  await shot('chat-offline-queued');
  await context.setOffline(false);
  await page.waitForFunction(() => !document.querySelector('[data-testid="queued-message"]'), null, { timeout: 15000 }).catch(() => errors.push('outbox: message did not send after reconnecting'));
  await see('See you at the pier', 'sent after reconnect');

  step('tools: split');
  await byTest('chat-tools').click();
  await see('Add to the circle', 'tools');
  await shot('tools');
  await byTest('tool-split').click();
  await byTest('split-what').fill('Dinner');
  await byTest('split-total').fill('1140');
  await page.getByRole('radio', { name: 'By family' }).click();
  await see('Your family', 'family unit');
  await see('Abdullah’s family', 'abdullah family');
  await shot('split-sheet');
  await byTest('split-post').click();
  await see('split by family', 'split card');
  await shot('chat-split');
  await see('paid their share', 'someone pays', 10000);
  await byTest('chat-tools').click();
  await byTest('tool-vote').click();
  await byTest('vote-q').fill('Where for lunch');
  await byTest('vote-o1').fill('Kadıköy');
  await byTest('vote-o2').fill('Galata');
  await shot('vote-sheet');
  await byTest('vote-post').click();
  await see('Where for lunch?', 'new vote');

  step('settings');
  await byTest('circle-settings').click();
  await see('Bookings and votes still reach you.', 'settings');
  await shot('settings');
  await byTest('rename').click();
  await byTest('rename-input').fill('Eid in Istanbul');
  await byTest('rename-save').click();
  await see('Renamed.', 'renamed');
  await byTest('invite-link-btn').click();
  await see('Invite to Eid in Istanbul', 'invite sheet');
  await page.waitForFunction(() => /madatrips\.sa\/join\//.test(document.querySelector('[data-testid="invite-link"]')?.value ?? ''), null, { timeout: 8000 }).catch(() => errors.push('link shown: no invite link'));
  await shot('invite-link');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await go('/circles');

  step('new circle');
  await go('/circle/new');
  await see('Your circle', 'preview');
  await byTest('circle-name').fill('Family');
  await see('You already have a circle called Family.', 'dupe');
  await shot('new-circle-dupe');
  await byTest('circle-name').fill('Summer in Baku');
  await shot('new-circle-name');
  await byTest('circle-next').click();
  await see('Who’s in Summer in Baku?', 'step 2');
  await shot('new-circle-who');
  await byTest('people-search').fill('Maha');
  await see('Maha Alharbi', 'mada-wide search');
  await byTest('pick-person').first().click();
  await byTest('people-search').fill('Zzzz');
  await see('Nobody called “Zzzz” on Mada yet.', 'nobody');
  await shot('new-circle-nobody');
  await byTest('people-search').fill('');
  await byTest('circle-make').click();
  await see('Summer in Baku starts here.', 'new chat');
  await see('Maha is invited', 'welcome invited');
  await shot('new-circle-chat');
  await see('Maha joined', 'accepted', 9000);
  await byTest('mada-ideas').click();
  await see('Three ideas for Baku', 'ideas', 9000);
  await shot('new-circle-ideas');

  step('people');
  await go('/people');
  await see('Your people', 'people');
  await see('Abdullah Alqahtani', 'friends list');
  await shot('people-friends');
  await page.getByRole('tab', { name: /Following/ }).click();
  await see('You don’t follow anyone yet.', 'following empty');
  await shot('people-following');
  await page.getByRole('tab', { name: /Invited/ }).click();
  await see('Not yet', 'pending invite');
  await see('Joined', 'joined invite');
  await shot('people-invited');
  await page.getByRole('tab', { name: /Requests/ }).click();
  await see('Reem Aldosari', 'request');
  await shot('people-requests');
  await byTest('request-accept').click();
  await see('You and Reem are friends.', 'accepted');
  await byTest('people-add').click();
  await see('From your contacts', 'add sheet');
  await byTest('add-phone').fill('512345678');
  await see('Not on Mada yet.', 'not on mada');
  await shot('add-friends');
  await byTest('from-contacts').click();
  await see('Numbers are matched on this phone and never stored.', 'contacts ask');
  await shot('contacts-ask');
  await byTest('contacts-allow').click();
  await see('On Mada from your contacts', 'contacts found');
  await see('Maha Alharbi', 'contact match');
  await shot('contacts-found');
  await page.keyboard.press('Escape');

  step('friend');
  await go('/circles');
  await go(`/people`);
  await page.getByRole('button', { name: 'Noor Alsaud' }).first().click();
  await see('Friends since 2025', 'friend since');
  await see('In Istanbul when you are', 'in city');
  await see('Künefe near Galata Tower', 'her tips');
  await shot('friend');
  await byTest('friend-more').click();
  await see('Hide from Who’s around', 'friend more');
  await shot('friend-more');
  await byTest('friend-report').click();
  await see('Report and block', 'report and block');
  await page.keyboard.press('Escape');

  step('saved');
  await go('/saved');
  await see('Plan a day from these', 'saved by city');
  await see('Saved plans', 'saved plans');
  await shot('saved');

  step('invite links');
  await go('/join/ist8k2qa-aq2k8t');
  await see('Abdullah invited you', 'invite preview');
  await see('If you join, they see', 'privacy');
  await shot('join-preview');
  await byTest('join-go').click();
  await see('You’re in. Abdullah can see you joined.', 'joined toast');
  await see('Booked. We’re on SV263', 'circle history');
  await shot('joined-circle');
  await go('/join/old4q1ba-ab1q4d');
  await see('This invite has expired.', 'expired');
  await shot('join-expired');
  await context.close();
}

/* ───────────── a new account: the empty states ───────────── */
async function fresh() {
  const { context, page } = await newPage();
  const { shot, see, byTest, text } = kit(page);
  await signIn(page, `5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`, { returning: false, name: 'Lama' });
  await byTest('dock-circles').click();
  await see('On this week in', 'discover');
  await see('Riyadh', 'home city');
  await shot('fresh-discover');
  await text('Circles').click();
  await see('Your people, in one place.', 'no circles');
  await see('Bring your people.', 'no friends');
  await see('Nothing saved yet.', 'nothing saved');
  await shot('fresh-circles');
  await scroll(page, 900);
  await see('Every trip home adds a stamp.', 'empty passport');
  await shot('fresh-passport');
  await context.close();
}

/* ───────────── signed out: open a link, sign up, land in the circle ───────────── */
async function joinSignedOut() {
  const { context, page } = await newPage();
  const { shot, see, byTest } = kit(page);
  await page.goto(ORIGIN + '/join/ist8k2qa-aq2k8t');
  await see('Abdullah invited you', 'preview signed out');
  await see('Takes a minute. Your passport can wait.', 'sign-up line');
  await shot('join-signed-out');
  await byTest('join-go').click();
  await see("We'll take it from here.", 'welcome');
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill(`5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`);
  await byTest('phone-send').click();
  await byTest('otp-input').fill('123456');
  await byTest('name-input').fill('Sami');
  await byTest('name-go').click();
  await byTest('alerts-allow').click();
  await see('Booked. We’re on SV263', 'landed in the circle', 10000);
  await shot('join-landed');
  await context.close();
}

try {
  for (const [name, fn] of [['demo', demo], ['fresh', fresh], ['join', joinSignedOut]]) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) continue;
    try { await fn(); } catch (e) { errors.push(`${name}: ${String(e?.message ?? e).split('\n')[0]}`); console.log(e); }
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nCircles passed. ${n} screenshots in ${OUT}`);
