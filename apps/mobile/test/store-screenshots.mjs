// Store screenshots, in English and Arabic, from the web export in mock mode (docs/app/LAUNCH.md).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   npm run store:screenshots [-- out-dir]            (DIST=<export dir> to use another export)
//
// 1. Signs in as the demo account (+966 50 000 4127, the Istanbul family trip) and captures six hero screens on a
//    430×932 phone at 3× (Today on travel day, Ask with results, the trip, the delay plan, the Wallet, Mada's desk).
// 2. Puts each into a branded frame (Mada green, the sun, the caption from docs/app/store/listing.json) at every size
//    the stores take:
//      ios-6.9   1320×2868  App Store 6.9" (iPhone 16/17 Pro Max), the one size App Store Connect requires
//      ios-6.5   1284×2778  App Store 6.5" (older Pro Max), optional; App Store Connect scales 6.9" if missing
//      play      1080×1920  Google Play phone (9:16)
//    plus the Play feature graphic (1024×500) per language. iPad is skipped: the app is iPhone only.
// 3. Writes JPEGs (no transparency, small enough to upload) to docs/app/store/screenshots/<lang>/<size>/ and a
//    contact sheet per language to docs/app/store/screenshots/<lang>-overview.jpg. The size folders are gitignored;
//    the overviews are committed so the set can be reviewed without running this.
// Fails on any page error or a hero screen that didn't load.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const DIST = resolve(process.env.DIST ?? join(here, '..', 'dist'));
const OUT = resolve(process.argv[2] ?? join(repo, 'docs/app/store/screenshots'));
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LANGS = (process.env.LANGS ?? 'en,ar').split(',');
const listing = JSON.parse(readFileSync(join(repo, 'docs/app/store/listing.json'), 'utf8'));
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist`);

const SIZES = [
  { id: 'ios-6.9', w: 1320, h: 2868 },
  { id: 'ios-6.5', w: 1284, h: 2778 },
  { id: 'play', w: 1080, h: 1920 },
];
const PHONE = { width: 430, height: 932 };
const DEMO_AR = 'تجربة'; // 'ask.demo.open' in Arabic

/* ───────── serve the export ───────── */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
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
const step = (s) => console.log('·', s);

/* ───────── 1. the app screens ───────── */
const WORDS = {
  en: { welcome: "We'll take it from here.", otp: 'Enter the code', back: 'Welcome back', where: 'Where to?', results: 'ways to get there', wallet: 'Wallet', disclosure: 'Mada', trip: 'Manage', delay: 'hours late' },
  ar: { welcome: 'علينا الباقي.', otp: 'اكتب الرمز', back: 'حيّاك الله', where: 'وين رايح؟', results: 'ثلاث طرق توصلك.', wallet: 'المحفظة', disclosure: 'مادا', trip: 'إدارة', delay: 'ساعات' },
};

async function freshPage(lang) {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: lang === 'ar' ? 'ar-SA' : 'en-GB', timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  await context.addInitScript(() => { window.print = () => {}; });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${lang} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).first();
  const see = async (text, what, timeout = 12000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { return false; }
  };
  const w = WORDS[lang];
  await page.goto(ORIGIN + '/');
  if (!(await see(w.welcome, 'welcome', 20000))) throw new Error(`${lang}: the welcome screen didn't load`);
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await see(w.otp, 'otp');
  await byTest('otp-input').fill('123456');
  if (await see(w.back, 'welcome back', 8000)) await byTest('welcome-back-open').click();
  await page.waitForTimeout(1500);
  return { context, page, byTest, see, w };
}

async function phase({ page, byTest }, p) {
  await byTest('dock-today').click().catch(() => {});
  await page.waitForTimeout(600);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll('div')) if (el.scrollTop > 0) el.scrollTop = 0; });
    await page.waitForTimeout(400);
    const date = byTest('today-date');
    await date.waitFor({ state: 'visible', timeout: 15000 });
    await date.click({ delay: 800 });
    try { await page.locator(`[data-testid="demo-${p}"]`).first().waitFor({ state: 'visible', timeout: 3000 }); break; } catch { /* the long press didn't land: again */ }
  }
  await page.locator(`[data-testid="demo-${p}"]`).first().click();
  await page.waitForTimeout(1800);
}

