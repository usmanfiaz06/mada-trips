// The web build's stand-in for @mada/shared's copy/ar-catalogue.ts (metro.config.js): no Arabic in the first
// download. lib/i18n.ts fetches the real catalogue when the app is in Arabic, or Arabic is about to be spoken.
export const arCatalogue: Readonly<Record<string, string>> = {};
