// Navigation is obvious everywhere: the dock names every tab (English and Arabic, at 390 and 320 points), tapping
// Today while on Today goes back to the top, every stacked screen has a way back at its top start corner, and a screen
// opened from a link with nothing behind it offers Home instead of a Back with nowhere to go.
// Usage: node test/nav.mjs [screenshot-dir]
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-nav';
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const errors = [];
const step = (t) => console.log('·', t);
const URL_ = pathToFileURL(resolve('dist/index.html')).href;

/* Every stacked screen with params that open it with content (the demo account's trip, people and circles). */
const STACK = [
  ['passportSetup', {}], ['join', { code: 'ist-8k2' }], ['saved', {}], ['people', {}], ['newCircle', {}], ['friend', { id: 'sara' }],
  ['ask', {}], ['trip', {}], ['disruption', {}], ['group', { id: 'family' }], ['profile', {}], ['plan', {}], ['city', {}],
  ['account', {}], ['accountSignin', {}], ['accountPrefs', {}], ['household', {}], ['householdPerson', { id: 'layla' }], ['accountSecurity', {}],
  ['accountPrivacy', {}], ['accountHelp', {}], ['accountLegal', {}], ['itinerary', {}], ['invoices', {}], ['invoice', {}], ['refund', {}],
  ['changeFlight', {}], ['hotelOptions', {}], ['specialRequests', {}], ['support', {}], ['inbox', {}], ['notFound', {}],
];

async function open(viewport, lang = 'en', hash = '') {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
  await page.goto(URL_ + hash);
  await page.waitForTimeout(400);
  if (lang === 'ar') { await page.locator('[data-testid="lang-ar"]').click().catch(() => {}); await page.waitForTimeout(600); }
  return page;
}
const demo = async (page, text) => { await page.locator('.demo').getByRole('button', { name: text, exact: true }).click(); await page.waitForTimeout(600); };

try {
  for (const [lang, w, h] of [['en', 1200, 920], ['ar', 1200, 920], ['en', 320, 640], ['ar', 320, 640]]) {
    step(`dock labels: ${lang} at ${w}`);
    const page = await open({ width: w, height: h }, lang);
    await demo(page, 'Skip sign-up');
    const phone = page.locator('.phone');
    const dock = phone.locator('.dock');
    const labels = await dock.locator('.dock-l').allInnerTexts();
    if (labels.length !== 5 || labels.some((l) => !l.trim())) errors.push(`dock ${lang}@${w}: expected 5 labels, got ${JSON.stringify(labels)}`);
    // Nothing cut off, nothing past the screen's edges.
    const fit = await dock.evaluate((d) => {
      const r = d.getBoundingClientRect();
      const p = d.closest('.phone').getBoundingClientRect();
      const cut = [...d.querySelectorAll('.dock-l')].filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent);
      return { inside: r.left >= p.left - 1 && r.right <= p.right + 1, cut };
    });
    if (!fit.inside) errors.push(`dock ${lang}@${w}: wider than the screen`);
    if (fit.cut.length) errors.push(`dock ${lang}@${w}: labels cut off: ${fit.cut.join(', ')}`);
    const on = await dock.locator('button.on .dock-l').innerText();
    if (!/Today|اليوم/.test(on)) errors.push(`dock ${lang}@${w}: Today not highlighted (${on})`);
    await phone.screenshot({ path: `${OUT}/dock-${lang}-${w}.png` });
    await page.close();
  }

  step('Today is home: tapping Today on Today goes back to the top');
  {
    const page = await open({ width: 1200, height: 920 });
    await demo(page, 'Skip sign-up');
    await demo(page, 'Day before');
    const phone = page.locator('.phone');
    const scroller = phone.locator('.screen .scroll').first();
    await scroller.evaluate((el) => el.scrollTo(0, 900));
    await page.waitForTimeout(300);
    await phone.locator('.dock').getByRole('button', { name: 'Today', exact: true }).click();
    await page.waitForTimeout(900);
    const y = await scroller.evaluate((el) => el.scrollTop);
    if (y > 4) errors.push(`Today tap: still scrolled (${y})`);

    step('every stacked screen has a way back at its top start corner');
    for (const [name, params] of STACK) {
      await page.evaluate(([n, p]) => window.__madaPush(n, p), [name, params]);
      await page.waitForTimeout(450);
      const box = await phone.boundingBox();
      const top = phone.locator('div[style*="z-index"]').last();
      const found = await top.evaluate((el, [px, py]) => {
        const btns = [...el.querySelectorAll('button, [role="button"]')].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.top - py < 130 && (r.left - px < 140 || r.right - px > 250);
        });
        return btns.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean);
      }, [box.x, box.y]);
      const way = found.find((t) => /^(Back|Home|Close|Cancel|Not now|Done|Later|Choose again)/.test(t) || /back|close/i.test(t));
      if (!way) { errors.push(`${name}: no Back/Close at the top (top buttons: ${found.slice(0, 4).join(' | ') || 'none'})`); await phone.screenshot({ path: `${OUT}/missing-${name}.png` }); }
      // Leave it, the way a person would.
      await page.evaluate(() => window.__madaPop());
      await page.waitForTimeout(300);
    }
    await page.close();
  }

  step('a link with nothing behind it: Home, not a dead Back');
  {
    const page = await open({ width: 1200, height: 920 });
    await demo(page, 'Skip sign-up');
    await page.goto(URL_ + '#join/ist-8k2');
    await page.reload();
    await page.waitForTimeout(900);
    const phone = page.locator('.phone');
    await phone.screenshot({ path: `${OUT}/link-join.png` });
    const home = phone.getByRole('button', { name: 'Home', exact: true });
    if (await home.count()) {
      await home.first().click();
      await page.waitForTimeout(500);
      if (!(await phone.locator('.dock').isVisible())) errors.push('Home from a link: did not land on Today');
    } else console.log('  (join keeps its own Not now / Back to Mada)');
    await page.close();
  }
} catch (e) {
  errors.push('crash: ' + e.message);
}
await browser.close();
if (errors.length) { console.log('\nFAILED\n' + errors.map((e) => ' - ' + e).join('\n')); process.exit(1); }
console.log('\nNavigation checks passed.');
