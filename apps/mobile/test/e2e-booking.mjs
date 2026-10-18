// Booking (M2), end to end in headless Chromium against the web export in mock-API mode:
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-booking.mjs [shot-dir]            (ONLY=flights,edges,pay,desk,requests,umrah,circles,stays,stays-ar,asks,phone,money,money-ar to pick)
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

async function newPage(locale = 'en-GB') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
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
  /** A hotel row: its name opens the hotel's page, so choose it by the price on the end side. */
  const choose = async (id) => { const l = byTest(id); await l.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); const b = await l.boundingBox(); await page.mouse.click(b.x + b.width - 30, b.y + b.height / 2); await page.waitForTimeout(300); };
  return { shot, see, byTest, press, tap, text, closeSheet, ask, demo, slide, choose };
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
  // Already in Ask (or a screen over it): close back to the tabs first.
  for (let i = 0; i < 3 && !(await page.locator('[data-testid="dock-ask"]').filter({ visible: true }).count()); i++) {
    const close = page.getByRole('button', { name: /^(Close|Back)$/ }).filter({ visible: true }).last();
    if (!(await close.count())) break;
    await close.click(); await page.waitForTimeout(600);
  }
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
  await k.see('SAR 8,100', 'saudia price'); // Ahmed is 10: a child fare
  await k.shot('results');
  step('flights: fare rules, sort');
  await k.press(k.byTest('flight-rules-SV263'));
  await k.see('Fare rules · Saudia', 'fare rules sheet');
  await k.see('Refund minus SAR 400 per person', 'fare rules');
  await k.see('SV264', 'return flight');
  await k.shot('fare-rules');
  await k.press(k.byTest('fare-rules-done'));
  await page.waitForTimeout(500);
  await k.press(page.getByRole('tab', { name: 'Cheapest' }));
  await page.waitForTimeout(300);
  await k.shot('sorted-cheapest');
  await k.press(page.getByRole('tab', { name: 'Best' }));
  step('flights: say what matters (direct, in the morning)');
  await k.byTest('ask-input').fill('direct only, morning');
  await k.byTest('ask-send').click();
  await k.see('Direct only', 'flight wish chip');
  await k.byTest('flights-answer').waitFor({ timeout: 5000 }).catch(() => errors.push('flights: no answer line'));
  await k.shot('flights-refine');
  await k.press(k.byTest('fwish-morning'));
  await k.press(k.byTest('fwish-direct'));
  step('flights: travellers, entry checks, the bundle');
  await k.see('Rules checked today', 'entry checked');
  await k.see('Add connecting rooms at Bereketzade Hotel and airport pickup?', 'bundle names the hotel');
  if ((await page.getByText('Galata Tower and airport').filter({ visible: true }).count()) > 0) errors.push('bundle: still says Galata Tower');
  await k.press(k.byTest('bundle-hotel'));
  await k.see('Beyoğlu · 3 min to the tower', 'bundle hotel page');
  await k.shot('bundle-hotel');
  await page.getByRole('button', { name: 'Back' }).filter({ visible: true }).last().click();
  await k.see('Three ways to get there.', 'back to results', 8000);
  await k.press(k.byTest('bundle-add'));
  await k.see('Review · SAR 14,420', 'review with rooms');
  await k.shot('bundle-entry');
  step('flights: the order sheet');
  await k.press(k.byTest('ask-review'));
  await k.see('Istanbul · 9–15 Mar', 'pay title', 12000);
  await k.see('3 adults · Saudia, direct', 'flight line');
  await k.see('1 child fare (2 to 11, or a baby with a seat)', 'child fare line');
  await k.see('Bereketzade Hotel · Connecting rooms · 6 nights', 'stay line');
  await k.see('If you cancel, the flights come back minus SAR 400 per person. Rooms and pickups are free to cancel until 2 Mar.', 'rule');
  await k.see('Price held · 19:', 'hold timer');
  await k.shot('pay-sheet');
  step('pay: promo codes');
  await k.tap('Promo code');
  await k.byTest('promo-input').fill('RAMADAN');
  await k.byTest('promo-apply').click();
  await k.see('That code ended on 30 March.', 'expired code');
  await k.shot('promo-expired');
  await k.byTest('promo-input').fill('EID10');
  await k.byTest('promo-apply').click();
  await k.see('Code EID10 · 10% off', 'promo applied');
  await k.see('SAR 14,120', 'total after promo');
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
  step('pay: the bank’s code didn’t come');
  await k.byTest('otp-nocode').click();
  await k.see('It can take a minute. Still nothing?', 'no-code options');
  await k.see('Use another card', 'another card offered');
  await k.see('Talk to Mada', 'Mada offered');
  await k.byTest('otp-resend').click();
  await k.see('Your bank is sending a new code. Give it a minute.', 'code sent again');
  await k.see('Send it again in', 'a wait before asking again');
  await k.shot('3ds-no-code');
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
  // One quiet line for internet there, never chosen for them.
  await k.see('Internet when you land? From SAR', 'eSIM line after booking', 12000);
  await k.shot('confirmed', 1200);
  await k.byTest('see-trip').click();
  await page.waitForTimeout(1200);
  await k.see('Internet in Türkiye', 'eSIM row on the trip', 12000);
  await k.see('Get an eSIM · from SAR', 'eSIM from price on the trip');
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
  await k.demo('Card declines', 'Price rises at payment', 'Fare drops on a re-check');
  await toPay(page, { bundle: false });
  await k.slide();
  await k.see('The price went up SAR 140 while we checked.', 'price rose', 10000);
  await k.shot('price-rose');
  await k.closeSheet();
  await k.text('(demo: end the hold)').click();
  await k.see('Hold ended', 'hold ended');
  await k.see('The price hold ended', 'hold ended: what happened');
  await k.see('Check again and you’ll see the price before anything is charged.', 'hold ended: what next');
  await k.see('Check the price again', 'recheck');
  await k.shot('hold-ended');
  await k.byTest('pay-recheck').click();
  await k.see('Price checked again.', 'rechecked');
  await k.see('down from', 'the price came down, said on the sheet');
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
  // Closed while it waits for an answer: Today and Trips › Requests say so (not "Mada is on it"), and it opens again.
  await k.byTest('wait-close').click();
  await k.see("Your booking didn't go through", 'today: failed booking card', 15000);
  await k.shot('today-failed-booking');
  await k.byTest('dock-trips').click();
  await k.byTest('tab-requests').click();
  await k.see("Tickets didn't issue", 'requests: failed booking pill', 15000);
  await k.see('Mada tries by phone', 'requests: the actions');
  await k.shot('requests-failed-booking');
  await k.byTest('open-flight-request').first().click();
  await k.see('The airline didn’t issue the tickets', 'reopened from Trips', 15000);
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

