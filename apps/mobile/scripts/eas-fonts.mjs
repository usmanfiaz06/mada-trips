#!/usr/bin/env node
/*
 * EAS Build pre-install hook (package.json › eas-build-pre-install): puts the Thmanyah font files into
 * assets/fonts/thmanyah/ so a cloud build ships Mada's Arabic typeface. The files can't be in git (Thmanyah's licence
 * forbids re-hosting and this repository is public; see src/theme/arabic-fonts.ts), so they come from an EAS
 * environment variable, visibility "Secret":
 *
 *   THMANYAH_FONTS_ZIP   a zip of the .otf/.ttf files, either as an EAS "file" variable (the value is then a path to
 *                        the file on the build machine) or as plain text holding the zip in base64.
 *
 * Without the variable nothing happens and the build uses the fallback (IBM Plex Sans Arabic and Reem Kufi). Only
 * .otf and .ttf entries are written, flattened into the one folder; nothing is ever printed but file names.
 * metro.config.js then finds the files and points the theme at them.
 *
 * Zip reading is done here (central directory + zlib inflate) so the hook needs no unzip tool on the build image.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const FONT = /\.(otf|ttf)$/i;

/** The zip's bytes from the variable's value: a file path (EAS "file" variable) or base64 text. */
export function zipBytes(value) {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (!v.includes('\n') && v.length < 4096 && existsSync(v)) return readFileSync(v);
  const buf = Buffer.from(v.replace(/\s+/g, ''), 'base64');
  return buf.length > 22 && buf.readUInt32LE(0) === 0x04034b50 ? buf : null;
}

/** Every font entry in a zip: [{ name, data }]. Folders inside the zip are dropped (flattened). */
export function fontEntries(zip) {
  // End of central directory: the last 0x06054b50 within the final 64 KiB.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('THMANYAH_FONTS_ZIP is not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('THMANYAH_FONTS_ZIP has a damaged directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    const file = basename(name.replace(/\\/g, '/'));
    if (!FONT.test(file) || name.startsWith('__MACOSX/') || file.startsWith('._')) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + size);
    const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`THMANYAH_FONTS_ZIP: ${file} uses an unsupported compression method`);
    out.push({ name: file, data });
  }
  return out;
}

export function installFonts(value, dir) {
  const zip = zipBytes(value);
  if (!zip) return [];
  const fonts = fontEntries(zip);
  mkdirSync(dir, { recursive: true });
  for (const f of fonts) writeFileSync(join(dir, f.name), f.data);
  return fonts.map((f) => f.name);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts', 'thmanyah');
  if (!process.env.THMANYAH_FONTS_ZIP) {
    console.log('[eas-fonts] THMANYAH_FONTS_ZIP is not set: this build uses the fallback Arabic fonts.');
  } else {
    try {
      const names = installFonts(process.env.THMANYAH_FONTS_ZIP, dir);
      console.log(names.length ? `[eas-fonts] Thmanyah: ${names.join(', ')}` : '[eas-fonts] THMANYAH_FONTS_ZIP held no .otf or .ttf files: fallback Arabic fonts.');
    } catch (e) {
      // A bad zip shouldn't stop a build; the app still has its fallback fonts. Say so loudly.
      console.warn(`[eas-fonts] ${e instanceof Error ? e.message : String(e)}. This build uses the fallback Arabic fonts.`);
    }
  }
}
