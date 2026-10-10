// Sign-in through Supabase Auth, end to end, in headless Chromium against the web export (mock mode: Supabase's
// stand-in in the app and the in-app API, so no project and no server are needed).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   node test/e2e-auth.mjs [shot-dir]
//
// Walks every way in, each on a fresh phone, screenshotting each screen at 390×844:
//   1. Apple (the stand-in sheet, Hide my email) → Verify your phone → Later → name → alerts → Today → Profile shows
//      "Verify your phone" → the number and code from there → Profile without the row
//   2. Google → Verify your phone (a wrong code, then the right one) → name → alerts → Today
//   3. Email (an incomplete address, a wrong code) → Verify your phone → name
//   4. Phone → code → name → alerts → Today → Profile › Sign-in methods: add email (code in the sheet), add Google
//   5. The demo number again on a new phone: Welcome back
// Fails on any page error or missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-auth');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const size = statSync(file).size;
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]); const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
let n = 0;
const step = (s) => console.log('·', s);
const randomPhone = () => `5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

async function fresh(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${name} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });
  const shot = async (label) => { n += 1; await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}-${label}.png`) }); };
  const see = async (text, what) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 8000 }); }
    catch { errors.push(`${name} ${what}: expected "${text}"`); console.log('MISSING', name, what, '→', text); }
  };
  const gone = async (text, what) => {
    await page.waitForTimeout(400);
    if (await page.getByText(text, { exact: false }).filter({ visible: true }).count()) { errors.push(`${name} ${what}: "${text}" should be gone`); console.log('STILL THERE', what); }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).first();
  const tap = async (text) => { await page.getByRole('button', { name: text, exact: true }).filter({ visible: true }).first().click(); };

  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await see('Sign in to book and keep your trips.', 'signin');
  return { context, page, shot, see, gone, byTest, tap };
}

async function verifyPhone(p, { wrong = false, label = 'verify' } = {}) {
  const phone = randomPhone();
  await p.byTest('phone-input').fill(phone);
  await p.shot(`${label}-number`);
  await p.byTest('phone-send').click();
  await p.see('Enter the code', `${label} code`);
  if (wrong) {
    await p.byTest('otp-input').fill('000000');
    await p.see('That code doesn’t match. Check the latest one we sent.', `${label} wrong code`);
    await p.shot(`${label}-wrong`);
  }
  await p.byTest('otp-input').fill('123456');
  return phone;
}

async function nameAlertsToday(p, name = 'Omar') {
  await p.see('What should we call you?', 'name');
  await p.byTest('name-input').fill(name);
  await p.shot('name');
  await p.byTest('name-go').click();
  await p.see("We'll only interrupt you when it matters.", 'alerts');
  await p.page.waitForTimeout(1500);
  await p.byTest('alerts-allow').click();
  await p.see('Nowhere planned yet.', 'today');
}

