/*
 * The web app's shell, kept for a reload with no signal (an airport, a lift, a plane on the ground).
 *
 * What is kept: the page itself (index.html), the hashed bundles it names (/_expo/static/…), and the app's own files
 * (/assets/…: fonts, icons, the bundled photos). That is all. Nothing from /api is ever touched here: trips, Wallet
 * and messages are saved by the app itself (lib/net/persist.ts, lib/net/outbox.ts), per account, and dropped on
 * sign-out. So this cache holds nothing that belongs to a traveller: no tokens, no passports, no trips. An API answer,
 * good or bad, always comes straight from the network: an error is never hidden behind an old copy.
 *
 * Builds: every export has its own id, the hash in its entry bundle's name (entry-<hash>.js). The app registers this
 * file as /sw.js?build=<id> (lib/net/shell.ts), so a new deploy is a new worker: it installs, saves the new page and
 * bundles in its own cache (mada-shell-<id>), takes over at once (skipWaiting + clients.claim), and keeps the last
 * build's cache too, so a tab still running the old app can finish loading its own screens instead of a mix of both.
 * Anything older goes.
 *
 * The page: always the network first, so a new deploy is what opens when there's a connection. Only when the network
 * fails (or is slower than a few seconds and a copy is here) is the saved page used; when the network then answers
 * with a newer build, every open tab is told ({ type: 'build', build }) and shows "A new version is ready · Refresh".
 * The hashed bundles never change under their name, so they're served from the cache first.
 */
const BUILD = new URL(self.location.href).searchParams.get('build') || 'unknown';
const PREFIX = 'mada-shell-';
const FILES = 'mada-files-v1';
const PAGE = '/index.html';
const PAGE_WAIT_MS = 4000;
/** This build and the one before it. */
const KEEP_BUILDS = 2;

const sameOrigin = (url) => url.origin === self.location.origin;
const neverKept = (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/ocr/') || url.pathname === '/sw.js';
const isBundle = (url) => url.pathname.startsWith('/_expo/');
const isHtml = (res) => (res.headers.get('content-type') ?? '').includes('text/html');

/** A page's build: the hash in its entry bundle's name (the same rule as lib/net/shell.ts buildOf). */
function buildOf(html) {
  const m = /\/_expo\/static\/js\/web\/entry-([A-Za-z0-9]+)\.js/.exec(html);
  return m ? m[1] : null;
}

/** The bundles and styles a page names: <script src>, <link href>. */
function namedIn(html) {
  const out = new Set();
  for (const m of html.matchAll(/\b(?:src|href)="(\/_expo\/[^"]+)"/g)) out.add(m[1]);
  return [...out];
}

/** The chunks a bundle loads later (other screens, the mock API): their paths are written in the entry bundle. */
function chunksIn(js) {
  const out = new Set();
  for (const m of js.matchAll(/_expo\/static\/js\/[A-Za-z0-9_./-]+\.js/g)) out.add(`/${m[0]}`);
  return [...out];
}

/** The saved builds, newest first: each cache's page carries when it was saved. */
async function savedBuilds() {
  const out = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX)) continue;
    const page = await (await caches.open(name)).match(PAGE);
    // A page saved by an older worker (no stamp) counts as the oldest build; a cache with no page, as nothing.
    out.push({ name, build: name.slice(PREFIX.length), at: page ? Number(page.headers.get('x-mada-saved') ?? 1) || 1 : 0 });
  }
  return out.sort((a, b) => b.at - a.at);
}

async function prune() {
  const builds = await savedBuilds();
  const keep = new Set(builds.filter((b) => b.at > 0).slice(0, KEEP_BUILDS).map((b) => b.name));
  keep.add(PREFIX + BUILD);
  for (const b of builds) if (!keep.has(b.name)) await caches.delete(b.name);
  // Older workers' caches by another name (mada-shell-v1 and the like are covered above).
  for (const name of await caches.keys()) if (name.startsWith('mada-') && !name.startsWith(PREFIX) && name !== FILES) await caches.delete(name);
}

async function tellClients(build) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'build', build });
}

