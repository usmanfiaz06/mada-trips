// Reads the machine-readable zone off a photo of a passport, on the phone, with Tesseract.
// Everything loads lazily from ocr/ next to the page (same origin), only when someone scans.
//   ocr/tesseract.min.js           browser API (window.Tesseract)
//   ocr/worker.min.js              web worker
//   ocr/tesseract-core-simd-lstm.js + .wasm   OCR engine
//   ocr/eng.traineddata.gz         English "fast" model
import { findMrz } from './mrz.js';

export const MAX_BYTES = 10 * 1024 * 1024;
const BASE = 'ocr/';
const abs = (p) => new URL(BASE + p, document.baseURI).href;

let workerPromise = null;
let listener = null; // progress listener for the scan in flight

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load the reader'));
    document.head.appendChild(el);
  });
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') throw new Error('This browser can’t read passports');
      await loadScript(abs('tesseract.min.js'));
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: abs('worker.min.js'),
        corePath: abs('tesseract-core-simd-lstm.js'),
        langPath: new URL(BASE, document.baseURI).href.replace(/\/$/, ''),
        workerBlobURL: false,
        gzip: true,
        logger: (m) => { if (listener) listener(m); },
      });
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '0',
      });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Start downloading the reader early (for example when the camera step opens). Never throws. */
export function warmUp() { getWorker().catch(() => {}); }

/** Check a picked file before reading. Returns an error sentence, or null. */
export function checkFile(file) {
  if (!file) return 'No photo was chosen.';
  if (!/^image\//.test(file.type || '') && !/\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(file.name || '')) return 'That isn’t a photo. Choose a JPG or PNG of the photo page.';
  if (file.size > MAX_BYTES) return 'That photo is over 10 MB. Try a smaller one, or take a new photo.';
  return null;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo couldn’t be opened. Try a JPG or PNG.')); };
    img.src = url;
  });
}

/** Draw the photo onto a canvas no wider than maxW, turned by `turn` radians (about its centre). */
function toCanvas(src, { maxW = 2000, turn = 0 } = {}) {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  const k = Math.min(1, maxW / Math.max(sw, sh));
  const w = Math.round(sw * k);
  const h = Math.round(sh * k);
  const cos = Math.abs(Math.cos(turn));
  const sin = Math.abs(Math.sin(turn));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * cos + h * sin);
  canvas.height = Math.round(w * sin + h * cos);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(turn);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  return canvas;
}

/**
 * How far the text lines lean, in radians. Finds ink (pixels darker than their surroundings),
 * then picks the angle whose row profile is peakiest. Handles roughly +/- 12 degrees.
 */
