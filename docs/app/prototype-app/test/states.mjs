// When things go wrong: every failure state, end to end in headless Chromium.
// Walks the demo panel's "When things go wrong" gallery (which flips the real switches and drives the real screens),
// checks each state says what happened and offers its next step, exercises the recovery (Resume, Send again, Carry on,
// sign back in, Restart…), and screenshots each state at desktop (1200×920, phone frame + demo panel) and at phone
// width (390×844). Fails on any page error.
// Usage: node test/states.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-states';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const step = (t) => console.log('·', t);

/* What each gallery state must say, and what to do after the screenshot to prove the way out works. */
const STATES = [
  { id: 'offline', wait: 900, see: ['Offline · your trips are on this phone', 'Saved on this phone · updated 14 min ago'] },
  { id: 'outbox', wait: 1100, see: ['Waiting to send', 'Queued', 'Didn’t send', 'Send again', 'Discard', 'Works without a connection'],
    after: async (t) => { await t.click('Discard'); await t.see('Discarded. Nothing was sent.'); } },
  { id: 'offline-safe', wait: 1300, see: ['Offline ·'] },
  { id: 'back-online', wait: 2900, see: ['Back online. Sent 2 things you did offline.'] },
  { id: 'weak', wait: 1000, see: ['Weak connection · loading slowly'], extra: { name: 'weak-slow', wait: 3800, see: ['Still working… slower than usual', 'Cancel'] },
    after: async (t) => { await t.click('Cancel'); await t.see('Showing what’s saved on this phone'); } },
  { id: 'down-today', wait: 900, see: ['Can’t reach Mada right now', 'Last updated 14 min ago'] },
  { id: 'down-search', wait: 4200, see: ['We can’t reach our flight search right now.', 'Try again'] },
  { id: 'down-pay', wait: 2600, see: ['We can’t reach payments right now.', 'Nothing was charged.'] },
  { id: 'down-discover', wait: 1100, see: ['Tips can’t load right now.', 'Your trips'] },
  { id: 'maintenance', wait: 900, see: ['Mada is being updated until 03:00.', 'Your trips and Wallet still work offline', 'Talk to Mada by phone'],
    after: async (t) => { await t.click('Open my trips'); await t.see('Maintenance until 03:00'); } },
  { id: 'update', wait: 900, see: ['Update Mada to keep booking.', 'Update Mada'],
    after: async (t) => { await t.click('Update Mada'); await t.see('Updated. You’re on Mada 1.1'); } },
  { id: 'session', wait: 1600, see: ['Sign back in to carry on.', 'What you typed is still here.'],
    after: async (t) => {
      await t.phone.locator('#session-code').fill('123456'); await t.page.waitForTimeout(500);
      await t.see('Signed back in.');
      const kept = await t.phone.locator('#support-msg').inputValue();
      if (!/baby seat/.test(kept)) t.fail('session: the draft was lost');
    } },
  { id: 'rate', wait: 1200, see: ['Let’s take a short pause.', 'You can try again in'] },
  { id: 'crash', wait: 900, see: ['Something broke on our side. Your trips are safe.', 'Restart Mada', 'Talk to Mada'],
    after: async (t) => { await t.click('Restart Mada'); await t.notSee('Something broke on our side'); } },
  { id: 'pay-drop', wait: 2600, see: ['The connection dropped while paying.', 'Nothing was charged. Your price is held for', 'Resume'],
    after: async (t) => { await t.click('Resume', 2600); await t.see('Booking now'); } },
  { id: 'double-tap', wait: 1100, see: ['Already paying. You can only be charged once.'],
    after: async (t) => { await t.page.waitForTimeout(1600); const n = await t.phone.locator('.wait').count(); if (n !== 1) t.fail(`double tap: ${n} booking screens`); } },
  { id: 'closed', wait: 900, see: ['Your Istanbul booking is still with Faisal.'],
    after: async (t) => { await t.phone.locator('.resume-card').click(); await t.page.waitForTimeout(700); await t.see('Booking now'); } },
  { id: 'images', wait: 1400, see: ['Discover'], check: async (t) => { const ok = await t.page.evaluate(() => [...document.querySelectorAll('.phone img')].filter((i) => i.offsetParent && !/airlines/.test(i.dataset.orig || '')).every((i) => /^data:image\/svg/.test(i.getAttribute('src') || ''))); if (!ok) t.fail('images: a photo without its placeholder'); } },
  { id: 'perm-camera', wait: 1900, see: ['The camera is off for Mada.', 'Open Settings', 'Upload a photo instead'] },
  { id: 'perm-contacts', wait: 1500, see: ['Contacts are off for Mada.', 'Share your invite link'] },
  { id: 'perm-location', wait: 1700, see: ['Location is off for Mada.', 'Choose your city instead'] },
  { id: 'perm-alerts', wait: 1500, see: ['Alerts are off for Mada.', 'Get them by SMS instead'] },
  { id: 'not-found', wait: 900, see: ['This link doesn’t go anywhere now.', 'See your trips'] },
  { id: 'timeout', wait: 4200, see: ['The search took too long.', 'Ask Mada to search'],
    after: async (t) => { await t.click('Try again', 4200); await t.see('ways to get there'); } },
  { id: 'supplier', wait: 4200, see: ['Saudia isn’t answering right now.', 'Show the others'] },
  { id: 'chat', wait: 1400, see: ['Didn’t send', 'Send again', '1 didn’t send · open the Outbox'],
    after: async (t) => { await t.click('Send again', 2800); await t.notSee('Didn’t send'); } },
  { id: 'upload', wait: 5200, see: ['Stopped at 62%. The connection dropped.', 'Carry on from 62%'],
    after: async (t) => { await t.click('Carry on from 62%', 1600); await t.see('We found this'); } },
];