/* ───────────── Umrah around the permit ───────────── */
async function umrah() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('umrah: "I have a permit" typed as a correction');
  await k.ask('Umrah after Eid');
  await k.see('Do you have your Nusuk permit?', 'permit first');
  await k.press(k.byTest('umrah-permit-no'));
  await k.ask('I have a permit');
  await k.see('Which day is your permit?', 'permit day');
  await k.press(k.byTest('umrah-day-pick'));
  await page.waitForTimeout(500);
  await page.locator('[aria-label="Next month"]').filter({ visible: true }).first().click().catch(() => {});
  await page.getByRole('button', { name: /\b20\b/ }).filter({ visible: true }).first().click();
  await k.press(k.byTest('search-go'));
  await k.see('And the time slot?', 'slot');
  await k.press(k.byTest('umrah-slot-morning'));
  await k.see('the day before', 'check in the night before');
  await k.shot('umrah-permit-slot');
  await k.press(k.byTest('umrah-who-done'));
  step('umrah: Makkah by distance, the hotel page, Madinah first, the train, flights');
  await k.press(k.byTest('umrah-nights-makkah-4'));
  await k.see('4 nights', 'nights');
  await k.press(k.byTest('umrah-hotel-open-hilton-suites-makkah'));
  await k.see('Hilton Suites Makkah', 'hotel page', 8000);
  await k.see('6 min walk', 'walk on the hotel page');
  await k.shot('umrah-hotel-page');
  await page.getByRole('button', { name: 'Back' }).filter({ visible: true }).last().click();
  await k.see('Where to stay in Makkah?', 'back to Makkah', 8000);
  await k.choose('umrah-hotel-hilton-suites-makkah');
  await k.press(k.byTest('umrah-madinah-before'));
  await k.see('Steps from the Prophet’s Mosque', 'madinah band');
  await k.choose('umrah-hotel-oberoi-madinah');
  await k.press(k.byTest('umrah-fly-RUH'));
  await k.see('Your Umrah', 'plan');
  await k.see('Haramain train from Madinah to Makkah', 'train');
  await k.see('Fly into Madinah, home from Jeddah.', 'airports');
  await k.see('Morning', 'permit in the plan');
  if ((await page.getByText('Wheelchair to the gate').filter({ visible: true }).count()) > 0) errors.push('umrah: needs open without being asked');
  await k.press(k.byTest('umrah-needs'));
  await k.see('Wheelchair to the gate', 'needs behind the chip');
  await k.shot('umrah-plan-madinah');
  await k.press(k.byTest('umrah-send'));
  await k.see(' at Mada', 'sent');
  await k.see('Hilton Suites Makkah, 4 nights', 'summary names the hotel', 8000);
  await k.see('Planned around your permit', 'quote says the permit back', 20000);
  await k.shot('umrah-quote');
  await context.close();
}

/* ───────────── 5. requests, stays, plans, eSIM ───────────── */
async function requests() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('requests: Umrah without a permit, the last ten nights, needs behind a chip');
  await k.ask('Umrah in Ramadan, Hessa needs a wheelchair');
  await k.see('Do you have your Nusuk permit?', 'permit first');
  if ((await page.getByText('Anything we should arrange for each person?').filter({ visible: true }).count()) > 0) errors.push('umrah: needs shown first');
  await k.press(k.byTest('umrah-permit-no'));
  await k.see('Each person needs a Nusuk permit', 'permit explained');
  await k.shot('umrah-no-permit');
  await k.press(k.byTest('umrah-permit-help'));
  await k.see('Mada watches for slots on your dates', 'help line');
  await k.see('When are you hoping to go?', 'when');
  await k.press(k.byTest('umrah-when-lastten'));
  await k.see('The last ten nights of Ramadan', 'last ten warning');
  await k.see('permits go within minutes of opening', 'last ten body');
  await k.shot('umrah-last-ten');
  await k.see('Omar and Hessa', 'who, from the words');
  await k.see('Where to stay in Makkah?', 'makkah');
  await k.see('Steps from the Haram', 'band steps');
  await k.see('A 5 to 10 minute walk', 'band walk');
  await k.see('By the hotel shuttle', 'band shuttle');
  await k.shot('umrah-makkah');
  await k.choose('umrah-hotel-swissotel-makkah');
  await k.press(k.byTest('umrah-madinah-no'));
  await k.press(k.byTest('umrah-fly-RUH'));
  await k.see('Your Umrah', 'plan');
  await k.see('Swissôtel Makkah', 'hotel named');
  await k.see('About SAR', 'plan total');
  await k.see('Wheelchair', 'needs open because it was said');
  await k.shot('umrah-plan');
  await k.press(k.byTest('umrah-send'));
  await k.see(' at Mada', 'sent');
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
  await k.see('When are you in Istanbul?', 'stays when');
  await k.press(page.getByRole('button', { name: /^This weekend · / }));
  await k.press(k.byTest('stays-search'));
  await k.see('Three places for you in Istanbul', 'stays', 12000);
  await k.shot('stays');
  await k.press(k.byTest('ask-review'));
  await k.see('Free to cancel until', 'stay rule', 10000);
  // Requests for the hotel, on the sheet before paying: chips and a line in your own words.
  await k.see('Requests for the hotel', 'hotel requests field');
  await k.byTest('hr-chip-highFloor').click();
  await k.byTest('hr-chip-cot').click();
  await k.byTest('hr-note').fill('Rooms next to each other if you can.');
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
  // The whole eSIM journey (plans, phone check, pay, install, top up) is test/e2e-esim.mjs; here only that Ask opens it.
  await k.ask('An eSIM for the trip');
  await k.see('Which trip?', 'esim');
  await k.shot('esim');
  await context.close();
}

