// العربية: the prototype in Arabic, right to left, through its main journeys, with screenshots.
// Usage: node test/arabic.mjs [screenshot-dir]
//
// Switches to Arabic from the demo panel, then walks onboarding (in Arabic), Today through the trip clock, booking
// from Ask to the slider (dragged right to left) and the wait, the trip, the Wallet, support, Circles, the crash
// screen, and Profile › Language back to English and again to Arabic. Every screenshot is audited: the page must be
// right to left, nothing may run off the side of the phone, and any English left on screen is listed (people's
// names and sample data can stay as written). Fails on page errors, missing Arabic or overflow.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'test/shots-arabic';
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1200, height: 920 }, reducedMotion: 'reduce' });
const errors = [];
const notes = [];
page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); console.log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/Demo crash/.test(m.text()) && !/The above error occurred/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(resolve('dist/index.html')).href);

const phone = page.locator('.phone');
let n = 0;
const step = (t) => console.log('·', t);

/** English that may stay in an Arabic screen: brands, codes, and the sample family's and places' own names. */
const OK = /^([A-Z]{3}|[A-Z0-9]{2}\d{2,4}|VISA|mada|[\w.]+@[\w.]+|Mada|Apple( Pay| Wallet)?|Google|Face ID|Visa|Mastercard|WhatsApp|eSIM|PDF|tabby|tamara|Omar|Hessa|Sara|Ahmed|Lina|Noura|Noor|Abdullah|Khalid|Ahmet|Faisal|Yousef|Faris|Alharbi)( · .*)?$/;

const shot = async (name, { dir = 'rtl' } = {}) => {
  n += 1;
  await page.waitForTimeout(450);
  const file = `${String(n).padStart(2, '0')}-${name}.png`;
  await phone.screenshot({ path: `${OUT}/${file}` });
  const a = await page.evaluate(() => {
    const p = document.querySelector('.phone').getBoundingClientRect();
    const out = { dir: document.documentElement.dir, overflow: [], english: [] };
    const scroller = (el) => { for (let x = el.parentElement; x; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll)/.test(s.overflowX) && x.scrollWidth > x.clientWidth + 2) return true; } return false; };
    const w = document.createTreeWalker(document.querySelector('.phone'), NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const text = t.nodeValue.replace(/[⁦-⁩]/g, '').trim();
      if (!text) continue;
      const el = t.parentElement;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || Number(s.opacity) === 0 || r.bottom < p.top || r.top > p.bottom) continue;
      if ((r.right > p.right + 2 || r.left < p.left - 2) && !scroller(el) && !el.closest('[aria-hidden="true"]')) out.overflow.push(`${text.slice(0, 40)} [${Math.round(r.left - p.left)}..${Math.round(r.right - p.left)}]`);
      if (!/[؀-ۿ]/.test(text) && /[A-Za-z]{2,}/.test(text) && !el.closest('.mrz, .pp-mrz, .pp-wait-mrz, [data-no-translate]')) out.english.push(text.slice(0, 70));
    }
    return out;
  });
  if (a.dir !== dir) errors.push(`${file}: dir is ${a.dir}, expected ${dir}`);
  for (const o of a.overflow) errors.push(`${file}: off the phone: ${o}`);
  const english = dir === 'rtl' ? [...new Set(a.english)].filter((e) => !OK.test(e)) : [];
  if (english.length) notes.push(`${file}: ${english.slice(0, 8).join(' | ')}`);
};
const see = async (text, what, timeout = 6000) => {
  try { await phone.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); return true; }
  catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
};
const tap = async (name, { wait = 400, role = 'button' } = {}) => {
  await phone.getByRole(role, { name, exact: typeof name === 'string' }).filter({ visible: true }).first().click();
  await page.waitForTimeout(wait);
};
const demo = async (text) => {
  if ((await page.locator('.demo-fab').count()) && await page.locator('.demo-fab').isVisible()) await page.locator('.demo-fab').click();
  await page.locator('.demo').getByRole('button', { name: text, exact: true }).click();
  await page.waitForTimeout(700);
};
const dock = async (name) => { await phone.locator('.dock').getByRole('button', { name, exact: false }).first().click(); await page.waitForTimeout(500); };

