// Documents in Ask (docs/app/ASK-INTEGRATED.md §6, U6) against the web export in mock-API mode, with the mock-only demo
// conversation (window.__MADA_DEMO__ = { askChat: true }) and `attachMrz`: the two lines a photo would give when read on
// the phone (the specimen passport of the demo account, Omar, and the ICAO specimen for a stranger):
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-ask-docs.mjs [shot-dir]          (default docs/app/screens)
//
// The same passport → "We already have your passport" and Use it (no second copy); a stranger's → "Whose passport is
// this?", someone new, their OK, saved; a renewed one → Replace; and the same in Arabic, right to left.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? '../../docs/app/screens');
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
const check = (ok, what) => { if (!ok) { errors.push(what); console.log('FAIL', what); } else console.log('ok  ', what); };


/** ICAO 9303 TD3 lines with real check digits, for specimen passports only. */
const cd = (x) => String([...x].reduce((a, c, i) => a + (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55) * [7, 3, 1][i % 3], 0) % 10);
function td3({ surname, given, number, nat, dob, sex, expiry }) {
  const l1 = `P<${nat}${`${surname}<<${given.replace(/ /g, '<')}`}`.padEnd(44, '<').slice(0, 44);
  const num = number.padEnd(9, '<');
  const personal = '<'.repeat(14);
  const body = `${num}${cd(num)}${nat}${dob}${cd(dob)}${sex}${expiry}${cd(expiry)}${personal}${cd(personal)}`;
  const comp = `${num}${cd(num)}${dob}${cd(dob)}${expiry}${cd(expiry)}${personal}${cd(personal)}`;
  return [l1, `${body}${cd(comp)}`];
}
const OMAR = td3({ surname: 'ALHARBI', given: 'OMAR', number: 'A08493141', nat: 'SAU', dob: '840311', sex: 'M', expiry: '310622' });
const OMAR_RENEWED = td3({ surname: 'ALHARBI', given: 'OMAR', number: 'B12345678', nat: 'SAU', dob: '840311', sex: 'M', expiry: '360530' });
const STRANGER = td3({ surname: 'ERIKSSON', given: 'ANNA MARIA', number: 'L898902C3', nat: 'SWE', dob: '740812', sex: 'F', expiry: '320415' });

async function start(locale) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  await context.addInitScript(() => { window.__MADA_DEMO__ = { askChat: true }; });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  await page.goto(ORIGIN + '/');
  await byTest('welcome-start').waitFor({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await byTest('otp-input').waitFor({ timeout: 10000 });
  await byTest('otp-input').fill('123456');
  await byTest('welcome-back-open').waitFor({ timeout: 10000 });
  await byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
  const shot = async (name) => { await page.screenshot({ path: join(OUT, `${name}.png`), type: 'png' }); console.log('·', name); };
  const visible = async (id, timeout = 12000) => { try { await byTest(id).waitFor({ state: 'visible', timeout }); return true; } catch { return false; } };
  /** Send a "photo" whose lines read as `lines` (attachMrz stands for the phone's reader). */
  const attach = async (lines) => {
    await page.evaluate((l) => { window.__MADA_DEMO__.attachMrz = l; }, lines);
    await byTest('ask-attach').click();
    await byTest('ask-attach-library').click();
  };
  const scrollEnd = async () => { await page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(300); };
  const openNew = async () => {
    await byTest('dock-ask').click();
    await visible('ask-list');
    await byTest('ask-list-new').click();
    await visible('ask-attach');
  };
  return { context, page, byTest, shot, visible, attach, openNew, scrollEnd };
}

async function english() {
  const s = await start('en-GB');
  const { page, byTest } = s;
  await s.openNew();
  await byTest('ask-attach').click();
  check(await s.visible('ask-attach-menu'), 'the + opens camera, photo library and file');
  await byTest('ask-attach').click();

  // The same passport as on file: we already have it, and Use it keeps nothing new.
  await s.attach(OMAR);
  check(await s.visible('doc-card-have_it'), 'the same passport: "we already have it" card');
  const said = await byTest('chat-thread').innerText().catch(() => '');
  check(/We already have your passport, ending 41, valid to 22 Jun 2031\. Use it\?/.test(said), 'Mada says it, with the last two characters and the expiry');
  check(!/A08493141/.test(said), 'the number is never on screen');
  check(/Passport · Omar · ••41/.test(await byTest('chat-me-attachment').innerText().catch(() => '')), 'the traveller\'s line is the masked label');
  await s.scrollEnd();
  await page.waitForTimeout(500);
  await s.shot('ai-u6-have-it-en');
  await byTest('doc-use').click();
  check(await s.visible('doc-card-used'), 'Use it: in use, nothing saved twice');

  // A stranger's passport: whose is it, someone new, their OK.
  await s.attach(STRANGER);
  check(await s.visible('doc-card-whose'), 'an unknown holder: "Whose passport is this?"');
  const names = await page.locator('[data-testid="doc-person"]').filter({ visible: true }).allInnerTexts();
  check(names.length >= 3 && names[0]?.trim() === 'Me', `the household to choose from (${names.join(', ')})`);
  await s.scrollEnd();
  await page.waitForTimeout(500);
  await s.shot('ai-u6-whose-en');
  await byTest('doc-new-person').click();
  check(await s.visible('doc-card-consent'), 'someone new: their OK first');
  await byTest('doc-keep').click();
  check(await s.visible('doc-card-saved'), 'kept with their OK: saved');

  // A renewed passport: replace the old one.
  await s.attach(OMAR_RENEWED);
  check(await s.visible('doc-card-renewed'), 'a newer passport: replace offer');
  check(/On file now: ••41/.test(await byTest('doc-old').innerText().catch(() => '')), 'the one on file, masked');
  await byTest('doc-replace').click();
  check(await s.visible('doc-card-replaced'), 'replaced');
  await s.context.close();
}

async function arabic() {
  const s = await start('ar-SA');
  await s.openNew();
  await s.attach(OMAR);
  check(await s.visible('doc-card-have_it'), 'Arabic: the same passport card');
  const said = await s.byTest('chat-thread').innerText().catch(() => '');
  check(/جوازك عندنا/.test(said), 'Arabic: «جوازك عندنا…»');
  const dir = await s.page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction);
  check(dir === 'rtl', `Arabic: right to left (${dir})`);
  await s.scrollEnd();
  await s.page.waitForTimeout(500);
  await s.shot('ai-u6-have-it-ar');
  await s.context.close();
}

try {
  await english();
  await arabic();
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`\nAll good. Screens in ${OUT}`);
