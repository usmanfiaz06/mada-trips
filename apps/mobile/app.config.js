// Extends app.json with what is only known per machine or per build (docs/app/LAUNCH.md).
//
//   EAS_PROJECT_ID      the Expo project id from `eas init` (or put it in app.json › extra.eas.projectId). Wires
//                       expo-updates (u.expo.dev/<id>) and expo-notifications' push token to the project.
//   EXPO_OWNER          the Expo account or organisation that owns the project (or app.json › owner).
//   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
//                       Google Sign-In's native SDK needs the iOS client id's reversed form as a URL scheme, known
//                       only once the Google Cloud project exists (docs/app/AUTH.md).
//   GOOGLE_SERVICES_JSON
//                       the path to google-services.json (Firebase): Android push goes through FCM, which needs it.
//                       On EAS it is a file environment variable (docs/app/ANDROID.md); locally a google-services.json
//                       next to this file works too (git-ignored). Without either the build still works, just
//                       without push on Android (registerForPush quietly gives up).
//   GOOGLE_MAPS_ANDROID_API_KEY
//                       the hotel map on Android (react-native-maps draws Google Maps there; iOS uses Apple Maps with
//                       no key). Without it Android shows the drawn map instead (src/components/maps).
//   APPLE_TEAM_ID       the Apple Developer team id: signs the widget extension (targets/live) with the app.
//   MADA_LIVE_ACTIVITY=off
//                       builds without the lock-screen flight and the home-screen widget (docs/app/NATIVE.md).
//   SENTRY_ORG, SENTRY_PROJECT (+ SENTRY_AUTH_TOKEN as an EAS secret)
//                       uploads source maps so crash reports show real file names. Without them nothing is uploaded.
//
// Channels: eas.json gives each build profile an expo-updates channel (development, preview, production), so an
// update published to "preview" only reaches preview builds. runtimeVersion follows the app version (app.json), so an
// update never reaches a build whose native code is different: bump "version" whenever native code changes.
module.exports = ({ config }) => {
  const out = { ...config, plugins: [...(config.plugins ?? [])], extra: { ...(config.extra ?? {}) } };

  const owner = process.env.EXPO_OWNER || config.owner;
  if (owner) out.owner = owner;

  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  if (projectId) {
    out.extra.eas = { ...(config.extra?.eas ?? {}), projectId };
    out.updates = { ...(config.updates ?? {}), url: `https://u.expo.dev/${projectId}` };
  }
  // Without a project id (local development, the web export, CI checks) there is no update server; EAS Build always
  // has one, so every store build checks its channel. updates stays enabled either way: i18n.ts restarts the app with
  // Updates.reloadAsync() when the language changes, and that refuses when expo-updates is turned off.

  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (iosClientId) {
    const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
    out.plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }]);
  }

  if (process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) {
    out.plugins.push(['@sentry/react-native/expo', { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, url: 'https://sentry.io/' }]);
  }

  const googleServices = googleServicesFile();
  if (googleServices) out.android = { ...(out.android ?? config.android ?? {}), googleServicesFile: googleServices };
  out.extra.pushAndroid = !!googleServices;

  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  if (mapsKey) out.android = { ...(out.android ?? config.android ?? {}), config: { ...(config.android?.config ?? {}), googleMaps: { apiKey: mapsKey } } };
  out.extra.mapsAndroid = !!mapsKey;

  // The lock-screen flight (Live Activity, Dynamic Island) and the next-trip widget: an App Group, Info.plist keys and
  // the widget extension in targets/live (plugins/with-mada-live.js, docs/app/NATIVE.md).
  if ((process.env.MADA_LIVE_ACTIVITY ?? 'on').toLowerCase() !== 'off') {
    const teamId = process.env.APPLE_TEAM_ID || config.ios?.appleTeamId;
    if (teamId) out.ios = { ...(out.ios ?? config.ios ?? {}), appleTeamId: teamId };
    out.plugins.push(require('./plugins/with-mada-live'));
    out.plugins.push('@bacons/apple-targets');
  }

  // The web export loads each screen when it is first opened (critique #5, docs/app/PERF.md): the first download is
  // the shell and the screen that opens, not all ninety. Phones ship every screen in the app, so they stay as they are.
  out.extra.router = { ...(config.extra?.router ?? {}), asyncRoutes: { web: 'production', default: false } };

  // Directions from Things to do (src/lib/directions.ts): Android 11+ only lets canOpenURL see apps declared here.
  out.plugins.push(withRideAppQueries);

  return out;
};

/** google-services.json from the EAS file variable, else one next to this file, else none (a build without FCM). */
/* global __dirname */
function googleServicesFile() {
  const fs = require('fs');
  const path = require('path');
  for (const p of [process.env.GOOGLE_SERVICES_JSON, './google-services.json']) {
    if (!p) continue;
    const abs = path.resolve(__dirname, p);
    try { if (fs.statSync(abs).isFile()) return abs; } catch { /* not there */ }
  }
  return undefined;
}

/** <queries> for the maps and ride apps we offer (Waze, Uber, Careem by their URL schemes). */
function withRideAppQueries(config) {
  const { withAndroidManifest } = require('expo/config-plugins');
  return withAndroidManifest(config, (m) => {
    const manifest = m.modResults.manifest;
    const intent = (scheme) => ({ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': scheme } }] });
    manifest.queries = [...(manifest.queries ?? []), { intent: ['waze', 'uber', 'careem'].map(intent) }];
    return m;
  });
}
