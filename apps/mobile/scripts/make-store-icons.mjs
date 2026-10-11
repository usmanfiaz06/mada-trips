// Android's extra icons, drawn from the same sun as make-icons.mjs:
//   notification-icon.png  96×96, white on transparent (Android tints it; a coloured icon shows as a grey square)
//   icon-monochrome.png    1024×1024 adaptive-icon monochrome layer (Android 13 themed icons)
// Run: node scripts/make-store-icons.mjs (needs the Playwright Chromium in /opt/pw-browsers or PW_CHROMIUM).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
// The sun's paths, read from make-icons.mjs so there is one copy of the drawing.
const PATHS = [...readFileSync(new URL('./make-icons.mjs', import.meta.url), 'utf8').matchAll(/<path d="([^"]+)"\/>/g)].map((m) => m[1]).slice(0, 9);
const sun = (fill) => `<g fill="${fill}">${PATHS.map((d) => `<path d="${d}"/>`).join('')}</g>`;
const page = (size, sunW, fill) => `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;display:grid;place-items:center"><svg width="${sunW}" height="${sunW * 0.67}" viewBox="0 0 132.31 88.61">${sun(fill)}</svg></div></body></html>`;
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const shot = async (file, size, sunW, fill) => { await p.setViewportSize({ width: size, height: size }); await p.setContent(page(size, sunW, fill)); await p.screenshot({ path: file, omitBackground: true }); };
await shot('assets/images/notification-icon.png', 96, 80, '#ffffff');
await shot('assets/images/icon-monochrome.png', 1024, 440, '#000000');
await b.close();