try {
  {
    step('the four ways in');
    const p = await fresh('signin');
    await p.see('Continue with Apple', 'apple button');
    await p.see('Continue with Google', 'google button');
    await p.see('Continue with email', 'email button');
    await p.see('Continue with phone number', 'phone button');
    await p.shot('choices');
    await p.byTest('signin-apple').click();
    await p.see('Hide my email', 'apple sheet');
    await p.tap('Cancel');
    await p.see('Sign-in cancelled. Nothing was shared.', 'cancel toast');
    await p.context.close();
  }

  {
    step('1. Apple → Verify your phone → Later → … → Profile → verify from there');
    const p = await fresh('apple');
    await p.byTest('signin-apple').click();
    await p.see('Hide my email', 'apple sheet');
    await p.shot('sheet');
    await p.byTest('signin-sheet-continue').click();
    await p.see('Verify your phone', 'verify phone');
    await p.see('You’re signed in with Apple.', 'verify phone body');
    await p.shot('verify-phone');
    await p.tap('Later');
    await nameAlertsToday(p);
    await p.byTest('today-avatar').click();
    await p.see('Needed before your first booking', 'profile verify row');
    await p.shot('profile-needs-phone');
    await p.byTest('profile-verify-phone').click();
    await p.see('Before your first booking we need a mobile number', 'verify from profile');
    const phone = await verifyPhone(p, { label: 'from-profile' });
    await p.see('Your number is verified.', 'verified toast');
    await p.see('Sign-in methods', 'back on profile');
    await p.gone('Needed before your first booking', 'profile verify row');
    await p.see(`+966 ${phone.slice(0, 2)}`, 'profile shows number');
    await p.shot('profile-verified');
    await p.context.close();
  }

  {
    step('2. Google → Verify your phone (wrong code, then right) → name → Today');
    const p = await fresh('google');
    await p.byTest('signin-google').click();
    await p.see('Google shares your name and email address. Nothing else.', 'google sheet');
    await p.shot('sheet');
    await p.byTest('signin-sheet-continue').click();
    await p.see('You’re signed in with Google.', 'verify phone');
    await verifyPhone(p, { wrong: true });
    await p.see('What should we call you?', 'name after phone');
    await p.see('Omar', 'google name prefilled');
    await nameAlertsToday(p);
    await p.shot('today');
    await p.context.close();
  }

  {
    step('3. Email → code → Verify your phone → name');
    const p = await fresh('email');
    await p.byTest('signin-email').click();
    await p.see('Your email', 'email screen');
    await p.byTest('email-input').fill('sara@example');
    await p.byTest('email-input').blur();
    await p.see('That address looks incomplete.', 'email problem');
    await p.shot('incomplete');
    await p.byTest('email-input').fill(`sara.${Date.now()}@example.com`);
    await p.shot('address');
    await p.byTest('email-send').click();
    await p.see('Check your email', 'email code');
    await p.byTest('email-code-input').fill('111111');
    await p.see('That code doesn’t match.', 'email wrong code');
    await p.shot('wrong-code');
    await p.byTest('email-code-input').fill('123456');
    await p.see('Verify your phone', 'verify after email');
    await p.see('You’re signed in with your email.', 'email verify body');
    await p.shot('verify-phone');
    await verifyPhone(p);
    await p.see('What should we call you?', 'name');
    await p.shot('name');
    await p.context.close();
  }

  {
    step('4. Phone → Today → Sign-in methods: add email, add Google');
    const p = await fresh('phone');
    await p.byTest('signin-phone').click();
    await p.see('Your mobile number', 'phone');
    await p.byTest('phone-input').fill('50 12');
    await p.byTest('phone-input').blur();
    await p.see('That number looks short.', 'short number');
    await p.shot('short');
    await verifyPhone(p, { wrong: true, label: 'signin' });
    await nameAlertsToday(p, 'Sara');
    await p.byTest('today-avatar').click();
    await p.see('Sign-in methods', 'profile');
    await p.byTest('profile-signin').click();
    await p.see('Ways into your account.', 'methods');
    await p.see('Only one way in.', 'only one');
    await p.shot('methods-one');
    await p.byTest('method-email').click();
    await p.see('Add your email as a way in?', 'add email sheet');
    await p.byTest('method-email-input').fill(`sara.${Date.now()}@example.com`);
    await p.shot('add-email');
    await p.byTest('method-email-send').click();
    await p.byTest('method-email-code').fill('123456');
    await p.see('Email added. You can sign in with it now.', 'email added');
    await p.gone('Only one way in.', 'only one');
    await p.byTest('method-google').click();
    await p.see('Add Google as a way in?', 'add google');
    await p.byTest('method-continue').click();
    await p.see('Google added. You can sign in with it now.', 'google added');
    await p.shot('methods-three');
    await p.byTest('method-phone').click();
    await p.see('Your number stays.', 'phone manage');
    await p.shot('phone-manage');
    await p.context.close();
  }

  {
    step('5. The demo number on a new phone: Welcome back');
    const p = await fresh('return');
    await p.byTest('signin-phone').click();
    await p.byTest('phone-input').fill('500004127');
    await p.byTest('phone-send').click();
    await p.byTest('otp-input').fill('123456');
    await p.see('Welcome back, Omar.', 'welcome back');
    await p.shot('welcome-back');
    await p.byTest('welcome-back-open').click();
    await p.see('Istanbul', 'today');
    await p.context.close();
  }
} catch (e) {
  errors.push(String(e?.stack ?? e));
  console.log(e);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.log(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`\nSign-in passed. ${n} screenshots in ${OUT}`);