/** Save a page and everything it needs, in its own build's cache. */
async function keepPage(res) {
  const html = await res.clone().text();
  const build = buildOf(html);
  if (!build) return null;
  const cache = await caches.open(PREFIX + build);
  const wanted = new Set(namedIn(html));
  const save = async (path) => {
    let hit = await cache.match(path);
    if (!hit) {
      const r = await fetch(path, { credentials: 'same-origin' });
      if (!r.ok || isHtml(r)) return null;
      await cache.put(path, r.clone());
      hit = r;
    }
    return hit;
  };
  // Bundles first: a saved page whose bundles aren't saved would open blank offline.
  await Promise.all([...wanted].map(async (path) => {
    const r = await save(path);
    if (r && path.endsWith('.js')) for (const c of chunksIn(await r.clone().text())) wanted.add(c);
  }));
  await Promise.all([...wanted].map((path) => save(path).catch(() => null)));
  const headers = new Headers(res.headers);
  headers.set('x-mada-saved', String(Date.now()));
  await cache.put(PAGE, new Response(html, { status: 200, headers }));
  await prune();
  return build;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch('/', { cache: 'no-store' });
      if (res.ok && isHtml(res)) await keepPage(res);
    } catch { /* offline at install: the next page with a connection fills it */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await prune();
    await self.clients.claim();
  })());
});

async function newestPage() {
  const [b] = (await savedBuilds()).filter((x) => x.at > 0);
  if (!b) return null;
  const res = await (await caches.open(b.name)).match(PAGE);
  return res ? { res, build: b.build } : null;
}

async function page(event) {
  const saved = await newestPage();
  const fresh = fetch(event.request).then((res) => {
    if (res.ok && isHtml(res)) {
      event.waitUntil(keepPage(res.clone()).then((build) => {
        // An old copy was opened while the network was slow: the tabs learn there's a newer app.
        if (build && saved && build !== saved.build) return tellClients(build);
        return undefined;
      }).catch(() => {}));
    }
    return res;
  });
  if (!saved) return fresh;
  // A copy is here: wait a few seconds for the network, then open what we have.
  const late = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_WAIT_MS));
  try {
    const first = await Promise.race([fresh, late]);
    // A server error page is still the server's answer (never hidden), unless it can't even say that.
    return first ?? saved.res;
  } catch {
    return saved.res;
  }
}

async function bundle(event) {
  const { request } = event;
  // Hashed: the same name is the same bytes, whichever build saved it.
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic' && !isHtml(res)) {
    const copy = res.clone();
    event.waitUntil((async () => { const b = (await savedBuilds())[0]; await (await caches.open(b ? b.name : PREFIX + BUILD)).put(request, copy); })().catch(() => {}));
  }
  return res;
}

async function file(event) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(event.request);
  const fresh = fetch(event.request).then(async (res) => {
    if (res.ok && res.type === 'basic' && !isHtml(res)) await cache.put(event.request, res.clone());
    return res;
  });
  if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Other origins (photos, maps, Supabase) and anything of the account go straight to the network, untouched.
  if (!sameOrigin(url) || neverKept(url)) return;
  if (request.mode === 'navigate') { event.respondWith(page(event)); return; }
  if (isBundle(url)) { event.respondWith(bundle(event)); return; }
  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico') { event.respondWith(file(event)); return; }
});

self.addEventListener('message', (event) => {
  const msg = event.data ?? {};
  // The page lists what it already loaded before this worker was in charge (the first visit), so that is kept too,
  // in that page's own build's cache.
  if (msg.type === 'keep' && Array.isArray(msg.urls)) {
    event.waitUntil((async () => {
      const shell = await caches.open(PREFIX + (typeof msg.build === 'string' && msg.build ? msg.build : BUILD));
      const files = await caches.open(FILES);
      for (const raw of msg.urls.slice(0, 200)) {
        let url;
        try { url = new URL(raw, self.location.origin); } catch { continue; }
        if (!sameOrigin(url) || neverKept(url)) continue;
        const target = isBundle(url) ? shell : url.pathname.startsWith('/assets/') ? files : null;
        if (!target || (await target.match(url.pathname))) continue;
        try { const r = await fetch(url.pathname); if (r.ok && !isHtml(r)) await target.put(url.pathname, r); } catch { /* next time */ }
      }
    })());
  }
  // Signed out: nothing here belongs to an account, but the files cache goes too, so nothing at all is left over.
  if (msg.type === 'forget') event.waitUntil(caches.delete(FILES));
});