try {
  step('switch to Arabic from the demo panel');
  await page.locator('[data-testid="lang-ar"]').click({ force: true });
  await page.waitForTimeout(500);
  await see('علينا الباقي.', 'welcome in Arabic');
  await shot('welcome');

  step('onboarding, in Arabic');
  await tap('ابدأ');
  await shot('signin');
  await tap(/استخدم رقم جوالي/);
  await phone.locator('#phone').fill('51234');
  await phone.locator('#phone').blur();
  await see('الرقم يبدو ناقصًا', 'short number');
  await shot('phone-short');
  await phone.locator('#phone').fill('512345678');
  await tap(/أرسلوا لي/);
  await phone.locator('#otp').fill('111111');
  await page.waitForTimeout(300);
  await shot('otp-wrong');
  await phone.locator('#otp').fill('123456');
  await page.waitForTimeout(500);
  await see('بماذا نناديك؟', 'name');
  await phone.locator('#nick').fill('عمر');
  await page.waitForTimeout(200);
  await shot('name');
  await tap(/يلّا نبدأ/, { wait: 600 });
  await see('لن نزعجك إلا حين يهم الأمر.', 'alerts');
  await shot('alerts');
  await tap(/اسمح بالتنبيهات/, { wait: 600 });
  await see('لا وجهة بعد.', 'today, nothing planned');
  await shot('today-new');

  step('Today through the trip clock');
  await demo('Skip sign-up');
  await shot('today-none');
  for (const [label, name, text] of [['Weeks before', 'booked', 'إسطنبول'], ['Day before', 'daybefore', 'إسطنبول'], ['Travel day', 'travelday', 'SV'], ['Delay predicted', 'delayed', 'SV'], ['In the air', 'inair', 'إسطنبول'], ['Landed', 'landed', 'إسطنبول'], ['Back home', 'home', 'إسطنبول']]) {
    await demo(label);
    await see(text, `today ${name}`);
    await shot(`today-${name}`);
  }

  step('booking: Ask to the wait');
  await demo('Skip sign-up');
  await phone.locator('.dock').getByRole('button').nth(2).click();
  await page.waitForTimeout(500);
  await see('إلى أين؟', 'ask');
  await shot('ask');
  await phone.locator('#ask-input').fill('Istanbul for Eid, all of us');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3200);
  await shot('ask-results');
  const review = phone.getByRole('button', { name: /راجع/ }).filter({ visible: true }).last();
  if (await review.count()) { await review.click(); await page.waitForTimeout(800); }
  await see('كل شيء مشمول. لا رسوم لاحقة.', 'order sheet');
  await shot('pay');
  // The slider starts on the right in Arabic and goes left.
  const track = phone.locator('.slider').filter({ visible: true }).last();
  const b = await track.boundingBox();
  if (b) {
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + b.width - 32, y);
    await page.mouse.down();
    for (let i = 1; i <= 14; i += 1) { await page.mouse.move(b.x + b.width - 32 - ((b.width - 40) * i) / 14, y); await page.waitForTimeout(16); }
    await page.mouse.up();
  }
  await page.waitForTimeout(1800);
  await shot('waiting');
  await page.waitForTimeout(4500);
  await shot('confirmed');

  step('the trip');
  await demo('Weeks before');
  await dock('الرحلات');
  await shot('trips');
  await phone.locator('.photo').filter({ visible: true }).first().click();
  await page.waitForTimeout(600);
  await shot('trip');
  await phone.locator('.scroll').filter({ visible: true }).last().evaluate((el) => { el.scrollTop = 900; });
  await page.waitForTimeout(300);
  await shot('trip-manage');

  step('the Wallet');
  await demo('Weeks before');
  await dock('المحفظة');
  await page.waitForTimeout(1800);
  await shot('wallet');

  step('support');
  await demo('Weeks before');
  await phone.locator('.td-avatar, .avatar-btn, [aria-label*="الملف الشخصي"]').filter({ visible: true }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await shot('profile');
  await tap(/المساعدة/, { wait: 600 }).catch(() => {});
  await tap(/مع مادا/, { wait: 800 }).catch(() => {});
  await shot('support');

  step('Circles');
  await demo('Weeks before');
  await dock('المجموعات');
  await page.waitForTimeout(600);
  await shot('discover');
  await phone.getByRole('tab', { name: 'المجموعات' }).first().click().catch(async () => { await phone.getByText('المجموعات', { exact: true }).first().click().catch(() => {}); });
  await page.waitForTimeout(600);
  await shot('circles');

  step('the crash screen: Arabic words, the holding pattern drawn as it is');
  await demo('App crashed');
  await see('نحلّق قليلًا ريثما نعود.', 'crash title');
  await shot('crash');
  await demo('App crashed');
  await page.waitForTimeout(400);

  step('Profile › Language: back to English, then Arabic again');
  await demo('Weeks before');
  await phone.locator('[aria-label*="الملف الشخصي"]').filter({ visible: true }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await tap(/اللغة/, { wait: 500 });
  await shot('language-sheet');
  await tap('English', { wait: 600 });
  await shot('language-english', { dir: 'ltr' });
  await see('Language', 'English again');
  await tap(/العربية/, { wait: 600 });
  await see('اللغة', 'Arabic again');
  await shot('language-arabic');
} catch (e) {
  errors.push(String(e?.stack ?? e));
  console.log(e);
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/audit.txt`, [`${n} screenshots`, '', 'Problems:', ...errors, '', 'English still on screen:', ...notes].join('\n'));
if (notes.length) console.log(`\n${notes.length} screen(s) with English still showing, see ${OUT}/audit.txt`);
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nArabic passed. ${n} screenshots in ${OUT}`);
