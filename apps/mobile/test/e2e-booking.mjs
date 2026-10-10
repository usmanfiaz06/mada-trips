// Booking (M2), end to end in headless Chromium against the web export in mock-API mode:
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-booking.mjs [shot-dir]            (ONLY=flights,edges,pay,desk,requests,more to pick)
//
// Signs in as the demo account (50 000 4127, Omar's family) and walks every booking flow and edge case in FLOWS.md §2–4:
// Ask (typed details, one question at a time, the calendar), search (results, fare rules, sort, the bundle, entry
// checks, no flights, an airline not answering, a passport problem, offline), the order sheet (promo codes, credit,
// travellers, cards with Luhn/expiry problems, a new card's bank code, Apple Pay and Face ID failing, Tabby, a decline,
// a price rise, the hold ending), With Mada (question, fare gone, tickets failing, slow, close and finish), the
// confirmation, requests with per-person quotes and the thread, a city searched by hand, stays, a curated plan, eSIM.
// Screenshots every step at 390×844 and fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-booking');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };
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
let n = 0;
const step = (s) => console.log('·', s);
const want = (name) => !ONLY || ONLY.includes(name);

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource|contract/.test(m.text())) console.log('console.error', m.text().slice(0, 300)); });
  return { context, page };
}

function kit(page) {
  const shot = async (name, wait = 650) => { n += 1; await page.waitForTimeout(wait); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 9000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const press = async (loc) => { loc = loc.filter({ visible: true }); await loc.first().evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); await loc.first().click(); };
  const tap = async (name, exact = true) => press(page.getByRole('button', { name, exact }));
  const text = (s, exact = false) => page.getByText(s, { exact }).filter({ visible: true }).first();
  const closeSheet = async () => { await page.getByRole('button', { name: 'Close' }).last().click(); await page.waitForTimeout(450); };
  const ask = async (q) => { await byTest('ask-input').fill(q); await byTest('ask-send').click(); };
  const demo = async (...labels) => {
    await byTest('ask-demo').click();
    await see('Make it go wrong', 'demo sheet');
    for (const l of labels) await page.getByRole('button', { name: l, exact: true }).last().click();
    await closeSheet();
  };
  /** Drag the sun across the slider, as a thumb would. */
  const slide = async () => {
    const track = page.locator('[role="slider"]').last();
    await track.waitFor({ state: 'visible', timeout: 8000 });
    const b = await track.boundingBox();
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 30, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) { await page.mouse.move(b.x + 30 + ((b.width - 40) * i) / 12, y); await page.waitForTimeout(16); }
    await page.mouse.up();
  };
  return { shot, see, byTest, press, tap, text, closeSheet, ask, demo, slide };
}

async function signIn(page) {
  const { see, byTest } = kit(page);
  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await see('Enter the code', 'otp');
  await byTest('otp-input').fill('123456');
  await see('Welcome back', 'welcome back');
  await byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
}

async function openAsk(page) {
  const { byTest, see } = kit(page);
  await byTest('dock-ask').click();
  await see('Where to?', 'ask start');
}

/** From Ask to the order sheet for the Eid family trip, Saudia with the rooms. */
async function toPay(page, { bundle = true, shots = false } = {}) {
  const k = kit(page);
  await k.ask('Istanbul for Eid, all of us');
  if (shots) { await k.see('Checking flights to Istanbul', 'working'); await k.shot('ask-working', 300); }
  if (!(await k.see('Three ways to get there.', 'results', 12000))) await k.shot('no-results');
  if (bundle) await k.press(k.byTest('bundle-add'));
  await k.press(k.byTest('ask-review'));
  await k.see('Everything included. No fees later.', 'pay sheet', 12000);
  await page.waitForTimeout(600);
}

