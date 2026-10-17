/*
 * The widget extension (docs/app/NATIVE.md): the lock-screen flight and Dynamic Island (Live Activity), and the
 * next-trip home-screen widget. Built by @bacons/apple-targets at prebuild; the Swift files here are the source.
 * It shares the App Group with the app (plugins/with-mada-live.js) to read the next trip.
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'MadaLive',
  displayName: 'Mada',
  bundleIdentifier: '.live',
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  colors: {
    $accent: '#1e352d',
    $widgetBackground: '#1e352d',
    madaGreen: '#1e352d',
    madaGold: '#d4be8c',
    madaPaper: '#fffdf9',
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios?.entitlements?.['com.apple.security.application-groups'] ?? [`group.${config.ios?.bundleIdentifier ?? 'sa.madatrips.app'}`],
  },
});
