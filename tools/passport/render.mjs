// Renders assets/img/passport.jpg (Visa Support card) from scene.html.
//   node tools/passport/render.mjs
import { chromium } from 'playwright';
const out = process.argv[2] || new URL('../../assets/img/passport.jpg', import.meta.url).pathname;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1.5 });
await p.goto(new URL('scene.html', import.meta.url).href, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(400);
await p.screenshot({ path: out, type: 'jpeg', quality: 84 });
await b.close();
