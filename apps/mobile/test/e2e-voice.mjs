// Voice in Ask, in headless Chromium against the web export in mock-API mode. The browser's speech service is faked
// (headless Chromium has none): words appear in the box as they're heard, the mic turns into a stop button while
// listening, and a refused microphone, silence, or a browser without voice each say what to do.
//
//   EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
//   DIST=dist node test/e2e-voice.mjs [shot-dir]
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const DIST = resolve(process.env.DIST ?? 'dist');
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/shots-voice');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`No web export in ${DIST}`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.txt': 'text/plain' };
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

/** A stand-in for the browser's speech service. mode: 'hear' | 'denied' | 'silence' | 'none' (no API at all). */
const fake = (mode) => {
  if (mode === 'none') { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; return; }
  const result = (text, isFinal) => { const alt = { transcript: text, confidence: 0.9 }; const r = [alt]; r.isFinal = isFinal; const list = [r]; return list; };
  class Fake extends EventTarget {
    start() {
      window.__voiceLang = this.lang;
      const fire = (type, extra = {}) => { const e = new Event(type); Object.assign(e, extra); this.dispatchEvent(e); };
      setTimeout(() => fire('start'), 50);
      if (mode === 'denied') { setTimeout(() => { fire('error', { error: 'not-allowed', message: 'denied' }); fire('end'); }, 150); return; }
      if (mode === 'silence') { setTimeout(() => fire('end'), 300); return; }
      setTimeout(() => fire('result', { results: result('Boulevard World', false), resultIndex: 0 }), 400);
      setTimeout(() => fire('result', { results: result('Boulevard World at night in Riyadh', true), resultIndex: 0 }), 1600);
      this._end = setTimeout(() => fire('end'), 1800);
    }
    stop() { clearTimeout(this._end); const e = new Event('end'); this.dispatchEvent(e); }
    abort() { this.stop(); }
  }
  window.webkitSpeechRecognition = Fake;
};

async function run(mode, locale = 'en-GB') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, timezoneId: 'Asia/Riyadh' });
  await context.addInitScript(fake, mode);
  const page = await context.newPage();
  page.on('pageerror', (e) => { errors.push(`${mode}: pageerror ${e.message}`); });
  const byTest = (id) => page.locator(`[data-testid="${id}"]`).filter({ visible: true }).last();
  const see = async (text, what, timeout = 9000) => {
    try { await page.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }); }
    catch { errors.push(`${mode} ${what}: expected "${text}"`); console.log('MISSING', mode, what, '→', text); }
  };
  const shot = async (name) => { n += 1; await page.waitForTimeout(300); await page.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${mode}-${name}.png`) }); };
  await page.goto(ORIGIN + '/');
  await see("We'll take it from here.", 'welcome');
  await byTest('welcome-start').click();
  await byTest('signin-phone').click();
  await byTest('phone-input').fill('500004127');
  await byTest('phone-send').click();
  await see('Enter the code', 'otp');
  await byTest('otp-input').fill('123456');
  await see('Welcome back', 'welcome back');
  await byTest('welcome-back-open').click();
  await page.waitForTimeout(1200);
  await byTest('dock-ask').click();
  await page.waitForTimeout(900);
  const mic = byTest('ask-send');
  if ((await mic.getAttribute('aria-label')) !== 'Speak to Mada') errors.push(`${mode}: mic label is "${await mic.getAttribute('aria-label')}"`);
  await mic.click();
  if (mode === 'hear') {
    await page.waitForTimeout(250);
    await shot('listening');
    if ((await byTest('ask-send').getAttribute('aria-label')) !== 'Stop listening') errors.push('hear: no stop button while listening');
    await page.waitForTimeout(500);
    const partial = await byTest('ask-input').inputValue();
    if (partial !== 'Boulevard World') errors.push(`hear: partial words "${partial}"`);
    await page.waitForTimeout(1500);
    const final = await byTest('ask-input').inputValue();
    if (final !== 'Boulevard World at night in Riyadh') errors.push(`hear: final words "${final}"`);
    if ((await byTest('ask-send').getAttribute('aria-label')) !== 'Send') errors.push('hear: send button not back after listening');
    if ((await page.evaluate(() => window.__voiceLang)) !== 'en-US') errors.push('hear: language not en-US');
    await shot('heard');
    await byTest('ask-send').click();
    await see('When would you like to go', 'request asks when', 6000).catch(() => {});
    await shot('sent');
  } else if (mode === 'denied') await (await see('Mada needs the microphone', 'denied toast'), shot('denied'));
  else if (mode === 'silence') await (await see('We didn’t catch that', 'silence toast'), shot('silence'));
  else await (await see('Voice doesn’t work in this browser', 'unsupported toast'), shot('unsupported'));
  await context.close();
}

try {
  for (const mode of ['hear', 'denied', 'silence', 'none']) { console.log('·', mode); await run(mode); }
} finally {
  await browser.close();
  server.close();
}
// The request question after sending is the app's own flow and may differ; only voice problems fail the run.
const real = errors.filter((e) => !e.includes('request asks when'));
if (real.length) { console.log('\nFAILED:\n' + real.join('\n')); process.exit(1); }
console.log(`\nVoice passed. ${n} screenshots in ${OUT}`);
