// What Mada remembers (docs/app/ASK-CHAT.md §7), end to end in headless Chromium against the mock web export:
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-memory.mjs [shot-dir]
//
// Signs in as the demo account in English and in Arabic, opens Profile → What Mada remembers, screenshots it
// (docs/app/screens/memory-en.png and memory-ar.png when SHOTS_DOCS=1), removes one thing, then forgets everything.
// Fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-memory');
const DOCS = process.env.SHOTS_DOCS === '1' ? resolve('../../docs/app/screens') : null;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };
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

const L = {
  en: { locale: 'en-GB', welcome: "We'll take it from here.", start: 'welcome-start', code: 'Enter the code', back: 'Welcome back', title: 'What Mada remembers', fact: 'Aisle seat', removed: 'Removed.', sure: 'Forget everything Mada remembers?', empty: 'Nothing yet.' },
  ar: { locale: 'ar-SA', welcome: 'علينا الباقي.', start: 'welcome-signin', code: 'اكتب الرمز', back: 'حيّاك الله', title: 'وش تتذكر مادا', fact: 'مقعد على الممر', removed: 'انشال.', sure: 'تبي مادا تنسى كل شي تتذكره؟', empty: 'للحين ما فيه شي.' },
};

async function run(lang) {
  const w = L[lang];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: w.locale, timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${lang} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const see = async (text, what, timeout = 10000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${lang} ${what}: expected "${text}"`); console.log('MISSING', lang, what, '→', text); return false; }
  };
  const press = async (id) => { const l = byTest(id); await l.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); await l.click(); };

  await page.goto(ORIGIN + '/');
  await see(w.welcome, 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest(w.start).click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await see(w.code, 'otp');
  await byTest('otp-input').fill('123456');
  if (await see(w.back, 'welcome back', 8000)) await byTest('welcome-back-open').click();
  await page.waitForTimeout(1500);

  await byTest('today-avatar').click();
  await page.waitForURL(/\/profile/, { timeout: 8000 });
  await press('profile-memory');
  await see(w.title, 'title');
  await see(w.fact, 'a fact');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `memory-${lang}.png`) });
  if (DOCS) { mkdirSync(DOCS, { recursive: true }); await page.screenshot({ path: join(DOCS, `memory-${lang}.png`) }); }

  // Remove one: it goes, the rest stay.
  await page.locator('[data-testid^="memory-remove-"]').filter({ visible: true }).nth(1).click();
  await see(w.removed, 'removed toast');
  await page.waitForTimeout(400);
  if (await page.getByText(w.fact, { exact: true }).filter({ visible: true }).count()) errors.push(`${lang}: the removed fact is still there`);
  // Forget everything, behind a sheet.
  await press('memory-forget-all');
  await see(w.sure, 'forget sheet');
  await press('memory-forget-confirm');
  await see(w.empty, 'empty');
  await page.screenshot({ path: join(OUT, `memory-${lang}-empty.png`) });
  await context.close();
}

try {
  await run('en');
  await run('ar');
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error(`\n${errors.length} problem(s):\n${errors.join('\n')}`); process.exit(1); }
console.log('memory e2e: ok');
