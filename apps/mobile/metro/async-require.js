/*
 * import() for the web export's files (metro/web-chunks.js): a screen's import can name two files, the shared file
 * and the screen's own, as [shared, own]. Both are fetched (side by side) before the screen runs; the shared one only
 * once. Everything else, and every import that names one file (phones, the dev server), is Expo's own async require.
 */
/* global __METRO_GLOBAL_PREFIX__ */
const expoAsyncRequire = require('expo/internal/async-require-module');

const fileList = (moduleID, paths) => {
  const p = paths == null ? null : paths[String(moduleID)];
  return Array.isArray(p) ? p : null;
};

function loadAll(list) {
  const loadBundle = globalThis[`${typeof __METRO_GLOBAL_PREFIX__ !== 'undefined' ? __METRO_GLOBAL_PREFIX__ : ''}__loadBundleAsync`];
  return Promise.all(list.map((p) => loadBundle(p)));
}

function asyncRequire(moduleID, paths, moduleName) {
  const list = fileList(moduleID, paths);
  if (!list) return expoAsyncRequire(moduleID, paths, moduleName);
  // Already here (an earlier import brought it): the module, at once.
  try { return expoAsyncRequire(moduleID, null, moduleName); } catch { /* not loaded yet */ }
  const promise = loadAll(list).then(() => expoAsyncRequire(moduleID, null, moduleName));
  promise._result = promise;
  return promise;
}

asyncRequire.unstable_importMaybeSync = function unstable_importMaybeSync(moduleID, paths) {
  const list = fileList(moduleID, paths);
  if (!list) return expoAsyncRequire.unstable_importMaybeSync(moduleID, paths);
  try { return expoAsyncRequire.unstable_importMaybeSync(moduleID, null); } catch { /* not loaded yet */ }
  return loadAll(list).then(() => expoAsyncRequire.unstable_importMaybeSync(moduleID, null));
};

asyncRequire.prefetch = function prefetch(moduleID, paths, moduleName) {
  const list = fileList(moduleID, paths);
  if (!list) return expoAsyncRequire.prefetch(moduleID, paths, moduleName);
  loadAll(list).then(() => {}, () => {});
};

asyncRequire.unstable_resolve = function unstable_resolve(moduleID, paths) {
  const list = fileList(moduleID, paths);
  return expoAsyncRequire.unstable_resolve(moduleID, list ? { [String(moduleID)]: list[list.length - 1] } : paths);
};

asyncRequire.unstable_createWorker = expoAsyncRequire.unstable_createWorker;

module.exports = asyncRequire;
