// Empty states for a brand-new account, end to end in headless Chromium.
// Visits every place that can be empty, checks the words and the one next step, and screenshots each
// at phone size (the phone frame is 390×844). Fails on any page error.
// Usage: node test/empty.mjs [screenshot-dir]
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
const push = async (name, params, wait = 700) => { await page.evaluate(([a, b]) => window.__madaPush(a, b), [name, params || {}]); await page.waitForTimeout(wait); };
const tab = async (name, wait = 600) => { await page.locator('.phone .dock').getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(wait); };
const see = async (text, what) => {
  const ok = await phone.getByText(text, { exact: false }).first().isVisible().catch(() => false);
  if (!ok) { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); }
};
/* Scroll the top-most scroll area to the end, so the bottom of an empty screen is checked too. */
const scrollEnd = async () => { await page.evaluate(() => { const all = [...document.querySelectorAll('.phone .scroll')]; const el = all[all.length - 1]; if (el) el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(500); };
/* Nothing in an empty state may sit behind the dock or the bottom bar. */
const clearOfDock = async (what) => {
  const bad = await page.evaluate(() => {
    const dock = document.querySelector('.phone .dock');
    if (!dock) return null;
    const top = dock.getBoundingClientRect().top;
    const all = [...document.querySelectorAll('.phone .scroll')];
    const sc = all[all.length - 1];
    if (!sc) return null;
    const items = [...sc.querySelectorAll('.es, .es-row, .empty-hero')];
    const last = items[items.length - 1];
    return last && last.getBoundingClientRect().bottom > top + 1 ? Math.round(last.getBoundingClientRect().bottom - top) : null;
  });
  if (bad) { errors.push(`${what}: empty state ends ${bad}px behind the dock`); console.log('BEHIND DOCK', what, bad); }
};
/* Applies a patch to the saved state and reloads, for states a new account reaches only after a few steps. */
const patch = async (x) => {
  await page.evaluate((p) => {
    const st = { ...JSON.parse(localStorage.getItem('mada-proto-v1') || '{}'), ...p };
    localStorage.setItem('mada-proto-v1', JSON.stringify(st));
    window.addEventListener('beforeunload', () => localStorage.setItem('mada-proto-v1', JSON.stringify(st)));
    location.reload();
  }, x).catch(() => {});
  await page.waitForLoadState('load');
  await page.waitForTimeout(600);
};
const step = (t) => console.log('·', t);

try {
  step('sign up with a phone number: a brand-new account');
  await click('Start');
  await click('Use my phone number');
  await phone.locator('#phone').fill('512345678');
  await click('Text me a code');
  await phone.locator('#otp').fill('123456');
  await page.waitForTimeout(600);
  await click('Skip', { wait: 700 });
  await click('Not now', { wait: 700 });

  step('Today: nothing planned, no passport, no family');
  await page.waitForTimeout(600);
  await see('Nowhere planned yet.', 'today');
  await shot('today');
  await scrollEnd();
  await see('Add your passport', 'today passport');
  await see('Add your family', 'today family');
  await shot('today-end');

  step('Trips: Upcoming, Requests, Past');
  await tab('Trips', 2600);
  await see('Your name’s not on the board yet.', 'upcoming');
  await shot('trips-upcoming');
  await scrollEnd();
  await shot('trips-upcoming-end');
  await phone.getByRole('tab', { name: /Requests/ }).click(); await page.waitForTimeout(1500);
  await see('Nothing waiting on Faisal.', 'requests');
  await clearOfDock('requests');
  await shot('trips-requests');
  await phone.getByRole('tab', { name: /Past/ }).click(); await page.waitForTimeout(600);
  await phone.locator('.pp-slot.first').click({ force: true });
  await page.waitForTimeout(200);
  await see('Every trip leaves a stamp.', 'past');
  await clearOfDock('past');
  await shot('trips-past');

  step('Wallet: no passport, no documents, no boarding passes, no credit, no cards');
  await tab('Wallet', 1600);
  await see('Your passport isn’t here yet.', 'wallet passport');
  await shot('wallet');
  await scrollEnd();
  await see('No other documents yet', 'wallet docs');
  await see('No boarding passes yet', 'wallet passes');
  await clearOfDock('wallet');
  await shot('wallet-end');
  await phone.locator('.credit-card').click(); await page.waitForTimeout(500);
  await see('Nothing has moved yet.', 'credit sheet');
  await shot('wallet-credit');
  await page.mouse.click(300, 120); await page.waitForTimeout(400);
  await click('Cards and Apple Pay', { exact: false, wait: 500 });
  await shot('wallet-cards');
  await page.mouse.click(300, 120); await page.waitForTimeout(400);

  step('Circles: Discover with no tips, a city we don’t cover, no circles, friends, saved, stamps');
  await tab('Circles', 700);
  await phone.getByRole('button', { name: /Choose a city/ }).click(); await page.waitForTimeout(500);
  await phone.getByLabel('Search a city').fill('Tbilisi'); await page.waitForTimeout(400);
  await see('We don’t cover Tbilisi yet.', 'city search');
  await shot('city-search-none');
  await phone.getByLabel('Search a city').fill(''); await page.waitForTimeout(300);
  await phone.locator('.city-row', { hasText: 'AlUla' }).click(); await page.waitForTimeout(500);
  await click('Food', { wait: 500 });
  await scrollEnd();
  await see('No food tips in AlUla yet.', 'discover tips');
  await clearOfDock('discover');
  await shot('discover-no-tips');
  await phone.getByRole('tab', { name: 'Circles' }).click(); await page.waitForTimeout(600);
  await see('Your people, in one place.', 'circles');
  await shot('circles');
  await scrollEnd();
  await see('Nothing saved yet.', 'circles saved');
  await clearOfDock('circles');
  await shot('circles-end');

  step('People: friends, following, invited, requests');
  await push('people');
  await see('No friends here yet.', 'people friends');
  await shot('people-friends');
  for (const [t, words] of [['Following', 'You don’t follow anyone yet.'], ['Invited', 'Nobody invited yet.'], ['Requests', 'No requests.']]) {
    await phone.getByRole('tab', { name: t }).click(); await page.waitForTimeout(500);
    await see(words, 'people ' + t);
    await shot('people-' + t.toLowerCase());
  }

  step('Saved, a trip circle that doesn’t exist yet');
  await push('saved');
  await see('Nothing saved yet.', 'saved');
  await shot('saved');
  await push('group');
  await see('No trip circle yet.', 'group');
  await shot('group-none');

  step('Updates, Faisal on first open');
  await push('inbox', null, 900);
  await see('All quiet.', 'inbox');
  await shot('inbox');
  await push('support', null, 900);
  await see('What can I do?', 'support');
  await shot('support');

  step('Trip screens with no trip: itinerary, payments, refund, special requests');
  for (const [name, words] of [['itinerary', 'No days to plan yet.'], ['invoices', 'Nothing paid yet.'], ['refund', 'Nothing to refund.'], ['specialRequests', 'No requests yet.']]) {
    await push(name);
    await see(words, name);
    await shot('trip-' + name);
  }

  step('Account: details with no email or photo, no loyalty numbers, just you, this phone only, profile');
  await push('profile');
  await shot('profile');
  await push('account');
  await see('Add a photo', 'account photo');
  await shot('account');
  await push('accountPrefs');
  await scrollEnd();
  await see('No loyalty numbers yet', 'loyalty');
  await shot('account-loyalty');
  await push('household');
  await see('Just you so far', 'household');
  await shot('household');
  await push('accountSecurity');
  await see('Only this phone', 'devices');
  await shot('account-devices');

  step('Search with no results: flights, stays, a city we book by hand');
  await demo('Empty account');
  await demo('No flights found');
  await push('ask', { intent: 'flight' });
  await click('Istanbul');
  await click('Eid al-Fitr · 9–15 Mar', { wait: 3200 });
  await see('Nothing direct on those dates.', 'flights none');
  await shot('ask-flights-none');
  await push('ask', { prefill: 'A hotel in Istanbul' }, 1800);
  await see('No rooms free on those dates.', 'stays none');
  await click('Ask Faisal to find rooms', { wait: 600 });
  await see('Faisal is finding rooms in Istanbul', 'stays by hand');
  await shot('ask-stays-by-hand');
  await shot('ask-stays-none');
  await demo('No flights found');
  await push('ask', { prefill: 'A hotel in Baku' }, 1200);
  await see('Faisal is finding rooms in Baku', 'other city');
  await shot('ask-other-city');

  step('A new circle, and a first message to a friend');
  await demo('Empty account');
  await patch({ friends: ['abdullah'], groups: [{ id: 'g-new', name: 'Weekend crew', img: null, members: ['omar'], admin: 'omar', unread: 0, sub: '', trip: null, muted: false }] });
  await push('group', { id: 'g-new' }, 1000);
  await see('Weekend crew', 'new circle');
  await shot('circle-new');
  await push('friend', { id: 'abdullah' });
  await click('Message', { wait: 900 });
  await see('Say salam to Abdullah', 'new dm');
  await shot('dm-new');

  step('Trip done: nothing left to refund');
  await demo('Empty account');
  await demo('Back home');
  await push('refund', {}, 900);
  await see('Your trip is done.', 'refund done');
  await shot('refund-all-used');

  step('Tracking a flight as a guest, nothing tracked yet');
  await demo('Fresh install');
  await click('Start');
  await click('Just track a flight', { wait: 800 });
  await see('Nothing tracked yet.', 'guest tracking');
  await shot('guest-track');

  step('phone width: content starts below the viewer bar');
  await demo('Empty account');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/90-phone-width.png` });
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]);
  console.log('FIRST ERROR:', e.message.slice(0, 500));
  await shot('FAILED').catch(() => {});
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nEmpty states passed with no page errors.');