/* ───────────── 6. links from Circles: pay my share, a plan at /plan/:id ───────────── */
async function circles() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  step('circles: a plan at /plan/:id');
  await k.text('Circles').click(); // the dock opens Discover
  await k.press(k.byTest('plan-alula2'));
  await k.see('Riyadh → AlUla', 'plan from a link', 10000);
  await k.see('Book it all', 'book it all');
  await k.shot('plan-link');
  await page.goBack();
  await k.see('Trips we’ve planned', 'back on Discover', 8000);
  await page.waitForTimeout(1500);
  step('circles: pay my share of a split');
  await page.getByText('Circles', { exact: true }).filter({ visible: true }).first().click(); // the Circles header
  await k.see('Istanbul for Eid', 'circles');
  await page.getByRole('button', { name: 'Istanbul for Eid', exact: true }).first().click();
  await k.see('Which evening for the cruise?', 'circle chat', 10000);
  await k.byTest('chat-tools').click();
  await k.byTest('tool-split').click();
  await k.byTest('split-what').fill('Cruise tickets');
  await k.byTest('split-total').fill('600');
  await k.press(page.getByRole('button', { name: 'Hessa', exact: true }));
  await k.byTest('split-post').click();
  await k.see('Pay my share', 'pay share button', 10000);
  await k.press(k.byTest('pay-share'));
  await k.see('Your share · Istanbul for Eid', 'share sheet', 10000);
  await k.see('Cruise tickets, your share', 'share line');
  if (await page.getByText('Promo code').filter({ visible: true }).count()) errors.push('share: promo offered');
  await k.shot('share-pay');
  await k.slide();
  await k.see('Paid. Your circle can see it.', 'share paid toast', 10000);
  await k.see('You paid your share', 'share paid line in the chat', 10000);
  await k.shot('share-paid', 200);
  await context.close();
}

/* ───────────── 7. stays: where, when, who and rooms, one question at a time ───────────── */
async function stays() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('stays: nothing said, so Mada asks where');
  await k.ask('A place to stay');
  await k.see('Which city?', 'stays where');
  await k.see('Popular', 'popular cities');
  if (await page.getByText('Checking 120 places').filter({ visible: true }).count()) errors.push('stays: searched before asking where');
  await k.shot('stay-where');
  await k.byTest('stay-city').fill('ist');
  await k.see('Prices right here', 'city match');
  await k.shot('stay-where-typed');
  await k.press(k.byTest('city-match-istanbul'));
  step('stays: when, with quick picks and the calendar');
  await k.see('When are you in Istanbul?', 'stays when');
  await k.see('Eid al-Fitr 2027 · 9–15 Mar', 'eid with its year');
  await k.shot('stay-when');
  await k.tap('I’ll pick dates');
  await k.see('Pick the day you check in, then the day you leave', 'stay calendar');
  if (await page.getByText('Babies on a lap').filter({ visible: true }).count()) errors.push('stay calendar: shows flight-only rows');
  await k.shot('stay-calendar');
  await k.tap('Next weekend');
  await k.see('2 nights', 'stay calendar range');
  await k.byTest('search-go').click();
  await k.see('Who’s staying?', 'calendar to who');
  step('stays: the dates changed from the summary, by a quick pick');
  await k.press(k.byTest('stay-chip-when'));
  await k.press(page.getByRole('button', { name: /^Next week · / }));
  step('stays: who and rooms, from the household');
  await k.see('Who’s staying?', 'stays who');
  await k.see('1 guest · 1 room', 'one guest');
  await k.press(page.getByRole('button', { name: 'Hessa', exact: true }));
  await k.see('2 guests · 1 room for 2', 'two guests');
  await k.press(page.getByRole('button', { name: /^Sara, \d+$/ }));
  await k.see('2 connecting rooms', 'family rooms');
  await k.see('Hotels price children by age', 'kids ages');
  await k.shot('stay-who');
  await k.press(k.byTest('stays-search'));
  await k.see('Three places for you in Istanbul', 'stays results', 12000);
  await k.see('Ranked for a family', 'stays: says who it ranked for');
  const photos = await page.locator('[data-testid^="stay-photo-"] img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  if (new Set(photos).size < Math.min(3, photos.length) || !photos.length) errors.push(`stays: hotels share a photo (${photos.join(', ')})`);
  await k.shot('stay-results');
  await refineStays(page, k);
  step('stays: change the dates from the summary');
  await k.press(k.byTest('stay-chip-when'));
  await k.see('When are you in Istanbul?', 'change dates');
  await k.press(page.getByRole('button', { name: /^This weekend · / }));
  await k.see('Who’s staying?', 'back to who');
  await k.see('3 guests', 'party kept');
  step('stays: what was typed answers where, when and who');
  await openAsk(page);
  await k.ask('A hotel in Dubai next weekend for 4');
  await k.see('Who’s staying?', 'straight to who', 9000);
  if (await page.getByText('Which city?').filter({ visible: true }).count()) errors.push('stays: asked where after it was said');
  if (await page.getByText('When are you in').filter({ visible: true }).count()) errors.push('stays: asked when after it was said');
  await k.see('4 guests · 2 connecting rooms', 'four guests');
  await k.see('Dubai', 'summary city');
  await k.shot('stay-typed-dubai');
  await context.close();
}