async function run(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => { errors.push(`${label} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  await page.goto(pathToFileURL(resolve('dist/index.html')).href);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  const phone = page.locator('.phone');
  const t = {
    page, phone,
    fail: (m) => { errors.push(`${label} ${m}`); console.log('FAIL', label, m); },
    see: async (text) => { const ok = await phone.getByText(text, { exact: false }).first().isVisible().catch(() => false); if (!ok) t.fail(`expected "${text}"`); },
    notSee: async (text) => { const ok = await phone.getByText(text, { exact: false }).first().isVisible().catch(() => false); if (ok) t.fail(`did not expect "${text}"`); },
    click: async (name, wait = 500) => { await phone.getByRole('button', { name, exact: true }).first().click({ timeout: 5000 }).catch((e) => t.fail(`click ${name}: ${e.message.split('\n')[0]}`)); await page.waitForTimeout(wait); },
  };
  const phoneWidth = width < 520;
  const shot = async (n, name) => {
    const path = `${OUT}/${String(n).padStart(2, '0')}-${name}-${phoneWidth ? 'phone' : 'desktop'}.png`;
    if (phoneWidth) {
      await page.evaluate(() => document.querySelectorAll('.gallery-bar, .demo-fab').forEach((el) => { el.style.visibility = 'hidden'; }));
      await page.screenshot({ path });
      await page.evaluate(() => document.querySelectorAll('.gallery-bar, .demo-fab').forEach((el) => { el.style.visibility = ''; }));
    } else await page.screenshot({ path });
  };
  /* Nothing in a failure state may sit under the pill strip's neighbours: the pill must clear the back button. */
  const pillClear = async (id) => {
    const bad = await page.evaluate(() => {
      const pill = document.querySelector('.phone .net-pill');
      if (!pill) return null;
      const p = pill.getBoundingClientRect();
      const hit = [...document.querySelectorAll('.phone .back, .phone .banner, .phone .topbar .icon-btn')].find((el) => { const r = el.getBoundingClientRect(); return r.width && r.top < p.bottom && r.bottom > p.top && r.left < p.right && r.right > p.left; });
      return hit ? hit.className : null;
    });
    if (bad) t.fail(`${id}: the connection pill covers ${bad}`);
  };

  step(`${label}: open the walkthrough from the demo panel`);
  if (phoneWidth) { await page.locator('.demo-fab').click(); await page.waitForTimeout(300); }
  await page.locator('.demo').getByRole('button', { name: /When things go wrong/ }).click();
  for (let i = 0; i < STATES.length; i += 1) {
    const st = STATES[i];
    if (i > 0) await page.locator(phoneWidth ? '.gallery-bar.floating' : '.gallery-bar.in-panel').getByRole('button', { name: /Next state|Done/ }).click();
    const title = await page.locator('.gallery-bar .gb-count').first().textContent();
    if (!title.includes(`${i + 1} of`)) t.fail(`gallery shows "${title}" at step ${i + 1}`);
    await page.waitForTimeout(st.wait);
    step(`${label}: ${st.id}`);
    for (const x of st.see) await t.see(x);
    if (st.check) await st.check(t);
    await pillClear(st.id);
    await shot(i + 1, st.id);
    if (st.extra) {
      await page.waitForTimeout(st.extra.wait);
      for (const x of st.extra.see) await t.see(x);
      await shot(i + 1, st.extra.name);
    }
    if (st.after) await st.after(t);
  }
  await page.locator(phoneWidth ? '.gallery-bar.floating' : '.gallery-bar.in-panel').getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(400);
  const left = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('mada-proto-v1')).demo).filter(([, v]) => v).map(([k]) => k));
  if (left.length) t.fail(`switches left on after Done: ${left.join(', ')}`);

  step(`${label}: every switch on its own, from the panel`);
  const ids = ['Weak connection', 'Server down', 'Maintenance', 'Update required', 'Session expired', 'Too many tries', 'App crashed', 'Connection drops while paying', 'Search times out', 'Messages don’t send', 'Upload stops midway', 'Photos don’t load', 'Permissions turned off', 'Offline'];
  for (const name of ids) {
    if (phoneWidth) { await page.locator('.demo-fab').click(); await page.waitForTimeout(200); }
    const btn = page.locator('.demo').getByRole('button', { name, exact: true });
    await btn.click(); await page.waitForTimeout(250);
    if ((await btn.getAttribute('aria-pressed')) !== 'true') t.fail(`switch ${name} did not turn on`);
    await btn.click(); await page.waitForTimeout(250);
    if (phoneWidth) { await page.locator('.demo-fab').click(); await page.waitForTimeout(200); }
  }
  await page.close();
}

try {
  await run(1200, 920, 'desktop');
  await run(390, 844, 'phone');
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]); console.log('FIRST ERROR:', e.message.slice(0, 600));
}

console.log(errors.length ? '\nPROBLEMS:\n' + errors.join('\n') : '\nEvery failure state passed with no page errors.');
await browser.close();
process.exit(errors.length ? 1 : 0);
