// The beta's flights by request, end to end in headless Chromium: the demo switch "Flights by request (beta)",
// Ask → "Tell us where and when" → Send to Mada → the fares in Trips › Requests → choose → pay → ticketed with the PNR
// and a ticket number each. Desktop frame and a 390×844 phone.
// Usage: node test/beta.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-beta';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
let n = 0;
const step = (t) => console.log('·', t);

async function run(viewport, tag) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => { errors.push(`${tag} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  const phone = page.locator('.phone');
  const shot = async (name) => { n += 1; await phone.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${tag}-${name}.png` }); };
  const click = async (text, opts = {}) => { await phone.getByRole(opts.role || 'button', { name: text, exact: opts.exact ?? true }).first().click(); await page.waitForTimeout(opts.wait ?? 350); };
  const see = async (text, what) => { try { await phone.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 }); } catch { errors.push(`${tag} ${what}: expected "${text}"`); console.log('MISSING', what, text); } };
  await page.evaluate(() => {
    const st = { seed: 'demo', onboarded: true, user: { name: 'Omar' }, household: ['omar', 'hessa', 'sara', 'ahmed'], passportSaved: true, notifications: true, location: true, phase: 'none', demo: { flightsByRequest: true } };
    localStorage.setItem('mada-proto-v1', JSON.stringify(st));
    window.addEventListener('beforeunload', () => localStorage.setItem('mada-proto-v1', JSON.stringify(st)));
    location.reload();
  }).catch(() => {});
  await page.waitForLoadState('load');
  await page.waitForTimeout(600);
  // The switch is on from the seed; on the desktop frame the demo panel shows it on.
  if (viewport.width > 600 && !(await page.locator('.demo').getByRole('button', { name: 'Flights by request (beta)', exact: true }).count())) errors.push(`${tag}: no demo switch`);
  await page.waitForTimeout(500);

  step(`${tag}: Ask → Tell us where and when`);
  await click('Flights');
  await click('Istanbul');
  await click('Eid al-Fitr · 9–15 Mar', { wait: 600 });
  await see('Tell us where and when', 'form');
  await see('Riyadh to Istanbul', 'route');
  await shot('form');
  await click('3 days either side');
  await click('Two checked bags');
  await click('Direct only');
  await shot('form-filled');
  await click('Send to Mada', { wait: 600 });
  await see('Sent to Mada', 'sent');
  await shot('sent');
  step(`${tag}: the fares arrive`);
  await click('See it in Trips', { wait: 600 });
  await page.waitForTimeout(10500);
  await see('I found 2 fares', 'fares');
  await see('Held for', 'hold');
  await shot('fares');
  await phone.getByRole('button', { name: /Turkish Airlines/ }).first().click();
  await page.waitForTimeout(300);
  await see('Refund minus SAR 300 per person', 'rules');
  await shot('fare-two');
  step(`${tag}: pay, ticketed`);
  await phone.getByRole('button', { name: /^Pay SAR/ }).last().click();
  await page.waitForTimeout(700);
  await see('Turkish Airlines', 'pay line');
  await shot('pay');
  await phone.locator('.slider').focus(); await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
  await see('Paid. Faisal is issuing your tickets.', 'paid');
  await shot('paid');
  await page.waitForTimeout(7000);
  await see('Ticketed · Airline booking', 'ticketed');
  await see('Ticket 065', 'ticket numbers');
  await shot('ticketed');
  await page.close();
}

try {
  await run({ width: 1200, height: 920 }, 'desk');
  await run({ width: 390, height: 844 }, 'phone');
} catch (e) {
  errors.push(`crash: ${e.message}`);
  console.log(e);
} finally {
  await browser.close();
}
console.log(`${n} screenshots in ${OUT}`);
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('OK');
