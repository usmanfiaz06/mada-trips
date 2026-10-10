/* eslint-disable @typescript-eslint/no-explicit-any */
import { findMrz, type MrzResult } from '@mada/shared';

/*
 * Reading the passport on the device, web build: the prototype's reader (docs/app/prototype-app/src/ocr.js), with
 * Tesseract loaded lazily from /ocr/ on the same origin (scripts/copy-ocr.mjs puts it in public/ocr at export).
 * Phones use ocr.native.ts (ML Kit text recognition, on device). Either way the photo never leaves the phone:
 * only the fields the traveller checks are sent, and the number is encrypted on the server.
 */

export type ReadResult = MrzResult & { attempts?: number };

const BASE = '/ocr/';
let workerPromise: Promise<any> | null = null;
let listener: ((m: { status: string; progress: number }) => void) | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((globalThis as any).Tesseract) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('reader'));
    document.head.appendChild(el);
  });
}

function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') throw new Error('reader');
      await loadScript(`${BASE}tesseract.min.js`);
      const b64 = (await (await fetch(`${BASE}eng-traineddata.b64.txt`)).text()).trim();
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const model = URL.createObjectURL(new Blob([bytes]));
      const worker = await (globalThis as any).Tesseract.createWorker('eng', 1, {
        langPath: `${model}#`, gzip: false, cacheMethod: 'none', workerBlobURL: false,
        workerPath: new URL(`${BASE}worker.min.js`, location.href).href, corePath: new URL(`${BASE}tesseract-core-simd-lstm.js`, location.href).href,
        logger: (m: { status: string; progress: number }) => { listener?.(m); },
      });
      await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<', tessedit_pageseg_mode: '6', preserve_interword_spaces: '0' });
      return worker;
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Start loading the reader early (when the camera step opens). Never throws. */
export function warmUp(): void { if (typeof document !== 'undefined') getWorker().catch(() => {}); }

/** True where this build can read a photo (the web reader, or ML Kit in a development build). */
export const canReadPhotos = () => typeof document !== 'undefined';

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('open'));
    img.src = uri;
  });
}

/** Draw the photo onto a canvas no wider than maxW, turned by `turn` radians (about its centre). */
function toCanvas(src: any, { maxW = 2000, turn = 0 }: { maxW?: number; turn?: number } = {}): HTMLCanvasElement {
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
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
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
function estimateSkew(src: any): number {
  const small = toCanvas(src, { maxW: 700 });
  const w = small.width;
  const h = small.height;
  const px: any = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const g: any = new Float32Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 1) g[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  // Integral image for local means.
  const S: any = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) { row += g[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; }
  }
  const r = 12;
  const xs: any[] = []; const ys: any[] = [];
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
  const scoreAt = (deg: number) => {
    const a = (deg * Math.PI) / 180; const c = Math.cos(a); const sn = Math.sin(a);
    const hist: any = new Float64Array(bins);
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
function prepare(src: HTMLCanvasElement, { y0 = 0, y1 = 1, width = 1600, threshold = false }: { y0?: number; y1?: number; width?: number; threshold?: boolean } = {}): HTMLCanvasElement {
  const sw = src.width;
  const sh = Math.round(src.height * (y1 - y0));
  const sy = Math.round(src.height * y0);
  const scale = width / sw;
  const w = Math.round(sw * scale);
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, sy, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px: any = data.data;
  const grey: any = new Uint8ClampedArray(w * h);
  const hist: any = new Uint32Array(256);
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
    const h2: any = new Uint32Array(256);
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

const rank = (r: MrzResult | null) => (r && r.fields ? (r.ok ? 1000 : 0) + Object.values(r.checks).filter(Boolean).length * 10 - r.doubtful.length : -1);

/**
 * Read the two lines at the bottom of a passport photo. onProgress gets 0..100.
 * Resolves with findMrz's result (fields null when nothing MRZ-shaped was found). Rejects with Error('open') for a
 * photo that can't be opened and Error('reader') when the reader can't load.
 */
export async function readPassport(uri: string, onProgress: (pct: number) => void = () => {}): Promise<ReadResult> {
  let pct = 0;
  const report = (v: number) => { const n = Math.max(pct, Math.min(100, Math.round(v))); if (n !== pct) { pct = n; onProgress(n); } };
  report(2);
  const img = await loadImage(uri);
  try {
    let phase = { from: 2, to: 30 };
    listener = (m) => {
      if (typeof m.progress !== 'number') return;
      if (m.status === 'recognizing text') report(phase.from + (phase.to - phase.from) * m.progress);
      else if (phase.to <= 30) report(phase.from + (phase.to - phase.from) * Math.min(1, m.progress) * (/core/.test(m.status) ? 0.5 : 1));
    };
    const worker = await getWorker();
    report(30);
    const straight = toCanvas(img, { turn: -estimateSkew(img) });
    const tries = [
      { y0: 0.62, y1: 1, threshold: false, psm: '6' },
      { y0: 0.62, y1: 1, threshold: true, psm: '6' },
      { y0: 0.4, y1: 1, threshold: false, psm: '6' },
      { y0: 0, y1: 1, threshold: false, psm: '3' },
    ];
    const sideways = [
      { turn: Math.PI / 2, y0: 0.5, y1: 1, threshold: false, psm: '6' },
      { turn: -Math.PI / 2, y0: 0.5, y1: 1, threshold: false, psm: '6' },
    ];
    const step = 66 / tries.length;
    let best: ReadResult | null = null;
    let attempts = 0;
    const attempt = async (tr: { turn?: number; y0: number; y1: number; threshold: boolean; psm: string }, from: number, to: number) => {
      phase = { from, to };
      const canvas = prepare(tr.turn ? toCanvas(straight, { turn: tr.turn }) : straight, tr);
      await worker.setParameters({ tessedit_pageseg_mode: tr.psm });
      const { data } = await worker.recognize(canvas);
      attempts += 1;
      const r = findMrz(data.text);
      if (rank(r) > rank(best)) best = r;
      report(to);
    };
    for (let i = 0; i < tries.length && !(best as ReadResult | null)?.ok; i += 1) await attempt(tries[i]!, 30 + step * i, 30 + step * (i + 1));
    for (let i = 0; i < sideways.length && !(best as ReadResult | null)?.fields; i += 1) await attempt(sideways[i]!, 96 + i * 2, 98 + i * 2);
    report(100);
    return { ...(best ?? findMrz('')), attempts };
  } finally {
    listener = null;
  }
}