/** Each hero screen from a fresh sign-in, so one screen's state never leaks into the next. Returns a PNG buffer. */
const SCREENS = {
  async today(k) {
    await phase(k, 'travelday');
    return k.see('SV263', 'today');
  },
  async ask(k) {
    await phase(k, 'booked');
    await k.byTest('dock-ask').click();
    await k.see(k.w.where, 'ask');
    // The mock reads English requests only; the Arabic screen answers in Arabic either way.
    await k.byTest('ask-input').fill('Istanbul for Eid, all of us');
    await k.byTest('ask-send').click();
    const ok = await k.see(k.w.results, 'results', 20000);
    await k.page.waitForTimeout(1500);
    return ok;
  },
  async trip(k) {
    await phase(k, 'booked');
    await k.byTest('dock-trips').click();
    await k.page.waitForTimeout(900);
    await k.page.locator('[data-testid="trip-card-Istanbul"]').first().click();
    return k.see(k.w.trip, 'trip');
  },
  async disruption(k) {
    await phase(k, 'delayed');
    await k.page.locator('[data-testid="see-plan"]').first().click();
    await k.page.waitForTimeout(1200);
    return k.see(k.w.delay, 'delay plan');
  },
  async wallet(k) {
    await phase(k, 'booked');
    await k.byTest('dock-wallet').click();
    const ok = await k.see(k.w.wallet, 'wallet');
    await k.page.waitForTimeout(2500);
    return ok;
  },
  async support(k) {
    await phase(k, 'booked');
    await k.byTest('today-avatar').click();
    await k.page.waitForURL(/\/profile/, { timeout: 8000 });
    await k.byTest('profile-help').click();
    await k.page.waitForTimeout(800);
    await k.byTest('help-talk').click();
    await k.page.waitForTimeout(1200);
    return k.see(k.w.disclosure, 'support');
  },
};

async function capture(lang, id) {
  const k = await freshPage(lang);
  try {
    const ok = await SCREENS[id](k);
    if (!ok) errors.push(`${lang} ${id}: the screen didn't show what it should`);
    await k.page.waitForTimeout(800);
    // The mock build's demo controls are for design work, not the store.
    await k.page.evaluate((words) => {
      for (const el of document.querySelectorAll('[role="button"], button')) if (words.includes(el.textContent?.trim() ?? '')) el.style.visibility = 'hidden';
      // Today's "Showing: Travel day" line from the demo panel ('td.demo.showing').
      for (const el of document.querySelectorAll('div')) if (el.childElementCount === 0 && /^(Showing: |المعروض: )/.test(el.textContent ?? '')) el.style.visibility = 'hidden';
    }, ['Demo', DEMO_AR]);
    return await k.page.screenshot({ type: 'png' });
  } finally {
    await k.context.close();
  }
}

/* ───────── 2. the branded frame ───────── */
const fontData = (pkg, file) => {
  const p = join(repo, 'node_modules/@expo-google-fonts', pkg, file);
  return existsSync(p) ? `data:font/ttf;base64,${readFileSync(p).toString('base64')}` : null;
};
const thmanyahDir = join(here, '..', 'assets/fonts/thmanyah');
const thmanyah = existsSync(join(thmanyahDir, 'thmanyahsans-Bold.otf')) ? `data:font/otf;base64,${readFileSync(join(thmanyahDir, 'thmanyahsans-Bold.otf')).toString('base64')}` : null;
const FONTS = `
@font-face { font-family: 'Caption'; src: url(${fontData('inter-tight', '600SemiBold/InterTight_600SemiBold.ttf')}); }
@font-face { font-family: 'CaptionSerif'; src: url(${fontData('instrument-serif', '400Regular/InstrumentSerif_400Regular.ttf')}); }
@font-face { font-family: 'CaptionAr'; src: url(${thmanyah ?? fontData('ibm-plex-sans-arabic', '600SemiBold/IBMPlexSansArabic_600SemiBold.ttf')}); }`;
const SUN = readFileSync(join(here, '..', 'scripts', 'make-icons.mjs'), 'utf8').match(/const SUN = `([^`]+)`/)[1];

function framePage({ w, h, lang, caption, shotUrl, index }) {
  const ar = lang === 'ar';
  const phoneH = Math.round(h * (w / h > 0.5 ? 0.66 : 0.71));
  const phoneW = Math.round(phoneH * (PHONE.width / PHONE.height));
  const bezel = Math.round(phoneW * 0.035);
  const radius = Math.round(phoneW * 0.13);
  const capSize = Math.round(w * (ar ? 0.066 : 0.07));
  const tilt = index % 2 ? -1 : 1;
  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${FONTS}
  html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}
  body{background:radial-gradient(120% 70% at ${50 + 20 * tilt}% 0%, #2c4a3f 0%, #1e352d 45%, #10201a 100%);font-family:${ar ? "'CaptionAr'" : "'Caption'"},sans-serif;color:#f6f2ec;position:relative}
  .sun{position:absolute;width:${Math.round(w * 0.9)}px;left:${Math.round(w * 0.05)}px;top:${Math.round(h * 0.47)}px;opacity:.07}
  .cap{position:absolute;left:${Math.round(w * 0.08)}px;right:${Math.round(w * 0.08)}px;top:${Math.round(h * 0.06)}px;text-align:center}
  .cap h1{margin:0;font-size:${capSize}px;line-height:1.12;font-weight:600;letter-spacing:${ar ? 0 : '-0.02em'};text-wrap:balance}
  .brand{display:flex;justify-content:center;align-items:center;gap:${Math.round(w * 0.014)}px;margin-bottom:${Math.round(h * 0.022)}px;color:#d9b77a;font-size:${Math.round(w * 0.03)}px;letter-spacing:${ar ? 0 : '0.18em'};text-transform:uppercase}
  .brand svg{width:${Math.round(w * 0.06)}px}
  .phone{position:absolute;left:50%;bottom:${Math.round(h * 0.045)}px;width:${phoneW}px;height:${phoneH}px;transform:translateX(-50%);border-radius:${radius}px;background:#0b1511;padding:${bezel}px;box-sizing:border-box;box-shadow:0 ${Math.round(h * 0.02)}px ${Math.round(h * 0.05)}px rgba(0,0,0,.45), inset 0 0 0 2px rgba(255,255,255,.08)}
  .phone img{display:block;width:100%;height:100%;border-radius:${radius - bezel}px;object-fit:cover}
  </style></head><body>
  <svg class="sun" viewBox="0 0 132.31 88.61">${SUN.replace('fill="#d9b77a"', 'fill="#f6f2ec"')}</svg>
  <div class="cap"><div class="brand"><svg viewBox="0 0 132.31 88.61">${SUN}</svg><span>${ar ? 'مادا' : 'Mada Trips'}</span></div><h1>${caption}</h1></div>
  <div class="phone"><img src="${shotUrl}"></div>
  </body></html>`;
}

