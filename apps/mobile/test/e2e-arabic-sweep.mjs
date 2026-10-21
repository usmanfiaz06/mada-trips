// The English-leak sweep: every main screen in Arabic, as a guest and as the demo account, headless Chromium against
// the web export (mock API). Fails on any interface text written only in Latin letters that isn't a name or a code.
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-arabic-sweep.mjs [shot-dir]
//
// What may stay in Latin inside Arabic: brands (Mada's partners, card networks), codes (flight numbers, airports,
// booking references, SAR), times and numbers, e-mail addresses and links, and names as their owners write them
// (people, hotels, airlines, places: words that each start with a capital). Anything with an everyday lowercase word
// ("Book with Mada", "direct", "per night") is a sentence someone forgot to write in Arabic.
//
// Screens: welcome, guest Today, Ask (start, flight results, stay results, the sign-in sheet), a hotel page, a plan,
// Discover, Circles, Trips, Wallet and Talk to Mada as a guest; then signed in: Today, Trips, a trip, the Wallet,
// Profile, the inbox (notifications), Talk to Mada, Circles, an empty state and a toast.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-arabic-sweep');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };
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
const leaks = new Map(); // text → screens
let n = 0;
const step = (s) => console.log('·', s);

/** Brands and words that are names everywhere, in any language. */
const BRANDS = /^(Mada|flynas|flyadeal|Saudia|Apple( Pay| Wallet)?|Google( Maps| Pay)?|Face ID|Touch ID|Visa|Mastercard|American Express|mada|Tabby|WhatsApp|eSIM|PDF|JPEG|PNG|QR|SMS|ETA|GACA|SAR|HBX Group|Hotelbeds|OpenStreetMap|Wikivoyage|Wikipedia|Ticketmaster|English|iPhone|Android|Wi-?Fi|km|kg|min|AM|PM)$/;
/** A name as its owner writes it: every word starts with a capital (or is a joiner like "of", "al", "de"), no sentence. */
const NAME = /^([A-ZÀ-Þ0-9][\w'’.:\-À-ÿ]*|of|al|el|de|da|du|la|le|the|and|&|·|-|–|\/)(\s+([A-ZÀ-Þ0-9][\w'’.:\-À-ÿ]*|of|al|el|de|da|du|la|le|the|and|&|·|-|–|\/))*$/;
/** Codes, times, numbers, prices, addresses with numbers, e-mail, links. */
const CODE = /^([A-Z0-9<•\s]{20,}|©.*|[A-Z0-9]{1,4}[ -]?\d{1,5}|[A-Z]{3}|[A-Z0-9]{5,8}|[\d\s.,:/–\-+×()%°]+|.*@.*\..*|https?:\/\/\S+|[a-z0-9.-]+\.(sa|com|net)(\/\S*)?)$/;

function isLeak(text) {
  const s = text.replace(/[⁦-⁩‎‏]/g, '').trim();
  if (!s || /[؀-ۿ]/.test(s)) return false;
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  if (BRANDS.test(s) || CODE.test(s)) return false;
  // Split on separators the interface uses between names and codes ("Saudia · SV 263", "Galata, Istanbul").
  const parts = s.split(/\s*[·,|→]\s*/).filter(Boolean);
  return parts.some((p) => !(BRANDS.test(p) || CODE.test(p) || NAME.test(p)));
}

async function newPage(locale = 'ar-SA') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  return { context, page };
}

