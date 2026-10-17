import "server-only";
import { inflateSync } from "node:zlib";
import type { Pixels } from "./barcode";

/*
 * The pictures inside a PDF, so the barcode on an airline's boarding-pass PDF can be read. Most check-in systems
 * embed the barcode as an image: a JPEG (DCTDecode) or deflated pixels (FlateDecode, often 1-bit). A barcode drawn as
 * vector shapes has no picture to read; the traveller is then asked for a screenshot instead (copy bp.unreadable).
 */

export type PdfImage = { kind: "jpeg"; bytes: Buffer } | { kind: "pixels"; pixels: Pixels };

const MAX_IMAGES = 24;
const MAX_PIXELS = 25_000_000;

const num = (dict: string, key: string) => {
  const m = new RegExp(`/${key}\\s+(\\d+)`).exec(dict);
  return m ? Number(m[1]) : null;
};

/** PNG-style row filters (/Predictor 10–15) undone. */
function unpredict(data: Buffer, rowBytes: number, bpp: number): Buffer {
  const rows = Math.floor(data.length / (rowBytes + 1));
  const out = Buffer.alloc(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const type = data[r * (rowBytes + 1)]!;
    const src = r * (rowBytes + 1) + 1;
    const dst = r * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const raw = data[src + i]!;
      const a = i >= bpp ? out[dst + i - bpp]! : 0;
      const b = r > 0 ? out[dst - rowBytes + i]! : 0;
      const c = i >= bpp && r > 0 ? out[dst - rowBytes + i - bpp]! : 0;
      let v = raw;
      if (type === 1) v = raw + a;
      else if (type === 2) v = raw + b;
      else if (type === 3) v = raw + ((a + b) >> 1);
      else if (type === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[dst + i] = v & 255;
    }
  }
  return out;
}

function toPixels(dict: string, raw: Buffer): Pixels | null {
  const width = num(dict, "Width"), height = num(dict, "Height");
  if (!width || !height || width * height > MAX_PIXELS) return null;
  const mask = /\/ImageMask\s+true/.test(dict);
  const bits = mask ? 1 : num(dict, "BitsPerComponent") ?? 8;
  const cs = /\/ColorSpace\s*\/DeviceRGB/.test(dict) ? 3 : /\/ColorSpace\s*\/DeviceGray/.test(dict) || mask ? 1 : /\/ColorSpace\s*\/DeviceCMYK/.test(dict) ? 4 : null;
  if (!cs || (bits !== 1 && bits !== 8)) return null;
  const inverted = /\/Decode\s*\[\s*1(?:\.0)?\s+0/.test(dict);
  let data: Buffer = inflateSync(raw, { maxOutputLength: MAX_PIXELS * 4 });
  const rowBytes = Math.ceil((width * cs * bits) / 8);
  const predictor = num(dict, "Predictor");
  if (predictor && predictor >= 10) data = unpredict(data, rowBytes, Math.max(1, (cs * bits) >> 3));
  if (data.length < rowBytes * height) return null;
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let v: number;
    if (bits === 1) {
      const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
      // An image mask paints where the sample is 0; a 1-bit gray image is white where it is 1.
      v = mask ? (bit === 0 ? 0 : 255) : bit ? 255 : 0;
    } else if (cs === 1) v = data[y * rowBytes + x]!;
    else if (cs === 3) { const i = y * rowBytes + x * 3; v = (data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114) / 1000; }
    else { const i = y * rowBytes + x * 4; v = 255 - Math.min(255, data[i + 3]! + (data[i]! + data[i + 1]! + data[i + 2]!) / 3); }
    if (inverted) v = 255 - v;
    const o = (y * width + x) * 4;
    px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255;
  }
  return { data: px, width, height };
}

/** The image XObjects in a PDF, largest first (the barcode is rarely the smallest picture on the page). */
export function pdfImages(pdf: Buffer): PdfImage[] {
  const text = pdf.toString("latin1");
  const found: { size: number; img: PdfImage }[] = [];
  const re = /<<((?:(?!>>\s*stream|endobj|\bobj\b)[\s\S]){0,4000}?\/Subtype\s*\/Image[\s\S]{0,4000}?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && found.length < MAX_IMAGES) {
    const dict = m[1]!;
    const start = m.index + m[0].length;
    const len = num(dict.replace(/\/Length\s+\d+\s+\d+\s+R/, ""), "Length");
    const end = len && text.startsWith("endstream", start + len + (text[start + len] === "\r" ? 2 : text[start + len] === "\n" ? 1 : 0)) ? start + len : text.indexOf("endstream", start);
    if (end < 0) break;
    const raw = pdf.subarray(start, end);
    try {
      if (/\/DCTDecode/.test(dict)) found.push({ size: raw.length, img: { kind: "jpeg", bytes: Buffer.from(raw) } });
      else if (/\/FlateDecode/.test(dict) && !/\/(DCT|JPX|JBIG2|CCITTFax)Decode/.test(dict.replace(/\/FlateDecode/, ""))) {
        const p = toPixels(dict, Buffer.from(raw));
        if (p) found.push({ size: p.width * p.height, img: { kind: "pixels", pixels: p } });
      }
    } catch { /* a picture we can't unpack is skipped, never fatal */ }
    re.lastIndex = end;
  }
  return found.sort((a, b) => b.size - a.size).map((f) => f.img);
}
