# Mada Trips app: production build plan

How we go from the prototype ([prototype-app/](prototype-app/)) to a real iOS and Android app.

Everything in [SCOPE.md](SCOPE.md), [EXPERIENCE.md](EXPERIENCE.md), [COPY.md](COPY.md), [FLOWS.md](FLOWS.md) and [INTEGRATIONS.md](INTEGRATIONS.md) applies.

---

## 1. Code layout: one repo, next to Mada Ops

```
mada-trips/
  platform/          Mada Ops (exists): gains the app inbox, request queue, 24/7 desk board
  apps/mobile/       the iOS and Android app: Expo SDK 56, React Native, TypeScript
  services/core/     Mada Core API: app accounts, trips, search, payments, alerts, AI
  packages/shared/   types, Zod schemas, money and date helpers, the string catalogue
```

**Why this layout**
- **One language end to end:** TypeScript in the app, the Core API and Ops.
- **One database:** the existing Supabase Postgres, with new tables beside the Ops tables.
- **Shared Zod schemas:** so the app, the Core API and Ops can't disagree about what a booking is.

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
| **M0** | Foundations | Monorepo, CI, design tokens and components from the prototype, string catalogue, Supabase schema and migrations, Sentry and PostHog, Expo dev builds on real phones | Apple Developer and Google Play accounts; Supabase access |
| **M1** | Accounts and Wallet | Onboarding, sign-in, passport scan (on-device MRZ), household, encrypted document vault, upload and import, Face ID lock | — |
| **M2** | Booking | Ask with Claude, flight search (GDS + Travelfusion), hotels, the pay sheet with MyFatoorah, the Ops app inbox, issuing in Ops, confirmation, tickets in the Wallet | GDS API credentials; Travelfusion and RateHawk accounts; MyFatoorah sandbox; Anthropic API key |
| **M3** | Companion | Trips, change and cancel, refund tracker, FlightAware radar, Live Activities, travel day, disruption flows, WhatsApp | FlightAware key; WhatsApp Business verified |
| **M4** | Circles and Discover | Groups, Who's around, tips with moderation, curated plans, points and stamps | — |
| **M5** | Launch | Arabic, Tabby and Tamara, store submission, closed beta with Mada clients, the 24/7 desk live | Tabby and Tamara merchant approval; legal opinions; ZATCA e-invoicing |

## 4. What I can do now, and what needs you

**I can start M0 straight away in this repo.** Every vendor connection starts in sandbox or mock mode. Each one switches to live once the account exists, with nothing rewritten.

**Only Mada can supply** the accounts, keys and contracts in [INTEGRATIONS.md §1](INTEGRATIONS.md). Until they arrive, the app runs against realistic mock suppliers, so design and testing don't wait on them.