function estimateSkew(src) {
  const small = toCanvas(src, { maxW: 700 });
  const w = small.width;
  const h = small.height;
  const px = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) g[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  // Integral image for local means.
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) { row += g[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
  }
  const r = 12;
  const xs = []; const ys = [];
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r); const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r); const x1 = Math.min(w, x + r + 1);
      const mean = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0));
      if (g[y * w + x] < mean - 18) { xs.push(x); ys.push(y); }
    }
  }
  if (xs.length < 200) return 0;
  const stride = Math.max(1, Math.floor(xs.length / 60000));
  const bins = h + w + 2;
  const scoreAt = (deg) => {
    const a = (deg * Math.PI) / 180; const c = Math.cos(a); const sn = Math.sin(a);
    const hist = new Float64Array(bins);
    for (let i = 0; i < xs.length; i += stride) hist[Math.round(ys[i] * c - xs[i] * sn) + w] += 1;
    let sum = 0; for (let i = 0; i < bins; i += 1) sum += hist[i] * hist[i];
    return sum;
  };
  let best = 0; let bestScore = -1;
  for (let d = -12; d <= 12; d += 0.5) { const sc = scoreAt(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  for (let d = best - 0.4; d <= best + 0.4; d += 0.1) { const sc = scoreAt(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  return Math.abs(best) < 0.3 ? 0 : (best * Math.PI) / 180;
}

/**
 * Take a horizontal band of the canvas (y0..y1 as fractions), grey and contrast-stretched,
 * optionally thresholded (Otsu). Output is `width` px wide.
 */
function prepare(src, { y0 = 0, y1 = 1, width = 1600, threshold = false } = {}) {
  const sw = src.width;
  const sh = Math.round(src.height * (y1 - y0));
  const sy = Math.round(src.height * y0);
  const scale = width / sw;
  const w = Math.round(sw * scale);
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, sy, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const grey = new Uint8ClampedArray(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) {
    grey[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    hist[grey[j]] += 1;
  }
  // Stretch between the 2nd and 98th percentiles.
  const total = w * h;
  let lo = 0; let hi = 255; let acc = 0;
  for (let v = 0; v < 256; v += 1) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v -= 1) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  let cut = 128;
  if (threshold) {
    const h2 = new Uint32Array(256);
    for (let j = 0; j < grey.length; j += 1) h2[Math.max(0, Math.min(255, ((grey[j] - lo) * 255) / span)) | 0] += 1;
    let sum = 0; for (let v = 0; v < 256; v += 1) sum += v * h2[v];
    let sumB = 0; let wB = 0; let best = 0;
    for (let v = 0; v < 256; v += 1) {
      wB += h2[v]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += v * h2[v];
      const mB = sumB / wB; const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; cut = v; }
    }
  }
  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) {
    let v = ((grey[j] - lo) * 255) / span;
    if (threshold) v = v > cut ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

const rank = (r) => (r && r.fields ? (r.ok ? 1000 : 0) + Object.values(r.checks).filter(Boolean).length * 10 - r.doubtful.length : -1);

/**
 * Read a passport photo.
 * onProgress(0..100) is called as it goes.
 * Resolves to the findMrz() result plus { attempts, text }. Rejects only for files that can't be opened
 * or a reader that can't load; "no MRZ found" resolves with ok:false and fields:null.
 */
export async function readPassport(file, onProgress = () => {}) {
  const bad = checkFile(file);
  if (bad) throw new Error(bad);
  let pct = 0;
  const report = (v) => { const n = Math.max(pct, Math.min(100, Math.round(v))); if (n !== pct) { pct = n; onProgress(n); } };
  report(2);
  const { img, url } = await loadImage(file);
  try {
    // Loading the reader is 0-30%. Each attempt then gets a slice of the rest.
    let phase = { from: 2, to: 30 };
    listener = (m) => {
      if (typeof m.progress !== 'number') return;
      if (m.status === 'recognizing text') report(phase.from + (phase.to - phase.from) * m.progress);
      else if (phase.to <= 30) report(phase.from + (phase.to - phase.from) * Math.min(1, m.progress) * (/core/.test(m.status) ? 0.5 : 1));
    };
    const worker = await getWorker();
    report(30);

    // Straighten the page first; a few degrees of lean is enough to lose a line.
    const skew = estimateSkew(img);
    const straight = toCanvas(img, { turn: -skew });
    const tries = [
      { y0: 0.62, y1: 1, threshold: false, psm: '6' }, // the MRZ band at the bottom of the page
      { y0: 0.62, y1: 1, threshold: true, psm: '6' },
      { y0: 0.4, y1: 1, threshold: false, psm: '6' }, // page photographed with space below it
      { y0: 0, y1: 1, threshold: false, psm: '3' }, // whole photo
    ];
    // A page photographed sideways: only worth trying when nothing turned up.
    const sideways = [
      { turn: Math.PI / 2, y0: 0.5, y1: 1, threshold: false, psm: '6' },
      { turn: -Math.PI / 2, y0: 0.5, y1: 1, threshold: false, psm: '6' },
    ];
    const step = 66 / tries.length;
    let best = null;
    const texts = [];
    const attempt = async (t, from, to) => {
      phase = { from, to };
      const canvas = prepare(t.turn ? toCanvas(straight, { turn: t.turn }) : straight, t);
      await worker.setParameters({ tessedit_pageseg_mode: t.psm });
      const { data } = await worker.recognize(canvas);
      texts.push(data.text);
      const r = findMrz(data.text);
      if (rank(r) > rank(best)) best = { ...r, attempt: texts.length - 1 };
      report(to);
    };
    for (let i = 0; i < tries.length && !(best && best.ok); i += 1) await attempt(tries[i], 30 + step * i, 30 + step * (i + 1));
    for (let i = 0; i < sideways.length && !(best && best.fields); i += 1) await attempt(sideways[i], 96 + i * 2, 98 + i * 2);
    report(100);
    return { ...best, attempts: texts.length, text: texts.join('\n---\n') };
  } finally {
    listener = null;
    URL.revokeObjectURL(url);
  }
}
