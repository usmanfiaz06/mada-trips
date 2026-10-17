// The lock-screen flight and the home-screen widget (docs/app/NATIVE.md), at prebuild:
//   - the app's Info.plist says it has Live Activities (and frequent updates, for boarding and gate changes), and
//     names the App Group the widget reads the next trip from (MadaAppGroup);
//   - the app and the widget extension share that App Group;
//   - @bacons/apple-targets adds the widget extension (targets/live) to the Xcode project, with its own bundle id
//     (sa.madatrips.app.live) and signing settings, and tells EAS about it.
// Turn it all off with MADA_LIVE_ACTIVITY=off (a build without the extension; the app falls back to notifications).
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const GROUPS = 'com.apple.security.application-groups';

function withMadaLive(config, { appGroup } = {}) {
  const group = appGroup || `group.${config.ios?.bundleIdentifier ?? 'sa.madatrips.app'}`;
  // apple-targets mirrors the app's App Groups into the extension: set them on the config before it runs.
  config.ios = { ...(config.ios ?? {}), entitlements: { ...(config.ios?.entitlements ?? {}), [GROUPS]: [...new Set([...(config.ios?.entitlements?.[GROUPS] ?? []), group])] } };
  config = withInfoPlist(config, (c) => {
    c.modResults.NSSupportsLiveActivities = true;
    c.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    c.modResults.MadaAppGroup = group;
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    c.modResults[GROUPS] = [...new Set([...(c.modResults[GROUPS] ?? []), group])];
    return c;
  });
  return config;
}

module.exports = withMadaLive;
