// Renders the company profile to PDF and per-page PNG previews.
// Usage: node profile/build.js   (from the repo root)
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const dir = __dirname;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1123, height: 794 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  await page.pdf({ path: path.join(dir, 'Mada-Company-Profile.pdf'), width: '297mm', height: '210mm', printBackground: true, preferCSSPageSize: true });

  if (process.argv.includes('--previews')) {
    const out = process.argv[process.argv.indexOf('--previews') + 1];
    const pages = await page.$$('.page');
    for (let i = 0; i < pages.length; i++) {
      await pages[i].screenshot({ path: path.join(out, `p${String(i + 1).padStart(2, '0')}.png`) });
    }
  }
  await browser.close();
})();