/* ───────────── 7b. stays in Arabic: the same picks, wishes said in Arabic, the map right to left ───────────── */
async function staysAr() {
  const { page, context } = await newPage('ar-SA');
  const k = kit(page);
  await page.goto(ORIGIN + '/');
  await k.byTest('welcome-start').waitFor({ timeout: 15000 });
  await k.byTest('welcome-start').click();
  await k.byTest('signin-phone').click();
  await k.byTest('phone-input').fill('500004127');
  await k.byTest('phone-send').click();
  await k.byTest('otp-input').waitFor({ timeout: 10000 });
  await k.byTest('otp-input').fill('123456');
  await k.byTest('welcome-back-open').waitFor({ timeout: 10000 });
  await k.byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
  await k.byTest('dock-ask').click();
  await page.waitForTimeout(800);
  step('stays (Arabic): asked in Arabic');
  await k.ask('فندق في إسطنبول');
  await page.getByRole('button').filter({ hasText: '·' }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  await k.press(k.byTest('stays-search'));
  await k.see('ثلاثة أماكن لك في', 'stays (Arabic) results', 12000);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== 'rtl') errors.push(`stays (Arabic): dir ${dir}`);
  await k.shot('stay-results-ar');
  await refineStays(page, k, true);
  await context.close();
}

