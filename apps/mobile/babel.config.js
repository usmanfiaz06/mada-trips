// Expo's preset, with two changes for the web only (docs/app/PERF.md); phones get exactly what Expo gives them.
//  - The worklets plugin leaves out the copy of each worklet's source it writes for phones' UI thread (a string per
//    worklet, ~450 of them, Reanimated's own included): the web runs worklets on the page and never reads them.
//  - `import { … } from '@mada/shared'` is rewritten to the files that define the names (metro/shared-imports.js),
//    so a screen doesn't carry the whole package.
module.exports = (api) => {
  const web = api.caller((caller) => caller?.platform === 'web');
  return {
    presets: [['babel-preset-expo', web ? { worklets: false } : {}]],
    plugins: web ? [require('./metro/shared-imports'), ['react-native-worklets/plugin', { omitNativeOnlyData: true }]] : [],
  };
};
