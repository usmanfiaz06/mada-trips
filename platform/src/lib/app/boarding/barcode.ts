import "server-only";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { BarcodeFormat } from "@mada/shared";

/*
 * Reading and drawing boarding-pass barcodes with zxing-cpp (WebAssembly, zxing-wasm). The .wasm ships inside the
 * package and is read from disk, never fetched from a CDN at run time (next.config.ts traces it into the function).
 */

type Zx = typeof import("zxing-wasm/full");
let ready: Promise<Zx> | null = null;

function zx(): Promise<Zx> {
  ready ??= (async () => {
    const z = await import("zxing-wasm/full");
    // Node's own resolver from the app's folder, not webpack's: the .wasm must stay a file on disk, never a module.
    const nodeRequire = createRequire(join(process.cwd(), "package.json"));
    const wasmBinary = readFileSync(nodeRequire.resolve(["zxing-wasm", "full", "zxing_full.wasm"].join("/")));
    await z.prepareZXingModule({ overrides: { wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) as ArrayBuffer }, fireImmediately: true });
    return z;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export type Found = { format: BarcodeFormat; text: string };
const FROM: Record<string, BarcodeFormat> = { PDF417: "pdf417", Aztec: "aztec", QRCode: "qr" };
const TO: Record<BarcodeFormat, "PDF417" | "Aztec" | "QRCode"> = { pdf417: "PDF417", aztec: "Aztec", qr: "QRCode" };

/** RGBA pixels, the shape zxing reads (an ImageData without the browser). */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

/** Every PDF417, Aztec or QR code in an image file (PNG, JPEG, GIF, BMP) or in raw pixels. */
export async function readCodes(input: Uint8Array | Pixels): Promise<Found[]> {
  const z = await zx();
  const src = input instanceof Uint8Array ? input : { ...input, colorSpace: "srgb" as const };
  const res = await z.readBarcodes(src as Uint8Array, { formats: ["PDF417", "Aztec", "QRCode"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 8 });
  return res.filter((r) => r.isValid && r.text && FROM[r.format]).map((r) => ({ format: FROM[r.format]!, text: r.text }));
}

/** The barcode drawn again from its text, as SVG, for the phone to show at full size. */
export async function drawCode(format: BarcodeFormat, text: string): Promise<string | null> {
  try {
    const z = await zx();
    const w = await z.writeBarcode(text, { format: TO[format], scale: 2 });
    if (w.error) return null;
    // A viewBox, so the phone can draw it at any width.
    return w.svg.replace(/<\?xml[^>]*>\s*/, "").replace(/<!DOCTYPE[^>]*>\s*/, "").replace(/<desc>[^<]*<\/desc>\s*/, "")
      .replace(/<svg width="([\d.]+)" height="([\d.]+)"/, '<svg viewBox="0 0 $1 $2" width="$1" height="$2"');
  } catch { return null; }
}

/** The barcode as pixels (tests, and anything that needs a raster). Bars are black on white with a quiet zone. */
export async function drawPixels(format: BarcodeFormat, text: string, scale = 3): Promise<Pixels> {
  const z = await zx();
  const w = await z.writeBarcode(text, { format: TO[format] });
  if (w.error) throw new Error(w.error);
  const s = w.symbol; const q = 10 * scale;
  const width = s.width * scale + 2 * q, height = s.height * scale + 2 * q;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    if (s.data[y * s.width + x] !== 0) continue; // 0 is a bar
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = ((q + y * scale + dy) * width + q + x * scale + dx) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, width, height };
}

/** The image file zxing can draw (PNG), for tests and the desk's preview. */
export async function drawPng(format: BarcodeFormat, text: string): Promise<Buffer> {
  const z = await zx();
  const w = await z.writeBarcode(text, { format: TO[format], scale: 4 });
  if (w.error || !w.image) throw new Error(w.error || "no image");
  return Buffer.from(await w.image.arrayBuffer());
}
