// The app in Arabic, right to left, end to end, in headless Chromium against the web export (mock API).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-arabic.mjs [shot-dir]
//
// 1. A phone set to Arabic, first run: the app follows it (dir="rtl", Arabic fonts), through Welcome → Sign in →
//    phone (a short number) → code (one wrong try) → name → alerts → Today; Profile › Language with Arabic-Indic digits
//    and the Hijri date; the tabs.
// 2. The demo account in Arabic: Today through the trip clock, Trips and the trip (itinerary, payments, an invoice),
//    booking from Ask to the order sheet and the slider (dragged right to left) to the confirmation, the Wallet,
//    support, and Circles (Discover, the list, a chat).
// 3. Switching language in Profile restarts into English, and back into Arabic.
//
// Every screenshot is audited: the document must be right to left, nothing may run off the side of the screen, and
// English sentences in the interface are reported (data from suppliers and people, like hotel names and chat
// messages, can stay as written). Fails on any page error, missing text or overflow.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-arabic');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
const notes = [];
let n = 0;
const step = (s) => console.log('·', s);

/** A phone set to Arabic, in Riyadh. Reduced motion keeps entrance animations out of the screenshots. */
async function newPage(locale = 'ar-SA') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  await context.addInitScript(() => { window.print = () => {}; });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });
  return { context, page };
}

/** Interface words that may stay in Latin inside Arabic: brands, codes, people's and hotels' own names from the data. */
const LATIN_OK = /^(Mada|Apple( Pay| Wallet)?|Google( Maps)?|Face ID|Visa|Mastercard|American Express|WhatsApp|eSIM|PDF|JPEG|PNG|JPG|MM\/YY|DD\/MM\/YYYY|Wikivoyage|ETA|QR|GACA|SAR|English|privacy@madatrips\.sa|madatrips\.sa)$/;

function kit(page) {
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  const see = async (text, what, timeout = 9000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  /** Screenshot, then audit what's on screen for right-to-left problems. */
  const shot = async (name, { dir = 'rtl', wait = 700 } = {}) => {
    n += 1;
    await page.waitForTimeout(wait);
    const file = `${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(OUT, file) });
    const a = await page.evaluate(() => {
      const vw = window.innerWidth;
      const out = { dir: document.documentElement.dir, overflow: [], english: [] };
      const scroller = (el) => { for (let x = el.parentElement; x; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll)/.test(s.overflowX) && x.scrollWidth > x.clientWidth + 2) return true; } return false; };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const text = t.textContent.replace(/[⁦-⁩]/g, '').trim();
        if (!text) continue;
        const el = t.parentElement;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (!r.width || !r.height || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        if ((r.right > vw + 2 || r.left < -2) && !scroller(el)) out.overflow.push(`${text.slice(0, 40)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
        if (el.scrollWidth > el.clientWidth + 2 && s.overflow === 'hidden' && s.textOverflow !== 'ellipsis' && !scroller(el)) out.overflow.push(`clipped: ${text.slice(0, 40)}`);
        if (!/[؀-ۿ]/.test(text) && /[A-Za-z]{2,}\W+[A-Za-z]{2,}\W+[A-Za-z]{2,}/.test(text)) out.english.push(text.slice(0, 60));
      }
      return out;
    });
    if (a.dir !== dir) errors.push(`${file}: document dir is ${a.dir}, expected ${dir}`);
    for (const o of a.overflow) errors.push(`${file}: off screen or clipped: ${o}`);
    const english = dir === 'rtl' ? a.english.filter((e) => !LATIN_OK.test(e)) : [];
    if (english.length) notes.push(`${file}: English left in view: ${[...new Set(english)].slice(0, 6).join(' | ')}`);
  };
  const scroll = async (px = 700) => { await page.mouse.move(195, 420); await page.mouse.wheel(0, px); await page.waitForTimeout(500); };
  const back = async () => { const b = page.getByRole('button', { name: /^(رجوع|أغلق|إغلاق)$/ }).filter({ visible: true }); if (await b.count()) { await b.first().click(); await page.waitForTimeout(600); return true; } return false; };
  const tapText = async (text) => { await page.getByText(text, { exact: false }).first().click(); await page.waitForTimeout(500); };
  /** Drag the sun across the slider. In Arabic it starts at the right and goes left. */
  const slide = async () => {
    const track = page.locator('[role="slider"]').last();
    await track.waitFor({ state: 'visible', timeout: 8000 });
    const b = await track.boundingBox();
    const y = b.y + b.height / 2;
    const from = b.x + b.width - 30;
    await page.mouse.move(from, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) { await page.mouse.move(from - ((b.width - 40) * i) / 12, y); await page.waitForTimeout(16); }
    await page.mouse.up();
  };
  /** Back to a screen with the dock (the app's state lives in the page, so no reloads). */
  const toTabs = async () => {
    for (let i = 0; i < 6; i += 1) {
      if (await page.locator('[data-testid="dock-today"]').filter({ visible: true }).count()) return;
      if (!(await back())) {
        const done = page.getByRole('button', { name: /^(اعرض الرحلة|تم)$/ }).filter({ visible: true });
        if (await done.count()) { await done.first().click(); await page.waitForTimeout(800); } else { await page.goBack(); await page.waitForTimeout(800); }
      }
    }
  };
  return { byTest, see, shot, scroll, back, tapText, slide, toTabs };
}