/** Three picks with reasons, at most one of each badge, plain lines; wishes said in the box; see all, sort, distance from, the map. */
async function refineStays(page, k, ar = false) {
  step(`stays${ar ? ' (Arabic)' : ''}: three picks, plain lines, one badge of each`);
  const body = await page.evaluate(() => document.body.innerText);
  for (const raw of ['Includes Non-refundable', 'No amendments permitted', 'Includes Special discount', 'ROOM ONLY']) if (body.includes(raw)) errors.push(`stays: raw supplier text "${raw}"`);
  const picks = await page.locator('[data-testid^="stay-reason-"]').filter({ visible: true }).count();
  if (picks !== 3) errors.push(`stays: ${picks} picks with a reason, want 3`);
  const best = (body.match(ar ? /اختيارنا/g : /Our pick/g) ?? []).length;
  if (best > 2) errors.push(`stays: "Our pick" ${best} times`);
  await k.see(ar ? 'لـ ' : 'for 3 guests', 'stays: total for the party');
  step(`stays${ar ? ' (Arabic)' : ''}: say what matters, in the box under the results`);
  await k.byTest('ask-input').fill(ar ? 'فيه مسبح' : 'with a pool');
  await k.byTest('ask-send').click();
  await k.see(ar ? 'يناسب' : 'fits: Pool', 'refine answer');
  await k.see(ar ? 'مسبح' : 'Pool', 'pool chip');
  await k.shot(`stay-refine-pool${ar ? '-ar' : ''}`);
  await k.byTest('ask-input').fill(ar ? 'قريب من السلطان أحمد' : 'closer to Sultanahmet');
  await k.byTest('ask-send').click();
  await k.see(ar ? 'ما فيه مكان' : 'Nothing here has all of that.', 'refine: nothing fits both, said plainly');
  await k.see(ar ? 'اطلب من' : 'to find it', 'refine: the desk offered');
  await k.shot(`stay-refine-none${ar ? '-ar' : ''}`);
  await k.press(k.byTest('wish-has:pool'));
  await k.see(ar ? 'الأقرب على بعد' : 'The closest is', 'refine: near Sultanahmet, nearest first');
  await k.shot(`stay-refine-near${ar ? '-ar' : ''}`);
  await k.byTest('ask-input').fill(ar ? 'غرفة فيها بيانو' : 'a room with a piano');
  await k.byTest('ask-send').click();
  await k.see(ar ? 'ما فهمت مادا' : 'Mada didn’t catch what to change', 'refine: not read, said so');
  await k.press(k.byTest('wish-near:sultanahmet'));
  step(`stays${ar ? ' (Arabic)' : ''}: see all, sort, distance from, the map`);
  await k.press(k.byTest('stays-see-all'));
  await k.see(ar ? 'أماكن في' : 'places in Istanbul', 'see all heading');
  await k.press(k.byTest('stays-sort'));
  await k.press(k.byTest('sort-price'));
  const prices = await page.locator('[data-testid^="stay-price-"]').filter({ visible: true }).allInnerTexts();
  const num = (x) => Number(x.replace(/[^0-9٠-٩]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
  if (prices.map(num).some((v, i, a) => i && v < a[i - 1])) errors.push(`stays: lowest price sort out of order (${prices.join(', ')})`);
  await k.shot(`stay-all-price${ar ? '-ar' : ''}`);
  await k.press(k.byTest('stays-sort'));
  await k.press(k.byTest('stays-distance'));
  await k.press(k.byTest('dist-taksim'));
  await k.see(ar ? 'من تقسيم' : 'from Taksim', 'distance from Taksim on the cards');
  await k.shot(`stay-distance${ar ? '-ar' : ''}`);
  await k.press(k.byTest('stays-view-map'));
  await page.waitForTimeout(2500);
  step(`stays map${ar ? ' (Arabic)' : ''}: the map fills the space above the box and Review, nothing shows through`);
  const mapBox = await k.byTest('stays-map').boundingBox();
  const boxTop = (await k.byTest('stays-refine').boundingBox())?.y ?? 844;
  if (!mapBox || mapBox.height < 300) errors.push(`stays map: ${mapBox?.height ?? 0}px tall, want the screen's height`);
  if (mapBox && mapBox.y + mapBox.height > boxTop) errors.push(`stays map: runs under the box (map ends ${Math.round(mapBox.y + mapBox.height)}, box starts ${Math.round(boxTop)})`);
  const under = await page.evaluate(() => { const st = document.querySelector('[data-testid="ask-stage"]'); if (!st) return 'no stage'; const r = st.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height - 30); return st.contains(el) ? '' : (el?.textContent ?? '').slice(0, 40); });
  if (under) errors.push(`stays map: something shows over or through the map (${under})`);
  const pins = await page.locator('[data-testid^="map-pin-"]').count();
  if (pins < 3) errors.push(`stays map: ${pins} pins, want 3`);
  await k.shot(`stay-map${ar ? '-ar' : ''}`, 1500);
  const openCard = async () => {
    await page.locator('[data-testid^="map-pin-"]').filter({ visible: true }).first().click({ force: true });
    await page.waitForTimeout(500);
    const card = page.locator('[data-testid="stays-map-card"]').filter({ visible: true });
    if (!(await card.count())) { errors.push('map: a pin opens its card straight away'); return false; }
    return true;
  };
  if (pins) {
    step(`stays map${ar ? ' (Arabic)' : ''}: a price opens the hotel's card straight away`);
    if (await openCard()) {
      const name = (await k.byTest('stays-map-card-name').innerText()).trim();
      const total = await k.byTest('stays-map-card-total').innerText();
      if (!name) errors.push('map card: no hotel name');
      if (!/·.*·/.test(total) || !/[0-9٠-٩]/.test(total)) errors.push(`map card: total without rooms · nights · price (${total})`);
      if (!(await k.byTest('stays-map-card-night').innerText()).match(/[0-9٠-٩]/)) errors.push('map card: no price a night');
      if (await page.locator('[data-testid="ask-review"]').filter({ visible: true }).count()) errors.push('map card: Review still showing under the card');
      if (await page.locator('[data-testid="stays-refine"]').filter({ visible: true }).count()) errors.push('map card: the box still showing under the card');
      const cardBox = await k.byTest('stays-map-card').boundingBox();
      if (cardBox && cardBox.y + cardBox.height > 845) errors.push('map card: cut off at the bottom');
      await k.shot(`stay-map-card${ar ? '-ar' : ''}`, 900);
      step(`stays map${ar ? ' (Arabic)' : ''}: "See hotel" opens its page, back returns to the map`);
      await k.byTest('stays-map-card-see').click();
      await k.byTest('hotel-where').waitFor({ timeout: 10000 }).catch(() => errors.push('map card: See hotel did not open the hotel page'));
      if (!(await page.getByText(name, { exact: false }).filter({ visible: true }).count())) errors.push(`map card: the hotel page isn't ${name}`);
      await k.shot(`stay-map-hotel${ar ? '-ar' : ''}`);
      await page.goBack();
      await page.waitForTimeout(1500);
      if (!(await page.locator('[data-testid="stays-map"]').filter({ visible: true }).count())) errors.push('map card: back from the hotel page lost the map');
      step(`stays map${ar ? ' (Arabic)' : ''}: "Choose this" goes straight to review and pay`);
      if (await openCard()) {
        const chosen = (await k.byTest('stays-map-card-name').innerText()).trim();
        await k.byTest('stays-map-card-choose').click();
        await page.waitForURL(/\/pay/, { timeout: 10000 }).catch(() => errors.push('map card: Choose this did not reach review and pay'));
        await page.waitForTimeout(1200);
        if (!(await page.getByText(chosen, { exact: false }).filter({ visible: true }).count())) errors.push(`map card: review and pay isn't for ${chosen}`);
        await k.shot(`stay-map-choose${ar ? '-ar' : ''}`);
        await page.goBack();
        await page.waitForTimeout(1500);
      }
    }
    // The card closes on the map's close button (and Escape) and the box comes back.
    if (await page.locator('[data-testid="stays-map-card"]').filter({ visible: true }).count()) {
      await k.byTest('stays-map-card-close').click();
      await page.waitForTimeout(500);
    }
    if (!(await page.locator('[data-testid="stays-refine"]').filter({ visible: true }).count())) errors.push('map: the box did not come back after the card closed');
    step(`stays map${ar ? ' (Arabic)' : ''}: pins that would sit on each other group, and a group splits on tap`);
    let groups = 0;
    // Zoom out from the keyboard (the map's own "-" key), as someone without a trackpad would.
    const canvas = page.locator('[data-testid="stays-map"] canvas').first();
    for (let i = 0; i < 8 && !groups; i++) {
      await canvas.focus();
      await page.keyboard.press('Minus');
      await page.waitForTimeout(900);
      groups = await page.locator('[data-testid^="map-group-"]').filter({ visible: true }).count();
    }
    if (!groups) errors.push('map: zoomed out, overlapping pins never grouped');
    else {
      const label = await page.locator('[data-testid^="map-group-"]').filter({ visible: true }).first().innerText();
      if (!/·/.test(label)) errors.push(`map: group pill says "${label}", want count · from price`);
      await k.shot(`stay-map-group${ar ? '-ar' : ''}`, 300);
      const before = await page.locator('[data-testid^="map-pin-"]').filter({ visible: true }).count();
      for (let i = 0; i < 4 && (await page.locator('[data-testid^="map-group-"]').filter({ visible: true }).count()); i++) {
        await page.locator('[data-testid^="map-group-"]').filter({ visible: true }).first().click();
        await page.waitForTimeout(1100);
      }
      const after = await page.locator('[data-testid^="map-pin-"]').filter({ visible: true }).count();
      if (after <= before) errors.push(`map: tapping the group didn't split it (${before} → ${after} pins)`);
      await k.shot(`stay-map-split${ar ? '-ar' : ''}`, 300);
    }
  }
  await k.press(k.byTest('stays-view-list'));
  await k.press(k.byTest('stays-back-picks'));
}

/* ───────────── 8. anything else: only the missing details, words said once, replies that fit ───────────── */
/* ───────────── a family by count and age: never fewer people than said; corrections change the answer ───────────── */
async function family() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('family: 2 adults and 3 kids aged 2, 6 and 13, two of them not saved yet');
  await k.ask('Istanbul for Eid, 2 adults and 3 kids aged 2, 6 and 13');
  await k.see('You said 2 adults and 3 children (2, 6, 13).', 'party said');
  if (await page.getByText('Three ways to get there.').filter({ visible: true }).count()) errors.push('family: searched before asking who the five are');
  await k.see('Omar ✓', 'adult matched');
  await k.see('Sara ✓', 'the 13-year-old matched');
  await k.see('A child, 6', 'the 6-year-old asked');
  await k.see('A child, 2', 'the 2-year-old asked');
  await k.see('Continue · 5 going', 'continue with five');
  await k.shot('family-stepper');
  await k.byTest('party-name-child-1').fill('Yousef');
  await k.byTest('party-name-child-2').fill('Noura');
  await k.press(k.byTest('party-continue'));
  step('family: five people, night flights last, the price per person');
  await k.see('Three ways to get there.', 'family results', 15000);
  await k.see('5 people · Economy', 'five travellers');
  await k.see('Daytime flights first, with a little one going.', 'family ranking line');
  await k.see('Leaves at night', 'night flight labelled');
  await k.see('Leaves at 02:10: a short night for little ones.', 'night flight reason');
  const firstCard = await page.locator('[data-testid^="flight-"]').filter({ visible: true }).first().getAttribute('data-testid');
  if (firstCard === 'flight-TK141') errors.push('family: the 02:10 departure is first for a family with a 2-year-old');
  await k.see('Price per person', 'fare lines');
  await k.see('Child, 2 to 11', 'child fare line');
  await k.see('Ages 6, 2', 'child ages');
  await k.see('Seats held together', 'seats together');
  await k.shot('family-results');
  step('family: a correction while the results are up (December), then one Mada can’t read');
  await k.byTest('ask-input').fill('December');
  await k.byTest('ask-send').click();
  await k.see('When in December?', 'dates corrected, asked again');
  if (await page.getByText('Mada didn’t catch what to change. Try a place').filter({ visible: true }).count()) errors.push('family: hotel-only error on a date correction');
  await k.shot('family-corrected-month');
  await k.ask('that’s wrong');
  await k.see('What should Mada change?', 'which thing to change');
  await k.shot('family-fix-prompt');
  await k.tap('Who’s going');
  await k.see('Continue · 5 going', 'who asked again, five kept', 10000);
  await k.press(k.byTest('party-continue'));
  await k.see('When in December?', 'back to the dates');
  step('family: a correction in stays');
  await openAsk(page);
  await k.ask('A hotel in Istanbul next weekend');
  await k.press(k.byTest('stays-search'));
  await k.see('Three places for you in Istanbul', 'stays', 12000);
  await k.byTest('ask-input').fill('we are 5');
  await k.byTest('ask-send').click();
  await k.see('5 guests', 'stays corrected to five', 10000);
  if (await page.getByText('Try a place, a view, a pool').filter({ visible: true }).count()) errors.push('stays: hotel-only error on "we are 5"');
  await k.shot('stays-corrected-five');
  await context.close();
}

