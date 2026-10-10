# Mada Trips app: production build plan

How we go from the prototype ([prototype-app/](prototype-app/)) to a real iOS and Android app.

Everything in [SCOPE.md](SCOPE.md), [EXPERIENCE.md](EXPERIENCE.md), [COPY.md](COPY.md), [FLOWS.md](FLOWS.md) and [INTEGRATIONS.md](INTEGRATIONS.md) applies.

---

## 1. Code layout: one repo, next to Mada Ops

```
mada-trips/
  package.json         npm workspaces: apps/*, packages/* (root scripts: typecheck, test, lint)
  apps/mobile/         the iOS and Android app: Expo SDK 57, React Native 0.86, TypeScript strict, expo-router
  packages/shared/     zod schemas + types for every API payload, money and date helpers, design tokens,
                       the string catalogue (TypeScript source, no build step)
  platform/            Mada Ops (Next.js 15) + the Mada Core API at /api/app/v1 (own package and lockfile)
    src/app/api/app/v1/   route handlers: auth, me, people, flights/{no}/position, health
    src/lib/app/          server logic: tokens, codes, users, household, crypto, audit, suppliers/
    src/db/app-schema.ts  the app_ tables (Ops tables untouched)
    test/app/             Core API integration tests on a real Postgres
  .github/workflows/app-ci.yml
```

**Decisions**
- **The Core API lives inside `platform/`**, not a separate service: one Vercel project, one database, one deploy.
  It is plain JSON under `/api/app/v1` (versioned), outside the Ops middleware, with its own tables prefixed `app_`.
  App rows point at Ops (`clients`, `bookings`, `payments`, `users`) only through nullable foreign keys.
- **`platform/` stays its own package** with its own lockfile, so its Vercel deploy is unchanged. It is not an npm
  workspace. It imports `packages/shared` as TypeScript source through the `@mada/shared` path alias
  (`tsconfig.json` paths + a webpack alias in `next.config.ts`, `experimental.externalDir`). Shared's only
  dependency, `zod`, resolves to `platform/node_modules/zod` (pinned to the same 4.6.5), so a build that installs only
  `platform/` (Vercel, CI) works. Verified by building with the root `node_modules` removed.
- **The mobile app consumes `@mada/shared` as a workspace package**; Metro watches `packages/shared`
  (`apps/mobile/metro.config.js`).
- **Expo SDK 57 pins React Native 0.86.3 and React 19.2.3** (its `bundledNativeModules.json`), so those are used rather
  than the newer RN 0.87 on npm.
- **One string catalogue** (`packages/shared/src/copy/en.ts`). Server error messages, SMS texts and notification
  texts come from it too. A test fails on COPY.md banned words, exclamation marks, em dashes, emoji, unfinished
  placeholders and lock-screen length limits.

### Why this layout
- **One language end to end:** TypeScript in the app, the Core API and Ops.
- **One database:** the existing Postgres, with new tables beside the Ops tables.
- **Shared zod schemas:** the app, the Core API and Ops can't disagree about what a booking is. The app validates
  every response against them, so contract drift shows up as an error, not a blank screen.

## 2. What "production ready" means here

| Area | Standard |
|---|---|
| **Accounts** | Sign in with Apple, Google and phone codes. Refresh tokens in the iOS Keychain and Android Keystore. Sign-out and account deletion that really delete. |
| **Data** | Passports and documents in a separately encrypted bucket. Every agent view is logged in the Ops audit log. Consent captured as the PDPL (Saudi data protection law) requires. Moving data to a Saudi region is planned from day one. |
| **Payments** | MyFatoorah, Tabby and Tamara. The card is authorised on request, captured when the ticket is issued, and voided if issuing fails. Payment confirmations from the providers are idempotent, so a repeated message can never charge twice. |
| **Supply** | GDS for flights, Travelfusion for flynas and flyadeal, RateHawk and WebBeds for hotels. Searches are cached and the ratio of searches to bookings is watched. Prices are never written by the AI. |
| **Alerts** | FlightAware webhooks feed a queue, which sends push notifications (including Live Activities) and WhatsApp messages, within the notification budget. |
| **AI** | Claude, with strict tool schemas. High-stakes messages use fixed templates. Every outgoing message is checked for banned words. Spending is capped by a budget alert. |
| **Quality** | Typecheck, lint, unit tests on money, dates and rules, and end-to-end tests of every flow in FLOWS.md (Maestro on device). |
| **Monitoring** | Sentry for crashes and slow frames. PostHog funnels plus our own tap heatmaps. Alerts when a supplier fails or the 24/7 desk falls behind its promised response times. |
| **Accessibility** | Dynamic Type, VoiceOver and TalkBack, Reduce Motion, 4.5:1 contrast. |
| **Languages** | English first, with full Arabic and right-to-left layouts. Strings come from the catalogue, never hard-coded. |
| **App stores** | User-generated content rules (report, block, filter), privacy labels, the Apple Pay merchant ID, a demo account for app review, and TestFlight / Play internal testing tracks. |