function kit(page) {
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const see = async (text, what, timeout = 12000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  /** Screenshot, then read every visible text on the screen (scrolling the page through) for English. */
  const sweep = async (name, { scrolls = 3 } = {}) => {
    n += 1;
    await page.waitForTimeout(900);
    const file = `${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: join(OUT, file) });
    const seen = new Set();
    for (let i = 0; i <= scrolls; i += 1) {
      const texts = await page.evaluate(() => {
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const el = t.parentElement;
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (!r.width || !r.height || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
          if (r.bottom < 0 || r.top > window.innerHeight) continue;
          // Words the traveller typed or a person wrote (their bubbles, tips) are theirs.
          if (el.closest('[data-testid="ask-query"], [data-testid="ask-fix"], [data-testid="tip-card"], input, textarea')) continue;
          // Marked as written in English by whoever wrote it (a hotel, the desk), with "Translate" beside it; the map's
          // data credit stays as its owners write it.
          if (el.closest('[lang="en"], .maplibregl-ctrl-attrib')) continue;
          out.push(t.textContent);
        }
        for (const el of document.querySelectorAll('[aria-label]')) {
          if (el.closest('[lang="en"], .maplibregl-ctrl-attrib')) continue;
          // A card named by what it shows: when that is someone's own words marked with their language, so is the name.
          if (el.querySelector('[lang="en"]') && [...el.querySelectorAll('[lang="en"]')].some((x) => x.textContent.trim() === el.getAttribute('aria-label').trim())) continue;
          const r = el.getBoundingClientRect();
          if (r.width && r.height && r.bottom > 0 && r.top < window.innerHeight) out.push(el.getAttribute('aria-label'));
        }
        return out;
      });
      for (const t of texts) seen.add(t.trim());
      if (i < scrolls) { await page.mouse.move(195, 420); await page.mouse.wheel(0, 700); await page.waitForTimeout(450); }
    }
    for (const t of seen) if (isLeak(t)) { const k = t.slice(0, 80); leaks.set(k, [...(leaks.get(k) ?? []), name]); }
    await page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll('div')) if (el.scrollTop > 0) el.scrollTop = 0; });
  };
  const ask = async (q) => { await byTest('ask-input').fill(q); await byTest('ask-send').click(); };
  return { byTest, see, sweep, ask };
}

try {
  /* ───────────── as a guest ───────────── */
  {
    const { page, context } = await newPage();
    const k = kit(page);
    step('guest: welcome, Today, Ask');
    await page.goto(ORIGIN + '/');
    await k.see('علينا الباقي.', 'welcome');
    await k.sweep('welcome', { scrolls: 0 });
    await k.byTest('welcome-browse').click();
    await k.see('وين رايح؟', 'guest today');
    await k.sweep('guest-today');
    await k.byTest('dock-ask').click();
    await k.see('وين رايح؟', 'ask');
    await k.sweep('ask-start', { scrolls: 1 });
    await k.ask('إسطنبول في العيد، أنا بس');
    await k.see('ر.س', 'flight prices', 15000);
    await k.sweep('ask-flights');
    await k.byTest('ask-review').click();
    await k.see('سجّل دخولك عشان تحجزه', 'sign-in sheet');
    await k.sweep('signin-sheet', { scrolls: 0 });
    await k.byTest('signin-sheet-later').click();
    await page.goto(ORIGIN + '/ask');
    await k.ask('فندق في إسطنبول ٣ ليالي من ١ مارس');
    await page.waitForTimeout(4000);
    await k.sweep('ask-stays');

    step('guest: hotel, plan, Discover, Circles, Trips, Wallet, Mada');
    await page.goto(ORIGIN + '/hotel/m_mockhotel99701');
    await k.see('Galata Tower Suites', 'hotel');
    await k.sweep('hotel');
    await page.goto(ORIGIN + '/plan/alula2');
    await page.waitForTimeout(2500);
    await k.sweep('plan');
    await page.goto(ORIGIN + '/circles');
    await k.see('هذا الأسبوع في', 'discover', 15000);
    await k.sweep('discover');
    await page.goto(ORIGIN + '/circles?view=circles');
    await k.sweep('circles-guest', { scrolls: 0 });
    await page.goto(ORIGIN + '/trips');
    await k.sweep('trips-guest');
    await page.goto(ORIGIN + '/wallet');
    await k.sweep('wallet-guest', { scrolls: 0 });
    await page.goto(ORIGIN + '/support');
    await k.sweep('support-guest', { scrolls: 0 });
    await context.close();
  }

  /* ───────────── signed in (the demo account) ───────────── */
  {
    const { page, context } = await newPage();
    const k = kit(page);
    step('signed in: Today, Trips, a trip, Wallet, Profile, inbox, Mada, Circles');
    await page.goto(ORIGIN + '/');
    await k.see('علينا الباقي.', 'welcome');
    await k.byTest('welcome-start').click();
    await k.byTest('signin-phone').click();
    await k.byTest('phone-input').fill('500004127');
    await k.byTest('phone-send').click();
    await k.see('اكتب الرمز', 'otp');
    await k.byTest('otp-input').fill('123456');
    if (await k.see('حيّاك الله', 'welcome back', 10000)) await k.byTest('welcome-back-open').click();
    await page.waitForTimeout(2000);
    await k.sweep('today');
    // In-app navigation only: a reload would forget the mock's session (mock builds expose the router as __madaGo).
    await k.byTest('dock-wallet').click();
    await page.waitForTimeout(1500);
    const go = async (path) => { await page.evaluate((p) => window.__madaGo(p), path); await page.waitForTimeout(1800); };
    await go('/trips');
    await page.waitForTimeout(1500);
    await k.sweep('trips');
    const card = page.locator('[data-testid^="trip-card"]').filter({ visible: true }).first();
    if (await card.count()) { await card.click(); await page.waitForTimeout(2000); await k.sweep('trip', { scrolls: 5 }); }
    await go('/trips?tab=requests');
    await page.waitForTimeout(1500);
    await k.sweep('trips-requests');
    await go('/wallet');
    await page.waitForTimeout(2000);
    await k.sweep('wallet', { scrolls: 4 });
    await go('/profile');
    await page.waitForTimeout(1500);
    await k.sweep('profile', { scrolls: 4 });
    await go('/inbox');
    await page.waitForTimeout(1500);
    await k.sweep('inbox', { scrolls: 3 });
    await go('/support');
    await page.waitForTimeout(2000);
    await k.sweep('support', { scrolls: 2 });
    await go('/circles?view=circles');
    await page.waitForTimeout(2000);
    await k.sweep('circles', { scrolls: 3 });
    await go('/saved');
    await page.waitForTimeout(1500);
    await k.sweep('saved');
    step('signed in: a toast, being offline');
    await go('/plan/alula2');
    await page.waitForTimeout(2500);
    await k.byTest('plan-save').click();
    await page.waitForTimeout(500);
    await k.sweep('plan-saved-toast', { scrolls: 0 });
    await go('/today');
    await page.waitForTimeout(2000);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await k.byTest('dock-trips').click().catch(() => {});
    await page.waitForTimeout(2500);
    await k.sweep('offline', { scrolls: 0 });
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await context.close();
  }
} catch (e) {
  errors.push(`crashed: ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser.close();
  server.close();
}

for (const [text, screens] of leaks) errors.push(`English in Arabic (${[...new Set(screens)].join(', ')}): "${text}"`);
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nArabic sweep: no English left on ${n} screens (screenshots in ${OUT}).`);
