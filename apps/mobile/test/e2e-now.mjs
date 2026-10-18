// The now path (critique 4 and 10), end to end in headless Chromium against the web export (mock API).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-now.mjs [shot-dir]
//
// Signs in as the demo account and walks: a car asked for now (no "Tomorrow" anywhere; now or in 15 minutes, the
// city, where to meet; finding a car → the driver with car, plate, meeting point and price, call, message and cancel);
// a car where none is free (said plainly, then Mada finds one by hand with a call-back time); urgent help on travel day
// (the trip's disruption card, a problem picked → Mada calls back by a time, no 997), someone hurt (997 shows); and the
// disruption screen when nothing is wrong ("Your flight is on time", when it was checked, never "No signal").
// The car-now opening once more in Arabic. Screenshots at 390×844. Fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-now');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
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

async function run(lang) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'ar' ? 'ar-SA' : 'en-GB', timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${lang} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const shot = async (name) => { n += 1; await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${lang}-${name}.png`) }); };
  const see = async (text, what, timeout = 10000) => {
    try { await page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${lang} ${what}: expected "${text}"`); console.log('MISSING', lang, what, '→', text); return false; }
  };
  const never = async (text, what) => { if (await page.getByText(text, { exact: false }).locator('visible=true').count()) { errors.push(`${lang} ${what}: "${text}" should not show`); console.log('UNWANTED', lang, what, '→', text); } };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).locator('visible=true').first();
  const go = async (path) => { await page.evaluate((p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')); }, path); await page.waitForTimeout(1500); };
  // Back out of pushed screens and the Ask sheet until the tab bar shows.
  const home = async () => { for (let i = 0; i < 6 && (await page.getByRole('button', { name: /^(Back|Close|Home)$/ }).locator('visible=true').count()); i += 1) { await page.getByRole('button', { name: /^(Back|Close|Home)$/ }).locator('visible=true').first().click(); await page.waitForTimeout(700); } };
  const tab = async (name) => { await page.getByRole('tab', { name, exact: true }).first().click(); await page.waitForTimeout(800); };
  async function phase(p) {
    await tab('Today');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll('div')) if (el.scrollTop > 0) el.scrollTop = 0; });
      await page.waitForTimeout(400);
      const date = page.locator('[data-testid="today-date"]').first();
      await date.waitFor({ state: 'visible', timeout: 15000 });
      await date.click({ delay: 800 });
      try { await page.locator(`[data-testid="demo-${p}"]`).waitFor({ state: 'visible', timeout: 3000 }); break; } catch { /* the long press didn't land: again */ }
    }
    await page.locator(`[data-testid="demo-${p}"]`).click();
    await page.waitForTimeout(1500);
  }

  step(`${lang}: sign in as the demo account`);
  await page.goto(ORIGIN + '/');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-testid="welcome-start"]').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('[data-testid="welcome-start"]').click();
  await page.locator('[data-testid="signin-phone"]').click();
  await page.locator('[data-testid="phone-input"]').fill('500004127');
  await page.locator('[data-testid="phone-send"]').click();
  await page.locator('[data-testid="otp-input"]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-testid="otp-input"]').fill('123456');
  try { await page.locator('[data-testid="welcome-back-open"]').waitFor({ state: 'visible', timeout: 6000 }); await page.locator('[data-testid="welcome-back-open"]').click(); } catch { /* straight in */ }
  await page.waitForTimeout(1500);

  if (lang === 'ar') {
    step('ar: a car now, the opening');
    await go(`/ask?prefill=${encodeURIComponent('أبي سيارة الحين')}`);
    // «الحين» is the answer to "when": a chip from what was said, never the question (critique 2, #2).
    await see('من كلامك', 'heard chips');
    await never('متى تبيها؟', 'when not asked again');
    await never('بكرة', 'no tomorrow');
    await see('بأي مدينة؟', 'city still asked');
    await shot('car-now');
    await go(`/ask?prefill=${encodeURIComponent('تاكسي الحين في أبها')}`);
    await see('أبها', 'taxi now in Abha is a car, Abha heard');
    await never('متى تبيها؟', 'when not asked');
    await shot('taxi-now-ar');
    step('ar: landed at Istanbul airport, a car now to Taksim (critique 2, #17)');
    await go(`/ask?prefill=${encodeURIComponent('وصلت مطار إسطنبول أبغى سيارة الحين لتقسيم')}`);
    await see('مطار إسطنبول', 'meeting point from the words');
    await see('إلى تقسيم', 'destination from the words');
    await see('كم', 'distance shown');
    await never('متى تبيها؟', 'when not asked');
    await never('بأي مدينة؟', 'city not asked');
    await shot('car-now-taksim-ar');
    await context.close();
    return;
  }

  step('car now: never tomorrow');
  await go(`/ask?prefill=${encodeURIComponent('I need a car now')}`);
  // "now" answers when: a chip, never the question again (critique 2, #2).
  await see('From what you said', 'heard chips');
  await never('When should it come?', 'when not asked again');
  await never('Tomorrow', 'no tomorrow');
  await shot('car-now-when');
  await byTest('car-now-city-Riyadh').click();
  await byTest('car-now-place').fill('Rosewood lobby');
  await shot('car-now-where');
  await byTest('car-now-send').click();
  await see('Finding you a car', 'requesting');
  await shot('car-now-requesting');
  await see('is on the way', 'driver assigned', 15000);
  for (const id of ['ride-driver', 'ride-car', 'ride-plate', 'ride-meet', 'ride-price', 'ride-call', 'ride-message', 'ride-cancel']) {
    if (!(await page.locator(`[data-testid="${id}"]`).count())) errors.push(`car now: ${id} missing`);
  }
  await see('Rosewood lobby', 'meeting point');
  await see('Fixed price, paid to the driver.', 'price note');
  await see('Test mode: no real car comes.', 'test mode said');
  await shot('car-now-assigned');
  await byTest('ride-cancel').click();
  await see('Car cancelled. Nothing to pay.', 'cancelled');
  await shot('car-now-cancelled');

  step('car now: "Get me a taxi now in Abha" is a car now, not a flight; none free');
  await home();
  await go(`/ask?prefill=${encodeURIComponent('Get me a taxi now in Abha')}`);
  await see('Where should the driver meet you?', 'taxi now is a car');
  await never('When should it come?', 'when not asked again');
  await never('Checking flights', 'not a flight search');
  await byTest('car-now-place').fill('Abha airport');
  await byTest('car-now-send').click();
  await see('No car is free near you right now.', 'no car', 15000);
  await see('Mada can find one by hand and call you within 10 minutes.', 'next step');
  await shot('car-now-none');
  await byTest('ride-ask-mada').click();
  await see('Mada has it. We call you by', 'call-back promise');
  await shot('car-now-asked');

  step('car now: landed at Istanbul airport, to Taksim, nothing asked twice (critique 2, #2, #17)');
  await home();
  await go(`/ask?prefill=${encodeURIComponent('I just landed at Istanbul airport, I need a car right now to Taksim')}`);
  await see('Istanbul Airport', 'meeting point from the words');
  await see('To Taksim', 'destination from the words');
  await see(' km · ', 'distance and time');
  await never('When should it come?', 'when not asked');
  await never('Which city?', 'city not asked');
  await never('Where should the driver meet you?', 'meeting point not asked');
  await shot('car-now-taksim');
  await byTest('car-heard-to').click();
  await see('Where to?', 'a chip opens its question');
  await byTest('car-now-send').click();
  await see('is on the way', 'driver assigned to Taksim', 15000);
  await see('Taksim', 'destination on the driver card');
  if (!(await page.locator('[data-testid="ride-dest"]').count())) errors.push('car now: destination row missing');
  await never('SAR 44', 'the fare is for this ride, not the city minimum');
  await shot('car-now-taksim-assigned');
  await byTest('ride-cancel').click();
  await see('Car cancelled. Nothing to pay.', 'cancelled');

  step('urgent on travel day: the disruption card, a call-back, no 997');
  await home();
  await phase('travelday');
  await go('/support');
  await page.locator('[data-testid="topic-urgent"], [data-testid="urgent-pill"]').locator('visible=true').first().click();
  await see('What’s wrong with your Istanbul trip?', 'disruption card');
  await see('Lost passport or documents', 'docs choice');
  await never('997', 'no 997 yet');
  await shot('urgent-card');
  await page.getByRole('button', { name: 'My flight is cancelled', exact: true }).click();
  await see('Mada calls you back within 10 minutes', 'promise');
  await see('No need to queue at the counter.', 'what to do meanwhile');
  if (!(await page.locator('[data-testid="callback-by"]').count())) errors.push('urgent: call-back time missing');
  await never('997', 'still no 997');
  await shot('urgent-callback');
  await byTest('support-input').fill('Help, my son is hurt');
  await byTest('support-send').click();
  await see('Call 997, ambulance', '997 for someone hurt');
  await shot('urgent-emergency');

  step('disruption screen when nothing is wrong');
  await home();
  await phase('booked');
  await tab('Trips');
  await page.locator('[data-testid="trip-card-Istanbul"]').first().click();
  await page.waitForTimeout(1500);
  const tripId = new URL(page.url()).pathname.split('/').filter(Boolean)[1];
  await go(`/disruption/${tripId}`);
  await see('Your flight is on time.', 'on time');
  if (!(await page.locator('[data-testid="dz-checked"]').count())) errors.push('disruption: last check time missing');
  await never('No signal', 'never no signal while online');
  await never('offline', 'no offline wording while online');
  await shot('disruption-all-well');
  await context.close();
}

try {
  await run('en');
  await run('ar');
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${n} screenshots in ${OUT}`);
if (errors.length) { console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log('e2e now: all good');
