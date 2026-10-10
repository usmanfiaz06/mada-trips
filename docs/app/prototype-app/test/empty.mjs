// Empty states, and the layout at phone width, end to end in headless Chromium.
// Usage: node test/money.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-empty';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 920 } });
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
await page.goto(pathToFileURL(resolve('dist/index.html')).href);
const phone = page.locator('.phone');
let n = 0;
const shot = async (name) => { n += 1; await phone.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
const click = async (text, opts = {}) => { await phone.getByRole(opts.role || 'button', { name: text, exact: opts.exact ?? true }).first().click(); await page.waitForTimeout(opts.wait ?? 350); };
const demo = async (text) => { await page.locator('.demo').getByRole('button', { name: text, exact: true }).click(); await page.waitForTimeout(400); };
const step = (t) => console.log('·', t);

/* Start signed in with a household and some Mada credit, so each test reaches its screen fast. */
const seed = async (extra = {}) => {
  await page.evaluate((x) => {
    const st = { seed: 'demo', onboarded: true, user: { name: 'Omar' }, household: ['omar', 'hessa', 'sara', 'ahmed'], passportSaved: true, notifications: true, location: true, phase: 'none', credit: { balance: 400, history: [{ id: 'c1', text: 'Refund · Baku hotel night', amount: 400, at: Date.now() - 864e5 }] }, ...x };
    localStorage.setItem('mada-proto-v1', JSON.stringify(st));
    /* Reload in the same tick, so the app can't save its old state over the seed first. */
    window.addEventListener('beforeunload', () => localStorage.setItem('mada-proto-v1', JSON.stringify(st)));
    location.reload();
  }, extra).catch(() => {});
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
};
const toPay = async () => {
  await click('Flights');
  await click('Istanbul');
  await click('Eid al-Fitr · 9–15 Mar');
  await click('These 4', { wait: 2800 });
  await phone.getByRole('button', { name: /^Review · SAR/ }).last().click();
  await page.waitForTimeout(700);
};
const slide = async () => { await phone.locator('.slider').focus(); await page.keyboard.press('Enter'); };

try {
  step('empty: trips tabs and inbox for a brand-new account');
  await click('Start');
  await click('Use my phone number');
  await phone.locator('#phone').fill('512345678');
  await click('Text me a code');
  await phone.locator('#otp').fill('123456');
  await page.waitForTimeout(600);
  await click('Skip', { wait: 700 });
  await page.locator('.phone .dock').getByRole('button', { name: 'Trips', exact: true }).click();
  await page.waitForTimeout(2600);
  await shot('empty-upcoming');
  await phone.getByRole('tab', { name: /Requests/ }).click(); await page.waitForTimeout(1500);
  await shot('empty-requests');
  await phone.getByRole('tab', { name: /Past/ }).click(); await page.waitForTimeout(600);
  await phone.locator('.pp-slot.first').click({ force: true });
  await page.waitForTimeout(200);
  await shot('empty-past');
  await page.evaluate(() => window.__madaPush('inbox'));
  await page.waitForTimeout(900);
  await shot('empty-inbox');

  step('phone width: content starts below the viewer bar');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/90-phone-width.png` });
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]);
  console.log('FIRST ERROR:', e.message.slice(0, 500));
  await shot('FAILED').catch(() => {});
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nEmpty states passed with no page errors.');