/* ───────────── 1. the happy path: Eid in Istanbul ───────────── */
async function flights() {
  const { page, context } = await newPage();
  const k = kit(page);
  step('flights: sign in, Ask');
  await signIn(page);
  await openAsk(page);
  await k.shot('ask-start');
  await k.ask('Istanbul for Eid, all of us');
  await k.see('Checking flights to Istanbul', 'working');
  await k.shot('ask-working', 200);
  await k.see('Three ways to get there.', 'results', 12000);
  await k.see('Riyadh → Istanbul · 9–15 Mar 2027', 'summary');
  await k.see('4 people · Economy', 'party');
  await k.see('SAR 8,640', 'saudia price');
  await k.shot('results');
  step('flights: fare rules, sort');
  await k.press(k.byTest('flight-SV263'));
  await k.see('Refund minus SAR 400 per person', 'fare rules');
  await k.see('SV264', 'return flight');
  await k.shot('fare-rules');
  await k.press(page.getByRole('tab', { name: 'Cheapest' }));
  await page.waitForTimeout(300);
  await k.shot('sorted-cheapest');
  await k.press(page.getByRole('tab', { name: 'Best' }));
  step('flights: travellers, entry checks, the bundle');
  await k.see('Rules checked today', 'entry checked');
  await k.press(k.byTest('bundle-add'));
  await k.see('Review · SAR 14,960', 'review with rooms');
  await k.shot('bundle-entry');
  step('flights: the order sheet');
  await k.press(k.byTest('ask-review'));
  await k.see('Istanbul · 9–15 Mar', 'pay title', 12000);
  await k.see('4 travellers · Saudia, direct', 'flight line');
  await k.see('Connecting rooms near Galata Tower · 6 nights', 'stay line');
  await k.see('If you cancel, the flights come back minus SAR 400 per person. Rooms and pickups are free to cancel until 2 Mar.', 'rule');
  await k.see('Held 19:', 'hold timer');
  await k.shot('pay-sheet');
  step('pay: promo codes');
  await k.tap('Have a promo code?');
  await k.byTest('promo-input').fill('RAMADAN');
  await k.byTest('promo-apply').click();
  await k.see('That code ended on 30 March.', 'expired code');
  await k.shot('promo-expired');
  await k.byTest('promo-input').fill('EID10');
  await k.byTest('promo-apply').click();
  await k.see('Code EID10 · 10% off', 'promo applied');
  await k.see('SAR 14,660', 'total after promo');
  await k.shot('promo-applied');
  step('pay: who is going');
  await k.tap('Edit');
  await k.see("Who's travelling?", 'people sheet');
  await k.shot('people-sheet');
  await k.closeSheet();
  step('pay: a new card (problems, then a good one)');
  await k.tap('Change');
  await k.see('Pay with', 'cards sheet');
  await k.shot('cards-sheet');
  await k.byTest('card-add').click();
  await k.byTest('card-number').fill('3782 8224 6310 005');
  await k.see('We can’t take American Express yet.', 'amex');
  await k.byTest('card-number').fill('4242 4242 4242 4241');
  await k.see('That number doesn’t look right.', 'luhn');
  await k.byTest('card-exp').fill('0125');
  await k.byTest('card-cvv').click();
  await k.see('This card has expired.', 'expired card');
  await k.shot('card-problems');
  await k.byTest('card-number').fill('4242 4242 4242 4242');
  await k.byTest('card-exp').fill('0829');
  await k.byTest('card-cvv').fill('123');
  await k.byTest('card-name').fill('OMAR ALHARBI');
  await k.shot('card-ok');
  await k.byTest('card-use').click();
  await k.see('Visa ending 42', 'new card chosen');
  await k.see('Tabby · 4 ×', 'instalments');
  await k.shot('pay-new-card');
  step('pay: slide, the bank asks for a code');
  await k.slide();
  await k.see('Your bank wants to check it’s you', '3ds', 10000);
  await k.byTest('otp-3ds').fill('000000');
  await k.see('That code doesn’t match. 2 tries left.', '3ds wrong');
  await k.shot('3ds-wrong');
  await k.byTest('otp-3ds').fill('123456');
  step('with Mada');
  await k.see('Booking now', 'waiting', 10000);
  await k.see('Istanbul', 'waiting place');
  await k.shot('waiting-start', 300);
  await k.see('Held: four seats together', 'held', 8000);
  await k.shot('waiting-held', 200);
  step('confirmed');
  await k.see("You're going to Istanbul.", 'confirmed', 15000);
  await k.see('Confirmed by', 'actor');
  await k.see('Paid with Visa ending 42', 'paid with');
  await k.shot('confirmed', 1200);
  await k.byTest('see-trip').click();
  await page.waitForTimeout(1200);
  await k.shot('after-see-trip');
  await context.close();
}

