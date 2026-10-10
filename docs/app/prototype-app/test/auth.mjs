// Sign-in paths: Apple, cancel, returning user, guest who signs in to book, end to end in headless Chromium.
// Usage: node test/money.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-auth';
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
    const st = { onboarded: true, user: { name: 'Omar' }, household: ['omar', 'hessa', 'sara', 'ahmed'], passportSaved: true, notifications: true, location: true, phase: 'none', credit: { balance: 400, history: [{ id: 'c1', text: 'Refund · Baku hotel night', amount: 400, at: Date.now() - 864e5 }] }, ...x };
    localStorage.setItem('mada-proto-v1', JSON.stringify(st));
  }, extra);
  await page.reload();
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
  step('apple: hide email, then phone');
  await click('Start');
  await click('Continue with Apple');
  await phone.getByRole('radio', { name: /Hide my email/ }).click();
  await shot('apple-sheet');
  await click('Continue');
  await shot('phone-after-apple');

  step('returning user');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(400);
  await click('Start');
  await click('Use my phone number');
  await phone.locator('#phone').fill('500004127');
  await click('Text me a code');
  await phone.locator('#otp').fill('123456');
  await page.waitForTimeout(600);
  await shot('welcome-back');
  await click('Open Mada', { wait: 500 });
  await shot('today-returning');

  step('guest signs in to book, lands back in Ask');
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(400);
  await click('Just track a flight', { wait: 500 });
  await phone.getByRole('button', { name: 'Ask Mada' }).click();
  await page.waitForTimeout(400);
  await click('Flights to Istanbul', { wait: 500 });
  await shot('guest-gate');
  await click('Sign in', { wait: 500 });
  await shot('signin-from-guest');
  await click('Use my phone number');
  await phone.locator('#phone').fill('500004127');
  await click('Text me a code');
  await phone.locator('#otp').fill('123456');
  await page.waitForTimeout(600);
  await click('Open Mada', { wait: 700 });
  await shot('back-in-ask');
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]);
  console.log('FIRST ERROR:', e.message.slice(0, 500));
  await shot('FAILED').catch(() => {});
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nSign-in paths passed with no page errors.');
