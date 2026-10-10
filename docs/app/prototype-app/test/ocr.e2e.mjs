// End to end: real passport reading in headless Chromium, from synthetic photos in test/fixtures/.
// Serves dist/ over http (web workers don't run from file://), walks onboarding to the camera step,
// picks each photo and checks what lands on the confirm screen. Then reads one through the Wallet.
// Usage: npm run build && node test/ocr.e2e.mjs [screenshot-dir]
// Regenerate the photos with: python3 test/make-passports.py test/fixtures
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const OUT = process.argv[2] || 'test/shots';
mkdirSync(OUT, { recursive: true });
const ROOT = resolve('dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const fx = (f) => resolve('test/fixtures', f);
// What each photo should give. `fail` means the can't-read screen; `fileErr` means it's refused before reading.
const CASES = [
  { file: 'noura-photo.jpg', what: 'clean photo on a table', want: { given: 'NOURA FAHAD', surname: 'ALQAHTANI', number: 'B47120385', nationality: 'Saudi Arabia', dob: '17/05/1992', expiry: '04/09/2033' } },
  { file: 'noura-tilt8.jpg', what: 'tilted 8 degrees', want: { given: 'NOURA FAHAD', surname: 'ALQAHTANI', number: 'B47120385', nationality: 'Saudi Arabia', dob: '17/05/1992', expiry: '04/09/2033' } },
  { file: 'noura-hard.jpg', what: 'blurred, noisy, small, tilted', want: { given: 'NOURA FAHAD', surname: 'ALQAHTANI', number: 'B47120385', nationality: 'Saudi Arabia', dob: '17/05/1992', expiry: '04/09/2033' } },
  { file: 'anna-photo.jpg', what: 'ICAO specimen, expired 2012', want: { given: 'ANNA MARIA', surname: 'ERIKSSON', number: 'L898902C3', nationality: 'Utopia', dob: '12/08/1974', expiry: '15/04/2012' }, expired: true },
  { file: 'noura-baddigit.jpg', what: 'birth date misprinted (check fails)', want: { given: 'NOURA FAHAD', surname: 'ALQAHTANI', number: 'B47120385', nationality: 'Saudi Arabia', dob: '18/05/1992', expiry: '04/09/2033' }, flag: ['dob'] },
  { file: 'receipt.png', what: 'not a passport', fail: true },
  { file: 'notes.txt', what: 'not an image', fileErr: true },
];

const exe = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1200, height: 920 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`); });
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
const phone = page.locator('.phone');
const click = async (name, wait = 350) => { await phone.getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(wait); };
let n = 0;
const shot = async (name) => { n += 1; await phone.screenshot({ path: `${OUT}/ocr-${String(n).padStart(2, '0')}-${name}.png` }); };

const results = [];
let fieldsRight = 0; let fieldsTotal = 0;
try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await click('Start');
  await click('Use my phone number');
  await phone.locator('#phone').fill('512345678');
  await click('Text me a code');
  await phone.locator('#otp').fill('123456');
  await page.waitForTimeout(800);
  // Sign-up goes straight in (name, alerts); the passport is added from Today's "Add your passport".
  await phone.locator('#nick').fill('Omar');
  await click('Let\u2019s go, Omar', 700);
  await click('Not now', 700);
  await phone.getByRole('button', { name: /Add your passport/ }).first().click();
  await page.waitForTimeout(500);
  await click('Scan passport');
  await click('Allow');
  await shot('camera');

  for (const c of CASES) {
    const t0 = Date.now();
    await phone.locator('input[type=file]:not([capture])').setInputFiles(fx(c.file));
    if (c.fileErr) {
      await phone.getByRole('alert').first().waitFor({ timeout: 5000 });
      const msg = await phone.getByRole('alert').first().textContent();
      results.push({ ...c, pass: /photo/i.test(msg), note: msg });
      await shot('file-error');
      continue;
    }
    await page.waitForTimeout(400);
    if (c.file === CASES[0].file) await shot('reading');
    // Wait for the confirm screen or the can't-read screen.
    await page.waitForFunction(() => document.querySelector('#pp-given') || /couldn't read it/.test(document.querySelector('.phone').textContent), null, { timeout: 120000 });
    const ms = Date.now() - t0;
    const onConfirm = await phone.locator('#pp-given').count();
    if (c.fail) {
      results.push({ ...c, ms, pass: !onConfirm, note: onConfirm ? 'filled the form from a non-passport' : 'showed the can’t-read tips' });
      await shot('cant-read');
      await click('Try again');
      continue;
    }
    if (!onConfirm) { results.push({ ...c, ms, pass: false, note: 'no MRZ found' }); await shot('missed-' + c.file); await click('Try again'); continue; }
    const got = {};
    for (const k of Object.keys(c.want)) got[k] = await phone.locator('#pp-' + k).inputValue();
    const flagged = await phone.locator('[id$="-check"]').evaluateAll((els) => els.map((e) => e.id.replace(/^pp-|-check$/g, '')));
    const wrong = Object.keys(c.want).filter((k) => got[k] !== c.want[k]);
    fieldsTotal += Object.keys(c.want).length; fieldsRight += Object.keys(c.want).length - wrong.length;
    const note = await phone.getByText('Read from your photo. Check every letter.', { exact: false }).count();
    const expiredShown = await phone.getByText('This passport has expired.').count();
    const wantFlags = (c.flag || []).join(',');
    const pass = !wrong.length && note > 0 && (!c.expired || expiredShown > 0) && flagged.join(',') === wantFlags;
    results.push({ ...c, ms, pass, wrong: wrong.map((k) => `${k}: got "${got[k]}"`), flagged, note: wrong.length ? '' : flagged.length && !wantFlags ? 'right, but flagged' : wantFlags ? 'read as printed, doubtful field marked' : 'all fields right' });
    await shot('confirm-' + c.file.replace(/\..*$/, ''));
    await phone.getByRole('button', { name: 'Back' }).first().click();
    await page.waitForTimeout(400);
  }

  // Wallet: save the demo passport (straight back to Today), then add a passport through the Wallet sheet.
  await click('Use the demo passport', 2800);
  await click('Yes, save it', 800);
  await phone.getByRole('button', { name: 'Wallet' }).click();
  await page.waitForTimeout(1500);
  await phone.getByRole('button', { name: 'Add a document', exact: true }).first().click();
  await page.waitForTimeout(300);
  await click('Passport');
  const t0 = Date.now();
  await phone.locator('.sheet input[type=file]:not([capture])').setInputFiles(fx('noura-photo.jpg'));
  await page.waitForFunction(() => /Read from your photo|couldn't read it/.test(document.querySelector('.phone').textContent), null, { timeout: 120000 });
  const sheetText = await phone.locator('.sheet').textContent();
  const walletOk = /B47120385/.test(sheetText) && /ALQAHTANI/.test(sheetText) && /04\/09\/2033/.test(sheetText);
  results.push({ file: 'noura-photo.jpg', what: 'Wallet › Add › Passport', ms: Date.now() - t0, pass: walletOk, note: walletOk ? 'name, number and expiry read' : sheetText.slice(0, 200) });
  await shot('wallet-found');
  await click('Save', 600);
  const saved = await phone.getByText('B47120385 · expires 04/09/2033').count();
  results.push({ file: '', what: 'Wallet saves it', pass: saved > 0, note: saved ? 'listed under other documents' : 'not listed' });
} catch (e) {
  errors.push('flow: ' + e.message.split('\n')[0]);
  await shot('FAILED');
}

console.log('\nfile                 case                               result   time    notes');
for (const r of results) console.log(`${(r.file || '').padEnd(20)} ${r.what.padEnd(34)} ${r.pass ? 'pass' : 'FAIL'}     ${r.ms ? (r.ms / 1000).toFixed(1) + 's' : '    '}    ${[r.note, ...(r.wrong || []), r.flagged && r.flagged.length ? 'flagged: ' + r.flagged.join(', ') : ''].filter(Boolean).join('; ')}`);
if (fieldsTotal) console.log(`\nFields read exactly right: ${fieldsRight}/${fieldsTotal}`);
const failed = results.filter((r) => !r.pass);
console.log(errors.length ? '\nPROBLEMS:\n' + errors.join('\n') : '');
console.log(failed.length || errors.length ? `${failed.length} case(s) failed.` : 'All passport reading checks passed.');
await browser.close();
server.close();
process.exit(failed.length || errors.length ? 1 : 0);
