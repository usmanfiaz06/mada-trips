// Things to do, end to end, in headless Chromium against the web export (mock API mode).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-activities.mjs [shot-dir]          (DIST=… for another export)
//
// Walks, in English then Arabic: a city's Things to do (Riyadh: today's weather turning ideas indoors, prayer time,
// places with their hours, Book with Mada, What's on), a place's sheet (photo, hours, the drawn map), the full list
// with filters, an experience booked with Mada (sheet → request → its chat), an event, the sources page, a city with
// no list yet (Tbilisi), and inside the Istanbul trip: from the hotel, by day, Add to my plan → on the itinerary.
// Getting there: the address, Directions (the chooser; Google Maps on the web), Get there with Mada (a car request,
// from where they say outside a trip, from the hotel inside one), "12 min drive" on the rows, meeting points.
// Screenshots every screen at 390×844.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-activities');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
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

async function newPage(locale) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  return { context, page };
}

function kit(page, lang) {
  const shot = async (name) => { n += 1; await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${lang}-${name}.png`) }); };
  const see = async (text, what, timeout = 9000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${lang} ${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).first();
  /** Tap something in a scroller, brought to the middle first (the city page's action bar covers the bottom). */
  const tapTest = async (id) => { const l = byTest(id); await l.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' })); await page.waitForTimeout(400); await l.click(); };
  const go = async (path) => { await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await page.waitForTimeout(900); };
  const scrollTo = async (id) => { await page.locator(`[data-testid="${id}"]`).first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(400); };
  const closeSheet = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(600); const shade = page.locator('[aria-label="Close"], [aria-label="أغلق"], [aria-label="إغلاق"]').filter({ visible: true }); if (await shade.count()) { await shade.first().click().catch(() => {}); await page.waitForTimeout(500); } };
  return { shot, see, byTest, tapTest, go, scrollTo, closeSheet };
}

async function signIn(page) {
  const { byTest } = kit(page, 'x');
  await page.goto(ORIGIN + '/');
  await page.locator('[data-testid="welcome-start"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await page.locator('[data-testid="otp-input"]').waitFor({ state: 'visible', timeout: 10000 });
  await byTest('otp-input').fill('123456');
  await page.locator('[data-testid="welcome-back-open"]').waitFor({ state: 'visible', timeout: 10000 });
  await byTest('welcome-back-open').click();
  await page.waitForTimeout(1500);
}

async function run(lang) {
  const ar = lang === 'ar';
  const W = (en, arText) => (ar ? arText : en);
  const { page } = await newPage(ar ? 'ar-SA' : 'en-GB');
  const { shot, see, byTest, tapTest, go, scrollTo, closeSheet } = kit(page, lang);
  await signIn(page);

  step(`${lang}: Riyadh: today, places, book, what's on`);
  await go('/city/108410');
  await see(W('Riyadh', 'الرياض'), 'city');
  await scrollTo('things-section');
  await see(W('Things to do', 'ماذا تفعل'), 'section title');
  await see(W('Indoor ideas first', 'الأفكار الداخلية أولًا'), 'hot day turns indoors');
  await shot('city-things');
  await see(W('National Museum of Saudi Arabia', 'المتحف الوطني السعودي'), 'a place card');
  await scrollTo('things-book');
  await see(W('Book with Mada', 'احجز مع مادا'), 'book rail');
  await scrollTo('things-events');
  await see(W('What’s on', 'الفعاليات'), "what's on");
  await see('Riyadh Season', 'desk event');
  await shot('city-things-more');

  step(`${lang}: a place's sheet`);
  await tapTest('place-osm:w140528417');
  await see(W('Open in Maps', 'افتح في الخرائط'), 'map');
  await see(W('From OpenStreetMap', 'من OpenStreetMap'), 'hours source');
  await shot('place-sheet');

  step(`${lang}: getting there: address, Directions (Google Maps on the web), Get there with Mada`);
  await scrollTo('thing-getting-there');
  await see('King Saud Rd', 'address');
  await see(W('Directions', 'الاتجاهات'), 'directions button');
  await see(W('Get there with Mada', 'اذهب مع مادا'), 'ride button');
  await shot('place-getting-there');
  await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await byTest('thing-directions').click();
  await page.waitForTimeout(900);
  await see(W('Getting to National Museum', 'الطريق إلى المتحف الوطني'), 'chooser title');
  await see(W('Google Maps', 'خرائط Google'), 'Google Maps on the web');
  await see(W('Opens in your browser', 'يفتح في المتصفح'), 'web note');
  await shot('directions-chooser');
  await byTest('go-app-google').click();
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => window.__opened);
  if (!opened?.[0]?.startsWith('https://www.google.com/maps/dir/?api=1&destination=24.64755,46.71038')) errors.push(`${lang}: Google Maps link was ${JSON.stringify(opened)}`);
  await byTest('directions-ride').click();
  await page.waitForTimeout(900);
  await see(W('A car to National Museum', 'سيارة إلى المتحف الوطني'), 'ride sheet');
  await see(W('Tell us where to pick you up.', 'أخبرنا أين نأخذك.'), 'no hotel outside a trip: say where');
  await byTest('ride-where').fill('Kingdom Centre');
  await page.waitForTimeout(300);
  await shot('ride-sheet');
  await byTest('ride-send').click();
  await page.waitForTimeout(1800);
  await see('Kingdom Centre', 'the car request thread opens with the message');
  await shot('ride-request');
  await go('/city/108410');
  await scrollTo('things-section');

  step(`${lang}: the full list and filters`);
  await tapTest('things-see-all');
  await page.waitForTimeout(1200);
  await see(W('Things to do in Riyadh', 'ماذا تفعل في الرياض'), 'full title');
  await shot('things-full');
  await page.getByRole('button', { name: W('Family', 'للعائلة'), exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  const famNames = await page.locator('[data-testid^="place-osm:"]').evaluateAll((els) => els.length);
  if (famNames < 1) errors.push(`${lang}: family filter emptied the list`);
  await shot('things-family');
  await page.getByRole('button', { name: W('Indoors', 'في الداخل'), exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  await shot('things-family-indoors');
  await page.getByRole('button', { name: W('Family', 'للعائلة'), exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: W('Indoors', 'في الداخل'), exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(600);

  step(`${lang}: experiences: no meeting point yet → the voucher`);
  await scrollTo('things-book');
  await tapTest('exp-hotelbeds:E-E10-RUH-CAMP');
  await scrollTo('thing-meeting');
  await see(W('Meeting point is in your voucher', 'نقطة اللقاء مذكورة في القسيمة'), 'meeting point on the voucher');
  await shot('experience-voucher');
  await closeSheet();

  step(`${lang}: book an experience with Mada`);
  await scrollTo('things-book');
  await tapTest('exp-hotelbeds:E-E10-RUH-DIRIYAH');
  await see(W('Book with Mada', 'احجز مع مادا'), 'book button');
  await shot('experience-sheet');
  await scrollTo('thing-meeting');
  await see(W('Meeting point', 'نقطة اللقاء'), 'meeting point label');
  await see('At-Turaif Visitor Centre', 'meeting point address');
  await shot('experience-meeting-point');
  await byTest('thing-directions').click();
  await page.waitForTimeout(900);
  await see(W('Getting to', 'الطريق إلى'), 'chooser for the meeting point');
  await shot('experience-directions');
  await closeSheet();
  await page.waitForTimeout(500);
  await byTest('thing-book').click();
  await page.waitForTimeout(900);
  await see(W('Book Diriyah at sunset', 'احجز'), 'book sheet');
  await shot('book-sheet');
  await byTest('book-send').click();
  await page.waitForTimeout(1800);
  await see('Diriyah at sunset with a local guide', 'the request thread opens with the message');
  await shot('book-request');

  step(`${lang}: an event, then the sources`);
  await go('/things/108410?city=Riyadh');
  await scrollTo('things-events');
  { const ev = page.locator('[data-testid^="event-desk:"]').filter({ visible: true }).first(); await ev.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300); await ev.click(); }
  await see(W('Picked by the Mada team', 'اختارها فريق مادا'), 'event source');
  await shot('event-sheet');
  await closeSheet();
  await scrollTo('things-sources');
  await tapTest('things-sources');
  await page.waitForTimeout(900);
  await see(W('OpenStreetMap contributors', 'مساهمو OpenStreetMap'), 'OSM credit');
  await see('Open-Meteo', 'Open-Meteo credit');
  await see('Ticketmaster', 'Ticketmaster credit');
  await shot('sources');

  step(`${lang}: a city with no list yet`);
  await go('/city/611717');
  await scrollTo('things-section');
  await see(W('We don’t have a list for Tbilisi yet', 'ليست لدينا قائمة لـ'), 'no list');
  await shot('city-none');

  step(`${lang}: inside the Istanbul trip`);
  await go('/trips');
  await page.waitForTimeout(800);
  await page.locator('[data-testid^="trip-card-"]').filter({ visible: true }).first().click();
  await page.waitForTimeout(1500);
  await scrollTo('things-section');
  await see(W('Things to do', 'ماذا تفعل'), 'trip section');
  await shot('trip-things');
  await tapTest('things-see-all');
  await page.waitForTimeout(1200);
  await see(W('Near the hotel', 'قرب الفندق'), 'near the hotel filter');
  await page.getByRole('button', { name: W('Near the hotel', 'قرب الفندق'), exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  await see(W('min drive', 'د بالسيارة'), 'minutes from the hotel on the rows');
  await see(W('min walk', 'د مشيًا'), 'a short walk from the hotel');
  await shot('trip-things-near');
  const tripId = await page.evaluate(() => new URL(location.href).searchParams.get('trip'));
  // A day of the trip: no "open now", what's on that day.
  await page.locator('[data-testid="things-days"] [role="button"]').nth(2).click();
  await page.waitForTimeout(900);
  await shot('trip-things-day');
  await tapTest('place-osm:r1374029');
  await page.waitForTimeout(600);
  await scrollTo('thing-getting-there');
  await see(W('From Rooms near Galata Tower', 'من غرف قرب برج غلطة'), 'from the hotel');
  await see(W('About', 'نحو'), 'about how long');
  await shot('trip-place-getting-there');
  await byTest('thing-directions').click();
  await page.waitForTimeout(900);
  await see(W('A straight-line guess', 'تقدير بخط مستقيم'), 'the estimate is labelled a guess');
  await shot('trip-directions');
  await closeSheet();
  await page.waitForTimeout(700);
  await byTest('thing-add-plan').click();
  await page.waitForTimeout(1000);
  await see(W('On your plan for', 'في خطتك يوم'), 'added to the plan');
  await shot('trip-added-plan');

  step(`${lang}: a car from the hotel`);
  await byTest('thing-ride').click();
  await page.waitForTimeout(900);
  await see(W('A car to Hagia Sophia', 'سيارة إلى آيا صوفيا'), 'ride sheet in the trip');
  await see(W('Rooms near Galata Tower', 'غرف قرب برج غلطة'), 'pickup from the hotel by default');
  await shot('trip-ride-sheet');
  await byTest('ride-send').click();
  await page.waitForTimeout(1800);
  await see(W('picking us up from Rooms near Galata Tower', 'تأخذنا من غرف قرب برج غلطة'), 'the request asks for a car from the hotel');
  await shot('trip-ride-request');

  step(`${lang}: the idea is on the itinerary`);
  await go(`/itinerary/${tripId}`);
  await page.waitForTimeout(1200);
  const planned = page.locator('[data-testid^="itin-item-plan-"]').first();
  await planned.scrollIntoViewIfNeeded().catch(() => {});
  if (!(await planned.count())) errors.push(`${lang}: the planned idea isn't on the itinerary`);
  await see(W('Hagia Sophia', 'Hagia Sophia'), 'planned idea title');
  await shot('itinerary-planned');
  await page.context().close();
}

try {
  for (const lang of ['en', 'ar']) {
    try { await run(lang); } catch (e) { errors.push(`${lang}: ${String(e?.message ?? e).split('\n')[0]}`); console.log(e); }
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nThings to do passed. ${n} screenshots in ${OUT}`);
