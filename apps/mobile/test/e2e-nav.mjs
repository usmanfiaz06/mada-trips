// The wake-up alarm on the day before, and navigation that never leaves you guessing, in headless Chromium against
// the web export (mock API):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-nav.mjs [shot-dir]
//
// English then Arabic: the wake row off, on, a changed time, "How it works"; the dock with a name under every tab at
// 390 and 320 points; tapping Today on Today goes back to the top; a screen opened from a link offers Home.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-nav');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}.`);

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

async function run(lang) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'ar' ? 'ar-SA' : 'en-GB', timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  await context.addInitScript(() => { window.print = () => {}; });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${lang} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: join(OUT, `${lang}-${name}.png`) }); };
  const see = async (text, what, timeout = 8000) => {
    try { await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${lang} ${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  const T = (en, ar) => (lang === 'ar' ? ar : en);

  step(`${lang}: sign in as the demo account`);
  await page.goto(ORIGIN + '/');
  await byTest('welcome-start').click({ timeout: 20000 });
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await byTest('otp-input').fill('123456');
  try { await byTest('welcome-back-open').click({ timeout: 6000 }); } catch { /* straight in */ }
  await page.waitForTimeout(1500);

  step(`${lang}: the day before`);
  for (let i = 0; i < 4; i += 1) {
    await byTest('today-date').first().click({ delay: 800 });
    try { await byTest('demo-daybefore').waitFor({ state: 'visible', timeout: 3000 }); break; } catch { /* again */ }
  }
  await byTest('demo-daybefore').click();
  await page.waitForTimeout(1500);

  step(`${lang}: the wake-up alarm, off until turned on`);
  const row = byTest('wake-row');
  await row.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 120);
  await see(T('Wake-up alarm is off', 'منبّه الاستيقاظ متوقف'), 'wake off');
  await shot('wake-off');
  const sw = byTest('wake-switch');
  await (await sw.locator('input').count() ? sw.locator('input').first() : sw).click();
  await see(T('weather and drive time', 'الطقس ومدة الطريق'), 'wake on');
  await see(T('Nothing rings in the browser', 'لا شيء يرنّ في المتصفح'), 'web line');
  await shot('wake-on');

  step(`${lang}: change the time`);
  await byTest('wake-change').click();
  await byTest('wake-earlier').click();
  await byTest('wake-earlier').click();
  await see(T('min before you leave', 'قبل خروجك'), 'minutes before leaving');
  await shot('wake-time-sheet');
  await byTest('wake-save').click();
  await see(T('This phone wakes you at', 'هذا الجوال يوقظك'), 'toast after time change');
  await shot('wake-time-changed');

  step(`${lang}: how it works`);
  await byTest('wake-how-link').click();
  await see(T('iPhone with iOS 26 or later', 'آيفون بنظام'), 'how sheet');
  await shot('wake-how');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const close = page.getByRole('button', { name: T('Okay', 'حسنًا') });
  if (await close.count()) await close.last().click().catch(() => {});
  await page.waitForTimeout(400);
  await (await sw.locator('input').count() ? sw.locator('input').first() : sw).click();
  await see(T('Wake-up alarm is off', 'منبّه الاستيقاظ متوقف'), 'wake off again');

  step(`${lang}: Today is home: tapping Today on Today goes back to the top`);
  const scrolled = await byTest('today-scroll').evaluate((el) => el.scrollTop);
  if (scrolled < 50) errors.push(`${lang}: Today was not scrolled before the tap (${scrolled})`);
  await byTest('dock-today').click();
  await page.waitForTimeout(1200);
  const top = await byTest('today-scroll').evaluate((el) => el.scrollTop);
  if (top > 4) errors.push(`${lang}: tapping Today on Today left it scrolled (${top})`);

  for (const [w, h] of [[390, 844], [320, 640]]) {
    step(`${lang}: the dock at ${w}`);
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    const dock = await page.evaluate(() => {
      const tabs = ['today', 'trips', 'ask', 'circles', 'wallet'].map((n) => document.querySelector(`[data-testid="dock-${n}"]`));
      return tabs.map((el) => {
        if (!el) return null;
        const label = [...el.querySelectorAll('div')].filter((d) => d.children.length === 0 && d.textContent.trim()).pop();
        const r = el.getBoundingClientRect();
        return { text: label?.textContent ?? '', cut: label ? label.scrollWidth > label.clientWidth + 1 : true, left: r.left, right: r.right };
      });
    });
    if (dock.some((d) => !d || !d.text)) errors.push(`${lang}@${w}: a dock tab has no label ${JSON.stringify(dock)}`);
    if (dock.some((d) => d?.cut)) errors.push(`${lang}@${w}: a dock label is cut off ${JSON.stringify(dock.map((d) => d?.text))}`);
    if (dock.some((d) => d && (d.left < 0 || d.right > w))) errors.push(`${lang}@${w}: the dock is wider than the screen`);
    await page.screenshot({ path: join(OUT, `${lang}-dock-${w}.png`), clip: { x: 0, y: h - 120, width: w, height: 120 } });
  }
  await page.setViewportSize({ width: 390, height: 844 });

  step(`${lang}: a link with nothing behind it offers Home`);
  // In-app (a reload would drop the mock session): the URL changes under the app, the way a tapped link arrives,
  // and the linking config rebuilds the screens from it, with nothing behind.
  await page.evaluate(() => { window.history.replaceState(null, '', '/account/help'); window.dispatchEvent(new PopStateEvent('popstate', { state: null })); });
  await page.waitForTimeout(1500);
  await byTest('topbar-home').waitFor({ state: 'visible', timeout: 15000 }).catch(() => errors.push(`${lang}: no Home on a linked screen`));
  await shot('link-home');
  await byTest('topbar-home').click().catch(() => {});
  await byTest('dock-today').waitFor({ state: 'visible', timeout: 10000 }).catch(() => errors.push(`${lang}: Home did not land on Today`));
  await shot('after-home');

  step(`${lang}: a pushed screen keeps Back`);
  await byTest('dock-trips').click();
  await page.waitForTimeout(1200);
  await page.getByText('Istanbul').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  if (await byTest('topbar-back').count()) await shot('pushed-back');
  else errors.push(`${lang}: trip detail has no Back`);
  await context.close();
}

try {
  await run('en');
  await run('ar');
} catch (e) {
  errors.push('crash: ' + e.message);
}
await browser.close();
server.close();
if (errors.length) { console.log('\nFAILED\n' + errors.map((e) => ' - ' + e).join('\n')); process.exit(1); }
console.log(`\nWake-up alarm and navigation passed. Screenshots in ${OUT}`);