function featurePage(lang) {
  const l = listing.locales[lang];
  const ar = lang === 'ar';
  return `<!doctype html><html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${FONTS}
  html,body{margin:0;width:1024px;height:500px;overflow:hidden}
  body{background:radial-gradient(90% 120% at ${ar ? '85%' : '15%'} 10%, #2c4a3f 0%, #1e352d 50%, #10201a 100%);color:#f6f2ec;font-family:${ar ? "'CaptionAr'" : "'Caption'"},sans-serif;display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box}
  svg{width:250px;flex:none}
  h1{margin:0 0 14px;font-size:${ar ? 66 : 70}px;line-height:1;font-weight:600;letter-spacing:${ar ? 0 : '-0.03em'}}
  p{margin:0;font-size:30px;line-height:1.3;color:#d9b77a}
  </style></head><body><svg viewBox="0 0 132.31 88.61">${SUN}</svg><div><h1>${l.name}</h1><p>${l.subtitle}</p></div></body></html>`;
}

async function render(html, w, h, file) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
  await page.close();
}

/* ───────── 3. run ───────── */
const made = [];
try {
  for (const lang of LANGS) {
    const l = listing.locales[lang];
    const shots = [];
    for (const [i, s] of l.screenshots.entries()) {
      step(`${lang}: ${s.id}`);
      const png = await capture(lang, s.id);
      shots.push({ ...s, url: `data:image/png;base64,${png.toString('base64')}` });
      for (const size of SIZES) {
        const file = join(OUT, lang, size.id, `${String(i + 1).padStart(2, '0')}-${s.id}.jpg`);
        await render(framePage({ ...size, lang, caption: s.caption, shotUrl: shots[i].url, index: i }), size.w, size.h, file);
        made.push(file);
      }
    }
    const feature = join(OUT, lang, 'play', 'feature-graphic.jpg');
    await render(featurePage(lang), 1024, 500, feature);
    made.push(feature);

    // A contact sheet of the 6.9" set, small enough to commit and review in a pull request.
    const tiles = l.screenshots.map((s, i) => `<img src="data:image/jpeg;base64,${readFileSync(join(OUT, lang, 'ios-6.9', `${String(i + 1).padStart(2, '0')}-${s.id}.jpg`)).toString('base64')}">`).join('');
    const sheet = `<!doctype html><html dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><body style="margin:0;background:#e9e2d8;display:flex;gap:16px;padding:16px;width:${6 * 264 + 7 * 16}px;box-sizing:border-box">${tiles.replaceAll('<img ', '<img style="width:264px;height:574px;border-radius:12px" ')}</body></html>`;
    await render(sheet, 6 * 264 + 7 * 16, 574 + 32, join(OUT, `${lang}-overview.jpg`));
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${made.length} images in ${OUT}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s):\n${errors.map((e) => `  ✖ ${e}`).join('\n')}`);
  process.exit(1);
}
