# Mada Trips on Google Play (Android first)

**For:** the owner (Bader) and whoever holds Mada's Google and Expo accounts. **Status, 19 Oct 2026:** the app is ready
for Play in code. Every step left needs Mada's accounts or keys. Apple follows later ([LAUNCH.md](LAUNCH.md)); nothing
here waits on Apple.

Legend: **Owner** = you (or someone with Mada's accounts) · **Code-done** = built and checked, nothing to do.
Never paste a key, password, JSON file or certificate into chat, an issue or git. Each one goes straight into the place
named below (Play Console, Google Cloud, Firebase, expo.dev, Vercel).

---

## 0. What's already done in the app (Code-done)

| | What | Where |
|---|---|---|
| Code-done | Package `sa.madatrips.app`, version 1.0.0. Build numbers (`versionCode`) are kept on EAS and go up by one on every production build | `app.json`, `eas.json` (`appVersionSource: remote`, `autoIncrement`) |
| Code-done | Adaptive icon (Mada green background, sun foreground) with a **monochrome** layer for Android 13 themed icons; white notification icon; green splash with the sun | `assets/images/icon-*.png`, `expo-splash-screen` |
| Code-done | Edge to edge (on by default in SDK 57; prebuild writes `edgeToEdgeEnabled=true`); right-to-left for Arabic (`supportsRtl`), English and Arabic app names | `app.json`, `locales/` |
| Code-done | **Permissions, only what is used**: camera (passport scan, photos), microphone (voice to Mada; the phone's speech service turns it into words, nothing recorded), **approximate** location only (“Distance from: where I am now”, asked once, never in the background), contacts (hashed on the phone to find friends), biometrics (app lock), notifications, set alarm (wake-up before a flight). Blocked: precise and background location, photo/video library (Android's photo picker needs none), storage, overlay, system settings, write contacts | `app.json` › `android.permissions` / `blockedPermissions`, checked by `npm run mobile:doctor` and `test/unit/android-config.test.ts` |
| Code-done | **App Links**: `https://madatrips.sa/join/…`, `/i/…`, `/trip/…`, `/plan/…`, `/city/…` open the app (intent filters with `autoVerify`). The website serves `/.well-known/assetlinks.json` from `ANDROID_CERT_SHA256` | `app.json`, `platform/src/lib/app/links/well-known.ts` |
| Code-done | **Push (FCM)**: `app.config.js` reads `google-services.json` from the EAS file variable `GOOGLE_SERVICES_JSON` (or a local, git-ignored file). Without it the build still works, only without push on Android | `app.config.js` |
| Code-done | **Notification channels**: *Trip updates* (high: gate changes, delays, driver, bookings), *Messages* (Mada's team and Circles), *Offers* (low, silent), named in the app's language. The server names the channel on every push, so muting offers never mutes a gate change. The flight you're on today stays pinned as its own quiet notification (Android's version of the iPhone lock-screen flight) | `src/lib/notification-channels.ts`, `platform/src/lib/app/push.ts`, `src/lib/live-activity.ts` |
| Code-done | **Google Maps** on the hotel map from `GOOGLE_MAPS_ANDROID_API_KEY`; without it the drawn map shows | `app.config.js` |
| Code-done | **Payments on Android**: saved cards, new card, mada, Visa/Mastercard through MyFatoorah. Apple Pay is never shown on Android. Google Pay is not offered yet (no dead button): MyFatoorah supports it in its embedded form, so it is a later addition once the merchant account has it enabled | `src/lib/device.ts` (`HAS_APPLE_PAY`), `src/app/pay/index.tsx` |
| Code-done | iPhone-only features hidden cleanly on Android: Apple Wallet buttons (Android shows the pass in the app), Live Activity (the pinned notification instead) | `src/lib/boarding.ts`, `src/lib/live-activity.ts` |
| Code-done | **Back button**: during payment, Android back does nothing but say “Still checking with your bank”; on the pay screen opened from a link or notification it asks “Leave this booking?” instead of closing the app; while a passport is saving it waits. Open sheets close first | `src/lib/hardware-back.ts` |
| Code-done | 360 dp phones: the booking flow and pay footer are tested at 360 and 390 wide | `test/e2e-booking.mjs` |
| Code-done | Build profiles: `preview` = APK for testers (internal distribution), `production` = AAB for Play on channel `production`, live API (`https://madatrips.sa`), `EXPO_PUBLIC_API_MODE=live`; `eas submit` uploads to the **internal** track as a draft | `eas.json` |
| Code-done | Store listing (English + Arabic), screenshots and feature graphic generator, privacy page, delete-account page | [store/LISTING.md](store/LISTING.md), `npm run store:screenshots`, madatrips.sa/privacy |

---

## 1. Google Play Console account (Owner)

1. Go to play.google.com/console and sign up with a Mada Google account (not a personal Gmail you'd lose), choose
   **Organisation**. You need: the D-U-N-S number of Mada Travel and Tourism (free at dnb.com, days to two weeks:
   start now), the CR, a company website (`madatrips.sa`), a contact phone and email Google can verify.
2. Pay the one-time **US$25** fee.
3. Complete **identity verification** (the legal representative's ID) and the organisation verification. Google can
   take a few days.
4. Users and permissions › invite the developer/lead with **Admin** (or *Release manager*).

> The rule that a new account must run a **closed test with 12 testers for 14 days** before production applies to new
> **personal** accounts only. As an **organisation** account Mada can go from internal testing to production directly.

## 2. Create the app (Owner)

Play Console › **Create app**: name **Mada Trips**, default language **English (United States)**, **App**, **Free**;
accept the declarations. Then Store presence › Store listings › add **Arabic** as a translation.

### Store listing (drafts, lengths checked)

The single source is [store/LISTING.md](store/LISTING.md) (rebuilt and length-checked by `npm run store:listing` from
`store/listing.json`). Paste from there. Title and short description:

| | English | Arabic |
|---|---|---|
| Title (≤ 30) | `Mada Trips` (10) | `مادا للسفر` (10) |
| Short description (≤ 80) | `Tell us where. Real people at Mada book it and look after the whole trip.` (73) | `قل لنا وجهتك. فريق مادا يحجزها ويعتني برحلتك كاملة.` (51) |
| Full description (≤ 4000) | LISTING.md › “App Store description · Play full description” (1417) | LISTING.md › same heading under Arabic (1191) |

The Arabic is a first draft for the native writer (COPY.md §7.4). Category: **Travel & Local**. Contact email
`support@madatrips.sa`, website `https://madatrips.sa`.

### Graphics

- **App icon** 512 × 512 PNG: export `apps/mobile/assets/images/icon.png` at 512.
- **Feature graphic** 1024 × 500: `npm run store:screenshots` writes `docs/app/store/screenshots/<en|ar>/play/feature-graphic.jpg`.
- **Phone screenshots** (2–8, we use 6, 1080 × 1920): same command, `docs/app/store/screenshots/<en|ar>/play/`. The six
  screens: Today (leave on time), Ask (say where), Trip day by day, Disruption fix, Wallet passports, Support. English
  screenshots on the English listing, Arabic on the Arabic one. Steps: in `apps/mobile`,
  `EXPO_PUBLIC_API_MODE=mock npm run export:web`, then `npm run store:screenshots`.
- No tablet screenshots needed (phone app).

## 3. Firebase for push (Owner, 15 min)

Android push travels over Firebase Cloud Messaging; Expo sends it for us. Two things from one Firebase project:

1. console.firebase.google.com › **Add project** › “Mada Trips” (link it to the same Google Cloud project as Maps and
   Sign-In if you like; analytics **off**).
2. Project settings › **Add app** › Android › package `sa.madatrips.app` › download **google-services.json**.
3. Give the file to EAS, not git: expo.dev › project *mada-trips* › **Environment variables** › Add › name
   `GOOGLE_SERVICES_JSON`, type **File**, visibility *Secret*, environments **preview** and **production** › upload the
   file. (`app.config.js` picks it up; it's not a secret in the strict sense, but it stays out of the public repo.)
4. Firebase › Project settings › **Service accounts** › *Generate new private key* (a JSON). Then
   `cd apps/mobile && npx eas-cli credentials` › Android › production › **Push Notifications: FCM V1 service account key**
   › upload that JSON. Delete the downloaded copy afterwards.

Correction to LAUNCH.md step 9: Firebase *is* needed on Android, for the `google-services.json` above. Without it the app
installs and works but gets no Expo push token.

## 4. Google Cloud: Maps key and Google Sign-In (Owner, 20 min)

In the Google Cloud project owned by Mada (the same one as the OAuth consent screen, AUTH.md §4):

1. **Maps**: APIs & Services › enable **Maps SDK for Android** › Credentials › *Create API key* › restrict it to
   *Android apps*, package `sa.madatrips.app` with the **SHA-1** fingerprints from §5, API restriction *Maps SDK for
   Android*. EAS environment variable `GOOGLE_MAPS_ANDROID_API_KEY` (preview + production, *Sensitive*).
   (CONNECT.md §18.)
2. **Google Sign-In, Android client**: Credentials › *Create OAuth client ID* › **Android**, package
   `sa.madatrips.app`, SHA-1 = the **upload key** SHA-1. Create a **second** Android client with the **Play app signing**
   SHA-1 (one SHA-1 per client). No id from these goes into the app: the app asks for tokens for the **web** client
   (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, already in AUTH.md §6), and Google checks the Android clients by package +
   SHA-1. A missing SHA-1 shows up as “DEVELOPER_ERROR” when tapping *Continue with Google*.

## 5. Signing fingerprints and App Links (Owner, after the first build)

There are two signing certificates:

- **Upload key**: EAS creates it on the first Android build (`npx eas-cli credentials` › Android › production shows its
  SHA-1 and SHA-256).
- **App signing key**: Google's, created when the first AAB reaches Play (Play Console › Test and release › **App
  integrity** › App signing shows SHA-1 and SHA-256).

Then:

1. **Vercel** (madatrips.sa, Production): `ANDROID_CERT_SHA256` = both SHA-256 values, comma-separated (colons or
   not). Redeploy. Check `https://madatrips.sa/.well-known/assetlinks.json` lists them.
2. **Google Cloud**: the SHA-1s into the Maps key restriction and the two Android OAuth clients (§4).
3. On a phone with the Play build: Settings › Apps › Mada Trips › *Open by default* shows `madatrips.sa` verified.

## 6. Other EAS environment variables (Owner)

expo.dev › project › Environment variables, for **preview** and **production** (names only here, values from each
service). Full table: [LAUNCH.md](LAUNCH.md) “Which variable goes where”.

| Variable | From |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | production Supabase project (AUTH.md §6, CONNECT.md §3) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Cloud web client (AUTH.md §4) |
| `GOOGLE_SERVICES_JSON` (file) | §3 |
| `GOOGLE_MAPS_ANDROID_API_KEY` | §4 |
| `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (secret) | Sentry (CONNECT.md §21) |
| `THMANYAH_FONTS_ZIP` (file) | the Arabic typeface (LAUNCH.md step 10) |

`EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_API_MODE` are already set in `eas.json` (production API, live).

## 7. Play service account for uploads (Owner, 15 min)

1. Google Cloud › IAM & Admin › Service accounts › Create “play-uploader” (no roles) › Keys › Add key › JSON.
2. Play Console › Users and permissions › **Invite new users** › the service account's email › app *Mada Trips* ›
   **Release manager** (or *Release to testing tracks* + *Manage testing tracks*).
3. `cd apps/mobile && npx eas-cli credentials` › Android › production › **Google Service Account** › *Upload a Google
   Service Account Key* › the JSON. EAS keeps it; `eas submit` uses it. Delete the downloaded file.

## 8. App content (Owner, 45 min): Play Console › Policy › App content

| Section | Answer |
|---|---|
| Privacy policy | `https://madatrips.sa/privacy` |
| App access | *All or some functionality is restricted* › the review sign-in from [store/REVIEW.md](store/REVIEW.md) §1 (`APP_REVIEW_LOGIN` / `APP_REVIEW_CODE` set in Vercel while the review is open) |
| Ads | **No ads** |
| Content rating | IARC questionnaire, category *Travel*: no violence, sexual content, language, drugs, gambling; users can talk to each other (Circles: yes, moderated, can block/report); shares location: no (approximate distance is used on the phone for one search); digital purchases: no (travel services are physical goods). Expected: Everyone / PEGI 3, with “Users interact” |
| Target audience | **18 and over** (bookings, payments, passports); not designed for children |
| News app | No |
| Government app | No |
| Financial features | None (payments go through MyFatoorah; Mada isn't a bank or lender). If Tabby/Tamara ship: “Buy now, pay later” via a partner |
| Health | No |
| Data safety | below |
| Account deletion | `https://madatrips.sa/delete-account` and in the app (Profile › Privacy) |

### Data safety (from what the code collects)

General: collects data **Yes**; encrypted in transit **Yes**; users can ask for deletion **Yes**; account creation
**Yes** (phone, email, Google, Apple). The detailed table is [store/PRIVACY-LABELS.md](store/PRIVACY-LABELS.md) › Data
safety; in short:

| Data type | Collected | Shared | Optional | Why |
|---|---|---|---|---|
| Name | Yes | Yes (airlines, hotels, to fulfil the booking) | Required | App functionality, account |
| Email address | Yes | No | Optional | Account, receipts |
| Phone number | Yes | Yes (bookings) | Optional | Account, booking contact |
| Other info: passport and ID details, date of birth, nationality | Yes (passport number encrypted) | Yes (bookings, visas) | Optional (needed to book) | App functionality |
| Purchase history | Yes | No | Required to book | App functionality |
| User payment info | Yes, by MyFatoorah's form (Mada keeps brand + last 4) | No | Required to pay | App functionality |
| **Approximate location** | Yes, **ephemeral** (once, when you ask for distance from where you are; not stored) | No | Optional | App functionality |
| Messages | Yes | No | Optional | App functionality |
| Photos | Yes (documents, profile photo) | No | Optional | App functionality |
| Contacts | Yes, **ephemeral** (hashed on the phone, matched, discarded) | No | Optional | App functionality |
| Other user-generated content (Circles) | Yes | No | Optional | App functionality |
| Crash logs, diagnostics (Sentry) | Yes | No | Required when on | Analytics (crash diagnosis) |
| Device or other IDs (push token) | Yes | No | Optional | Notifications |
| Audio | **No**: voice goes to the phone's own speech service; the app receives text only | | | |
| Precise location, web history, calendar, health, files | No | | | |

Counsel should confirm the “Shared” answers (PRIVACY-LABELS.md explains the user-initiated exemption).

## 9. First builds and testers (Owner gives the go; the lead/Claude runs the commands)

Needs `EXPO_TOKEN` in the Claude Code environment (LAUNCH.md step 3).

```
cd apps/mobile
npm run doctor                                      # store checks + expo-doctor; must say "Ready"
npx eas-cli build -p android --profile preview      # APK: install link for testers, no Play needed
npx eas-cli build -p android --profile production   # AAB for Play
```

The **first** AAB must be uploaded **by hand** once: Play Console › Test and release › Testing › **Internal testing** ›
Create release › upload the `.aab` from the EAS build page. After that:

```
npx eas-cli submit -p android --profile production --latest   # → internal track, as a draft
```

## 10. Rollout (Owner)

1. **Internal testing** (up to 100 testers): Testing › Internal testing › Testers › email list (staff, a few clients) ›
   copy the opt-in link. Fix what they find; each new build: `eas build --profile production` then `eas submit`.
   JavaScript-only fixes: `eas update --channel production`.
2. **Closed testing** (optional for an organisation account, useful for a wider beta): promote the internal release to
   a *Closed* track with a Google Group of testers.
3. **Production**: promote the release › countries **Saudi Arabia** first (add GCC later) › **staged rollout**: 10% for
   a day or two, watch Sentry crash-free rate (≥ 99.5%) and Play vitals, then 50%, then 100%. Halt the rollout from
   the same page if crashes rise.
4. Play's first review of a new app takes from a few hours to about a week.

---

## 11. Backend go-live for production (before step 10.3)

The app in Play talks to `https://madatrips.sa`. Everything below is in the **production** Vercel project, never in
chat. Each line points to its CONNECT.md section.

| | Item | Where |
|---|---|---|
| Owner | **Vercel production project** for madatrips.sa (Pro plan: the 5- and 15-minute crons need it), domain attached, `APP_PUBLIC_URL=https://madatrips.sa` | PRODUCTION.md §5 |
| Owner | **Production database** (Postgres, backups and point-in-time recovery on): `DATABASE_URL` (+ `DIRECT_URL` for a pooler), `APP_JWT_SECRET`, `APP_DATA_KEY` (passport encryption key: store a copy offline; losing it loses every passport number), `CRON_SECRET` | PRODUCTION.md §5 |
| Owner | **Server region next to the database**: Vercel › Settings › Functions › region = the database's region (e.g. both in Frankfurt or both in Bahrain/me-central). Every request makes several queries; across continents that is seconds | Vercel settings |
| Owner | **Supabase production**: phone, email, Google, Apple providers; Send SMS hook → `SUPABASE_SMS_HOOK_SECRET`; redirect URLs; SMTP from ZeptoMail; `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | CONNECT.md §3, AUTH.md §2, §6, §8 |
| Owner | Sign-in codes: WhatsApp (Zoho CPaaS) and/or SMS (Unifonic / Taqnyat, sender name registered with CST) | CONNECT.md §4, §5 |
| Owner | **MyFatoorah live**: live `MYFATOORAH_API_KEY`, live `MYFATOORAH_BASE_URL`, webhook `https://madatrips.sa/api/app/v1/payments/webhook` with `MYFATOORAH_WEBHOOK_SECRET`; test cards on staging first | CONNECT.md §6 |
| Owner | **Hotelbeds live** after their certification (a test booking and cancellation): `HOTELBEDS_ENV=live`, Hotels/Transfers/Activities keys, `SUPPLIER_MODE_*`, markups | CONNECT.md §8–10, HOTELBEDS.md |
| Owner | **eSIM Access production**: keys, webhook, account credit, margin | CONNECT.md §13, ESIM.md |
| Owner | **AeroDataBox**: `AERODATABOX_*` and its webhook | CONNECT.md §15 |
| Owner | **Anthropic**: `ANTHROPIC_API_KEY` with a monthly limit | CONNECT.md §19 |
| Owner | **Push**: `EXPO_ACCESS_TOKEN` (if enhanced push security is on), `EAS_PROJECT_ID`; `PUSH_MODE` defaults to live on production | CONNECT.md §16, `platform/src/lib/app/push.ts` |
| Owner | **App Links**: `ANDROID_CERT_SHA256` (§5) | `platform/src/lib/app/links/well-known.ts` |
| Owner | **Sentry**: platform DSN and the app's (`EXPO_PUBLIC_SENTRY_DSN`) | CONNECT.md §21 |
| Owner | Email (ZeptoMail domain verified, SPF/DKIM) | CONNECT.md §20 |
| Owner | **Legal pages**: counsel approves `/privacy`, `/terms`, `/delete-account` (EN + AR), then the DRAFT banner comes off | LAUNCH.md step 14 |
| Owner | **Desk staff accounts**: each agent gets their own Mada Ops login at `/adminwork` (no shared passwords); the 24/7 rota is staffed before 10% rollout | STAGING.md (bootstrap), Mada Ops users |
| Owner | Review sign-in for Play: `APP_REVIEW_LOGIN`, `APP_REVIEW_CODE` while Play reviews; remove after | store/REVIEW.md §1 |
| Code-done | Production refuses to start in mock mode, without required env, or with the mock desk on (the guard); `npm run app:preflight` lists what's missing | PRODUCTION.md “Launching, the guard” |
| Code-done | `/.well-known/assetlinks.json`, push with Android channels, account deletion, data export | platform |

**Do not** set `APP_ALLOW_MOCKS`, `APP_DESK_AUTOPILOT=on` or `APP_LEGACY_AUTH` on production.

---

## Owner checklist, in order

1. D-U-N-S number (start today; it gates Play *and* Apple).
2. Play Console organisation account, US$25, identity + organisation verification; invite the lead (§1).
3. Expo organisation + `EXPO_TOKEN` (LAUNCH.md steps 2–3) if not done.
4. Create the app in Play Console, add Arabic (§2).
5. Firebase project → `google-services.json` as EAS file variable `GOOGLE_SERVICES_JSON`; FCM V1 key into `eas credentials` (§3).
6. Google Cloud: Maps key → `GOOGLE_MAPS_ANDROID_API_KEY`; web client id → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (§4).
7. Production Supabase and the other EAS variables (§6).
8. Play service account JSON into `eas credentials` (§7).
9. Say “go”: preview APK for staff, then the first production AAB; upload that first AAB by hand to Internal testing (§9).
10. Fingerprints: `ANDROID_CERT_SHA256` in Vercel; SHA-1s on the Maps key and two Android OAuth clients (§5).
11. Store listing, graphics, App content, Data safety (§2, §8).
12. Backend go-live list (§11), tested on staging first.
13. Internal testers → (optional closed) → production at 10% → 50% → 100% (§10).
