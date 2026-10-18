// eSIMs (eSIM Access or Airalo; the mock here), end to end in headless Chromium against the web export (react-native-web, mock API), in English
// and in Arabic.
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-esim.mjs [shot-dir]
//
// Signs in as the demo account, asks Ask for internet in Istanbul: the plan for Türkiye in three sizes priced in SAR,
// who needs one, "does your phone take an eSIM?" (not sure → the steps to check), the order sheet, paying; then the
// install screen (iPhone one-tap link, Android QR code and the codes to type, the steps for when you land), "I've
// installed it", what's left, a top-up paid on the order sheet, "Not connecting?" step by step and Talk to Mada; last, an eSIM the
// supplier can't give: refunded at once, with the outcome. Entry points: Ask's "Internet abroad" chip, "Covers your 7
// days" on each plan, the Wallet's eSIMs, other words in Ask ("data", "نت"). After booking and on the trip page:
// e2e-booking. Screenshots each at 390×844. Fails on any page error or
// missing text.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-esim');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}. Run: EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist`);

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
let n = 0;
const step = (s) => console.log('·', s);

const COPY = {
  en: {
    ask: 'Internet for Istanbul', title: 'Internet in Türkiye, on when you land.', each: 'each', light: 'Light', regular: 'Most people', heavy: 'Heavy',
    phone: 'Does your phone take an eSIM?', check: 'Check in a minute', thisPhone: 'This phone takes an eSIM.', payTitle: 'An eSIM for Türkiye', line: 'Türkiye ·',
    install: 'Install it now. It switches on when you land.', ios: 'Install on this iPhone', qr: 'Scan this with the phone it’s for.', codes: 'Activation code',
    land: 'When you land', installedToast: 'Installed. It switches on when you land.', left: 'left of', topupTitle: 'More GB for Türkiye', topLine: 'Top up ·', topupToast: 'The GB are on your eSIM.',
    trouble: 'Let’s get you online', talk: 'Talk to Mada', refunded: 'This eSIM didn’t come through.', ready: 'Ready to install',
    idea: 'Internet abroad', which: 'Which trip is it for?', covers: 'Covers your 7 days', wallet: 'eSIMs', walletRow: 'Internet in Türkiye', ask2: 'data for Istanbul',
  },
  ar: {
    ask: 'شريحة انترنت لإسطنبول', title: 'نت في تركيا، يشتغل أول ما تهبط.', each: 'للواحد', light: 'خفيف', regular: 'الأغلب ياخذونه', heavy: 'ثقيل',
    phone: 'جوالك يدعم eSIM؟', check: 'تأكد في دقيقة', thisPhone: 'هذا الجوال يدعم eSIM.', payTitle: 'شريحة eSIM لـ تركيا', line: 'تركيا ·',
    install: 'نزّلها الحين، وتشتغل لما تهبط.', ios: 'نزّلها على هذا الآيفون', qr: 'صوّر هذا بالجوال اللي بتركبها فيه.', codes: 'رمز التفعيل',
    land: 'لما تهبط', installedToast: 'تمام. تشتغل لما تهبط.', left: 'باقي', topupTitle: 'جيجات زيادة لـ تركيا', topLine: 'شحن ·', topupToast: 'الجيجات صارت على شريحتك.',
    trouble: 'خلّنا نوصلك بالنت', talk: 'كلّم مادا', refunded: 'هذي الشريحة ما وصلت.', ready: 'جاهزة تنزّلها',
    idea: 'إنترنت برّا', which: 'لأي رحلة؟', covers: 'تغطي أيامك الـ7', wallet: 'شرائح النت', walletRow: 'النت في تركيا', ask2: 'نت لإسطنبول',
  },
};

