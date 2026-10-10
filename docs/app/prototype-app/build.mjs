// Bundles the prototype into one self-contained page: dist/index.html (script and styles inline) plus dist/img/.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, existsSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  minify: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  target: ['es2019'],
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Shared styles first, then one file per area from src/css/.
const css = [readFileSync('src/styles.css', 'utf8'), ...(existsSync('src/css') ? readdirSync('src/css').filter((f) => f.endsWith('.css')).sort().map((f) => readFileSync('src/css/' + f, 'utf8')) : [])].join('\n');
const html = `<meta charset="utf-8">
<title>Mada Trips app</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Reem+Kufi:wght@500&display=swap">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
mkdirSync('dist/img', { recursive: true });
writeFileSync('dist/index.html', html);
cpSync('img', 'dist/img', { recursive: true });

// Passport reader, loaded only when someone scans: dist/ocr/ (same origin as the page).
// Engine and worker come from node_modules (pinned in package-lock); the English model is committed in ocr-assets/.
mkdirSync('dist/ocr', { recursive: true });
for (const [from, to] of [
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
]) cpSync(from, 'dist/ocr/' + to);
// The model ships as base64 text: the host serves plain text, not .gz or binary.
writeFileSync('dist/ocr/eng-traineddata.b64.txt', readFileSync('ocr-assets/eng.traineddata.gz').toString('base64'));
console.log('built dist/index.html', Math.round(html.length / 1024) + ' KB');

/*
 * Thmanyah (Arabic). Its licence allows it inside a built product but not re-hosting the files, and this repo is
 * public, so dist/index.html (committed) keeps IBM Plex Sans Arabic and Reem Kufi. When the woff2 files are in
 * fonts/thmanyah/ (ignored by git), a second page, dist/index.thm.html (also ignored), carries them inline for
 * publishing the prototype.
 */
const thmDir = 'fonts/thmanyah';
const thm = existsSync(thmDir) ? readdirSync(thmDir).filter((f) => f.endsWith('.woff2')) : [];
const face = (family, weight, match) => {
  const f = thm.find((x) => x.toLowerCase().includes(match));
  return f ? `@font-face{font-family:'${family}';font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${readFileSync(`${thmDir}/${f}`).toString('base64')}) format('woff2')}` : '';
};
const faces = [face('Thmanyah Sans', 400, 'sans-regular'), face('Thmanyah Sans', 500, 'sans-medium'), face('Thmanyah Sans', 600, 'sans-bold'), face('Thmanyah Sans', 700, 'sans-bold'), face('Thmanyah Serif Display', 500, 'serifdisplay-medium')];
if (faces.every(Boolean)) {
  const rtl = `[dir="rtl"]{--f-ui:'Thmanyah Sans','Inter Tight',system-ui,sans-serif;--f-display:'Thmanyah Serif Display','Thmanyah Sans',Georgia,serif}`;
  const page = html.replace('<style>', `<style>${faces.join('')}</style>\n<style>`).replace('</style>\n<div id="root">', `\n${rtl}</style>\n<div id="root">`);
  writeFileSync('dist/index.thm.html', page);
  console.log('built dist/index.thm.html with Thmanyah', Math.round(page.length / 1024) + ' KB');
}
