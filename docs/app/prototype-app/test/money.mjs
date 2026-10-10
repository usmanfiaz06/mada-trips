// Payments, booking failures, support and the inbox, end to end in headless Chromium.
// Usage: node test/money.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-money';
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
  step('pay: credit, promo, new card with checks, bank code');
  await seed();
  await toPay();
  await shot('pay-credit');
  await click('Have a promo code?');
  await phone.getByLabel('Promo code').fill('RAMADAN');
  await click('Apply');
  await shot('promo-expired');
  await phone.getByLabel('Promo code').fill('EID10');
  await click('Apply');
  await click('Change');
  await click('Add a card');
  await phone.locator('#cardnum').fill('4242424242424241');
  await phone.locator('#cardexp').fill('0120');
  await phone.locator('#cardexp').blur();
  await shot('card-errors');
  await phone.locator('#cardnum').fill('4242424242424242');
  await phone.locator('#cardexp').fill('0830');
  await phone.locator('#cardcvv').fill('123');
  await phone.locator('#cardname').fill('OMAR ALHARBI');
  await click('Use this card', { wait: 500 });
  await shot('pay-new-card');
  await slide();
  await page.waitForTimeout(1600);
  await phone.locator('#otp3ds').fill('111111');
  await page.waitForTimeout(300);
  await shot('3ds-wrong');
  await phone.locator('#otp3ds').fill('123456');
  await page.waitForTimeout(1600);
  await shot('waiting');
  await page.waitForTimeout(4500);
  await shot('confirmed');
  await click('See the trip', { wait: 600 });
  await shot('trip-after-booking');

  step('pay: Apple Pay, fare sold out, tickets fail');
  await seed();
  await demo('Fare sold out while booking');
  await demo('Tickets fail to issue');
  await toPay();
  await click('Change');
  await click('Apple Pay');
  await slide();
  await page.waitForTimeout(1500);
  await shot('apple-pay');
  await page.waitForTimeout(2600);
  await shot('fare-gone');
  await phone.getByRole('button', { name: /^Book at SAR/ }).click();
  await page.waitForTimeout(4200);
  await shot('ticketing-failed');
  await click('Faisal tries by phone', { wait: 3200 });
  await page.waitForTimeout(2000);
  await shot('confirmed-after-retry');
  await demo('Fare sold out while booking');
  await demo('Tickets fail to issue');

  step('search: pick dates, one way, business, a baby, sort');
  await seed();
  await click('Flights');
  await click('Istanbul');
  await click('I’ll pick dates');
  await phone.getByRole('radio', { name: 'One way' }).click();
  await phone.locator('.cal-d', { hasText: /^12$/ }).click();
  await phone.getByRole('radio', { name: 'Business' }).click();
  await click('One more baby');
  await shot('search-sheet');
  await click('Search', { wait: 400 });
  await click('These 4', { wait: 2800 });
  await click('Cheapest', { wait: 300 });
  await shot('results-oneway-business');

  step('waiting: close and finish in the background');
  await seed();
  await toPay();
  await slide();
  await page.waitForTimeout(2000);
  await click('Close', { wait: 400 });
  await shot('closed-to-today');
  await page.waitForTimeout(8000);
  await shot('background-confirmed-banner');

  step('support and inbox');
  // Open support and inbox directly (the Today header links to them too).
  const open = async (name) => page.evaluate((nm) => window.__madaPush(nm), name);
  await open('support');
  await page.waitForTimeout(400);
  await shot('support-empty');
  await click('A refund', { wait: 2400 });
  await shot('support-refund');
  await phone.locator('#support-msg').fill('Can Sara sit by the window?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(4800);
  await shot('support-resolved');
  await click('Back');
  await open('inbox');
  await page.waitForTimeout(400);
  await shot('inbox');

  step('wallet: credit and cards');
  await click('Back');
  await page.locator('.phone').getByRole('button', { name: 'Wallet' }).click();
  await page.waitForTimeout(600);
  const unlock = phone.getByRole('button', { name: /Unlock|Face ID/ }).first();
  if (await unlock.count()) { await unlock.click(); await page.waitForTimeout(1600); }
  await phone.locator('.credit-card').evaluate((el) => el.scrollIntoView());
  await page.waitForTimeout(300);
  await shot('wallet-money');
  await phone.locator('.credit-card').click();
  await page.waitForTimeout(400);
  await shot('credit-sheet');

  step('one way, business, June: the booking keeps exactly what was chosen');
  const see = async (re, what) => { if (!(await phone.getByText(re).count())) throw new Error('missing: ' + what + ' ' + re); };
  const notSee = async (re, what) => { if (await phone.getByText(re).count()) throw new Error('should not show: ' + what + ' ' + re); };
  await seed();
  await click('Flights');
  await click('Istanbul');
  await click('I’ll pick dates');
  await phone.getByRole('radio', { name: 'One way' }).click();
  await phone.locator('.cal-months button', { hasText: /^Jun/ }).click();
  await page.waitForTimeout(200);
  await phone.locator('.cal-d', { hasText: /^20$/ }).click();
  await phone.getByRole('radio', { name: 'Business' }).click();
  await click('Search', { wait: 400 });
  await click('These 4', { wait: 2800 });
  await phone.getByRole('button', { name: /^Review · SAR/ }).last().click();
  await page.waitForTimeout(700);
  await see(/Istanbul · 20 Jun/, 'pay title');
  await see(/Business · one way/, 'cabin and one way on the line');
  await see(/15,208/, '4 × SAR 3,802');
  await notSee(/Free to cancel until 2 Mar/, 'March rule on a June trip');
  await notSee(/halal meals, seats together$/, 'fixed preference copy');
  await shot('oneway-business-pay');
  await slide();
  await page.waitForTimeout(1500);
  await page.waitForTimeout(5000);
  await click('See the trip', { wait: 700 });
  await see(/One way · Sun 20 Jun/, 'trip keeps the date, one way');
  await see(/Business/, 'trip keeps the cabin');
  await notSee(/^Back · /, 'no way back');
  await notSee(/Tue 9 Mar|9–15 Mar/, 'March dates');
  await shot('oneway-trip');
  await phone.locator('.scroll').last().evaluate((el) => el.scrollTo(0, 500)); await page.waitForTimeout(300);
  await phone.getByRole('button', { name: /^Payments and invoices/ }).click(); await page.waitForTimeout(500);
  await see(/SAR 15,208/, 'payments total is what was paid');
  await notSee(/Tabby|Next payment/, 'no Tabby when paid in full');
  await shot('oneway-payments');
  await phone.locator('.tm-pay', { hasText: 'Flights' }).click(); await page.waitForTimeout(500);
  await see(/one way, Business/, 'invoice line');
  await see(/and SAR 400 Mada credit/, 'credit on the invoice');
  await notSee(/14 Feb 2027/, 'demo invoice date');
  await see(new RegExp(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/ (\w{3}) /, ' $1 ')), 'booked today');
  await shot('oneway-invoice');

  step('invoice for a company: checked, issued, then locked');
  await phone.getByRole('button', { name: /^Invoice for a company/ }).click(); await page.waitForTimeout(400);
  await phone.locator('#co-name').fill('Alharbi Trading Co.');
  await phone.locator('#co-vat').fill('123456789012345');
  await phone.locator('#co-cr').fill('1010');
  await phone.locator('#co-address').fill('Olaya St, Riyadh');
  await click('Save company details');
  await see(/starts and ends with 3/, 'VAT rule');
  await see(/A CR number has 10 digits/, 'CR rule');
  await shot('company-errors');
  await phone.locator('#co-vat').fill('300123456700003');
  await phone.locator('#co-cr').fill('1010123456');
  await phone.locator('#co-address').fill('King Fahd Rd, Al Olaya, Riyadh 12214');
  await click('Save company details', { wait: 500 });
  await see(/Tax invoice · draft/, 'draft tax invoice');
  await see(/300123456700003/, 'buyer VAT on the invoice');
  await shot('company-draft');
  await click('Issue the tax invoice', { wait: 500 });
  await see(/Ask Mada to reissue/, 'locked after issue');
  if (await phone.getByRole('button', { name: 'Edit company details' }).count()) throw new Error('issued invoice still editable');
  await shot('company-issued');
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]);
  console.log('FIRST ERROR:', e.message.slice(0, 500));
  await shot('FAILED').catch(() => {});
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nMoney, failures and support passed with no page errors.');