async function run(lang) {
  const c = COPY[lang];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: lang === 'ar' ? 'ar-SA' : 'en-GB', timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${lang} pageerror: ${e.message}`); console.log('PAGEERROR', e.message); });
  const shot = async (name) => { n += 1; await page.waitForTimeout(700); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${lang}-${name}.png`) }); };
  const see = async (text, what, timeout = 9000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); return true; }
    catch { errors.push(`${lang} ${what}: expected "${text}"`); console.log('MISSING', lang, what, '→', text); return false; }
  };
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const press = async (id) => { const l = byTest(id); await l.waitFor({ state: 'visible', timeout: 9000 }); await l.evaluate((el) => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(200); await l.click(); };
  const slide = async () => {
    const track = page.locator('[role="slider"]').last();
    await track.waitFor({ state: 'visible', timeout: 9000 });
    await track.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const b = await track.boundingBox();
    const y = b.y + b.height / 2;
    const [x0, x1] = lang === 'ar' ? [b.x + b.width - 30, b.x + 10] : [b.x + 30, b.x + b.width - 10];
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i += 1) { await page.mouse.move(x0 + ((x1 - x0) * i) / 12, y); await page.waitForTimeout(16); }
    await page.mouse.up();
  };
  const closeSheet = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(450); };
  const openAsk = async () => { await press('dock-ask'); await page.waitForTimeout(600); };

  step(`${lang}: sign in as the demo account`);
  await page.goto(ORIGIN + '/');
  await page.evaluate(() => document.fonts.ready);
  await byTest('welcome-start').waitFor({ state: 'visible', timeout: 15000 });
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await byTest('otp-input').waitFor({ state: 'visible', timeout: 10000 });
  await byTest('otp-input').fill('123456');
  try { await byTest('welcome-back-open').waitFor({ state: 'visible', timeout: 6000 }); await byTest('welcome-back-open').click(); } catch { /* straight in */ }
  await page.waitForTimeout(1500);

  step(`${lang}: Ask's start has "Internet abroad" → the plans ask which trip`);
  await openAsk();
  await see(c.idea, 'internet abroad chip');
  await press('ask-idea-esim');
  await see(c.which, 'which trip', 12000);
  await shot('entry-ask-chip');
  await page.goBack();
  await page.waitForTimeout(1000);

  step(`${lang}: Ask for internet in Istanbul → the plan for Türkiye`);
  // Back lands on Ask's start again (or on Today, depending on how Ask was opened).
  if (!(await byTest('ask-input').count())) await openAsk();
  await byTest('ask-input').fill(c.ask);
  await byTest('ask-send').click();
  await see(c.title, 'plan title', 12000);
  await see(c.light, 'light size');
  await see(c.regular, 'regular size');
  await see(c.heavy, 'heavy size');
  await see(c.each, 'price each');
  await see(c.covers, 'covers your days');
  const reviewBefore = await byTest('esim-review').getAttribute('aria-disabled');
  if (reviewBefore !== 'true') errors.push(`${lang} review allowed before the phone check`);
  await shot('plans');

  step(`${lang}: not sure about the phone → the steps, then it takes one`);
  await press('esim-phone-unsure');
  await see(c.check, 'check sheet');
  await shot('phone-check');
  await press('esim-check-yes');
  await page.waitForTimeout(500);
  await see(c.thisPhone, 'phone ok');
  await press('esim-plan-regular');
  await shot('ready-to-review');

  step(`${lang}: the order sheet and paying`);
  await press('esim-review');
  await see(c.payTitle, 'pay title', 12000);
  await see(c.line, 'pay line');
  await shot('pay');
  await page.waitForTimeout(500);
  await slide();

  step(`${lang}: after paying, the eSIMs to install`);
  await see(c.ready, 'ready to install', 15000);
  await shot('esims');
  await press('esim-open');
  await see(c.install, 'install title');
  await see(c.ios, 'iPhone one-tap');
  const link = await page.locator('a[href^="https://esimsetup.apple.com"]').count();
  void link;
  await see(c.land, 'steps when you land');
  await shot('install-iphone');
  await press('esim-tab-android');
  await byTest('esim-qr').waitFor({ state: 'visible', timeout: 6000 }).catch(() => errors.push(`${lang} QR code missing`));
  await see(c.qr, 'scan line');
  await press('esim-manual');
  await see(c.codes, 'activation code');
  const code = await byTest('esim-code').innerText().catch(() => '');
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code.trim())) errors.push(`${lang} activation code looks wrong: "${code}"`);
  await shot('install-android');

  step(`${lang}: installed → what's left, top up`);
  await press('esim-installed');
  await see(c.installedToast, 'installed toast');
  await see(c.left, 'GB left');
  await shot('on-trip');
  await press('esim-topup');
  await see(c.topupTitle, 'top-up sheet');
  await shot('topup');
  await press('esim-topup-light');
  await see(c.topLine, 'top-up pay line', 12000);
  await page.waitForTimeout(800);
  await slide();
  await see(c.topupToast, 'top-up toast', 15000);
  await shot('topped-up');

  step(`${lang}: not connecting → the checks → Talk to Mada`);
  await press('esim-trouble');
  await see(c.trouble, 'trouble sheet');
  await shot('trouble');
  // One check at a time (roaming, the line for data, the APN when there is one, airplane mode, restart), then Mada.
  for (let i = 0; i < 6 && (await byTest('esim-tr-next').count()); i += 1) await press('esim-tr-next');
  await shot('trouble-last');
  await press('esim-talk');
  await page.waitForTimeout(1500);
  await shot('talk');

  step(`${lang}: the Wallet lists the eSIM`);
  await page.evaluate(() => { window.history.pushState({}, '', '/wallet'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(1500);
  await byTest('wallet-esims').waitFor({ state: 'visible', timeout: 12000 }).catch(() => errors.push(`${lang} wallet eSIMs section missing`));
  await byTest('wallet-esims').evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await see(c.wallet, 'wallet eSIMs title');
  await see(c.walletRow, 'wallet eSIM row');
  await shot('entry-wallet');

  step(`${lang}: the supplier can't give it → refunded, with the outcome`);
  // In the app (a reload would start the in-memory mock afresh): back to Today, then Ask.
  await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(2000);
  await openAsk();
  await press('ask-demo');
  await page.getByRole('button', { name: 'eSIM not available', exact: true }).last().click();
  await closeSheet();
  // Other words for the same thing: "data", "نت".
  await byTest('ask-input').fill(c.ask2);
  await byTest('ask-send').click();
  await see(c.title, 'plan title (again)', 12000);
  await press('esim-phone-iphone');
  await press('esim-review');
  await see(c.payTitle, 'pay title (again)', 12000);
  await see(c.line, 'pay line (again)');
  await page.waitForTimeout(800);
  await slide();
  await see(c.refunded, 'refunded', 15000);
  await shot('refunded');
  await context.close();
}

try {
  await run('en');
  await run('ar');
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${n} screenshots in ${OUT}`);
if (errors.length) { console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log('e2e esim: all good');
