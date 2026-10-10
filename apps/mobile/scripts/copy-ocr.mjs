// The web build's passport reader (Tesseract, on the page, no server): copies the prototype's pinned reader files
// into public/ocr so `expo export` serves them at /ocr/. Phones use ML Kit instead (src/lib/ocr.native.ts).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '../../../docs/app/prototype-app/dist/ocr');
const to = join(here, '../public/ocr');
if (!existsSync(from)) { console.warn('[copy-ocr] no reader files at', from, '- the web build will offer the demo passport and typing by hand'); process.exit(0); }
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('[copy-ocr] passport reader copied to public/ocr');