async function asks() {
  const { page, context } = await newPage();
  const k = kit(page);
  await signIn(page);
  await openAsk(page);
  step('asks: an outing by name is a thing to do, asked when and who');
  await k.ask('Boulevard World at night in Riyadh');
  await k.see('When would you like to go?', 'outing when');
  if (await page.getByText('Pick what you like').filter({ visible: true }).count()) errors.push('outing: asked to pick from Istanbul ideas');
  await k.tap('This weekend');
  await k.see('Who’s going?', 'outing who');
  await k.press(page.getByRole('button', { name: 'Hessa', exact: true }));
  await k.tap('These 2');
  await k.shot('outing-asked');
  await k.byTest('request-send').click();
  await k.see('Riyadh · This weekend · Omar, Hessa', 'outing summary', 9000);
  const dup = await page.getByText('“Boulevard World at night in Riyadh”').filter({ visible: true }).count();
  if (dup) errors.push('outing: the typed words repeated as a note');
  await k.see('Can we go another day?', 'dated suggestion');
  if (await page.getByText('Can we change the dates?').filter({ visible: true }).count()) errors.push('outing: offered "change the dates"');
  const boxes = await page.locator('[data-testid="reply-input"], [data-testid="ask-input"]').filter({ visible: true }).count();
  if (boxes !== 1) errors.push(`outing: ${boxes} message boxes on screen`);
  await k.shot('outing-sent');
  await k.see('Boulevard World at night this weekend for the 2 of you: SAR 240.', 'priced answer', 20000);
  await k.see('Pay SAR 240', 'pay button');
  await k.shot('outing-priced');
  await k.tap('Can we go another day?');
  await k.see('I’ll check that day', 'reply fits', 9000);
  await k.shot('outing-thread');
  step('asks: a table asks where, when, who and what matters');
  await page.getByRole('button', { name: 'Ask something else' }).filter({ visible: true }).first().click();
  await k.ask('A table somewhere good');
  await k.see('Where?', 'table where');
  await k.tap('Riyadh');
  await k.see('When?', 'table when');
  await k.tap('Tonight');
  await k.see('Who’s coming?', 'table who');
  await k.press(k.byTest('request-who-done'));
  await k.see('What matters?', 'table prefs');
  await k.tap('Halal');
  await k.press(k.byTest('request-multi-done'));
  await k.shot('table-asked');
  await k.byTest('request-send').click();
  await k.see('Restaurant table: Riyadh', 'table title', 9000);
  await k.see('Can we go a little later?', 'table suggestion');
  await k.see('I’m asking for a table for one in Riyadh, tonight: halal.', 'table answer', 20000);
  if (await page.getByText(/airline/).filter({ visible: true }).count()) errors.push('table: the agent talks about airlines');
  await k.shot('table-answer');
  step('asks: back to the request from Trips');
  await page.getByRole('button', { name: /^(Close|Back)$/ }).filter({ visible: true }).last().click();
  await page.waitForTimeout(800);
  await k.text('Trips', true).click();
  await page.waitForTimeout(800);
  const reqTab = page.getByRole('tab', { name: /Requests/ }).filter({ visible: true });
  if (await reqTab.count()) await reqTab.first().click();
  else await k.text('Requests', true).click();
  await k.press(k.byTest('open-request-food'));
  await k.see(' at Mada', 'thread screen', 9000);
  await k.see('I’m asking for a table', 'thread from trips');
  await k.shot('thread-from-trips');
  await context.close();
}

