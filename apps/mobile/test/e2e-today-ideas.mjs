// Today's bento with nothing planned, against the web export (mock API), on pinned days.
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-today-ideas.mjs [shot-dir]
//
// Signs in as the demo account, sets the trip clock to "nothing planned", and checks the bento's shape rather than
// its places (they change by the day): a hero photo tile and two smaller ones, three different kinds, the same all
// day and different the next. Writes docs/app/screens/today-ideas-en-1.png, -en-2.png and -ar.png.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? '../../docs/app/screens');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}.`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
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

async function today(day, locale) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${day}T09:30:00+03:00`));
  page.on('pageerror', (e) => { errors.push(`${day} ${locale}: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  const ar = locale.startsWith('ar');
  await page.goto(ORIGIN + '/');
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await byTest('otp-input').waitFor({ timeout: 15000 });
  await byTest('otp-input').fill('123456');
  const back = byTest('welcome-back-open');
  if (await back.waitFor({ timeout: 8000 }).then(() => true, () => false)) await back.click();
  await page.waitForTimeout(1500);
  // The demo panel: nothing planned.
  for (let i = 0; i < 4; i += 1) {
    await byTest('today-date').first().click({ delay: 800 });
    if (await byTest('demo-none').waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
  }
  await byTest('demo-none').click();
  await byTest('today-ideas').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const tiles = await byTest('today-ideas').locator('[data-testid^="idea-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  if (tiles.length !== 3) errors.push(`${day} ${locale}: ${tiles.length} tiles (${tiles.join()})`);
  if (new Set(tiles).size !== tiles.length) errors.push(`${day} ${locale}: repeated kinds (${tiles.join()})`);
  const text = await byTest('today-ideas').innerText();
  if (/⟦/.test(text)) errors.push(`${day} ${locale}: a missing copy key in "${text}"`);
  if (/NaN|undefined/.test(text)) errors.push(`${day} ${locale}: "${text}"`);
  if (ar && /[A-Za-z]{4,}/.test(text.replace(/eSIM/g, ''))) errors.push(`${day} ${locale}: English inside Arabic: "${text}"`);
  if (ar && (await page.evaluate(() => document.documentElement.dir)) !== 'rtl') errors.push(`${day}: not right to left`);
  // The bento in view, with the line above it.
  await byTest('today-ideas').evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(800);
  return { page, context, tiles, text };
}

const shot = async (page, name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file, type: 'png', scale: 'css' });
  const kb = statSync(file).size / 1024;
  console.log(`  ${name}.png ${kb.toFixed(0)} KB`);
  if (kb > 400) errors.push(`${name}.png is ${kb.toFixed(0)} KB`);
};

try {
  step('English, 21 October');
  const a = await today('2026-10-21', 'en-US');
  console.log('  ', a.tiles.join(' '), '|', a.text.replace(/\s+/g, ' '));
  await shot(a.page, 'today-ideas-en-1');
  await a.context.close();

  step('English, the same day again: the same three');
  const a2 = await today('2026-10-21', 'en-US');
  if (a2.text !== a.text) errors.push(`not stable within a day: "${a.text}" vs "${a2.text}"`);
  await a2.context.close();

  step('English, 22 October: a different bento');
  const b = await today('2026-10-22', 'en-US');
  console.log('  ', b.tiles.join(' '), '|', b.text.replace(/\s+/g, ' '));
  if (b.text === a.text) errors.push('the same bento two days running');
  await shot(b.page, 'today-ideas-en-2');
  await b.context.close();

  step('Arabic, 21 October');
  const c = await today('2026-10-21', 'ar-SA');
  console.log('  ', c.tiles.join(' '), '|', c.text.replace(/\s+/g, ' '));
  await shot(c.page, 'today-ideas-ar');
  await c.context.close();
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error('\nFAILED\n' + errors.join('\n')); process.exit(1); }
console.log('\nToday ideas: all good');
