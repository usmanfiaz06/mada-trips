// Circles end to end in headless Chromium: make a circle, invite, vote, split, pay a share, persistence,
// @Mada, context-aware replies, someone leaving, joining by link, and every empty state.
// Usage: node test/circles.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-circles';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 920 } });
const errors = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(resolve('dist/index.html')).href);
const phone = page.locator('.phone');
let n = 0;
const shot = async (name) => { n += 1; await phone.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
const click = async (text, opts = {}) => { await phone.getByRole(opts.role || 'button', { name: text, exact: opts.exact ?? true }).first().click({ force: !!opts.force }); await page.waitForTimeout(opts.wait ?? 350); };
const see = async (text, timeout = 4000) => { await phone.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); };
const notSee = async (text) => { if (await phone.getByText(text, { exact: false }).count()) throw new Error(`did not expect "${text}"`); };
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('mada-proto-v1')));
const open = async (name, params) => { await page.evaluate(([nm, p]) => window.__madaPush(nm, p), [name, params || {}]); await page.waitForTimeout(500); };
const scrollEnd = async () => { await phone.locator('.scroll').last().evaluate((el) => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(300); };
const scrollTop = async () => { await phone.locator('.scroll').last().evaluate((el) => { el.scrollTop = 0; }); await page.waitForTimeout(300); };
const step = (t) => console.log('·', t);
const tool = async (name) => { await phone.getByRole('button', { name: 'Circle tools: vote, split, share, ask Mada' }).click(); await page.waitForTimeout(350); await phone.locator('.cx-tool', { hasText: name }).click(); await page.waitForTimeout(400); };
const back = async (wait = 450) => { await phone.locator('.topbar .back').last().click(); await page.waitForTimeout(wait); };
const toCirclesTab = async () => { await phone.getByRole('button', { name: 'Circles', exact: true }).first().click(); await page.waitForTimeout(400); await click('Circles', { role: 'tab' }); };
const send = async (text, wait = 300) => { await phone.locator('#msg').fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(wait); };

const DEMO_GROUPS = [
  { id: 'eid', name: 'Istanbul for Eid', img: 'img/istanbul.jpg', members: ['omar', 'hessa', 'abdullah', 'noor', 'sara', 'ahmed'], admin: 'omar', unread: 2, sub: 'vote on the cruise', trip: 'Istanbul · 9–15 Mar', muted: false },
  { id: 'family', name: 'Family', img: null, members: ['omar', 'hessa', 'sara', 'ahmed'], admin: 'omar', unread: 0, sub: 'documents', trip: null, muted: false },
  { id: 'season', name: 'Riyadh Season', img: 'img/riyadh.jpg', members: ['omar', 'abdullah', 'khalid', 'faris', 'maha', 'yousef', 'noor', 'reem'], admin: 'abdullah', unread: 0, sub: '2 events', trip: null, muted: true },
];
/* A brand-new account: nothing in Circles at all. */
const EMPTY = { groups: [], friends: [], friendRequests: [], invites: [], savedPosts: [], savedPlans: [], pastTrips: [], following: [], circleThreads: {}, circleQueue: [] };
const seed = async (extra = {}) => {
  await page.evaluate((x) => {
    const st = { onboarded: true, user: { name: 'Omar' }, household: ['omar', 'hessa', 'sara', 'ahmed'], passportSaved: true, notifications: true, location: true, phase: 'none', tab: 'today', ...x };
    localStorage.setItem('mada-proto-v1', JSON.stringify(st));
  }, extra);
  await page.reload();
  await page.waitForTimeout(500);
};

try {
  step('empty states: a new account');
  await seed(EMPTY);
  await toCirclesTab();
  await see('Your people, in one place.');
  await see('Bring your people.');
  await shot('empty-circles-top');
  await scrollEnd();
  await see('Every trip home adds a stamp.');
  await see('Nothing saved yet.');
  await shot('empty-passport');
  await open('people');
  await see('No friends here yet.');
  await shot('empty-people');
  await back();
  await open('saved');
  await see('Nothing saved yet.');
  await shot('empty-saved');
  await back();
  await open('group');
  await see('No trip circle yet.');
  await back();

  step('create a circle from a suggestion, with invites');
  await seed({ ...EMPTY, friends: ['abdullah', 'noor', 'khalid', 'faris'] });
  await toCirclesTab();
  await click('Eid trip', { wait: 500 });
  if ((await phone.locator('#nc-name').inputValue()) !== 'Eid trip') throw new Error('suggestion did not fill the name');
  await phone.locator('#nc-name').fill('Georgia in summer');
  await phone.locator('.person-row', { hasText: 'Abdullah' }).click();
  await phone.locator('.person-row', { hasText: 'Noor' }).click();
  await phone.getByRole('radio', { name: 'Somewhere new' }).click();
  await phone.getByLabel('Where to').fill('Georgia');
  await shot('new-circle');
  await click('Make Georgia in summer', { wait: 600 });
  await see('Abdullah and Noor are invited');
  let st = await state();
  const g = st.groups.find((x) => x.name === 'Georgia in summer');
  if (g.members.length !== 1 || g.invited.length !== 2) throw new Error('invitees were added without accepting');
  await shot('circle-invited');
  await see('Abdullah joined', 6000);
  st = await state();
  if (!st.groups.find((x) => x.id === g.id).members.includes('abdullah')) throw new Error('Abdullah did not join');
  if (st.groups.find((x) => x.id === g.id).members.includes('noor')) throw new Error('Noor joined without accepting');

  step('invites: Remind and Cancel in settings');
  await phone.getByRole('button', { name: /settings and people$/ }).click();
  await page.waitForTimeout(400);
  await see('Invited');
  await shot('settings-invited');
  await click('Remind');
  await see('Reminded');
  await phone.locator('.backdrop').last().click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(400);

  step('vote: question, choices, others vote, close, Mada posts the result');
  await click('Circle tools: vote, split, share, ask Mada');
  await shot('tools');
  await phone.locator('.cx-tool', { hasText: 'Start a vote' }).click();
  await page.waitForTimeout(400);
  await click('Post the vote', { force: true });
  await see('Add a question.');
  await phone.locator('#vote-q').fill('Which weekend');
  await click('Thu 11 Mar', { wait: 150 });
  await click('Fri 12 Mar', { wait: 150 });
  await click('Add a choice', { wait: 150 });
  await phone.locator('#vote-o3').fill('Fri 12 Mar');
  await click('Post the vote', { force: true });
  await see('Two choices are the same.');
  await phone.locator('#vote-o3').fill('Sat 13 Mar');
  await shot('vote-sheet');
  await click('Post the vote', { force: true, wait: 500 });
  await see('Which weekend?');
  await phone.locator('.cx-pin').waitFor();
  await page.waitForTimeout(2600);
  await phone.getByRole('button', { name: /^Thu 11 Mar, / }).click();
  await page.waitForTimeout(400);
  await see('2 of 2 voted');
  await shot('vote-live');
  await click('Close vote', { wait: 500 });
  await see('Thursday it is. Want us to book it?');
  await shot('vote-result');

  step('split: validation, custom amounts, paid by Abdullah');
  await tool('Split a cost');
  await phone.locator('#split-what').fill('Hotel deposit');
  await phone.locator('#split-total').fill('1200');
  await phone.getByRole('radio', { name: 'Abdullah' }).click();
  await phone.getByRole('radio', { name: 'Custom' }).click();
  await phone.getByLabel('Your share').fill('500');
  await page.waitForTimeout(200);
  await see('SAR 700 still to share out.');
  if (!(await phone.getByRole('button', { name: 'Split it' }).isDisabled())) throw new Error('a split that does not add up could be posted');
  await shot('split-custom-error');
  await phone.locator('.cx-amt-in').nth(1).fill('700');
  await see('Adds up to SAR 1,200.');
  await phone.getByRole('radio', { name: 'Equally' }).click();
  await shot('split-sheet');
  await click('Split SAR 1,200', { wait: 600 });
  await see('Pay my share · SAR 600');
  await shot('split-card');

  step('pay my share');
  await click('Pay my share · SAR 600', { wait: 800 });
  await shot('pay-share');
  await phone.locator('.slider').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
  await see('You paid your share · SAR 600', 4000);
  await see('Settled');
  await shot('split-settled');

  step('leave and reopen: messages, vote and split are still there');
  await back(500);
  await phone.locator('.cx-tile', { hasText: 'Georgia in summer' }).click();
  await page.waitForTimeout(500);
  await see('Thursday it is.');
  await see('Hotel deposit');
  await page.reload();
  await page.waitForTimeout(600);
  await open('group', { id: g.id });
  await see('Which weekend?');
  await see('Hotel deposit');
  await see('You paid your share');

  step('@Mada uses the circle’s place');
  await send('@Mada ideas for a trip', 2400);
  await see('Three ideas for Georgia');
  await notSee('Bosphorus');
  await shot('mada-georgia');
  await send('@Mada do we need a visa?', 2400);
  await see('no visa for stays up to a year');
  await click('Plan it', { wait: 800 });
  await see('Georgia');
  await shot('mada-plan-it');
  await back(500);

  step('replies: sparse and in context');
  const before = (await state()).circleThreads[g.id].msgs.length;
  await send('ok', 4200);
  const afterOk = (await state()).circleThreads[g.id].msgs;
  if (afterOk.length !== before + 1) throw new Error('someone replied to "ok"');
  await see('Seen by Abdullah');
  await shot('seen-receipt');
  await send('When should we go?', 3800);
  await see('After the 10th works for us.');
  await shot('reply-question');

  step('share a plan into the chat');
  await tool('Share a plan or place');
  await phone.locator('.sheet .city-row', { hasText: 'Two days in AlUla' }).click();
  await page.waitForTimeout(500);
  await scrollEnd();
  await see('Two days in AlUla');
  await shot('shared-plan');
  await phone.locator('.cx-share-card').last().getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(300);
  if (!((await state()).savedPlans || []).includes('alula2')) throw new Error('Save on the plan card did not save');

  step('@Mada with no place asks where, then answers');
  await seed({ friends: ['abdullah', 'noor', 'khalid', 'faris'], groups: DEMO_GROUPS, circleThreads: {}, circleQueue: [] });
  await open('group', { id: 'family' });
  await send('@Mada ideas for a trip', 2400);
  await see('Where are you thinking?');
  await click('Baku', { wait: 2600 });
  await see('Three ideas for Baku');
  await shot('mada-asks-where');

  step('demo circle: vote, book the cruise, split by family settles');
  await back(400);
  await open('group', { id: 'eid' });
  await see('Abdullah’s family is on SV263, Tue 9 Mar');
  await shot('eid-top');
  await scrollEnd();
  await phone.getByRole('button', { name: /^Thu 11 Mar, / }).click();
  await click('Close vote', { wait: 500 });
  await see('Wednesday it is.');
  await phone.locator('.cx-bubble', { hasText: 'Wednesday it is.' }).getByRole('button', { name: 'Book it' }).click();
  await page.waitForTimeout(600);
  await see('Confirmed by Faisal at Mada');
  await see('Remind Abdullah');
  await shot('eid-split');
  await see('Abdullah’s family paid their share · SAR 570', 8000);
  await scrollEnd();
  await shot('eid-settled');

  step('a member leaves on their own');
  await back(400);
  await open('group', { id: 'season' });
  await see('Khalid left the circle', 15000);
  st = await state();
  if (st.groups.find((x) => x.id === 'season').members.includes('khalid')) throw new Error('Khalid still a member');
  await shot('member-left');
  await back(400);
  await toCirclesTab().catch(() => {});
  await shot('circles-seeded');

  step('join by link: a new person sees the trip, flights and the plan');
  await seed(EMPTY);
  await open('join', { code: 'ist-8k2' });
  await shot('invite-preview');
  await click('Join the circle', { wait: 800 });
  await see('Abdullah’s family is on SV263, Tue 9 Mar');
  await see('Book the same flights');
  await see('Pinned plan');
  await shot('joined-circle');
  await scrollEnd();
  await see('You joined from Abdullah’s link');
  await shot('joined-history');
  await click('Book the same flights', { wait: 800 }).catch(async () => { await scrollTop(); await click('Book the same flights', { wait: 800 }); });
  await see('Istanbul');
  await shot('joined-book-same');

  step('join by link when already in the circle: no second copy');
  await seed({ friends: ['abdullah', 'noor', 'khalid', 'faris'], groups: DEMO_GROUPS, circleThreads: {}, circleQueue: [] });
  await open('join', { code: 'ist-8k2' });
  await click('Join the circle', { wait: 800 });
  await see('You’re already in Istanbul for Eid');
  st = await state();
  const copies = st.groups.filter((x) => x.name === 'Istanbul for Eid').length;
  if (copies !== 1) throw new Error(`${copies} Istanbul for Eid circles`);
  await shot('join-dedupe');
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]);
  console.log('FIRST ERROR:', e.message.slice(0, 600));
  await shot('FAILED').catch(() => {});
}
await browser.close();
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nCircles passed with no page errors.');
