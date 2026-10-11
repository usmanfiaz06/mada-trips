// Extends app.json with what is only known per machine or per build (docs/app/LAUNCH.md).
//
//   EAS_PROJECT_ID      the Expo project id from `eas init` (or put it in app.json › extra.eas.projectId). Wires
//                       expo-updates (u.expo.dev/<id>) and expo-notifications' push token to the project.
//   EXPO_OWNER          the Expo account or organisation that owns the project (or app.json › owner).
//   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
//                       Google Sign-In's native SDK needs the iOS client id's reversed form as a URL scheme, known
//                       only once the Google Cloud project exists (docs/app/AUTH.md).
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

  return out;
};
