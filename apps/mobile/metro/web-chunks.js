/*
 * How the web export is cut into files (critique #5, docs/app/PERF.md).
 *
 * With async routes (app.config.js) Expo gives every screen its own file, then moves every module that two screens
 * share into one `__common` file that the page loads before anything draws. Nearly everything is shared by some two
 * screens, so `__common` was 5 MB and the first open on a slow connection still waited for all of it.
 *
 * This regroups the files after Expo has made them, and only for an exported web build:
 *   entry      the shell and the screens every cold open draws first (FIRST_OPEN below), with everything they
 *              import. One file, named in the page, so the first screen needs no second round trip.
 *   anchors    the screen an open lands on next (Today: ANCHORS), with everything it imports that the entry lacks.
 *   __shared   what the other screens share, fetched with the first of them that needs it, kept from then on.
 *   <screen>   what only that screen uses.
 * An import() names every file the imported module needs ("paths": [today, shared, screen]); the app's async require
 * (metro/async-require.js) fetches them side by side before running it. Phones and the dev server are left as Expo
 * makes them.
 *
 * It works on Expo's own chunk objects, between the cut and the naming of the files: Expo calls
 * computeChunkFilenames.precomputeChunkFilenames(chunks, chunksByPath) once per export, with the very Set and Map it
 * then writes out, so regrouping them there (in place) is what gets written. Pinned to @expo/metro-config's
 * serializeChunks (SDK 57); if that call or the chunk names change, this does nothing and the export is Expo's own.
 */
const path = require('node:path');

/** Route files in the entry: what every cold open draws first (the root layout, the launch redirect, Welcome). */
const FIRST_OPEN = [
  /[\\/]src[\\/]app[\\/]_layout\.tsx$/,
  /[\\/]src[\\/]app[\\/]index\.tsx$/,
  /[\\/]src[\\/]app[\\/]\(onboarding\)[\\/]_layout\.tsx$/,
  /[\\/]src[\\/]app[\\/]\(onboarding\)[\\/]welcome\.tsx$/,
];
/**
 * Screens that keep everything they import in one file of their own, in this order: where an open lands next. The
 * tabs and Today (signed in, or "Look around") are one file, so a returning traveller's open is the entry and it.
 * A later screen that shares some of it fetches it too.
 */
const ANCHORS = [[/[\\/]src[\\/]app[\\/]\(tabs\)[\\/]_layout\.tsx$/, /[\\/]src[\\/]app[\\/]\(tabs\)[\\/]today\.tsx$/]];

function install(projectRoot) {
  const base = path.dirname(require.resolve('@expo/metro-config/package.json', { paths: [projectRoot] }));
  const names = require(path.join(base, 'build/serializer/computeChunkFilenames'));
  const { Chunk } = require(path.join(base, 'build/serializer/serializeChunks'));
  const { isResolvedDependency } = require(require.resolve('@expo/metro/metro/lib/isResolvedDependency', { paths: [base] }));
  if (names.__madaWebChunks) return;
  const original = names.precomputeChunkFilenames;
  names.precomputeChunkFilenames = (args) => {
    if (args.recomputeChunkNames) regroup(args.chunks, args.chunksByPath, Chunk, isResolvedDependency);
    return original(args);
  };
  names.__madaWebChunks = true;
}

/** Every module a set of modules needs to run now (static imports, not import()). */
function closure(graph, entries, isResolvedDependency) {
  const out = new Set();
  const stack = [...entries];
  while (stack.length) {
    const m = stack.pop();
    if (!m || out.has(m)) continue;
    out.add(m);
    for (const dep of m.dependencies.values()) {
      if (!isResolvedDependency(dep) || dep.data.data.asyncType) continue;
      stack.push(graph.dependencies.get(dep.absolutePath));
    }
  }
  return out;
}

