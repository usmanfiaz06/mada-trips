import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { scanText } from '../../../../tools/leak-scan/denylist.mjs';

/*
 * Nothing the app ships names Mada's partners or carries what Mada pays (docs/app/SUPPLIER-PRIVACY.md): every string
 * the app's code and the shared package hold, and the web export when one is in dist/ (`npm run export:web` scans it
 * too, through tools/leak-scan/scan.mjs). Comments don't ship (the bundler drops them) and aren't checked here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '../..');
const shared = resolve(app, '../../packages/shared/src');
/** Server-only shared files (the shared index never exports them; '@mada/shared/internal'). */
const SERVER_ONLY = /[\\/]packages[\\/]shared[\\/]src[\\/](?:internal\.ts|schemas[\\/](?:esim-plans|esim-pricing|esim-fixtures)\.ts)$/;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') files(p, out); }
    else if (/\.(?:ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Every string literal and template text in a file. */
function stringsOf(path: string): string[] {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, false, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) out.push(n.text);
    else if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) out.push(n.text);
    n.forEachChild(walk);
  };
  walk(src);
  return out;
}

describe('no partner in what the app ships', () => {
  it('the app and the shared package hold no partner name or host in any string or name', () => {
    const found: string[] = [];
    for (const f of [...files(join(app, 'src')), ...files(shared)]) {
      if (SERVER_ONLY.test(f)) continue;
      for (const s of stringsOf(f)) for (const h of scanText(s, { costFields: false })) found.push(`${relative(app, f)}: "${h.match}" in ${JSON.stringify(s.slice(0, 120))}`);
    }
    expect(found).toEqual([]);
  });

  it('the shared index carries no cost rule: the eSIM markup and price rules are server-only', async () => {
    const index = await import('@mada/shared');
    for (const k of ['ESIM_MARKUP_BPS', 'esimPrice', 'suggestEsimPlans', 'esimSellPrice', 'ESIM_PRICING_DEFAULTS', 'ESIM_FIXTURE_PACKAGES', 'ExperienceSupplier']) expect(index).not.toHaveProperty(k);
  });

  it.skipIf(!existsSync(join(app, 'dist/_expo')))('the web export in dist/ is clean (the mock chunk may hold the mock supplier’s sample prices)', async () => {
    const { execFileSync } = await import('node:child_process');
    const out = execFileSync(process.execPath, [resolve(app, '../../tools/leak-scan/scan.mjs'), join(app, 'dist'), '--allow-mock'], { encoding: 'utf8' });
    expect(out).toMatch(/is clean/);
  });
});
