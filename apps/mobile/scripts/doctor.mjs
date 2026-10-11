#!/usr/bin/env node
/*
 * npm run mobile:doctor — is the app ready for an EAS store build? (docs/app/LAUNCH.md)
 *   1. expo-doctor (dependency versions, config, native modules). Its React Native Directory check is a warning
 *      here, not a failure: it flags libraries the directory hasn't marked as tested on the New Architecture.
 *   2. Mada's own checks on the resolved app config, eas.json, locales, icons and the font licence rules.
 * Exit code 1 when anything fails. Needs no Expo account; `--offline` skips expo-doctor (it downloads itself).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..', '..');
const offline = process.argv.includes('--offline');
const problems = [];
const warnings = [];
const ok = [];
const check = (pass, what, fix) => (pass ? ok.push(what) : problems.push(`${what}${fix ? ` — ${fix}` : ''}`));

// 1. expo-doctor
if (!offline) {
  const r = spawnSync('npx', ['--yes', 'expo-doctor@latest'], { cwd: root, encoding: 'utf8', timeout: 300_000 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status === 0) ok.push('expo-doctor: all checks passed');
  else {
    const failed = [...out.matchAll(/^✖ (.+)$/gm)].map((m) => m[1].trim());
    const real = failed.filter((f) => !/React Native Directory/i.test(f));
    if (!failed.length) problems.push(`expo-doctor could not run (exit ${r.status}). Run "npx expo-doctor" in apps/mobile to see why.`);
    for (const f of real) problems.push(`expo-doctor: ${f}`);
    for (const f of failed.filter((x) => !real.includes(x))) {
      const pkgs = [...out.matchAll(/Untested on New Architecture: (.+)$/gm)].map((m) => m[1]).join(', ');
      warnings.push(`expo-doctor: ${f}${pkgs ? ` (${pkgs})` : ''}. Test those screens on a real device build.`);
    }
  }
}

// 2. The resolved config, as EAS would see it with a project id.
let cfg;
try {
  const json = execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'], { cwd: root, encoding: 'utf8', env: { ...process.env, EAS_PROJECT_ID: process.env.EAS_PROJECT_ID || '00000000-0000-0000-0000-000000000000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  cfg = JSON.parse(json);
} catch (e) {
  problems.push(`expo config failed: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
}

if (cfg) {
  const ios = cfg.ios ?? {};
  const android = cfg.android ?? {};
  check(cfg.name === 'Mada Trips' && cfg.slug === 'mada-trips', 'name "Mada Trips", slug "mada-trips"');
  check(ios.bundleIdentifier === 'sa.madatrips.app' && android.package === 'sa.madatrips.app', 'bundle id and package sa.madatrips.app');
  check(/^\d+\.\d+\.\d+$/.test(cfg.version ?? ''), `version is x.y.z (${cfg.version})`);
  check(cfg.runtimeVersion?.policy === 'appVersion', 'runtimeVersion follows the app version');
  check(cfg.updates?.url?.startsWith('https://u.expo.dev/'), 'expo-updates URL comes from the project id');
  check(ios.config?.usesNonExemptEncryption === false || ios.infoPlist?.ITSAppUsesNonExemptEncryption === false, 'export compliance: usesNonExemptEncryption false (standard HTTPS and AES only)');
  check(ios.supportsTablet === false, 'iPhone only (no iPad screenshots needed)');

  const plist = ios.infoPlist ?? {};
  const needed = ['NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSFaceIDUsageDescription', 'NSContactsUsageDescription'];
  for (const k of needed) check(typeof plist[k] === 'string' && plist[k].length > 20 && !/\$\(PRODUCT_NAME\)/.test(plist[k]), `iOS ${k} says why, in our words`);
  check(!plist.NSMicrophoneUsageDescription, 'no microphone permission (nothing records sound)');
  check(!plist.NSLocationWhenInUseUsageDescription && !plist.NSLocationAlwaysAndWhenInUseUsageDescription, 'no location permission (nothing reads GPS yet)');
  check((plist.CFBundleLocalizations ?? []).includes('ar'), 'iOS knows the app speaks Arabic (CFBundleLocalizations)');

  for (const lang of ['en', 'ar']) {
    const file = join(root, cfg.locales?.[lang] ?? `locales/${lang}.json`);
    if (!existsSync(file)) { problems.push(`locales/${lang}.json is missing`); continue; }
    const l = JSON.parse(readFileSync(file, 'utf8'));
    for (const k of needed) check(!!l.ios?.[k], `${lang}: ${k} translated`);
    check(!!l.ios?.CFBundleDisplayName && !!l.android?.app_name, `${lang}: home-screen name`);
    if (lang === 'en') for (const k of needed) check(l.ios?.[k] === plist[k], `en: ${k} matches app.json`);
  }

  const perms = new Set(android.permissions ?? []);
  const blocked = new Set(android.blockedPermissions ?? []);
  for (const p of ['RECORD_AUDIO', 'WRITE_CONTACTS', 'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'SYSTEM_ALERT_WINDOW'])
    check(blocked.has(`android.permission.${p}`), `Android ${p} blocked (not used; Play asks about each one)`);
  for (const p of ['CAMERA', 'READ_CONTACTS', 'USE_BIOMETRIC', 'POST_NOTIFICATIONS'])
    check(perms.has(`android.permission.${p}`), `Android ${p} declared`);
  check(Number.isInteger(android.versionCode), 'Android versionCode set (EAS increments it remotely)');

  const file = (p) => p && existsSync(join(root, p));
  check(file(cfg.icon), 'app icon exists');
  check(file(android.adaptiveIcon?.foregroundImage) && file(android.adaptiveIcon?.monochromeImage), 'adaptive icon foreground and monochrome layers');
  const notif = (cfg.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-notifications');
  check(notif && file(notif[1]?.icon), 'Android notification icon (white on transparent)');
  const splash = (cfg.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
  check(splash && /^#1e352d$/i.test(splash[1]?.backgroundColor ?? '') && file(splash[1]?.image), 'splash in Mada green with the sun');
  if (cfg.icon && file(cfg.icon)) {
    const png = readFileSync(join(root, cfg.icon));
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20), colorType = png[25];
    check(w === 1024 && h === 1024, 'icon is 1024×1024');
    check(colorType === 2, 'icon has no transparency (App Store refuses alpha)');
  }
}

// eas.json
try {
  const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
  const b = eas.build ?? {};
  for (const [name, channel] of [['development', 'development'], ['preview', 'preview'], ['production', 'production']]) check(b[name]?.channel === channel, `eas.json: ${name} profile on channel "${channel}"`);
  check(b.development?.developmentClient === true, 'eas.json: development builds are development clients');
  check(b.preview?.distribution === 'internal', 'eas.json: preview is internal distribution');
  check(b.production?.autoIncrement === true && eas.cli?.appVersionSource === 'remote', 'eas.json: production build numbers increment remotely');
  const prodEnv = { ...(b.base?.env ?? {}), ...(b.production?.env ?? {}) };
  check(prodEnv.EXPO_PUBLIC_API_MODE !== 'mock' && prodEnv.EXPO_PUBLIC_DEMO_HINTS !== 'yes', 'eas.json: production is never mock and shows no demo hints');
  const submit = eas.submit?.production?.ios ?? {};
  if (/REPLACE/.test(`${submit.ascAppId}${submit.appleTeamId}`)) warnings.push('eas.json: submit.production.ios ascAppId and appleTeamId are still placeholders (LAUNCH.md step 6).');
} catch (e) {
  problems.push(`eas.json unreadable: ${e instanceof Error ? e.message : e}`);
}

// The pre-install hook and the font licence.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
check(/eas-fonts\.mjs/.test(pkg.scripts?.['eas-build-pre-install'] ?? ''), 'EAS pre-install hook copies the Thmanyah fonts');
try {
  const tracked = execFileSync('git', ['ls-files', 'apps/mobile/assets/fonts/thmanyah', 'docs/app/prototype-app/fonts/thmanyah'], { cwd: repo, encoding: 'utf8' }).trim();
  check(!tracked, 'no Thmanyah font file is in git', tracked ? `git rm --cached ${tracked.split('\n').join(' ')}` : undefined);
  const leaked = execFileSync('git', ['ls-files', '*.p8', '*.p12', '*.mobileprovision', '*.jks', '*.keystore', 'apps/mobile/play-service-account.json', 'apps/mobile/google-services.json', 'apps/mobile/credentials.json'], { cwd: repo, encoding: 'utf8' }).trim();
  check(!leaked, 'no signing key or service-account file is in git', leaked || undefined);
} catch { warnings.push('git not available: font and key checks skipped'); }
const easignore = existsSync(join(repo, '.easignore')) ? readFileSync(join(repo, '.easignore'), 'utf8') : '';
check(!/^apps\/mobile\/assets\/fonts/m.test(easignore), '.easignore lets local fonts reach the build');

console.log(`\nMada Trips: store build checks\n${ok.map((s) => `  ✓ ${s}`).join('\n')}`);
if (warnings.length) console.log(`\nWarnings\n${warnings.map((s) => `  ! ${s}`).join('\n')}`);
if (problems.length) {
  console.log(`\nProblems\n${problems.map((s) => `  ✖ ${s}`).join('\n')}\n`);
  process.exit(1);
}
console.log(`\nReady for an EAS build (${ok.length} checks passed${warnings.length ? `, ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}).\n`);
