// Metro for an npm-workspaces monorepo: watch packages/shared (TypeScript source, no build step) and resolve
// modules from this app first, then the repo root where npm hoists them.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.resolve(workspaceRoot, 'packages/shared')])];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];
// The web's fonts are WOFF2 (theme/fonts.ts, scripts/web-fonts.sh).
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'woff2'])];

/*
 * zod's error messages in 50 languages (about 270 KB of the web download, read before the first screen): the app never
 * shows zod's own messages or switches its language, so its locale index resolves to English only (zod-locales.js).
 */
const zodLocales = path.join(projectRoot, 'src/lib/zod-locales.js');
const zodLocalesIndex = /[\\/]zod[\\/]v4[\\/]locales[\\/]index\.c?js$/;
const resolveBefore = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const r = (resolveBefore ?? context.resolveRequest)(context, moduleName, platform);
  return r.type === 'sourceFile' && zodLocalesIndex.test(r.filePath) ? { type: 'sourceFile', filePath: zodLocales } : r;
};

/*
 * Arabic's words (about 500 KB of the web download) wait until they are needed: on the web, the shared catalogue's
 * import of ./ar-catalogue resolves to an empty one (src/lib/copy-ar-stub.ts), and lib/i18n.ts fetches the real file
 * with import() before an Arabic screen draws. Phones keep every word in the app.
 */
const arStub = path.join(projectRoot, 'src/lib/copy-ar-stub.ts');
const copyIndex = /[\\/]packages[\\/]shared[\\/]src[\\/]copy[\\/]index\.ts$/;
const resolveCopy = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === './ar-catalogue' && copyIndex.test(context.originModulePath)) return { type: 'sourceFile', filePath: arStub };
  return resolveCopy(context, moduleName, platform);
};

/*
 * Thmanyah (theme/arabic-fonts.ts): its files can't live in this public repo, so when assets/fonts/thmanyah/ holds
 * them, write arabic-fonts.local.ts pointing at them and resolve the theme module to it. Files are matched by name:
 * Serif Display Medium (or Regular) for display; Sans Regular, Medium and Bold for the interface (Thmanyah Sans has no SemiBold,
 * so 600 uses Bold).
 */
const fs = require('node:fs');
const fontDir = path.join(projectRoot, 'assets/fonts/thmanyah');
const fallback = path.join(projectRoot, 'src/theme/arabic-fonts.ts');
const local = path.join(projectRoot, 'src/theme/arabic-fonts.local.ts');
const files = fs.existsSync(fontDir) ? fs.readdirSync(fontDir).filter((f) => /\.(otf|ttf)$/i.test(f)) : [];
const pick = (...words) => files.find((f) => words.every((w) => f.toLowerCase().replace(/[^a-z0-9]/g, '').includes(w)));
const found = {
  display: pick('serif', 'display', 'medium') ?? pick('serif', 'display', 'regular'),
  ui400: pick('sans', 'regular'),
  ui500: pick('sans', 'medium'),
  ui700: pick('sans', 'bold'),
};
if (Object.values(found).every(Boolean)) {
  const req = (f) => `require('../../assets/fonts/thmanyah/${f}')`;
  fs.writeFileSync(local, `// Written by metro.config.js from assets/fonts/thmanyah/. Not in git (Thmanyah's licence).\nimport type { ArabicFonts } from './arabic-fonts';\nexport type { ArabicFonts };\nexport const thmanyah: ArabicFonts | null = {\n  display: ${req(found.display)},\n  ui400: ${req(found.ui400)},\n  ui500: ${req(found.ui500)},\n  ui600: ${req(found.ui700)},\n  ui700: ${req(found.ui700)},\n};\n`);
  const resolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const r = (resolve ?? context.resolveRequest)(context, moduleName, platform);
    return r.type === 'sourceFile' && r.filePath === fallback ? { type: 'sourceFile', filePath: local } : r;
  };
} else if (fs.existsSync(local)) {
  fs.rmSync(local);
}

/*
 * The web export's files (metro/web-chunks.js, docs/app/PERF.md): the first screen in one file, what the other screens
 * share in a file loaded with the first of them, and an import() that can fetch both (metro/async-require.js).
 */
require('./metro/web-chunks').install(projectRoot);
// babel.config.js rewrites @mada/shared imports from a map of the package: a change to the map is a new cache.
config.cacheVersion = `${config.cacheVersion ?? ''}shared-${require('./metro/shared-imports').mapHash()}`;
config.transformer.asyncRequireModulePath = require.resolve('./metro/async-require.js');

module.exports = config;