function regroup(chunks, chunksByPath, Chunk, isResolvedDependency) {
  const all = [...chunks];
  const entry = all.find((c) => c.isEntry && !c.isAsync);
  const common = all.find((c) => c.isVendor && c.name.endsWith('/__common.js'));
  const runtime = all.find((c) => c.name.endsWith('/__expo-metro-runtime.js'));
  if (!entry || !common || !runtime || entry.getPlatform() !== 'web') return;
  const graph = entry.graph;
  if (process.env.MADA_CHUNK_GRAPH) dumpGraph(graph, process.env.MADA_CHUNK_GRAPH, isResolvedDependency);
  const deps = (mods) => closure(graph, mods, isResolvedDependency);
  const screens = all.filter((c) => c.isAsync && !c.sealed && c !== common);
  const matches = (c, list) => [...c.entries].some((m) => list.some((re) => re.test(m.path)));

  // The entry: what Expo put there, plus the first-open screens and everything they import.
  const placed = new Set(deps(entry.entries));
  for (const m of entry.deps) placed.add(m);
  for (const c of screens.filter((c) => matches(c, FIRST_OPEN))) for (const m of deps(c.entries)) placed.add(m);
  entry.deps = new Set(placed);

  // The anchors, in order: each keeps what it imports that the entry and the anchors before it don't have.
  const anchors = [];
  for (const group of ANCHORS) {
    const members = screens.filter((x) => matches(x, group));
    if (!members.length) continue;
    const [c, ...merged] = members;
    for (const x of merged) for (const m of x.entries) c.entries.add(m);
    for (const x of merged) chunks.delete(x);
    c.deps = new Set([...deps(c.entries)].filter((m) => !placed.has(m)));
    for (const m of c.deps) placed.add(m);
    anchors.push(c);
  }
  const merged = new Set(screens.filter((x) => !anchors.includes(x) && ANCHORS.some((g) => matches(x, g))));

  // Every other screen: what it imports that isn't placed yet; what two or more of them share goes to __shared.
  const rest = screens.filter((c) => !matches(c, FIRST_OPEN) && !anchors.includes(c) && !merged.has(c));
  const own = new Map(rest.map((c) => [c, [...deps(c.entries)].filter((m) => !placed.has(m))]));
  const count = new Map();
  for (const list of own.values()) for (const m of list) count.set(m, (count.get(m) ?? 0) + 1);
  const sharedDeps = new Set([...count].filter(([, n]) => n > 1).map(([m]) => m));
  for (const [c, list] of own) c.deps = new Set(list.filter((m) => !sharedDeps.has(m)));

  entry.requiredChunks.delete(common);
  chunks.delete(common);
  for (const c of screens.filter((c) => matches(c, FIRST_OPEN))) chunks.delete(c);
  for (const c of [...rest, ...anchors]) if (!c.deps.size) chunks.delete(c);
  const shared = sharedDeps.size ? new Chunk('/__shared.js', sharedDeps, graph, entry.options, true, true) : null;
  if (shared) {
    shared.requiredChunks.add(runtime);
    chunks.add(shared);
  }

  // Which file holds a module: a screen's own entry first, then wherever the module now lives.
  chunksByPath.clear();
  for (const c of chunks) for (const m of c.entries) if (c.deps.has(m) && !chunksByPath.has(m.path)) chunksByPath.set(m.path, c);
  for (const c of chunks) if (!c.sealed) for (const m of c.deps) if (!chunksByPath.has(m.path)) chunksByPath.set(m.path, c);
  for (const c of chunks) if (c.sealed) for (const m of c.deps) if (!chunksByPath.has(m.path)) chunksByPath.set(m.path, c);

  // What an import() needs: every file holding a module the imported one runs (anchors, then __shared, then its own).
  const holder = new Map();
  for (const c of chunks) if (!c.sealed && c !== entry && c !== runtime) for (const m of c.deps) holder.set(m, c);
  const rank = (c) => (anchors.includes(c) ? anchors.indexOf(c) : c === shared ? anchors.length : anchors.length + 1);
  const needed = new Map();
  const filesFor = (absPath) => {
    if (!needed.has(absPath)) {
      const m = graph.dependencies.get(absPath);
      const files = new Set();
      for (const d of m ? deps([m]) : []) if (holder.has(d)) files.add(holder.get(d));
      const target = chunksByPath.get(absPath);
      needed.set(absPath, [...files].sort((a, b) => (a === target ? 1 : b === target ? -1 : rank(a) - rank(b))));
    }
    return needed.get(absPath);
  };
  for (const c of chunks) {
    if (c.sealed) continue;
    // Everything an import needs counts as reached (so a file's name changes when one it needs does)…
    const targets = c.getAsyncChunkTargets.bind(c);
    c.getAsyncChunkTargets = (byPath) => {
      const out = targets(byPath);
      for (const m of c.deps) {
        for (const d of m.dependencies.values()) {
          if (isResolvedDependency(d) && d.data.data.asyncType) for (const f of filesFor(d.absolutePath)) if (f.isAsync) out.add(f);
        }
      }
      return out;
    };
    // …and the import names every file, fetched side by side (metro/async-require.js).
    const paths = c.getComputedPathsForAsyncDependencies.bind(c);
    c.getComputedPathsForAsyncDependencies = (byPath, filenames) => {
      const out = paths(byPath, filenames);
      if (!out) return out;
      for (const [abs, url] of Object.entries(out)) {
        const target = byPath.get(abs);
        const files = filesFor(abs);
        if (files.length < 2 || typeof url !== 'string') continue;
        // url is the base URL followed by the target's file name.
        const baseUrl = url.slice(0, url.length - filenames.get(target).length);
        out[abs] = files.map((f) => (f === target ? url : baseUrl + filenames.get(f)));
      }
      return out;
    };
  }
}

/** MADA_CHUNK_GRAPH=<file>: every module with its minified size and imports, to see what pulls what (docs/app/PERF.md). */
function dumpGraph(graph, file, isResolvedDependency) {
  const out = [];
  for (const [p, m] of graph.dependencies) {
    const code = m.output.find((o) => o.type.startsWith('js/'))?.data.code ?? '';
    const deps = [];
    const lazy = [];
    for (const d of m.dependencies.values()) {
      if (!isResolvedDependency(d)) continue;
      (d.data.data.asyncType ? lazy : deps).push(d.absolutePath);
    }
    out.push({ path: p, size: code.length, deps, lazy });
  }
  require('node:fs').writeFileSync(file, JSON.stringify(out));
}

module.exports = { install, FIRST_OPEN, ANCHORS };