/* ───────────── 9. a verified phone, asked early in a sheet (email account, the server needs one) ───────────── */
async function phone() {
  const { page, context } = await newPage();
  const k = kit(page);
  step('phone: email sign-in, phone later');
  await page.goto(`${ORIGIN}/?beta=off`);
  await k.see("We'll take it from here.", 'welcome');
  await k.byTest('welcome-start').click();
  await k.byTest('signin-email').click();
  await k.byTest('email-input').fill(`noor.${Date.now()}@example.com`);
  await k.byTest('email-send').click();
  await k.see('Check your email', 'email code');
  await k.byTest('email-code-input').fill('123456');
  await k.see('Verify your phone', 'verify phone');
  await page.getByRole('button', { name: /^(Later|Not now)$/ }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  if (await page.locator('[data-testid="name-input"]').count()) { await k.byTest('name-input').fill('Noor'); await page.getByRole('button', { name: /Continue|Let/ }).filter({ visible: true }).first().click(); await page.waitForTimeout(600); }
  for (let i = 0; i < 3 && !(await page.locator('[data-testid="dock-ask"]').filter({ visible: true }).count()); i++) {
    const b = page.getByRole('button', { name: /^(Not now|Skip|Allow|Continue)$/ }).filter({ visible: true }).first();
    if (!(await b.count())) break;
    await b.click(); await page.waitForTimeout(700);
  }
  step('phone: asked before the search, not at the payment');
  await openAsk(page);
  await k.ask('A hotel in Istanbul next weekend');
  await k.see('Who’s staying?', 'who (phone)', 9000);
  await k.see('we’ll ask for your mobile number, once', 'phone said up front');
  await k.shot('phone-before-search');
  await k.press(k.byTest('stays-search'));
  await k.see('Your mobile number', 'phone sheet');
  await k.byTest('phone-sheet-input').fill('12');
  await k.byTest('phone-sheet-input').blur();
  await k.see('start with 5', 'wrong number inline');
  await k.shot('phone-sheet-wrong');
  await k.byTest('phone-sheet-input').fill(`5${String(Date.now()).slice(-8)}`);
  await k.byTest('phone-sheet-send').click();
  await k.see('Enter the code', 'code in the sheet');
  await k.byTest('phone-sheet-code').fill('000000');
  await k.see('doesn', 'wrong code inline');
  await k.shot('phone-sheet-code-wrong');
  await k.byTest('phone-sheet-code').fill('123456');
  await k.see("Three places for you in", 'search carries on', 15000);
  await k.shot('phone-then-results');
  await k.press(k.byTest('ask-review'));
  await k.see('Free to cancel until', 'pay without asking again', 10000);
  if (await page.getByText('Add your mobile number to book').filter({ visible: true }).count()) errors.push('phone: asked again at payment');
  await context.close();
}

/* ───────────── money: preferences, loyalty, the display currency, a paid extra, a friend pays, the Money screen ───────────── */
async function money(locale = 'en-GB') {
  const ar = locale.startsWith('ar');
  const { page, context } = await newPage(locale);
  const k = kit(page);
  if (ar) {
    await page.goto(ORIGIN + '/');
    await k.byTest('welcome-start').waitFor({ timeout: 15000 });
    await k.byTest('welcome-start').click();
    await k.byTest('signin-phone').click();
    await k.byTest('phone-input').fill('500004127');
    await k.byTest('phone-send').click();
    await k.byTest('otp-input').waitFor({ timeout: 10000 });
    await k.byTest('otp-input').fill('123456');
    await k.byTest('welcome-back-open').waitFor({ timeout: 10000 });
    await k.byTest('welcome-back-open').click();
    await page.waitForTimeout(1200);
  } else await signIn(page);
  step(`money${ar ? ' (ar)' : ''}: prices shown in AED`);
  await page.locator('[data-testid="dock-wallet"]').click();
  await page.waitForFunction(() => !!window.__madaGo, null, { timeout: 15000 });
  await page.evaluate(() => window.__madaGo('/account'));
  await k.press(k.byTest('details-currency'));
  await k.press(k.text(ar ? 'AED · ' : 'AED · UAE dirham'));
  await page.waitForTimeout(800);
  if (ar) {
    for (let i = 0; i < 3 && !(await page.locator('[data-testid="dock-ask"]').filter({ visible: true }).count()); i++) {
      const close = page.locator('[aria-label="رجوع"], [aria-label="إغلاق"], [aria-label="Back"], [aria-label="Close"]').filter({ visible: true }).last();
      if (!(await close.count())) { await page.goBack(); } else await close.click();
      await page.waitForTimeout(700);
    }
    await k.byTest('dock-ask').click();
    await page.waitForTimeout(800);
  } else await openAsk(page);
  step('money: the order sheet applies the saved preferences and the Alfursan number');
  if (ar) {
    // Typed in Arabic: Mada answers each message in the language it is written in.
    await k.ask('إسطنبول في العيد مع العائلة');
    await k.byTest('ask-review').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await k.press(k.byTest('ask-review'));
    await k.byTest('pay-prefs').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
  } else await toPay(page, { bundle: false });
  await k.see(ar ? 'تفضيلاتك' : 'Your preferences', 'prefs row');
  await k.see(ar ? 'شباك' : 'Window', 'saved seat applied');
  await k.see(ar ? '••••3377' : 'Saudia Alfursan ••••3377 added', 'loyalty attached');
  await k.see('≈', 'approx in AED');
  await k.see(ar ? 'بالريال السعودي' : 'in Saudi riyals', 'charged in SAR, said plainly');
  await k.shot(`money-pay-prefs${ar ? '-ar' : ''}`);
  step('money: change the preferences for this booking only');
  await k.press(k.byTest('pay-prefs'));
  await k.see(ar ? 'لهذا الحجز بس' : 'for this booking only', 'prefs sheet');
  await k.press(page.getByRole('button', { name: ar ? 'ممر' : 'Aisle', exact: true }));
  await k.shot(`money-prefs-sheet${ar ? '-ar' : ''}`);
  await k.press(k.byTest('prefs-booking-done'));
  await k.see(ar ? 'ممر' : 'Aisle', 'aisle for this booking');
  step('money: loyalty per traveller, checked as typed');
  await k.press(k.byTest('pay-loyalty'));
  await page.locator('[data-testid^="loyalty-alfursan-"]').nth(1).fill('12');
  await k.see(ar ? 'ما يشبه رقم' : 'doesn’t look like a Saudia Alfursan number', 'bad loyalty number');
  await k.shot(`money-loyalty-sheet${ar ? '-ar' : ''}`);
  await page.locator('[data-testid^="loyalty-alfursan-"]').nth(1).fill('9988776655');
  await k.press(k.byTest('loyalty-booking-save'));
  await k.see('+1', 'two numbers attached');
  if (ar) { await context.close(); return; }
  step('money: flynas prices seats together; it is only added by hand');
  await openAsk(page);
  await k.ask('Istanbul for Eid, all of us');
  await k.see('Three ways to get there.', 'results', 12000);
  await k.press(k.byTest('flight-XY125'));
  await k.press(k.byTest('ask-review'));
  await k.see('Everything included. No fees later.', 'pay sheet (flynas)', 12000);
  await k.see('Sit together on flynas', 'extra offered');
  const before = await k.byTest('pay-total').innerText();
  await k.shot('money-extra-offered');
  await k.press(k.byTest('pay-extra-seats-toggle'));
  await k.see('Seats together · 8 × SAR 35', 'extra line once added');
  await page.waitForTimeout(800);
  const after = await k.byTest('pay-total').innerText();
  if (before === after) errors.push(`extra: total did not change (${before})`);
  await k.shot('money-extra-added');
  await k.press(k.byTest('pay-extra-seats-toggle'));
  step('money: ask Abdullah to pay');
  await k.press(k.byTest('pay-ask-someone'));
  await k.see('Who pays?', 'payer sheet');
  await k.press(page.locator('[data-testid^="payer-Abdullah"]').filter({ visible: true }).first());
  await k.shot('money-ask-someone');
  await k.press(k.byTest('payer-send'));
  await k.see('Paid by Abdullah', 'payer on the sheet');
  await k.slide();
  await k.see('Waiting for Abdullah to pay', 'payment requested', 15000);
  await k.shot('money-waiting-for-abdullah', 300);
  // Abdullah (the demo circle) pays his share a few seconds later; the order goes to the desk and books.
  await k.see("You're going to Istanbul.", 'booked after Abdullah paid', 40000);
  await k.shot('money-booked-by-abdullah', 1200);
  step('money: the trip Money screen');
  await k.press(k.byTest('see-trip'));
  await page.waitForTimeout(1500);
  await k.press(k.text('Money'));
  await k.see('spent on this trip', 'money screen', 12000);
  await k.see('Abdullah', 'paid by Abdullah');
  await k.see('Per person', 'per person');
  await k.see('Splits in your circles', 'the split');
  await k.shot('money-screen');
  await page.mouse.move(195, 420); await page.mouse.wheel(0, 900);
  await k.shot('money-screen-lower');
  await context.close();
}

try {
  if (want('flights')) await flights();
  if (want('edges')) await edges();
  if (want('pay')) await pay();
  if (want('desk')) await desk();
  if (want('requests')) await requests();
  if (want('umrah')) await umrah();
  if (want('circles')) await circles();
  if (want('stays')) await stays();
  if (want('stays-ar')) await staysAr();
  if (want('asks')) await asks();
  if (want('phone')) await phone();
  if (want('money')) await money();
  if (want('money-ar')) await money('ar-SA');
  if (want('family')) await family();
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
