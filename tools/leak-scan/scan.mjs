#!/usr/bin/env node
/*
 * node tools/leak-scan/scan.mjs <dir> [--allow-mock]: fails (exit 1) when anything in the folder (a web export) names a
 * partner, a partner's host, or a cost field (denylist.mjs). In a mock export (EXPO_PUBLIC_API_MODE=mock) the mock
 * API's own chunk holds the mock supplier's sample prices: --allow-mock lets cost fields stand in that one chunk only;
 * partner names count everywhere. Binary files are skipped; the OCR model's text is data, not code.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanText } from './denylist.mjs';

const dir = process.argv[2];
const allowMock = process.argv.includes('--allow-mock');
if (!dir) { console.error('usage: scan.mjs <dir> [--allow-mock]'); process.exit(2); }

const TEXT = /\.(?:js|mjs|cjs|html|json|css|map|txt|webmanifest|xml)$/i;
const SKIP = /(?:^|[\\/])ocr[\\/]/;

export function scanFolder(root, opts = {}) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = relative(root, p);
      if (!TEXT.test(name) || SKIP.test(rel) || name.endsWith('.map')) continue;
      const mockChunk = /(?:^|[\\/])mock-api-[0-9a-f]+\.js$/.test(rel);
      for (const h of scanText(readFileSync(p, 'utf8'), { costFields: !(opts.allowMock && mockChunk) })) out.push({ file: rel, ...h });
    }
  };
  walk(root);
  return out;
}

const hits = scanFolder(dir, { allowMock });
if (hits.length) {
  console.error(`Supplier leak scan: ${hits.length} finding(s) in ${dir}`);
  for (const h of hits) console.error(`  ${h.file}: ${h.kind} "${h.match}" … ${h.near.replace(/\s+/g, ' ')}`);
  process.exit(1);
}
console.log(`Supplier leak scan: ${dir} is clean.`);