/* ───────────── 2. search edge cases ───────────── */
async function edges() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('edges: one question at a time, then the calendar');
  await k.ask('Flights to Istanbul in March for 2');
  await k.see('When in March?', 'month only');
  await k.shot('ask-when-in-march');
  await k.tap('I’ll pick dates');
  await k.see('Your search', 'calendar');
  await k.see('Pick the day you leave, then the day back', 'calendar status');
  await k.shot('calendar');
  await k.tap('Eid al-Fitr · Mar 2027');
  await k.see('Tue 9 Mar 2027 → Mon 15 Mar 2027 · 6 nights', 'eid picked');
  await k.press(page.getByRole('radio', { name: 'Business', exact: true }));
  await k.tap('One more baby');
  await k.shot('calendar-eid');
  await k.byTest('search-go').click();
  await k.see('2 people + 1 on a lap · Business', 'business with baby', 12000);
  await k.shot('results-business-baby');
  step('edges: no flights');
  await k.demo('No flights found');
  await k.ask('Flights to Dubai next weekend, just me');
  await k.see('Nothing direct on those dates.', 'no flights', 12000);
  await k.shot('no-flights');
  await k.tap('Try a day either side');
  await k.see('ways to get there.', 'flex results', 12000);
  await k.shot('flex-results');
  step('edges: Saudia not answering');
  await k.demo('No flights found', 'Airline not answering');
  await k.ask('Istanbul for Eid, all of us');
  await k.see('Saudia’s system isn’t answering.', 'supplier down', 12000);
  await k.shot('supplier-down');
  await k.tap('Show the others');
  await k.see('Two ways to get there.', 'others', 8000);
  await k.shot('supplier-down-others');
  step('edges: a passport problem');
  await k.demo('Airline not answering', 'Passport problem');
  await k.ask('Istanbul for Eid, all of us');
  await k.see('Ahmed can’t travel on this passport.', 'passport blocks', 12000);
  await k.see('Sort out Ahmed’s passport first', 'blocked cta');
  await k.press(k.text('Ahmed can’t travel on this passport.'));
  await k.shot('passport-problem');
  await k.tap('Book without Ahmed');
  await k.see('Review · SAR', 'unblocked', 8000);
  await k.shot('passport-resolved');
  step('edges: offline');
  await k.demo('Passport problem', 'Offline');
  await k.ask('Flights to Dubai next weekend');
  await k.see("You're offline.", 'offline ask');
  await k.shot('ask-offline');
  await k.demo('Offline');
  step('edges: a city Mada searches by hand');
  await k.ask('Flights to Tbilisi 3-10 Dec, just me');
  await k.see('We’re searching Tbilisi for you.', 'by hand', 12000);
  await k.shot('by-hand-tbilisi');
  await context.close();
}

/* ───────────── 3. payment edge cases ───────────── */
async function pay() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('pay: the card declines');
  await k.demo('Card declines');
  await toPay(page);
  await k.slide();
  await k.see('Your bank said no.', 'declined', 10000);
  await k.shot('declined');
  await k.byTest('declined-other').click();
  await k.see('Pay with', 'cards after decline');
  await k.press(k.byTest('card-applepay'));
  step('pay: Apple Pay, Face ID fails, then passcode');
  await k.slide();
  await k.see('Double-click to pay', 'apple pay', 10000);
  await k.shot('applepay');
  await k.see('Booking now', 'waiting after apple pay', 12000);
  await page.waitForTimeout(500);
  await k.byTest('wait-close').click();
  await k.see('We’re finishing it.', 'background toast', 6000);
  await k.shot('closed-background', 200);
  await k.see('Booking ', 'confirmed in background toast', 20000);
  await k.shot('background-confirmed', 200);
  step('pay: price rises, then the hold ends');
  await openAsk(page);
  await k.demo('Card declines', 'Price rises at payment');
  await toPay(page, { bundle: false });
  await k.slide();
  await k.see('The price went up SAR 140 while we checked.', 'price rose', 10000);
  await k.shot('price-rose');
  await k.closeSheet();
  await k.text('(demo: end the hold)').click();
  await k.see('Hold ended', 'hold ended');
  await k.see('Check the price again', 'recheck');
  await k.shot('hold-ended');
  await k.byTest('pay-recheck').click();
  await k.see('Price checked again.', 'rechecked');
  await k.shot('rechecked');
  step('pay: Tabby');
  await k.press(k.byTest('plan-tabby'));
  await k.see('Slide to book · 4 ×', 'tabby slide');
  await k.shot('tabby');
  await context.close();
}

/* ───────────── 4. with Mada: a question, the fare goes, tickets fail ───────────── */
async function desk() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  await k.demo('Fare sold out while booking', 'Mada asks a question', 'Tickets fail to issue');
  await toPay(page, { bundle: false });
  await k.slide();
  await k.see('Saudia sold the last seats at that price a minute ago.', 'fare gone', 15000);
  await k.shot('fare-gone');
  await k.byTest('fare-accept').click();
  await k.see('passport has more than one given name', 'question', 15000);
  await k.shot('question');
  await k.byTest('question-yes').click();
  await k.see('The airline didn’t issue the tickets', 'ticketing failed', 15000);
  await k.shot('ticketing-failed');
  await k.byTest('ticket-retry').click();
  await k.see("You're going to Istanbul.", 'confirmed after phone', 20000);
  await k.shot('confirmed-after-problems', 1200);
  await context.close();
  await deskSlow();
}

