/*
 * The web app's shell, kept for a reload with no signal (an airport, a lift, a plane on the ground).
 *
 * What is kept: the page itself (index.html), the hashed bundles it names (/_expo/static/…), and the app's own files
 * (/assets/…: fonts, icons, the bundled photos). That is all. Nothing from /api is ever touched here: trips, Wallet
 * and messages are saved by the app itself (lib/net/persist.ts, lib/net/outbox.ts), per account, and dropped on
 * sign-out. So this cache holds nothing that belongs to a traveller: no tokens, no passports, no trips.
 *
 * Updates: the page is always asked for from the network first, so a new deploy is the app the next time it opens
 * with a connection. Only when the network can't answer (or takes longer than a few seconds and a copy is here) is the
 * saved page used, with the bundles it was saved with (and every chunk they load later). Each fresh page prunes the
 * bundles it no longer names.
 * A new version of this file takes over at once (skipWaiting + clients.claim); its caches are named by VERSION.
 */
const VERSION = 'v1';
const SHELL = `mada-shell-${VERSION}`;
const FILES = `mada-files-${VERSION}`;
const PAGE = '/index.html';
const PAGE_WAIT_MS = 4000;

const sameOrigin = (url) => url.origin === self.location.origin;
const neverKept = (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/ocr/') || url.pathname === '/sw.js';
const isBundle = (url) => url.pathname.startsWith('/_expo/');

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

async function keepPage(res) {
  const html = await res.clone().text();
  const cache = await caches.open(SHELL);
  const wanted = new Set(namedIn(html));
  const save = async (path) => {
    let hit = await cache.match(path);
    if (!hit) {
      const r = await fetch(path, { credentials: 'same-origin' });
      if (!r.ok) return null;
      await cache.put(path, r.clone());
      hit = r;
    }
    return hit;
  };
  // Bundles first: a saved page whose bundles aren't saved would open blank offline.
  await Promise.all([...wanted].map(async (path) => {
    const r = await save(path);
    if (r && path.endsWith('.js')) for (const c of chunksIn(await r.text())) wanted.add(c);
  }));
  await Promise.all([...wanted].map((path) => save(path).catch(() => null)));
  await cache.put(PAGE, res);
  // What no page names any more goes (the last deploy's bundles).
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path !== PAGE && !wanted.has(path)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch('/', { cache: 'no-store' });
      if (res.ok) await keepPage(res);
    } catch { /* offline at install: the next page with a connection fills it */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('mada-') && name !== SHELL && name !== FILES) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function page(event) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match(PAGE);
  const fresh = fetch(event.request).then((res) => {
    if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) event.waitUntil(keepPage(res.clone()).catch(() => {}));
    return res;
  });
  if (!saved) return fresh;
  // A copy is here: wait a few seconds for the network, then open what we have (it updates for next time).
  const late = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_WAIT_MS));
  try {
    const first = await Promise.race([fresh, late]);
    return first ?? saved;
  } catch {
    return saved;
  }
}

async function bundle(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
  return res;
}

async function file(event) {
  const cache = await caches.open(FILES);
  const hit = await cache.match(event.request);
  const fresh = fetch(event.request).then(async (res) => {
    if (res.ok && res.type === 'basic') await cache.put(event.request, res.clone());
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
  if (isBundle(url)) { event.respondWith(bundle(request)); return; }
  if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico') { event.respondWith(file(event)); return; }
});

self.addEventListener('message', (event) => {
  const msg = event.data ?? {};
  // The page lists what it already loaded before this worker was in charge (the first visit), so that is kept too.
  if (msg.type === 'keep' && Array.isArray(msg.urls)) {
    event.waitUntil((async () => {
      const shell = await caches.open(SHELL);
      const files = await caches.open(FILES);
      for (const raw of msg.urls.slice(0, 200)) {
        let url;
        try { url = new URL(raw, self.location.origin); } catch { continue; }
        if (!sameOrigin(url) || neverKept(url)) continue;
        const target = isBundle(url) ? shell : url.pathname.startsWith('/assets/') ? files : null;
        if (!target || (await target.match(url.pathname))) continue;
        try { const r = await fetch(url.pathname); if (r.ok) await target.put(url.pathname, r); } catch { /* next time */ }
      }
    })());
  }
  // Signed out: nothing here belongs to an account, but the files cache goes too, so nothing at all is left over.
  if (msg.type === 'forget') event.waitUntil(caches.delete(FILES));
});
