// Walks every Today phase in headless Chromium, screenshots each (top and scrolled) and exercises the phase interactions.
// Usage: node test/today.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-today';
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1200, height: 920 } });
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(resolve('dist/index.html')).href);

const phone = page.locator('.phone');
const scroller = phone.locator('.screen .scroll').first();
let n = 0;
const shot = async (name) => { n += 1; await phone.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
const click = async (text, opts = {}) => { await phone.getByRole(opts.role || 'button', { name: text, exact: opts.exact ?? true }).first().click(); await page.waitForTimeout(opts.wait ?? 350); };
const demo = async (text) => { await page.locator('.demo').getByRole('button', { name: text, exact: true }).click(); await page.waitForTimeout(700); };
const step = (t) => console.log('·', t);
const expect = async (cond, msg) => { if (!(await cond)) { errors.push('expect: ' + msg); console.log('EXPECT FAILED', msg); } };
const has = (text) => phone.getByText(text, { exact: false }).first().isVisible();
const scrollTo = async (y) => { await scroller.evaluate((el, yy) => el.scrollTo(0, yy), y); await page.waitForTimeout(350); };
/* Top, then every screen-height down to the end. Also checks the last element clears the dock. */
const shotAll = async (name) => {
  await scrollTo(0);
  await page.waitForTimeout(700);
  await shot(name + '-top');
  const [h, ch] = await scroller.evaluate((el) => [el.scrollHeight, el.clientHeight]);
  let y = 0; let k = 1;
  while (y + ch < h - 4 && k < 6) { y = Math.min(h - ch, y + ch - 120); await scrollTo(y); await shot(`${name}-scroll${k}`); k += 1; }
  const clear = await scroller.evaluate((el) => {
    el.scrollTo(0, el.scrollHeight);
    const last = [...el.children].filter((c) => c.getBoundingClientRect().height > 0).pop();
    const dock = document.querySelector('.phone .dock');
    if (!last || !dock) return true;
    return last.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top + 1;
  });
  await expect(clear, `${name}: last element clears the dock`);
};

try {
  step('nothing planned');
  await demo('Skip sign-up');
  await shotAll('nothing');
  await expect(phone.getByRole('button', { name: 'Notifications' }).isVisible(), 'bell in header');

  step('weeks before');
  await demo('Weeks before');
  await expect(has('In 2'), 'weeks countdown on the hero');
  await shotAll('booked');
  await scrollTo(0);
  await click('Set it up', { wait: 500 });
  await shot('booked-esim-sheet');
  await phone.locator('.sheet .person-row').nth(3).click();
  await expect(has('Pay SAR 117'), 'eSIM total follows who is picked');
  await phone.locator('.sheet .btn.primary').click();
  await page.waitForTimeout(1300);
  await expect(has('All set.'), 'readiness complete after eSIM');
  await click(/done:/, { exact: false });
  await shot('booked-all-set');
  await click(/done:/, { exact: false });

  step('weeks before: passport problem');
  await demo('Passport problem');
  await expect(has("Fix Ahmed's passport"), 'passport fix shown');
  await shot('booked-problem');
  await demo('Passport problem');

  step('day before');
  await demo('Day before');
  await expect(has('Tomorrow · 09:40'), 'day-before countdown says Tomorrow');
  await expect(has('Monday 8 Mar'), 'header date is the day before the flight, not the phone’s date');
  await expect(!(await has('weeks')), 'no weeks countdown on the day before');
  await shotAll('daybefore');
  await scrollTo(0);
  await click('See the list', { wait: 700 });
  await phone.getByRole('checkbox', { name: /Passports/ }).click();
  await phone.getByRole('checkbox', { name: /Plug adapter/ }).click();
  await phone.getByRole('checkbox', { name: /umbrella/ }).click();
  await phone.locator('#td-pack-add').fill('kids’ headphones');
  await click('Add');
  await expect(has('Kids’ headphones'), 'own item added');
  await expect(has('3 of 9 in the bags'), 'packed count');
  await shot('daybefore-packing');
  await click('Remove Kids’ headphones');
  await expect(has('3 of 8 in the bags'), 'own item removed');
  await scrollTo(0);
  await click('Change pickup time', { wait: 500 });
  await click(/^06:45/, { role: 'radio', exact: false });
  await shot('daybefore-pickup-sheet');
  await click('Move pickup to 06:45', { wait: 600 });
  await expect(has('06:00'), 'wake time follows pickup');
  await shot('daybefore-after-pickup');
  step('day before: ticks survive a reload');
  await page.reload();
  await page.waitForTimeout(900);
  await expect(has('3 of 8 done'), 'ticks persisted');
  for (const name of ['Chargers', 'A warm layer', 'Prayer mat', 'Snacks', 'Medicines']) await phone.getByRole('checkbox', { name: new RegExp(name) }).click();
  await page.waitForTimeout(400);
  await expect(has('Packed. Sleep well.'), 'all packed state');
  await expect(has('All set for tomorrow.'), 'status line after packing');
  await scrollTo(0);
  await shot('daybefore-packed');

  step('travel day');
  await demo('Travel day');
  await page.waitForTimeout(6600);
  await expect(has('Khalid at 06:45'), 'travel day uses the moved pickup');
  await expect(has('Tuesday 9 Mar'), 'header date is the travel day');
  await shotAll('travelday');

  step('delay predicted');
  await demo('Delay predicted');
  await shotAll('delayed');

  step('cancelled');
  await demo('Flight cancelled');
  await shotAll('cancelled');

  step('in the air');
  await demo('In the air');
  await shotAll('inair');

  step('landed');
  await demo('Landed');
  await page.waitForTimeout(5400);
  await shotAll('landed');
  await scrollTo(0);
  await click('Done');
  await click('Done');
  await shot('landed-bags');
  await click('A bag didn’t arrive', { wait: 500 });
  await phone.locator('#pir').fill('ISTSV12345');
  await shot('landed-bag-sheet');
  await click('Let Mada chase it', { wait: 600 });
  await expect(has('Reference ISTSV12345'), 'bag reference shown');
  await click('Done');
  await click('Hotel address', { wait: 500 });
  await shot('landed-address');
  await phone.locator('.backdrop').last().click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);
  await click('With the driver');
  await click('At the hotel');
  await expect(has('You’re through.'), 'arrival complete');
  await shot('landed-done');

  step('back home');
  await demo('Back home');
  await page.waitForTimeout(800);
  await shotAll('home');
  await scrollTo(0);
  await click('Yes, remember it');
  await expect(has('How were the drivers?'), 'rating step 2');
  await click('Great');
  await click('Great');
  await phone.locator('#td-note').fill('The kids loved the ferry.');
  await shot('home-note');
  await click('Send to Faisal', { wait: 500 });
  await expect(has('Faisal reads every one'), 'rating sent');
  await phone.locator('[data-testid="td-photos"]').setInputFiles(['test/fixtures/anna-photo.jpg', 'test/fixtures/noura-photo.jpg', 'test/fixtures/noura-tilt8.jpg']);
  await page.waitForTimeout(1200);
  await expect(has('Three to remember it by.'), 'three photos added');
  await scrollTo(400);
  await shot('home-photos');
  await scrollTo(0);
  await shot('home-recap-photo');
  await click('Plan the next one', { wait: 500 });
  await expect(phone.locator('#ask-input').isVisible(), 'ask opened from home');
  await click('Close', { wait: 400 });
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]); console.log('FIRST ERROR:', e.message.slice(0, 600));
  await shot('FAILED');
}

console.log(errors.length ? '\nPROBLEMS:\n' + errors.join('\n') : '\nAll Today phases passed with no page errors.');
await browser.close();
process.exit(errors.length ? 1 : 0);