async function deskSlow() {
  const { page, context } = await newPage();
  const k = kit(page);
  step('desk: slow airline');
  await signIn(page);
  await openAsk(page);
  await k.demo('Airline is slow');
  await toPay(page, { bundle: false });
  await k.slide();
  await k.see('Taking longer than usual.', 'slow', 20000);
  await k.shot('slow');
  await context.close();
}

/* ───────────── 5. requests, stays, plans, eSIM ───────────── */
async function requests() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('requests: Umrah with needs per person');
  await k.ask('Umrah in Ramadan, Hessa needs a wheelchair');
  await k.see('Every traveller needs their own Nusuk permit.', 'nusuk');
  await k.see('Who’s going?', 'who');
  await k.press(page.getByRole('button', { name: 'Hessa', exact: true }));
  await k.tap('Done');
  await k.see('Anything we should arrange for each person?', 'needs');
  await k.shot('umrah-needs');
  await k.tap('Done');
  await k.tap('Steps from the Haram');
  await k.byTest('request-note').fill('Hessa walks slowly');
  await k.shot('umrah-note');
  await k.byTest('request-send').click();
  await k.see('Sent to Mada.', 'sent');
  await k.shot('umrah-sent');
  await k.see('replied', 'quote arrives', 20000);
  await k.see('Total', 'breakdown');
  await k.shot('umrah-quote');
  step('requests: the thread, an offer switched in');
  await k.tap('Can we stay closer to the Haram?');
  await k.see('King Abdulaziz Gate', 'offer', 8000);
  await k.shot('umrah-thread');
  await k.tap('Switch it');
  await k.see('Pay when you’re ready.', 'switched', 8000);
  await k.shot('umrah-switched');
  await k.press(k.byTest('request-pay'));
  await k.see('Charged now.', 'quote pay sheet', 10000);
  await k.shot('quote-pay');
  await k.slide();
  await k.see('Paid. We’ll take it from here.', 'quote paid', 10000);
  await page.locator('[data-testid="request-pay"]').filter({ visible: true }).waitFor({ state: 'detached', timeout: 8000 }).catch(() => errors.push('quote paid: Pay button still there'));
  await k.shot('quote-paid', 200);
  step('requests: a visa for the helper (add someone)');
  await k.tap('Close');
  await page.waitForTimeout(600);
  await openAsk(page);
  await k.ask('A Schengen visa');
  await k.see('For who?', 'visa who');
  await k.tap('Add someone');
  await k.byTest('add-given').fill('Lina');
  await k.byTest('add-surname').fill('Reyes');
  await k.tap('Helper');
  await k.see('We\'ll ask for their iqama', 'helper note');
  await k.shot('add-helper');
  await k.tap('Add Lina');
  await k.see('we\'ll also need the iqama', 'helper visa note', 8000);
  await k.shot('visa-helper');
  step('stays: three places, then the order sheet');
  await openAsk(page);
  await k.ask('A hotel in Istanbul');
  await k.see('Three places you\'d like.', 'stays', 12000);
  await k.shot('stays');
  await k.press(k.byTest('ask-review'));
  await k.see('Free to cancel until', 'stay rule', 10000);
  await k.shot('stay-pay');
  await page.goBack();
  step('plans: AlUla');
  await openAsk(page);
  await k.ask('A weekend in AlUla');
  await k.see("We've planned it. Change anything you like.", 'plan ready', 12000);
  await k.shot('plan-card');
  await k.byTest('plan-see').click();
  await k.see('Riyadh → AlUla', 'plan day 1', 10000);
  await k.shot('plan');
  await k.tap('Day 2');
  await k.shot('plan-day2');
  await k.byTest('plan-book').click();
  await k.see('Tickets, tours and tables for 4', 'package line', 10000);
  await k.shot('plan-pay');
  step('eSIM');
  await openAsk(page);
  await k.ask('An eSIM for the trip');
  await k.see('An eSIM for Türkiye, ready on landing.', 'esim');
  await k.shot('esim');
  await context.close();
}

try {
  if (want('flights')) await flights();
  if (want('edges')) await edges();
  if (want('pay')) await pay();
  if (want('desk')) await desk();
  if (want('requests')) await requests();
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
console.log(`\nBooking passed. ${n} screenshots in ${OUT}`);