## 3. Milestones

| # | Milestone | Ships | Needs from Mada |
|---|---|---|---|
| **M0** | Foundations | Monorepo, CI, design tokens and components from the prototype, string catalogue, schema and migrations, Core API auth, supplier mocks, onboarding (see §5) | Apple Developer and Google Play accounts; Supabase access |
| **M1** | Accounts and Wallet | Onboarding, sign-in, passport scan (on-device MRZ), household, encrypted document vault, upload and import, Face ID lock | — |
| **M2** | Booking | Ask with Claude, flight search (GDS + Travelfusion), hotels, the pay sheet with MyFatoorah, the Ops app inbox, issuing in Ops, confirmation, tickets in the Wallet | GDS API credentials; Travelfusion and RateHawk accounts; MyFatoorah sandbox; Anthropic API key |
| **M3** | Companion | Trips, change and cancel, refund tracker, FlightAware radar, Live Activities, travel day, disruption flows, WhatsApp | FlightAware key; WhatsApp Business verified |
| **M4** | Circles and Discover | Groups, Who's around, tips with moderation, curated plans, points and stamps | — |
| **M5** | Launch | Arabic, Tabby and Tamara, store submission, closed beta with Mada clients, the 24/7 desk live | Tabby and Tamara merchant approval; legal opinions; ZATCA e-invoicing |

## 4. What I can do now, and what needs you

**I can start M0 straight away in this repo.** Every vendor connection starts in sandbox or mock mode. Each one switches to live once the account exists, with nothing rewritten.

**Only Mada can supply** the accounts, keys and contracts in [INTEGRATIONS.md §1](INTEGRATIONS.md). Until they arrive, the app runs against realistic mock suppliers, so design and testing don't wait on them.

---

## 5. Running it locally

**Needs:** Node 22 (20.19+), Postgres 16 (local or Docker), and for the phone app Expo Go or a dev build.

```bash
npm install                     # root: apps/mobile + packages/shared (workspaces)
npm --prefix platform ci        # platform has its own lockfile
```

### The Core API (platform/)

```bash
cd platform
cp .env.example .env            # DATABASE_URL, APP_JWT_SECRET, APP_DATA_KEY (see below)
npm run db:migrate              # Ops and app_ tables, through drizzle/
npm run dev                     # http://localhost:3100 ; Core API at /api/app/v1
curl localhost:3100/api/app/v1/health
```

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Postgres. Migrations use `DIRECT_URL` when set (pooler-safe). |
| `APP_JWT_SECRET` | 32+ characters; signs 15-minute access tokens. Required in production (a dev default exists locally). |
| `APP_DATA_KEY` | base64 of 32 bytes (`openssl rand -base64 32`); encrypts passport numbers with AES-256-GCM. Without it, passports can't be saved (`501 NOT_CONFIGURED`). Rotate by moving the old key to `APP_DATA_KEYS_OLD`. |
| `APP_OTP_PEPPER` | Optional; keys the hashes of codes and IPs. |
| `SUPPLIER_MODE`, `SUPPLIER_MODE_<NAME>` | `mock` or `live`. Mock is the default in development, live on a production deployment, which refuses mocks unless `APP_ALLOW_MOCKS=yes`. In mock SMS mode the sign-in code is always **123456** and is logged, not sent. Live aircraft positions are live by default. Per-supplier credentials: [platform/src/lib/app/suppliers/README.md](../../platform/src/lib/app/suppliers/README.md). |

**Endpoints (v1):** `POST /auth/otp/start`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`,
`POST /auth/apple`, `POST /auth/google` (mock-verified now, JWKS-verified when live), `GET`/`PATCH /me`,
`GET`/`POST /people`, `GET /flights/{flightNo}/position`, `GET /health`. Errors are always
`{ "error": { "code", "message" } }` with optional `fields`, `triesLeft`, `retryAfter`.

**Security as built:** codes are 6 digits, valid 10 minutes, stored as an HMAC, 3 tries then locked, 30 s between
sends, 5 per number and 20 per network per hour. Refresh tokens are 256-bit, stored as SHA-256, rotate on every use,
and a replayed old token revokes the session. Every request checks the session is still live, so sign-out is
immediate. Passport numbers are AES-256-GCM encrypted, bound to their row, returned only masked (`A08•••41`), and never
written to logs. `app_audit` and `app_credit_ledger` are append-only (database trigger).

### Tests

```bash
npm test                        # root: shared unit tests, then platform integration tests
npm --prefix platform test      # Core API on a throwaway Postgres: a private initdb cluster in /tmp
                                # (needs the Postgres 16 binaries; runs as the postgres user when you're root),
                                # or set TEST_DATABASE_URL to use a server you already have (CI does)
