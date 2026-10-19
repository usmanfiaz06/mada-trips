# Web speed: the first open on a slow connection

Critique 2, issue #5: the web build (what the owner tests on) took 42 s to show a trip on a cold "Slow 3G" open,
because every screen was in one 7.2 MB entry file. This is how the web export is cut now, how it was measured, and
how to check it again.

## How it's measured

`apps/mobile/test/perf-3g.mjs` against a web export (mock API):

```
cd apps/mobile
node scripts/copy-ocr.mjs && EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist
node test/perf-3g.mjs            # DIST=… for another export, RUNS=… (default 2), VERBOSE=1 lists every file
```

Headless Chromium, a 390 × 844 phone, every run a fresh context (cold HTTP cache, no service worker). The export is
served brotli-compressed, as Vercel does, behind CDP throttling of 400 kbit/s down and up with a 400 ms round trip
(what Chrome then reports as `effectiveType: 3g`). Medians of 2 runs.

- **Guest**: first paint; the welcome line on screen (its buttons work from then); "Look around" tapped as soon as
  Welcome shows, until Today is drawn.
- **Signed in**: the demo account signed in once (unthrottled), then a cold open until the trip is on Today. With the
  mock API the trip comes from the copy saved on the device; the mock's sessions live in memory, so the reopened app
  then asks to sign in again over it.

The mock API is itself a 160 KB (brotli) file that real builds never download, so on staging the signed-in open is
that much shorter than below.

## Before and after

| Measure | Before | After |
|---|---|---|
| Entry JS, raw / brotli | 7.30 MB / 1.49 MB | 2.06 MB / 0.47 MB |
| First paint (guest and signed in) | 37.1 s | 0.5 s (the page's own sun, then the app) |
| Guest: Welcome on screen, buttons working | 37.5 s | 11.0 s |
| Guest: "Look around" answered (Today drawn) | 37.7 s | 23.1 s |
| Signed in: trip on Today | 37.3 s | 22.9 s |
| Signed in: bytes on the wire to the trip | 1656 KB | 830 KB (of which the mock API 160 KB) |

The full e2e suite passes against this export. Screens now arrive on first use, so e2e-beta and e2e-booking wait
for the next onboarding screen instead of a fixed 700 ms.

Still short of the goal (interactive in under 8 s on Slow 3G): see "What's left".

## How the web export is cut

1. **A screen per file** (`app.config.js`: `extra.router.asyncRoutes = { web: 'production' }`). Phones and the dev
   server keep every screen in the bundle.
2. **Our own grouping** (`apps/mobile/metro/web-chunks.js`). Expo then moves everything two screens share into one
   `__common` file loaded before anything draws (5 MB here). Instead:
   - **entry**: the shell and Welcome (`FIRST_OPEN`), one file named in the page;
   - **anchor**: the tabs layout and Today, everything they need that the entry lacks (`ANCHORS`); the root layout
     starts fetching it as soon as the entry runs;
   - **`__shared`**: what the other screens share (Reanimated, the gesture library, sheets…), fetched with the
     first of them;
   - **each screen**: what only it uses.
   An `import()` names every file the module needs (`paths: [anchor, shared, screen]`) and `metro/async-require.js`
   fetches them side by side. Metro's module registry ignores a second definition, so nothing runs twice.
   `MADA_CHUNK_GRAPH=<file>` writes the module graph (sizes and imports) during an export, to see what pulls what.
3. **`@mada/shared` imports name their file** (`metro/shared-imports.js`, a Babel plugin, web only):
   `import { colors } from '@mada/shared'` becomes `import { colors } from '@mada/shared/tokens'`, so one token no
   longer brings every schema and all the copy.
4. **Arabic's words wait** (`metro.config.js`, `lib/i18n.ts`, `copy/ar-catalogue.ts`): on the web the catalogue's
   Arabic resolves to an empty stub; an Arabic launch fetches it before the first screen, an English one only if Ask
   answers in Arabic. About 0.9 MB raw (Metro writes Arabic as `\u` escapes).
5. **No worklet source strings** (`babel.config.js`): the worklets plugin's copies of each worklet's source, for the
   phones' UI thread, are left out of the web (`omitNativeOnlyData`): ~450 strings.
6. **Lazy for what isn't on screen** (`components/Later.tsx`): the sign-in and session sheets, the app lock, the
   update bar, toasts, the offline pill and the Outbox, every bottom sheet (`Sheet.web.tsx`), the in-flight swipe
   deck, the crash screen's moving art, Sentry (`import()` only with a DSN), Supabase's SDK (`lib/auth`). Once the
   first screen is up the pill, Outbox, toast and sheet files are preloaded (after 20 s on a slow link), so they are
   on the device for when the signal goes.
7. **Web motion without Reanimated** where the first screens need it: `Appear`, `Entering`, `PopIn`, `GestureRoot`
   (`.web.tsx` variants are CSS animations or plain views; phones keep Reanimated exactly as before).
8. **Something branded at once** (`public/index.html`): the sun on the brand green with a thin progress line, drawn
   by the page itself; the root layout removes it when the first screen is ready.
9. **Fonts don't hold the first screen** on the web (600 ms cap once everything else is ready; the browser swaps them
   in). On a slow or metered link (`lib/net/slow-link.ts`) they're fetched after Today's file, and Welcome shows its
   photo without fetching the 1 MB film.
10. **The service worker saves only the shell** at install (`public/sw.js`: the page, the runtime and the entry).
    Every other file is saved the first time the app fetches it (and what the first visit fetched before the worker
    took over, via the page's `keep` message).

## What's left

- The entry is still ~470 KB brotli: React, react-native-web and expo-router (~220 KB), the English copy (all of
  it, ~330 KB raw) and zod (~240 KB raw). Splitting the copy by screen needs `t()` to wait for a section; zod is what
  every API answer is checked with.
- Today's file (~180 KB brotli) carries the trip schemas, the phase cards and expo-notifications.
- With a real API the signed-in open loses the mock's 160 KB but makes its round trips (critique: the server is in
  iad1, the database in Singapore).
