// Cancel and refund in Ask (docs/app/ASK-REFUND.md) against the web export in mock-API mode, with the mock-only demo
// conversation: the refund_quote card (the refund screen's numbers and choice) before the slide, and the tracker after
// it, in English and Arabic. The mock's trip is Istanbul; its stay is on Tabby, so the card for it has no choice to make.
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir <dir> --clear
//   DIST=<dir> node test/e2e-ask-refund.mjs [shot-dir]          (default docs/app/screens)
//
// Screens: ask-refund-before-en/ar, ask-refund-after-en/ar, ask-refund-hotel-en.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? '../../docs/app/screens');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
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

async function start(locale) {
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  await context.addInitScript(() => { window.__MADA_DEMO__ = { askChat: true }; });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const all = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true });
  await page.goto(ORIGIN + '/');
  await byTest('welcome-start').waitFor({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  // Phone or email, whichever this build's sign-in has ready.
  await byTest('signin-phone').click();
  const phone = await byTest('phone-input').waitFor({ timeout: 4000 }).then(() => true, () => false);
  if (phone) {
    await byTest('phone-input').fill('500004127');
    await byTest('phone-send').click();
    await byTest('otp-input').waitFor({ timeout: 10000 });
    await byTest('otp-input').fill('123456');
  } else {
    await byTest('signin-email').click();
    await byTest('email-input').fill('omar@example.com');
    await byTest('email-send').click();
    await byTest('email-code-input').waitFor({ timeout: 10000 });
    await byTest('email-code-input').fill('123456');
  }
  await byTest('welcome-back-open').waitFor({ timeout: 10000 });
  await byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('·', name); };
  const visible = async (id, timeout = 12000) => { try { await byTest(id).waitFor({ state: 'visible', timeout }); return true; } catch { return false; } };
  const see = async (text, timeout = 12000) => { try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); return true; } catch { return false; } };
  /** In the app, not a reload: the mock keeps its sign-in in memory only. */
  const go = async (url) => { await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, url); await page.waitForTimeout(600); };
  const top = async () => { await page.evaluate(() => { for (const el of document.querySelectorAll('div')) if (el.scrollTop) el.scrollTop = 0; window.scrollTo(0, 0); }); await page.waitForTimeout(300); };
  return { context, page, byTest, all, shot, visible, see, go, top };
}

/** The card at the top of the screen, so the shot holds all of it. */
async function toCard(s, id) {
  await s.byTest(id).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await s.page.mouse.wheel(0, -90);
  await s.page.waitForTimeout(700);
}

/** Drag the sun across the slider, as a thumb would (right to left in Arabic). */
async function slide(s, rtl) {
  const track = s.page.locator('[data-testid="chat-refund-slide"] [role="slider"]').last();
  await track.waitFor({ state: 'visible', timeout: 8000 });
  const b = await track.boundingBox();
  const y = b.y + b.height / 2;
  const from = rtl ? b.x + b.width - 30 : b.x + 30;
  const dir = rtl ? -1 : 1;
  await s.page.mouse.move(from, y);
  await s.page.mouse.down();
  for (let i = 1; i <= 12; i += 1) { await s.page.mouse.move(from + dir * ((b.width - 40) * i) / 12, y); await s.page.waitForTimeout(16); }
  await s.page.mouse.up();
}

async function ask(s, words) {
  await s.byTest('ask-input').fill(words);
  await s.byTest('ask-send').click();
}

async function run(locale, lang, words, hotel) {
  const s = await start(locale);
  await s.byTest('dock-ask').click();
  await s.visible('ask-list');
  if (hotel) {
    // The hotel: paid with Tabby, so it goes back the way it was paid (no choice), what the hotel keeps said once.
    await ask(s, hotel);
    check(await s.visible('chat-refund-quote', 15000), `${lang}: the hotel's refund card`);
    const text = await s.byTest('chat-refund-quote').innerText();
    check(/Tabby/.test(text), `${lang}: the hotel goes back through Tabby`);
    await toCard(s, 'chat-refund-quote');
    await s.shot(`ask-refund-hotel-${lang}`);
    await s.context.close();
    return;
  }
  await ask(s, words);
  check(await s.visible('chat-refund-quote', 15000), `${lang}: the refund card`);
  const text = await s.byTest('chat-refund-quote').innerText();
  check(lang === 'ar' ? /محفظة مادا · فورًا/.test(text) && /ننصحك فيها/.test(text) && /يرجع لك/.test(text) : /Mada Wallet · instantly/.test(text) && /Recommended/.test(text) && /You get back/.test(text), `${lang}: Mada Wallet first, instant, Recommended, the amount`);
  check(lang === 'ar' ? /لبطاقتك Visa ending 41/.test(text) || /لبطاقتك/.test(text) : /Back to your Visa ending 41/.test(text), `${lang}: back to the card`);
  check(await s.visible('chat-refund-slide', 3000), `${lang}: the slide`);
  await toCard(s, 'chat-refund-quote');
  await s.shot(`ask-refund-before-${lang}`);
  await slide(s, lang === 'ar');
  check(await s.visible('chat-refund-done', 15000), `${lang}: the card turns into the tracker`);
  const after = await s.byTest('chat-refund-state').innerText();
  check(lang === 'ar' ? /في محفظة مادا/.test(after) : /In your Mada Wallet/.test(after), `${lang}: in the Mada Wallet`);
  check(await s.visible('chat-refund-wallet', 3000), `${lang}: Open Wallet`);
  await toCard(s, 'chat-refund-done');
  await s.shot(`ask-refund-after-${lang}`);
  await s.context.close();
}

await run('en-US', 'en', 'Cancel our airport pickup and refund me');
await run('ar-SA', 'ar', 'ألغِ التوصيل من المطار ورجّع فلوسي');
await run('en-US', 'en', null, 'Cancel my Istanbul hotel and refund me');
await browser.close();
server.close();
if (errors.length) { console.log(`\n${errors.length} problem(s)`); process.exit(1); }
console.log('\nall good');
