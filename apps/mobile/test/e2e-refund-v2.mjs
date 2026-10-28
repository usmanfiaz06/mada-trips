// Refunds v2 (APP-FINANCE.md "Auto-approval" and "Mada Wallet") against the web export in mock-API mode:
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir <dir> --clear
//   DIST=<dir> node test/e2e-refund-v2.mjs [shot-dir]          (default docs/app/screens)
//
// Screens: refund-v2-choice-en/ar (Mada Wallet first, chosen, Recommended; the card with 5–10 working days),
// refund-v2-wallet-en (in your Mada Wallet, Open Wallet), refund-v2-wallet-tab-en (the balance and a line per movement),
// refund-v2-tracker-en (sent to the card with the bank's reference).
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
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : '/opt/pw-browsers/chromium' });
const errors = [];
const check = (ok, what) => { if (!ok) { errors.push(what); console.log('FAIL', what); } else console.log('ok  ', what); };

async function start(locale) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  await page.goto(ORIGIN + '/');
  await byTest('welcome-start').waitFor({ timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
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
  const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: join(OUT, `${name}.png`) }); console.log('·', name); };
  const visible = async (id, timeout = 12000) => { try { await byTest(id).waitFor({ state: 'visible', timeout }); return true; } catch { return false; } };
  const see = async (text, timeout = 12000) => { try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ timeout }); return true; } catch { return false; } };
  /** In the app, not a reload: the mock keeps its sign-in in memory only. */
  const go = async (url) => { await page.evaluate((u) => { window.history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, url); await page.waitForTimeout(900); };
  const into = async (id) => { await byTest(id).evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(300); };
  /** Drag the sun across the slider, as a thumb would. */
  const slide = async () => {
    const track = page.locator('[role="slider"]').last();
    await track.waitFor({ state: 'visible', timeout: 8000 });
    const b = await track.boundingBox();
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 30, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) { await page.mouse.move(b.x + 30 + ((b.width - 40) * i) / 12, y); await page.waitForTimeout(16); }
    await page.mouse.up();
  };
  /** The demo trip's id, from its Payments link on the Trips tab. */
  const tripId = async () => {
    await byTest('dock-trips').click();
    await visible('card-payments');
    await byTest('card-payments').click();
    await page.waitForTimeout(900);
    return /\/trip\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? null;
  };
  /** The refund screen with the pickup picked and a reason: the destination choice in view. */
  const pickPickup = async (id, reason) => {
    await go(`/trip/${id}/refund`);
    check(await visible('refund-pickup'), `${locale}: refund screen`);
    await byTest('refund-pickup').click();
    await page.getByText(reason, { exact: true }).filter({ visible: true }).first().click();
    check(await visible('dest-credit'), `${locale}: destination choice`);
    await into('dest-card');
  };
  return { context, page, byTest, shot, visible, see, go, slide, tripId, pickPickup };
}

/* English: the choice, the wallet confirmation, the Wallet tab. */
{
  const s = await start('en-US');
  const id = await s.tripId();
  check(!!id, 'en: the demo trip');
  await s.pickPickup(id, 'Plans changed');
  check(await s.see('Mada Wallet · instantly'), 'en: wallet option says instantly');
  check(await s.see('Ready now for your next booking. Never expires.'), 'en: wallet option line');
  check(await s.see('Recommended'), 'en: wallet recommended');
  check(await s.see('Your bank shows it in 5–10 working days.'), 'en: card option line');
  await s.shot('refund-v2-choice-en');
  // Slid without touching the choice: it lands in the wallet, so the wallet was the one chosen.
  await s.slide();
  check(await s.visible('open-wallet'), 'en: Open Wallet');
  check(await s.see('is in your Mada Wallet.'), 'en: in your Mada Wallet');
  await s.shot('refund-v2-wallet-en');
  // A booking paid partly from the wallet, so the tab shows both kinds of line.
  await s.page.evaluate(() => window.__madaWallet?.spendCredit(15000, 'Dubai, 2–5 Dec'));
  await s.byTest('open-wallet').click();
  await s.page.waitForTimeout(1200);
  check(await s.see('Refund · Airport pickup both ways, Istanbul'), 'en: wallet refund line');
  await s.page.mouse.click(195, 60);
  await s.page.waitForTimeout(800);
  await s.byTest('wallet-credit').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  check(await s.visible('wallet-credit-line'), 'en: movement lines on the Wallet tab');
  check(await s.see('Used · Dubai, 2–5 Dec'), 'en: used line');
  check((await s.page.locator('[data-testid="credit-move"]').count()) === 0, 'en: nothing moves the wallet to a card');
  await s.shot('refund-v2-wallet-tab-en');
  await s.context.close();
}

/* English: a card refund the rules approve, sent with the bank's reference. */
{
  const s = await start('en-US');
  const id = await s.tripId();
  await s.pickPickup(id, 'Plans changed');
  await s.byTest('dest-card').click();
  await s.slide();
  check(await s.see('is on its way back.'), 'en: card refund on its way');
  await s.page.waitForTimeout(7500);
  await s.byTest('see-in-trips').click();
  await s.page.waitForTimeout(1200);
  if (!(await s.visible('refund-card', 3000))) { await s.byTest('tab-requests').click(); await s.page.waitForTimeout(900); }
  check(await s.visible('refund-reference', 15000), 'en: reference on the tracker');
  check(await s.see('Show this to your bank if it isn’t there after 10 working days.'), 'en: bank note');
  check(await s.see('Sent to your Visa ending 41 ·'), 'en: sent to the card with the day');
  await s.byTest('refund-reference').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await s.shot('refund-v2-tracker-en');
  await s.context.close();
}

/* Arabic: the choice. */
{
  const s = await start('ar-SA');
  const id = await s.tripId();
  await s.pickPickup(id, 'تغيّرت الخطط');
  check(await s.see('محفظة مادا · فورًا'), 'ar: wallet option');
  check(await s.see('جاهزة الحين لحجزك الجاي، وما تنتهي.'), 'ar: wallet option line');
  check(await s.see('يوصلك خلال 5–10 أيام عمل حسب بنكك.'), 'ar: card option line');
  await s.shot('refund-v2-choice-ar');
  await s.context.close();
}

await browser.close();
server.close();
if (errors.length) { console.log(`\n${errors.length} problem(s):\n${errors.join('\n')}`); process.exit(1); }
console.log('\nrefund v2: all good');
