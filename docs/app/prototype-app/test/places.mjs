// Places end to end in headless Chromium: worldwide city search in Discover (names, typos, airport codes, a true
// no-match with the closest names), our cities keeping their Discover week, the page for any city (our photo or the
// typographic hero), "Plan it with Mada" → a request in Trips → Requests and the chat with the prefilled message,
// and offline. No network: the cities ship in the page.
// Usage: node test/places.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-places';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 920 } });
const errors = [];
const requests = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('request', (r) => { if (/^https?:/.test(r.url()) && !/fonts\.(googleapis|gstatic)\.com/.test(r.url())) requests.push(r.url()); });
await page.goto(pathToFileURL(resolve('dist/index.html')).href);
const phone = page.locator('.phone');
let n = 0;
const shot = async (name) => { n += 1; await phone.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
const see = async (text, timeout = 4000) => { await phone.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); };
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('mada-proto-v1')));
const step = (t) => console.log('·', t);
const seed = async (extra = {}) => {
  await page.evaluate((x) => {
    const st = { onboarded: true, user: { name: 'Omar' }, household: ['omar', 'hessa', 'sara', 'ahmed'], passportSaved: true, notifications: true, location: true, phase: 'none', tab: 'circles', ...x };
    localStorage.setItem('mada-proto-v1', JSON.stringify(st));
  }, extra);
  await page.reload();
  await page.waitForTimeout(600);
};
const openSheet = async () => { await phone.getByRole('button', { name: /Choose a city/ }).click(); await page.waitForTimeout(450); };
const type = async (q) => { await phone.getByLabel('Search a city').fill(q); await page.waitForTimeout(300); };
const rows = () => phone.locator('.sheet .city-row').evaluateAll((els) => els.map((e) => e.querySelector('.h3')?.textContent));
const expectFirst = async (q, name) => {
  await type(q);
  const r = await rows();
  if (r[0] !== name) throw new Error(`"${q}" → ${JSON.stringify(r.slice(0, 4))}, expected ${name} first`);
};
const back = async () => { await phone.locator('.topbar .back').last().click(); await page.waitForTimeout(450); };

try {
  step('search: names, prefixes, typos, accents, airport codes');
  await seed();
  await openSheet();
  await shot('sheet-start');
  await expectFirst('tbilisi', 'Tbilisi');
  await see('Georgia · TBS');
  await shot('search-tbilisi');
  await expectFirst('tbil', 'Tbilisi');
  await expectFirst('tbilsi', 'Tbilisi');
  await expectFirst('tbs', 'Tbilisi');
  await expectFirst('rome', 'Rome');
  await expectFirst('LHR', 'London');
  await expectFirst('zurich', 'Zürich');
  await expectFirst('sao paulo', 'São Paulo');
  await expectFirst('maldives', 'Malé');
  await type('IST');
  await see('Türkiye · IST');
  await shot('search-ist');
  if ((await rows()).length > 8) throw new Error('more than 8 results');

  step('a true no-match: gentle, with the closest names');
  await type('sd');
  await see('No city called ‘sd’.');
  await see('Try a city or an airport code.');
  await see('Closest we know');
  const close = await rows();
  if (!close.some((x) => /^S/.test(x || ''))) throw new Error('no close names for "sd": ' + JSON.stringify(close));
  if (await phone.getByText('We don’t cover', { exact: false }).count()) throw new Error('old copy still shown');
  await shot('search-sd');

  step('our cities keep their Discover week');
  await type('istan');
  await phone.locator('.sheet .city-row', { hasText: 'Istanbul' }).first().click();
  await page.waitForTimeout(500);
  await see('Bosphorus dinner cruise');

  step('any city: Rome opens the typographic city page');
  await openSheet();
  await type('rome');
  await phone.locator('.sheet .city-row', { hasText: 'Rome' }).first().click();
  await page.waitForTimeout(600);
  await see('Italy');
  await see('Local time');
  await see('FCO');
  await see('What Mada puts together');
  await see('Plan it with Mada');
  await shot('city-rome');

  step('plan it with Mada: request + chat with the prefilled message');
  await phone.getByRole('button', { name: 'Plan it with Mada' }).click();
  await page.waitForTimeout(400);
  await see('Plan Rome with Mada');
  await phone.getByRole('radio', { name: 'May' }).click();
  await page.waitForTimeout(200);
  const msg = await phone.locator('#plan-msg').inputValue();
  if (msg !== 'Rome, 4 of us, sometime in May') throw new Error('message: ' + msg);
  await shot('plan-sheet');
  await phone.getByRole('button', { name: 'Send to Mada' }).click();
  await page.waitForTimeout(500);
  await see('Rome, 4 of us, sometime in May');
  await see('About: A trip to Rome');
  await see('I’ll put Rome together by hand', 5000);
  await shot('chat-prefilled');
  let st = await state();
  const req = st.requests.find((r) => r.title === 'A trip to Rome');
  if (!req || req.status !== 'sent') throw new Error('no request in Trips: ' + JSON.stringify(st.requests));
  await back();
  await back();
  await phone.getByRole('button', { name: 'Trips', exact: true }).first().click();
  await page.waitForTimeout(500);
  await see('A trip to Rome');
  await shot('trips-requests');

  step('a city we know: Tbilisi with our photo, and Ask for a city we sell');
  await page.evaluate(() => window.__madaPush('city', { id: '611717' }));
  await page.waitForTimeout(600);
  await see('Old Tbilisi and the cable car');
  await see('Saudi passports need no visa');
  await shot('city-tbilisi');
  await back();
  await page.evaluate(() => window.__madaPush('city', { id: '2643743' }));
  await page.waitForTimeout(600);
  await see('Flights and rooms for London are right here.');
  await shot('city-london');
  await phone.getByRole('button', { name: 'Plan it with Mada' }).click();
  await page.waitForTimeout(700);
  await see('A trip to London'); // Ask opens with it already asked
  await shot('ask-london');
  await back();
  await back();

  step('a city with no photo and no airport code nearby still looks finished');
  await page.evaluate(() => window.__madaPush('city', { id: '1850147' }));
  await page.waitForTimeout(600);
  await see('Tokyo');
  await shot('city-tokyo');
  await back();

  step('an unknown link gets a calm page');
  await page.evaluate(() => window.__madaPush('city', { id: '0' }));
  await page.waitForTimeout(500);
  await see('We can’t find that city.');
  await shot('city-missing');
  await back();

  step('offline: the plan waits in the Outbox');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('mada-proto-v1')); s.demo = { ...(s.demo || {}), offline: true }; localStorage.setItem('mada-proto-v1', JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__madaPush('city', { id: '2950159' }));
  await page.waitForTimeout(600);
  await see('Berlin');
  await phone.getByRole('button', { name: 'Plan it with Mada' }).click();
  await page.waitForTimeout(400);
  await phone.getByRole('button', { name: 'Send to Mada' }).click();
  await page.waitForTimeout(600);
  await see('sends when you’re online');
  st = await state();
  if (!st.requests.some((r) => r.title === 'A trip to Berlin' && r.status === 'queued')) throw new Error('offline request not queued');
  await shot('offline-plan');
  if (requests.length) throw new Error('fetched the network: ' + requests.slice(0, 3).join(', '));
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]);
  console.log('FIRST ERROR:', e.message.slice(0, 600));
  await shot('FAILED').catch(() => {});
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nPlaces passed with no page errors.');