npm run typecheck && npm run lint
```

### The app (apps/mobile)

```bash
cd apps/mobile
npx expo start                  # i / a / w ; EXPO_PUBLIC_API_URL=http://<your-ip>:3100 for a real phone
EXPO_PUBLIC_API_MODE=mock npx expo start      # no server: an in-app API with the same rules (demo: 50 000 4127)
npm run export:web              # static web build in dist/ (react-native-web), used for screenshots
API_TARGET=http://localhost:3100 npm run e2e:web -- <screenshot-dir>
```

`test/e2e-web.mjs` serves `dist/`, proxies `/api` to the platform, walks Welcome → Sign in (Apple sheet, cancelled) →
phone (a short number first) → code (one wrong try) → name → alerts → Today → Trips, Circles, Wallet, Ask, then signs
the same number in on a fresh browser and expects **Welcome back**. It screenshots every step at 390×844 and fails on any
page error. Set `EXPO_PUBLIC_DEMO_HINTS=yes` at export time to show the prototype's demo hints.

| App variable | What it is |
|---|---|
| `EXPO_PUBLIC_API_URL` | Core API origin. Empty on web means same origin; the default on a simulator is `localhost:3100`. |
| `EXPO_PUBLIC_API_MODE` | `mock` runs the in-app API (`src/lib/mock-api.ts`). Re-export with `--clear` when you change it. |
| `EXPO_PUBLIC_DEMO_HINTS` | `yes` shows "Demo code: 123456" outside development builds. |

---

## 6. M0: done, and what's next

**Done (M0)**
- [x] Workspaces, root scripts (`typecheck`, `test`, `lint`), GitHub Actions `app-ci.yml` (typecheck, tests, lint, web
      export; platform typecheck, Core API tests on Postgres 16, Next build, installing only `platform/` as Vercel does).
- [x] `packages/shared`: zod schemas and types for users, people and masked passports, trips, segments, stays, pickups,
      requests, quotes, payments, refunds, invoices, credit, circles, messages, notifications, tracked flights, offers,
      positions; halala money maths; Riyadh dates; Saudi phone checks; design tokens; the string catalogue with its
      COPY.md lint. Unit tests.
- [x] 21 `app_` tables with migrations `0015_app_core` and `0016_app_append_only`; Ops tables untouched.
- [x] Core API: phone codes with limits and lockout, Apple/Google endpoints behind the identity supplier, rotating
      refresh tokens, `/me`, `/people` with encrypted passports, `/health`, live aircraft positions. Integration tests
      against real Postgres.
- [x] Ten suppliers behind interfaces with prototype-faithful mocks; live adapters for Unifonic, WhatsApp Cloud API,
      FlightAware lookups, Claude, Apple/Google token verification and open ADS-B positions.
- [x] The app shell: tokens, fonts, the component kit from the prototype (buttons, cards, chips, pills, sheet, top bar,
      the dock with the sun orb, slide to confirm, avatars, pay marks, the icon set, empty states and their drawings),
      the haptic vocabulary, API client with single-flight refresh, React Query, secure token storage, onboarding
      exactly as the prototype, the four tabs' empty states, Ask placeholder.

**Known gaps, carried into M1**
- Native Sign in with Apple / Google sheets (`expo-apple-authentication`, Google Sign-In): the screens and API are
  ready, the native step is mocked in development builds (`src/lib/social.ts`).
- Expo dev builds on real phones, EAS project, Sentry and PostHog: need the Apple and Google accounts.
- Push: the alerts step records the answer and asks the OS on device; push-token registration (`app_devices`) has
  its table but no endpoint yet.
- Offline banner and request queue (needs `@react-native-community/netinfo`).
- Arabic: the catalogue and layouts are ready (start/end everywhere), the Arabic strings are not written yet.
- Motion: entrances, the sheet and the slider run on Reanimated; the sun's breathing, the empty-state drawings'
  loops and the split-flap animation are still static.
- Account deletion: `app_credit_ledger` blocks deleting a user who has credit; the delete flow will need an
  anonymising path (PDPL).
- Rate limits for verify attempts per network (codes are limited per code and per number today).
- OpenSky's terms: free for non-commercial use only. Agree terms with OpenSky, or rely on adsb.lol (ODbL, with
  attribution), before launch. Set `ADSB_CONTACT`.
- Some strings in `en.ts` were written by an engineer to fill gaps (error messages, the welcome-back line): they
  need the writer's review (COPY.md §9).

**Next (M1: accounts and Wallet)**: passport scan (on-device MRZ) into `POST /people` and a self-passport endpoint,
household management, Face ID lock on the Wallet, document vault and uploads, account deletion and data export,
native sign-in, device registration and push.
