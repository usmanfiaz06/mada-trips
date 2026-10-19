/*
 * `import { colors, t } from '@mada/shared'` names the whole package: every schema, all the copy, zod. Metro keeps
 * every module a file imports, used or not, so one token in the theme put ~1.1 MB in front of the first screen.
 *
 * For the web, this Babel plugin rewrites each such import to the file that defines the name
 * (`import { colors } from '@mada/shared/tokens'`), so a screen carries only the parts of the package it uses
 * (docs/app/PERF.md). The map is read from packages/shared/src at start: index.ts and every `export *` / `export {…}
 * from` under it, down to where each name is declared. A name it can't place (or a namespace import) keeps the
 * package import. Same modules either way, so nothing is loaded twice. `mapHash` goes into Metro's cache key.
 */
/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SHARED = path.resolve(__dirname, '../../../packages/shared/src');
const PKG = '@mada/shared';

function fileOf(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const f of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (fs.existsSync(f)) return f;
  return null;
}

/** name → the file that declares it, following re-exports from `file`. */
function exportsOf(file, seen = new Set()) {
  const out = new Map();
  if (!file || seen.has(file)) return out;
  seen.add(file);
  // Comments that open a line (doc comments): a "/*" inside a string ('/api/*') must not swallow the file.
  const src = fs.readFileSync(file, 'utf8').replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/[^\n]*/gm, '');
  const own = (name) => { if (!out.has(name)) out.set(name, file); };
  for (const m of src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|enum|abstract\s+class)\s+([A-Za-z0-9_$]+)/gm)) own(m[1]);
  for (const m of src.matchAll(/^export\s+(type\s+)?\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"])?/gm)) {
    if (m[1]) continue;
    const target = m[3] ? fileOf(file, m[3]) : null;
    const theirs = target ? exportsOf(target, new Set(seen)) : null;
    for (const part of m[2].split(',')) {
      const s = part.trim();
      if (!s || s.startsWith('type ')) continue;
      const [orig, alias] = s.split(/\s+as\s+/).map((x) => x.trim());
      const name = alias ?? orig;
      if (out.has(name)) continue;
      // Re-exported under its own name: the declaring file. Renamed or local: this file.
      out.set(name, theirs && !alias && theirs.has(orig) ? theirs.get(orig) : file);
    }
  }
  for (const m of src.matchAll(/^export\s+\*\s+from\s*['"]([^'"]+)['"]/gm)) {
    for (const [name, f] of exportsOf(fileOf(file, m[1]), seen)) if (!out.has(name)) out.set(name, f);
  }
  return out;
}

let cached = null;
function sharedMap() {
  if (cached) return cached;
  const map = new Map();
  for (const [name, file] of exportsOf(path.join(SHARED, 'index.ts'))) {
    map.set(name, `${PKG}/${path.relative(SHARED, file).replace(/\\/g, '/').replace(/\.tsx?$/, '')}`);
  }
  const hash = crypto.createHash('sha1').update(JSON.stringify([...map].sort())).digest('hex').slice(0, 12);
  cached = { map, hash };
  return cached;
}

/** The Babel plugin. */
function sharedImports({ types: t }) {
  return {
    name: 'mada-shared-imports',
    visitor: {
      ImportDeclaration(p) {
        const node = p.node;
        if (node.source.value !== PKG || node.importKind === 'type') return;
        const { map } = sharedMap();
        if (!node.specifiers.length || node.specifiers.some((s) => !t.isImportSpecifier(s))) return;
        const groups = new Map();
        for (const s of node.specifiers) {
          // A type is erased anyway: it needs no file.
          if (s.importKind === 'type') continue;
          const name = t.isIdentifier(s.imported) ? s.imported.name : s.imported.value;
          const target = map.get(name) ?? PKG;
          if (!groups.has(target)) groups.set(target, []);
          groups.get(target).push(s);
        }
        if (groups.size === 1 && groups.has(PKG) && groups.get(PKG).length === node.specifiers.length) return;
        if (!groups.size) { p.remove(); return; }
        p.replaceWithMultiple([...groups].map(([target, specs]) => t.importDeclaration(specs, t.stringLiteral(target))));
      },
      // `export { colors, fontFamilies as ff } from '@mada/shared'`: the same, for re-exports.
      ExportNamedDeclaration(p) {
        const node = p.node;
        if (!node.source || node.source.value !== PKG || node.exportKind === 'type') return;
        const { map } = sharedMap();
        if (node.specifiers.some((s) => !t.isExportSpecifier(s))) return;
        const groups = new Map();
        for (const s of node.specifiers) {
          if (s.exportKind === 'type') continue;
          const name = t.isIdentifier(s.local) ? s.local.name : s.local.value;
          const target = map.get(name) ?? PKG;
          if (!groups.has(target)) groups.set(target, []);
          groups.get(target).push(s);
        }
        if (groups.size === 1 && groups.has(PKG) && groups.get(PKG).length === node.specifiers.length) return;
        if (!groups.size) { p.remove(); return; }
        p.replaceWithMultiple([...groups].map(([target, specs]) => t.exportNamedDeclaration(null, specs, t.stringLiteral(target))));
      },
    },
  };
}

module.exports = sharedImports;
module.exports.mapHash = () => sharedMap().hash;
module.exports.sharedMap = () => sharedMap().map;