async function phase(page, p) {
  const { byTest } = kit(page);
  await byTest('dock-today').click().catch(() => {});
  await page.waitForTimeout(600);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll('div')) if (el.scrollTop > 0) el.scrollTop = 0; });
    await page.waitForTimeout(400);
    const date = byTest('today-date').first();
    await date.waitFor({ state: 'visible', timeout: 15000 });
    await date.click({ delay: 800 });
    try { await byTest(`demo-${p}`).waitFor({ state: 'visible', timeout: 3000 }); break; } catch { /* the long press didn't land */ }
  }
  await byTest(`demo-${p}`).click();
  await page.waitForTimeout(1500);
}

async function signInDemo(page) {
  const { byTest, see } = kit(page);
  await page.goto(ORIGIN + '/');
  await see('علينا الباقي.', 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await see('أدخل الرمز', 'otp');
  await byTest('otp-input').fill('123456');
  if (await see('أهلًا بعودتك', 'welcome back', 8000)) await byTest('welcome-back-open').click();
  await page.waitForTimeout(1500);
}

/* ───────────── 1. first run on an Arabic phone ───────────── */
async function firstRun() {
  const { context, page } = await newPage('ar-SA');
  const { byTest, see, shot, back } = kit(page);
  step('first run follows the phone: Arabic, right to left');
  await page.goto(ORIGIN + '/');
  await see('علينا الباقي.', 'welcome title');
  await see('قل لنا وجهتك.', 'welcome body');
  await page.evaluate(() => document.fonts.ready);
  const font = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(','));
  if (!/InterTight_400Regular/.test(font)) errors.push(`fonts: ${font}`);
  await shot('welcome');

  step('sign in, phone, code');
  await byTest('welcome-start').click();
  await page.waitForTimeout(800);
  await shot('signin');
  await byTest('signin-phone').click();
  await see('رقم جوالك', 'phone');
  const input = byTest('phone-input');
  await input.fill('50 12');
  await input.blur();
  await see('الرقم يبدو ناقصًا.', 'short number');
  await shot('phone-short');
  await input.fill(`5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`);
  await byTest('phone-send').click();
  await see('أدخل الرمز', 'otp');
  await byTest('otp-input').fill('000000');
  await page.waitForTimeout(800);
  await shot('otp-wrong');
  await byTest('otp-input').fill('123456');

  step('name and alerts');
  await see('بماذا نناديك؟', 'name');
  await byTest('name-input').fill('عمر');
  await see('يلّا نبدأ يا عمر', 'name button');
  await shot('name');
  await byTest('name-go').click();
  await see('لن نزعجك إلا حين يهم الأمر.', 'alerts');
  await page.waitForTimeout(2200);
  await shot('alerts');
  await byTest('alerts-allow').click();

  step('today');
  await see('لا وجهة بعد.', 'today');
  await see('إلى أين بعدها؟', 'composer');
  await shot('today');

  step('profile › language: digits and the Hijri date');
  await byTest('today-avatar').click();
  await page.waitForURL(/\/profile/, { timeout: 8000 });
  await see('العربية', 'language row shows Arabic');
  await shot('profile');
  await byTest('profile-language').click();
  await see('الأرقام والتواريخ', 'display settings');
  await shot('language-sheet');
  await byTest('lang-digits').click();
  await byTest('lang-hijri').click();
  await page.waitForTimeout(500);
  await shot('language-digits-hijri');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await back();
  await page.waitForTimeout(800);
  await shot('today-arabic-digits');
  // Back to Western digits for the rest of the walk.
  await byTest('today-avatar').click();
  await byTest('profile-language').click();
  await byTest('lang-digits').click();
  await byTest('lang-hijri').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await back();

  step('tabs');
  await byTest('dock-trips').click();
  await see('اسمك ليس على اللوحة بعد.', 'trips empty');
  await shot('trips-empty');
  await byTest('dock-circles').click();
  await see('هذا الأسبوع في', 'discover');
  await shot('circles-discover-empty');
  await byTest('dock-wallet').click();
  await page.waitForTimeout(1500);
  await shot('wallet-empty');
  await byTest('dock-ask').click();
  await see('إجابات فورية من مادا.', 'ask disclosure');
  await shot('ask-empty');
  await context.close();
}

