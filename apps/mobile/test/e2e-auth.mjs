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

async function fresh(name, { locale = 'en-GB', last = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  // The way in this phone used last time (lib/auth/last.ts), as if from an earlier visit.
  if (last) await context.addInitScript((v) => { if (!localStorage.getItem('mada.lastSignIn.v1')) localStorage.setItem('mada.lastSignIn.v1', v); }, JSON.stringify(last));
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
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  if (locale === 'en-GB') await see('Sign in to book and keep your trips.', 'signin');
  else await page.waitForTimeout(1200);
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
    await p.see("That code doesn't match. 2 tries left.", `${label} wrong code`);
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
    await p.see("That code doesn't match. 2 tries left.", 'email wrong code');
    await p.see('Open Mail', 'open mail');
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

  {
    step('6. Didn’t get the code? on the phone code: the sheet, then a recovery request');
    const p = await fresh('help-phone');
    await p.byTest('signin-phone').click();
    const phone = randomPhone();
    await p.byTest('phone-input').fill(phone);
    await p.byTest('phone-send').click();
    await p.see('Enter the code', 'code screen');
    await p.see('New code in 0:5', 'countdown under the code');
    await p.tap('Didn’t get the code?');
    await p.see('Codes can take a minute to arrive.', 'help sheet');
    await p.see('Send a new code in 0:', 'resend waits for the countdown');
    await p.see('Wrong number? Change it', 'change number');
    await p.see('Get a code by email', 'other way: email');
    await p.see('Continue with Google', 'other way: google');
    await p.see('Continue with Apple', 'other way: apple (mock web)');
    await p.see('I can’t use this number or email any more', 'lost');
    await p.shot('sheet');
    if (await p.byTest('help-resend').getAttribute('aria-disabled') !== 'true') errors.push('help-phone: Send a new code should wait for the countdown');
    await p.byTest('help-change').click();
    await p.see('Your mobile number', 'back to the number');
    const kept = await p.byTest('phone-input').inputValue();
    if (kept.replace(/\D/g, '') !== phone) errors.push(`help-phone: number not prefilled (${kept})`);
    await p.byTest('phone-send').click();
    await p.see('Enter the code', 'code again');
    await p.tap('Didn’t get the code?');
    await p.byTest('help-lost').click();
    await p.see('Can’t use your old number or email?', 'recovery screen');
    const oldShown = await p.byTest('recover-old').inputValue();
    if (oldShown.replace(/\D/g, '') !== phone) errors.push(`help-phone: old number not prefilled (${oldShown})`);
    await p.byTest('recover-send').click();
    await p.see('Your name helps us find your account.', 'name needed');
    await p.byTest('recover-name').fill('Omar Alharbi');
    await p.byTest('recover-new').fill(`omar.${Date.now()}@example.com`);
    await p.byTest('recover-note').fill('My last trip with you was Istanbul in March.');
    await p.shot('recover-form');
    await p.byTest('recover-send').click();
    await p.see('We have your request.', 'recovery sent');
    await p.see('passport details on file and your last booking', 'how we check');
    await p.see('We’ll reach you at omar.', 'reach on the new contact');
    await p.shot('recover-sent');
    await p.byTest('recover-done').click();
    await p.see('Sign in to book and keep your trips.', 'back to sign-in');
    await p.context.close();
  }

  {
    step('7. Email code: spam folder, Open Mail, another way; three wrong codes → a short pause');
    const p = await fresh('help-email');
    await p.byTest('signin-email').click();
    const email = `noura.${Date.now()}@example.com`;
    await p.byTest('email-input').fill(email);
    await p.byTest('email-send').click();
    await p.see('Check your email', 'email code');
    await p.see(`Sent to ${email}.`, 'address shown');
    await p.see('Change email', 'change link');
    await p.see('Open Mail', 'open mail');
    await p.tap('Didn’t get the code?');
    await p.see('Check your spam or junk folder', 'spam');
    await p.see('no-reply@madatrips.sa', 'sender');
    await p.see('Get a code by text', 'other way: text');
    await p.shot('sheet');
    await p.byTest('help-other-code').click();
    await p.see('Your mobile number', 'switched to phone');
    await p.page.goBack();
    await p.page.waitForTimeout(600);
    await p.byTest('signin-email').click().catch(() => {});
    await p.byTest('email-input').fill(email);
    await p.byTest('email-send').click();
    await p.see('Check your email', 'email code again');
    for (const [i, left] of [[1, '2 tries left'], [2, '1 try left']]) {
      await p.byTest('email-code-input').fill('11111' + i);
      await p.see(left, `wrong ${i}`);
    }
    await p.shot('one-try-left');
    await p.byTest('email-code-input').fill('111113');
    await p.see('Let’s take a short pause.', 'pause sheet');
    await p.see('You can try again in', 'pause countdown');
    await p.shot('pause');
    await p.context.close();
  }

  {
    step('8. The way in used last time goes first');
    const email = `omar.${Date.now()}@example.com`;
    const p = await fresh('last', { last: { via: 'email', contact: email } });
    await p.see('Continue as o•••@example.com', 'continue as');
    await p.see('Use another way', 'another way');
    await p.shot('continue-as');
    await p.byTest('signin-another').click();
    await p.see('Continue with phone number', 'all ways back');
    await p.byTest('signin-email').click();
    await p.page.goBack();
    await p.page.waitForTimeout(500);
    await p.page.reload();
    await p.page.waitForTimeout(1200);
    await p.byTest('welcome-start').click().catch(() => {});
    await p.byTest('signin-last').click();
    await p.see('Check your email', 'code sent straight away');
    await p.see(`Sent to ${email}.`, 'to the remembered address');
    await p.byTest('email-code-input').fill('123456');
    await p.see('Verify your phone', 'signed in');
    await p.context.close();
  }

  {
    step('9. Passwords: set one in Profile (rules tick), sign out, sign in with it, a wrong one first');
    const p = await fresh('password');
    const email = `hessa.${Date.now()}@example.com`;
    await p.byTest('signin-email').click();
    await p.byTest('email-input').fill(email);
    await p.byTest('email-send').click();
    await p.byTest('email-code-input').fill('123456');
    await verifyPhone(p);
    await nameAlertsToday(p, 'Hessa');
    await p.byTest('today-avatar').click();
    await p.byTest('profile-signin').click();
    await p.byTest('method-password').click();
    await p.see('Codes always work.', 'password sheet');
    await p.byTest('password-set').click();
    await p.see('First, a code to check it’s you.', 'reauth');
    await p.byTest('reauth-send').click();
    await p.byTest('reauth-code').fill('123456');
    await p.see('Your password needs', 'rules');
    await p.byTest('method-new-password').fill('istanbul');
    await p.page.locator('[data-testid="rule-lower-ok"]').waitFor({ timeout: 4000 }).catch(() => errors.push('password: lowercase rule should tick'));
    await p.shot('rules-partial');
    await p.byTest('method-new-password').fill('Istanbul 2027!');
    await p.page.locator('[data-testid="rule-symbol-ok"]').waitFor({ timeout: 4000 }).catch(() => errors.push('password: symbol rule should tick'));
    await p.shot('rules-done');
    await p.byTest('method-password-save').click();
    await p.see('Password saved.', 'saved');
    await p.see('Set', 'password row shows set');
    await p.page.goBack();
    await p.page.waitForTimeout(600);
    await p.byTest('profile-signout').click();
    await p.byTest('signout-keep').click();
    await p.see("We'll take it from here.", 'signed out');
    await p.byTest('welcome-start').click();
    await p.see('Continue as h•••@example.com', 'remembered email');
    await p.byTest('signin-another').click();
    await p.byTest('signin-email').click();
    await p.byTest('email-input').fill(email);
    await p.tap('Use my password instead');
    await p.see('Only if you set one in Profile.', 'password screen');
    await p.byTest('password-input').fill('Istanbul 2026!');
    await p.byTest('password-signin').click();
    await p.see('That email and password don’t match. 4 tries left before a short pause.', 'wrong password');
    await p.shot('wrong-password');
    await p.byTest('password-input').fill('Istanbul 2027!');
    await p.byTest('password-signin').click();
    await p.see('Welcome back, Hessa.', 'signed in with password');
    await p.context.close();
  }

  {
    step('10. Forgot password: a code by email, a new password, signed in');
    const p = await fresh('forgot');
    await p.byTest('signin-email').click();
    const email = `faris.${Date.now()}@example.com`;
    await p.byTest('email-input').fill(email);
    await p.tap('Use my password instead');
    await p.tap('Forgot password?');
    await p.see('Choose a new password', 'forgot');
    await p.see(email, 'address carried over');
    await p.shot('forgot');
    await p.byTest('forgot-send').click();
    await p.byTest('reset-code-input').fill('123456');
    await p.see('Your password needs', 'new password rules');
    await p.byTest('new-password').fill('Riyadh Season 9#');
    await p.shot('new-password');
    await p.byTest('new-password-save').click();
    await p.see('Verify your phone', 'signed in after reset');
    await p.context.close();
  }

  {
    step('11. Arabic: the help sheet and the recovery screen');
    const p = await fresh('ar', { locale: 'ar-SA' });
    await p.byTest('signin-phone').click();
    await p.byTest('phone-input').fill(randomPhone());
    await p.byTest('phone-send').click();
    await p.see('ما وصلك الرمز؟', 'ar link');
    await p.shot('code');
    await p.page.getByText('ما وصلك الرمز؟', { exact: true }).first().click();
    await p.see('جرّب طريقة أخرى', 'ar sheet');
    await p.shot('sheet');
    await p.byTest('help-lost').click();
    await p.see('ما عاد عندك رقمك أو بريدك القديم؟', 'ar recovery');
    await p.shot('recover');
    await p.byTest('recover-name').fill('عمر الحربي');
    await p.byTest('recover-new').fill(`omar.${Date.now()}@example.com`);
    await p.byTest('recover-send').click();
    await p.see('وصلنا طلبك.', 'ar sent');
    await p.shot('recover-sent');
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
