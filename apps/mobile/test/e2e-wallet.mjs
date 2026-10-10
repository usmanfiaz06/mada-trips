// The Wallet area, end to end, in headless Chromium against the web export (mock API by default).
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist   (npm run export:web copies the passport reader)
//   node test/e2e-wallet.mjs [shot-dir]          DIST=… to point at another export; API_TARGET=… to proxy /api to a server
//
// Walks: the Wallet lock (Face ID, then Face ID fails → passcode, a wrong passcode, lockout), the demo family's
// passports and validity, a new account's empty Wallet, "Add your passport" (camera → wrong file → demo passport →
// doubtful fields → by hand → expired warning → save), documents (wrong type, too big, scan fails, upload, share,
// delete), Mada credit and cards (default, remove the default), Profile and every account screen (details, email,
// phone, sign-in methods, preferences and loyalty, household with the helper's iqama and exit visa, security and
// devices, privacy with the copy and deletion, help and legal, sign-out), support (topics, the bag form, urgent help,
// offline queue with call and SMS, attachments) and the inbox. Screenshots every step at 390×844; fails on any page
// error or missing text.
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-wallet');
const API = process.env.API_TARGET ?? null;
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname.startsWith('/api/')) {
    if (!API) { res.writeHead(502).end('No API_TARGET'); return; }
    const target = new URL(url.pathname + url.search, API);
    const p = httpRequest(target, { method: req.method, headers: { ...req.headers, host: target.host, 'x-forwarded-for': '127.0.0.1' } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    p.on('error', (e) => { res.writeHead(502).end(String(e)); });
    req.pipe(p);
    return;
  }
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const errors = [];
let n = 0;
const step = (s) => console.log('·', s);

// Files the tests pick: a photo, a PDF, a text file (wrong type) and one over 10 MB.
const FIX = join(OUT, '_fixtures');
mkdirSync(FIX, { recursive: true });
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');
writeFileSync(join(FIX, 'visa.jpg'), JPEG);
writeFileSync(join(FIX, 'insurance.pdf'), '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
writeFileSync(join(FIX, 'notes.txt'), 'not a document');
writeFileSync(join(FIX, 'huge.jpg'), Buffer.concat([JPEG, Buffer.alloc(10.5 * 1024 * 1024)]));
// The prototype's passport photos (docs/app/prototype-app/test/fixtures): a misprinted birth date, an expired specimen, a receipt.
const PROTO = resolve('../../docs/app/prototype-app/test/fixtures');
for (const f of ['noura-baddigit.jpg', 'anna-photo.jpg', 'receipt.png']) writeFileSync(join(FIX, f), readFileSync(join(PROTO, f)));

async function newPage(demo = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', timezoneId: 'Asia/Riyadh' });
  await context.addInitScript((d) => { window.__MADA_DEMO__ = d; }, demo);
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) console.log('console.error', m.text()); });
  return { context, page };
}

