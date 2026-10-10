// Metro for an npm-workspaces monorepo: watch packages/shared (TypeScript source, no build step) and resolve
// modules from this app first, then the repo root where npm hoists them.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...new Set([...(config.watchFolders ?? []), path.resolve(workspaceRoot, 'packages/shared')])];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];

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

module.exports = config;
