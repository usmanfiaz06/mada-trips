// Bundles the prototype into one self-contained page: dist/index.html (script and styles inline) plus dist/img/.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';

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
const css = readFileSync('src/styles.css', 'utf8');
const html = `<title>Mada Trips app</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap">
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