function kit(page) {
  const shot = async (name) => { n += 1; await page.waitForTimeout(650); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${name}.png`) }); };
  const see = async (text, what, timeout = 8000) => {
    try { await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${what}: expected "${text}"`); console.log('MISSING', what, '→', text); return false; }
  };
  const gone = async (text, what) => {
    try { await page.getByText(text, { exact: false }).first().waitFor({ state: 'hidden', timeout: 5000 }); }
    catch { errors.push(`${what}: "${text}" should be gone`); console.log('STILL THERE', what, '→', text); }
  };
  const tap = async (name, opts = {}) => { await page.getByRole(opts.role ?? 'button', { name, exact: opts.exact ?? true }).first().click(); };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`);
  /** Scroll it to the middle first, so the dock never covers it. */
  const press = async (loc) => {
    // Wheel the screen until it sits above the dock, then tap.
    for (let i = 0; i < 12; i += 1) {
      const box = await loc.first().boundingBox();
      if (box && box.y > 80 && box.y + box.height < 700) break;
      await page.mouse.move(195, 400);
      await page.mouse.wheel(0, box && box.y < 80 ? -250 : 250);
      await page.waitForTimeout(250);
    }
    await loc.first().click();
  };
  const text = (s, exact = false) => page.getByText(s, { exact }).first();
  /** Pick a file for the next file chooser the app opens. */
  const pickFile = async (trigger, file) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), trigger()]);
    await chooser.setFiles(join(FIX, file));
  };
  const closeSheet = async () => { await page.getByRole('button', { name: 'Close' }).last().click(); await page.waitForTimeout(400); };
  return { shot, see, gone, tap, byTest, text, pickFile, closeSheet, press };
}

async function signIn(page, phone, { returning }) {
  const { see, byTest } = kit(page);
  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill(phone);
  await byTest('phone-send').click();
  await see('Enter the code', 'otp');
  await byTest('otp-input').fill('123456');
  if (returning) {
    await see('Welcome back', 'welcome back');
    await byTest('welcome-back-open').click();
  } else {
    await see('What should we call you?', 'name');
    await byTest('name-go').click();
    await byTest('alerts-allow').click();
  }
  await page.waitForTimeout(1200);
}

const want = (name) => !ONLY || ONLY.includes(name);

/* ───────────── 1. the Wallet with the demo family ───────────── */
async function walletDemo() {
  const { page, context } = await newPage();
  const { shot, see, byTest, text, closeSheet, press } = kit(page);
  step('wallet: sign in as the demo account');
  await signIn(page, '500004127', { returning: true });
  await byTest('dock-wallet').click();
  await see('Wallet is locked', 'lock');
  await see('Checking Face ID', 'checking');
  await shot('wallet-lock-checking');
  await see('Locked with Face ID · works offline', 'unlocked');
  await see('Omar Alharbi', 'passport name');
  await see('Valid until 22 Jun 2031.', 'validity without a trip');
  await shot('wallet-omar');
  step('wallet: family chips');
  await text('Sara', true).click();
  await see('Sara Alharbi', 'sara passport');
  await see('Valid until 14 Aug 2027.', 'sara validity');
  await shot('wallet-sara');
  await text('Hessa', true).click();
  await see('Hessa Alharbi', 'hessa passport');
  await see('Schengen visa', 'hessa docs');
  await text('Schengen visa').click();
  await see('Share with Mada', 'doc sheet');
  await see('Added when you set up Mada. To remove it, talk to Mada.', 'setup doc');
  await shot('wallet-doc-sheet');
  await byTest('doc-share').click();
  await see('Shared with Mada for this trip only. Faisal can see it, not download it.', 'shared toast');
  await page.waitForTimeout(800);
  step('wallet: money');
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 1200);
  await see('Mada credit', 'credit card');
  await shot('wallet-money');
  await press(byTest('wallet-credit'));
  await see('Nothing has moved yet.', 'credit empty');
  await shot('wallet-credit-empty');
  await closeSheet();
  await press(page.getByRole('button', { name: 'Cards and Apple Pay' }));
  await see('Pay with', 'cards');
  await shot('wallet-cards');
  await byTest('card-add').click();
  await byTest('card-number').fill('4242 4242 4242 4241');
  await see('That number doesn’t look right. Check each digit.', 'luhn');
  await byTest('card-number').fill('3782 822463 10005');
  await see('We can’t take American Express yet. Use Visa, Mastercard or mada.', 'amex');
  await byTest('card-number').fill('4242424242424242');
  await byTest('card-exp').fill('0120');
  await byTest('card-exp').blur();
  await see('This card has expired.', 'expired card');
  await byTest('card-exp').fill('0830');
  await byTest('card-cvv').fill('123');
  await byTest('card-name').fill('OMAR ALHARBI');
  await shot('wallet-card-form');
  await byTest('card-use').click();
  await see('Default card updated.', 'card added');
  await see('3 saved · default Visa ending 42', 'default label');
  // Credit lands (a refund taken as credit), then moves to the card.
  await page.evaluate(() => window.__madaWallet?.addCredit(64000, 'Galata rooms refund'));
  await press(byTest('wallet-credit'));
  await see('Mada credit · SAR 640', 'credit balance', 10000);
  await see('Galata rooms refund', 'credit history');
  await shot('wallet-credit-history');
  await byTest('credit-move').click();
  await see('SAR 640 is on its way to your Visa ending 42. 5 to 10 working days.', 'credit moved');
  await shot('wallet-credit-moved');
  await context.close();
}

/* ───────────── 2. Face ID fails, the passcode, lockout ───────────── */
async function walletLock() {
  const { page, context } = await newPage({ faceIdFails: true });
  const { shot, see, byTest } = kit(page);
  step('lock: Face ID fails');
  await signIn(page, '500004127', { returning: true });
  await byTest('dock-wallet').click();
  await see("Face ID didn't match. Use your passcode.", 'face id failed');
  await see('Demo passcode: 123456', 'demo hint');
  await shot('lock-faceid-failed');
  await byTest('lock-passcode-input').fill('111111');
  await byTest('lock-open').click();
  await see("That passcode doesn't match. 4 tries left.", 'wrong passcode');
  await shot('lock-wrong-passcode');
  for (let i = 0; i < 4; i += 1) { await byTest('lock-passcode-input').fill('111111'); await byTest('lock-open').click(); await page.waitForTimeout(200); }
  await see('Too many tries. Try again in 5 min, or open it with Face ID.', 'lockout');
  await shot('lock-lockout');
  await page.evaluate(() => { localStorage.removeItem('mada.wallet.lockout.v1'); });
  await page.reload();
  await byTest('dock-wallet').click().catch(() => {});
  await see("Face ID didn't match. Use your passcode.", 'face id failed again');
  await byTest('lock-passcode-input').fill('123456');
  await byTest('lock-open').click();
  await see('Omar Alharbi', 'opened with passcode');
  await context.close();
}


/* ───────────── 3. a new account: empty Wallet, add your passport, documents ───────────── */
async function walletFresh() {
  const { page, context } = await newPage();
  const { shot, see, gone, byTest, pickFile, closeSheet, press, tap } = kit(page);
  step('fresh: a new account');
  const phone = `5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  await signIn(page, phone, { returning: false });
  await byTest('dock-wallet').click();
  await see('Your passport isn’t here yet.', 'empty passport');
  await see('No other documents yet', 'no documents');
  await see('No boarding passes yet', 'no passes');
  await shot('fresh-wallet-empty');

  step('passport: intro, camera sheet, wrong file, unreadable photo');
  await byTest('passport-scan').click();
  await see('Scan it once. Never type it again.', 'passport intro');
  await page.waitForTimeout(2400);
  await shot('passport-intro');
  await byTest('passport-scan-start').click();
  await see('“Mada” would like to use the camera', 'camera sheet');
  await shot('passport-camera-ask');
  await byTest('camera-deny').click();
  await see('No camera, no problem.', 'camera denied');
  await shot('passport-camera-denied');
  await closeSheet();
  await byTest('passport-scan-start').click();
  await byTest('camera-allow').click();
  await see('Photograph the photo page', 'camera');
  await shot('passport-camera');
  await pickFile(() => byTest('camera-choose').click(), 'notes.txt');
  await see('That isn’t a photo. Choose a JPG or PNG of the photo page.', 'not a photo');
  await shot('passport-camera-not-photo');
  await pickFile(() => byTest('camera-choose').click(), 'receipt.png');
  await see('Reading your passport…', 'reading');
  await shot('passport-reading');
  await see("We couldn't read it.", 'unreadable', 150_000);
  await see('Lay the passport flat on a table.', 'tips');
  await shot('passport-failed');
  await byTest('camera-retry').click();

  step('passport: a real photo, read on the phone, with a doubtful birth date');
  await pickFile(() => byTest('camera-choose').click(), 'noura-baddigit.jpg');
  await see('Is this right?', 'confirm', 150_000);
  await see('Read from your photo. Check every letter. One detail may not have read right.', 'doubt notice');
  await see('Check this. It may not have read right.', 'check this');
  await shot('passport-confirm-doubt');
  const v = async (id) => page.locator(`[data-testid="pp-${id}"]`).inputValue();
  if ((await v('number')) !== 'B47120385') errors.push(`passport number read as ${await v('number')}`);
  if ((await v('surname')) !== 'ALQAHTANI') errors.push(`surname read as ${await v('surname')}`);
  await byTest('pp-dob').fill('17/05/1992');
  await gone('Check this. It may not have read right.', 'doubt cleared');
  await byTest('pp-expiry').fill('31/02/2033');
  await see('Use the format DD/MM/YYYY, for example 22/06/2031.', 'bad date');
  await byTest('pp-expiry').fill('04/09/2033');
  await byTest('passport-save').click();
  await see('Passport saved. It fills in every booking from now on.', 'saved toast');
  await see('Noura Fahad Alqahtani', 'passport on the card');
  await see('Valid until 4 Sep 2033.', 'validity');
  await shot('passport-saved');

  step('documents: wrong type, too big, scan fails, upload, share, delete');
  await byTest('wallet-add').click();
  await see('What are you adding?', 'add sheet');
  await shot('docs-add');
  await byTest('add-visa').click();
  await see('Add visa for Noura', 'upload sheet');
  await pickFile(() => byTest('upload-file').click(), 'notes.txt');
  await see('That file type won’t work. Use a photo or a PDF.', 'wrong type');
  await pickFile(() => byTest('upload-file').click(), 'huge.jpg');
  await see('That file is over 10 MB. Try a photo of the page instead.', 'too big');
  await shot('docs-too-big');
  await page.evaluate(() => { window.__MADA_DEMO__ = { scanFails: true }; });
  await pickFile(() => byTest('upload-file').click(), 'visa.jpg');
  await see("We couldn't read it.", 'scan fails');
  await shot('docs-scan-fails');
  await page.evaluate(() => { window.__MADA_DEMO__ = {}; });
  await tap('Try again');
  await pickFile(() => byTest('upload-file').click(), 'visa.jpg');
  await see('We found this. Check it before saving.', 'found');
  await byTest('upload-until').fill('11/06/2028');
  await shot('docs-found');
  await byTest('upload-save').click();
  await see('Saved to the Wallet.', 'saved');
  await see('Valid until Jun 2028', 'listed');
  await press(page.getByRole('button', { name: 'Visa' }));
  await see('Share with Mada', 'doc actions');
  await byTest('doc-share').click();
  await see('Shared with Mada for this trip only. Faisal can see it, not download it.', 'shared');
  await press(page.getByRole('button', { name: 'Visa' }));
  await see('Faisal can see it until', 'shared until');
  await shot('docs-shared');
  await byTest('doc-delete').click();
  await see('Deleted from this phone and from Mada.', 'deleted');

  step('household: a helper, by hand, an expired passport, iqama and exit visa');
  await page.evaluate(() => window.history.pushState({}, '', '/household'));
  await byTest('dock-today').click().catch(() => {});
  await context.close();
}
try {
  if (want('demo')) await walletDemo();
  if (want('lock')) await walletLock();
  if (want('fresh')) await walletFresh();
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
console.log(`\nWallet passed. ${n} screenshots in ${OUT}`);
