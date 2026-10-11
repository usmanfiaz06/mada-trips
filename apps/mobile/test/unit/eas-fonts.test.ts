import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fontEntries, installFonts, zipBytes } from '../../scripts/eas-fonts.mjs';

/** A minimal zip: entries stored (method 0) or deflated (method 8), with folders, like a downloaded font pack. */
function zip(entries: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(e.deflate ? 8 : 0, 8); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(e.deflate ? 8 : 0, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const pack = zip([
  { name: 'Thmanyah/thmanyahsans-Regular.otf', data: Buffer.from('regular-font-bytes'.repeat(20)), deflate: true },
  { name: 'Thmanyah/thmanyahserifdisplay-Medium.otf', data: Buffer.from('display') },
  { name: 'Thmanyah/LICENSE.txt', data: Buffer.from('licence') },
  { name: '__MACOSX/Thmanyah/._thmanyahsans-Regular.otf', data: Buffer.from('junk') },
]);

describe('EAS fonts hook', () => {
  it('reads base64 text and a file path, and ignores anything else', () => {
    expect(zipBytes(pack.toString('base64'))?.equals(pack)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'fonts-'));
    const file = join(dir, 'fonts.zip');
    writeFileSync(file, pack);
    expect(zipBytes(file)?.equals(pack)).toBe(true);
    expect(zipBytes('')).toBeNull();
    expect(zipBytes(Buffer.from('not a zip at all, just text').toString('base64'))).toBeNull();
  });

  it('keeps only font files, flattened, stored or deflated', () => {
    const fonts = fontEntries(pack);
    expect(fonts.map((f) => f.name)).toEqual(['thmanyahsans-Regular.otf', 'thmanyahserifdisplay-Medium.otf']);
    expect(fonts[0]!.data.toString()).toBe('regular-font-bytes'.repeat(20));
  });

  it('writes the fonts into the folder metro.config.js reads', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'fonts-')), 'assets/fonts/thmanyah');
    expect(installFonts(pack.toString('base64'), dir)).toHaveLength(2);
    expect(readdirSync(dir).sort()).toEqual(['thmanyahsans-Regular.otf', 'thmanyahserifdisplay-Medium.otf']);
    expect(readFileSync(join(dir, 'thmanyahserifdisplay-Medium.otf'), 'utf8')).toBe('display');
  });

  it('refuses a file that is not a zip', () => {
    expect(() => fontEntries(Buffer.alloc(100))).toThrow(/not a zip/);
  });
});