/* ───────────── 2. the demo account in Arabic ───────────── */
async function demo() {
  const { context, page } = await newPage('ar-SA');
  const { byTest, see, shot, scroll, back, tapText, slide, toTabs } = kit(page);
  step('demo: sign in');
  await signInDemo(page);

  for (const [p, text] of [['booked', 'إسطنبول'], ['daybefore', 'إسطنبول'], ['travelday', 'SV263'], ['delayed', 'SV263'], ['cancelled', 'ألغت'], ['inair', 'إسطنبول'], ['landed', 'إسطنبول'], ['home', 'حمدًا لله على السلامة.']]) {
    step(`today: ${p}`);
    await phase(page, p);
    await see(text, `today ${p}`);
    await shot(`today-${p}`);
    if (['booked', 'travelday', 'landed'].includes(p)) { await scroll(700); await shot(`today-${p}-more`); }
  }
  await phase(page, 'booked');

  step('trips and the trip');
  await byTest('dock-trips').click();
  await page.waitForTimeout(900);
  await shot('trips');
  await byTest('trip-card-Istanbul').first().click();
  await see('إدارة', 'trip manage');
  await shot('trip');
  await scroll(800);
  await shot('trip-manage');
  await tapText('المدفوعات والفواتير');
  await see('المدفوعات', 'payments');
  await shot('payments');
  await back();
  await tapText('برنامج الرحلة كاملًا');
  await see('يومًا بيوم', 'itinerary');
  await shot('itinerary');
  await back();
  await tapText('غيّر الرحلة');
  await see('ماذا تريد أن تغيّر؟', 'change flight');
  await shot('change-flight');
  await back();
  await back();

  step('booking: Ask to the confirmation');
  await byTest('dock-ask').click();
  await see('إلى أين؟', 'ask');
  await byTest('ask-input').fill('Istanbul for Eid, all of us');
  await byTest('ask-send').click();
  await see('ثلاث طرق للوصول.', 'results', 15000);
  await shot('results');
  await byTest('ask-review').first().click();
  await see('كل شيء مشمول. لا رسوم لاحقة.', 'pay sheet', 12000);
  await shot('pay-sheet');
  await scroll(500);
  await shot('pay-sheet-slider');
  await slide();
  await page.waitForTimeout(1500);
  if (await page.getByText('بنكك يريد التأكد أنه أنت').count()) {
    await shot('3ds');
    await page.locator('input').last().fill('123456');
  }
  await see('نحجز الآن', 'waiting', 12000);
  await shot('waiting');
  await see('مؤكدة', 'confirmed', 60000);
  await shot('confirmed');

  step('wallet');
  await toTabs();
  await byTest('dock-wallet').click();
  await see('المحفظة', 'wallet');
  await page.waitForTimeout(2500);
  await shot('wallet');
  await scroll(1200);
  await shot('wallet-money');

  step('support');
  await toTabs();
  await byTest('dock-today').click();
  await page.waitForTimeout(600);
  await byTest('today-avatar').click();
  await page.waitForURL(/\/profile/, { timeout: 8000 });
  await shot('profile-demo');
  await byTest('profile-help').click();
  await see('أسئلة متكررة', 'help');
  await shot('help');
  await byTest('help-talk').click();
  await see('إجابات فورية من مادا.', 'support disclosure');
  await shot('support');
  await byTest('topic-bag').click();
  await see('نأسف على الحقيبة.', 'bag reply');
  await shot('support-bag');

  step('circles');
  await toTabs();
  await byTest('dock-circles').click();
  await see('هذا الأسبوع في', 'discover');
  await shot('discover');
  await page.getByText('المجموعات', { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(900);
  await shot('circles');
  await page.getByRole('button', { name: 'Istanbul for Eid' }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  await shot('circle-chat');
  await context.close();
}

/**
 * The web build's mock API lives in the page, so a restart forgets the session: Mada asks to sign back in (on a phone
 * the server keeps it). Sign back in with the demo code.
 */
async function signBackIn(page) {
  const { byTest } = kit(page);
  const again = byTest('reauth-send').filter({ visible: true });
  try { await again.waitFor({ state: 'visible', timeout: 5000 }); } catch { return; }
  await again.click();
  await page.waitForTimeout(1000);
  if (await byTest('signin-phone').filter({ visible: true }).count()) {
    await byTest('signin-phone').click();
    await byTest('phone-input').fill('500004127');
    await byTest('phone-send').click();
  }
  const otp = byTest('reauth-code').or(byTest('otp-input')).filter({ visible: true }).first();
  await otp.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (await otp.count()) await otp.fill('123456');
  const verify = byTest('reauth-verify').filter({ visible: true });
  if (await verify.count()) await verify.click().catch(() => {});
  const open = byTest('welcome-back-open');
  await open.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if (await open.count()) await open.click();
  await page.waitForTimeout(1500);
}

/* ───────────── 3. switching language restarts the app ───────────── */
async function switching() {
  const { context, page } = await newPage('ar-SA');
  const { byTest, see, shot } = kit(page);
  step('switch: Arabic → English → Arabic');
  await signInDemo(page);
  await byTest('today-avatar').click();
  await page.waitForURL(/\/profile/, { timeout: 8000 });
  await byTest('profile-language').click();
  await byTest('lang-en').click();
  await see('نعيد تشغيل مادا بالإنجليزية؟', 'restart sheet');
  await shot('language-restart');
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), byTest('lang-restart-go').click()]);
  await page.waitForTimeout(2500);
  await shot('english-after-switch', { dir: 'ltr' });
  await signBackIn(page);
  await shot('english-signed-back-in', { dir: 'ltr' });
  if (!(await byTest('profile-language').filter({ visible: true }).count())) { await byTest('today-avatar').click(); await page.waitForURL(/\/profile/, { timeout: 8000 }); }
  await byTest('profile-language').click();
  await byTest('lang-ar').click();
  await see('Restart Mada in Arabic?', 'restart in Arabic');
  await shot('language-restart-en', { dir: 'ltr' });
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), byTest('lang-restart-go').click()]);
  await page.waitForTimeout(2500);
  await see('اللغة', 'Arabic again', 15000);
  await shot('arabic-again');
  await signBackIn(page);
  await shot('arabic-again-signed-in');
  await context.close();
}

try {
  const only = process.env.ONLY;
  if (!only || only === 'first') await firstRun();
  if (!only || only === 'demo') await demo();
  if (!only || only === 'switch') await switching();
} catch (e) {
  errors.push(String(e?.stack ?? e));
  console.log(e);
} finally {
  await browser.close();
  server.close();
}

writeFileSync(join(OUT, 'audit.txt'), [`${n} screenshots`, '', 'Problems:', ...errors, '', 'Notes (English still in view, mostly data):', ...notes].join('\n'));
if (notes.length) console.log(`\n${notes.length} note(s), see ${join(OUT, 'audit.txt')}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nArabic passed. ${n} screenshots in ${OUT}`);
