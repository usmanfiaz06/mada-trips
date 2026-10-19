# Mada Trips app: launch checklist (TestFlight and Play internal testing first)

**For:** the owner (Bader) and whoever holds Mada's accounts. **Then:** what the lead (or Claude) does after each step.
Everything that can be done without Mada's accounts is done: build profiles (`apps/mobile/eas.json`), store config (`app.json`, `app.config.js`, `locales/`), the fonts hook, `npm run mobile:doctor`, store listings and screenshots ([store/](store/)), the review sign-in, and the legal pages on madatrips.sa.

Never paste a key, password or certificate into chat, an issue or git. Each one goes straight into the place named below.

---

## Order of steps

| # | Owner does | Takes | Then the lead / Claude does |
|---|---|---|---|
| 1 | **D-U-N-S number** for Mada Travel and Tourism (free, dnb.com or through Apple's lookup). | days to 2 weeks | Nothing; start 2 and 4 meanwhile. |
| 2 | **Expo account and organisation**: create an Expo account with a Mada email, then an organisation (e.g. `madatrips`), invite the lead as *Developer*. | 10 min | Put the organisation name in `app.json` › `owner` (or `EXPO_OWNER`). |
| 3 | **EXPO_TOKEN**: expo.dev › organisation › Access tokens › create a *robot* token. Paste it in the **environment settings** of Claude Code (cloud environment › Secrets) as `EXPO_TOKEN`, and in GitHub › Settings › Secrets › Actions if CI will build. | 5 min | `cd apps/mobile && npx eas-cli init` → copy the project id into `app.json` › `extra.eas.projectId` (the config is dynamic, so eas prints it rather than writing it). Commit. `npm run mobile:doctor`. |
| 4 | **Apple Developer Program, as an organisation** ($99/yr) with the D-U-N-S; you as Account Holder; invite the lead as *Admin* (or App Manager + Developer). | 1–7 days | — |
| 5 | **App Store Connect app record**: My Apps › + › New App: iOS, name **Mada Trips**, primary language English (U.S.), bundle ID `sa.madatrips.app` (register it under Identifiers first with Sign in with Apple, Associated Domains, Push Notifications), SKU `madatrips-ios`. Add Arabic (Saudi Arabia) as a localisation. | 15 min | Put the numeric **Apple ID** of the app and the **Team ID** in `eas.json` › `submit.production.ios` (`ascAppId`, `appleTeamId`). |
| 6 | **App Store Connect API key** (Users and Access › Integrations › Keys, role *App Manager*): download the `.p8` once. | 5 min | `npx eas-cli credentials` › iOS › App Store Connect API key › upload it (stored by Expo, never in git). EAS then makes the distribution certificate, provisioning profile and **APNs push key** itself. |
| 7 | **Google Play Console, as an organisation** ($25 once). Organisation verification needs the CR and a D-U-N-S. Invite the lead with *Admin* or *Release manager*. | days | — |
| 8 | **Play Console app**: Create app › **Mada Trips**, default language English (United States), App, Free; accept the declarations. | 10 min | — |
| 9 | **Play service account** for uploads: Google Cloud › IAM › service account › JSON key; Play Console › Users and permissions › invite its email with *Release manager*. | 15 min | `npx eas-cli credentials` › Android › Google Service Account › upload the JSON (stored by Expo). Android push also needs a Firebase project: its `google-services.json` as the EAS file variable `GOOGLE_SERVICES_JSON`, and its FCM V1 service-account JSON in `eas credentials` › Android ([ANDROID.md](ANDROID.md) §3). |
| 10 | **Secrets for builds** (expo.dev › project › Environment variables, per environment *development / preview / production*, visibility *Secret* unless noted): see the table below. Thmanyah fonts: zip the five `.otf` files and add **THMANYAH_FONTS_ZIP** as a **file** variable. | 20 min | First builds: `npx eas-cli build --profile preview --platform all` (internal APK and ad-hoc iOS, registered devices via `eas device:create`), then `--profile production`. |
| 11 | **Platform (Vercel) variables** for the release: below. `APP_REVIEW_LOGIN` and `APP_REVIEW_CODE` for the review account ([store/REVIEW.md](store/REVIEW.md) §1). | 10 min | Prepare the review account (household, sample trip). Check `/support`, `/privacy`, `/terms`, `/delete-account` and `/ar/…` are live. |
| 12 | **TestFlight testers**: App Store Connect › TestFlight › Internal testing group *Mada team* (up to 100 people with App Store Connect access) — add staff. External group *Beta* (up to 10,000, needs a short beta review): add emails or a public link. | 10 min | `npx eas-cli submit --profile production --platform ios --latest` after each production build. Fill *Test Information* (what to test, feedback email `support@madatrips.sa`, the review sign-in). |
| 13 | **Play internal testing**: Testing › Internal testing › create track, tester list (Google accounts' emails, up to 100), copy the opt-in link to testers. Fill **App content**: privacy policy URL, app access (review sign-in), ads (none), content rating, target audience (18+), data safety ([store/PRIVACY-LABELS.md](store/PRIVACY-LABELS.md)), account deletion URL. | 45 min | `npx eas-cli submit --profile production --platform android --latest` (uploads to *internal* as a draft; the first upload of a new app must be done once by hand in the Console, then EAS works). Add the **SHA-1** of Play's app-signing key and of the EAS upload key to the Google OAuth Android client (AUTH.md §4). |
| 14 | **Store listings**: paste [store/LISTING.md](store/LISTING.md) (English and Arabic), upload screenshots from `npm run store:screenshots` (`docs/app/store/screenshots/<lang>/ios-6.9`, `play`, plus the feature graphic), age rating and App Privacy answers from [store/REVIEW.md](store/REVIEW.md) and [store/PRIVACY-LABELS.md](store/PRIVACY-LABELS.md). | 1 hour | Counsel reviews the DRAFT legal pages; when approved, remove the DRAFT banner (`tools/legal/content-*.mjs`, `node tools/legal/build.mjs`). |
| 15 | **Submit for review** (App Store) / promote internal → closed → production (Play; new personal accounts need a closed test with 12 testers for 14 days first, organisation accounts don't). | 1–3 days review | After approval: remove `APP_REVIEW_CODE`; `eas update --channel production` for JS-only fixes, a new build for anything native. |

---

## Which variable goes where

**EAS (expo.dev › project › Environment variables).** `EXPO_PUBLIC_*` values end up inside the app, so they must never be secrets in the security sense; set visibility *Plain text* or *Sensitive* for them, *Secret* for the rest.

| Variable | development | preview | production | What |
|---|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | staging or `https://madatrips.sa` | same | `https://madatrips.sa` (default in `eas.json`) | The Core API origin |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✓ | ✓ | ✓ | Sign-in (AUTH.md §6) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | ✓ | ✓ | ✓ | Google Sign-In (AUTH.md §4); the iOS one also sets the URL scheme in `app.config.js` |
| `EXPO_PUBLIC_SENTRY_DSN` | optional | ✓ | ✓ | Crash reports |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (secret) | — | ✓ | ✓ | Source maps upload (`app.config.js` adds the plugin only when set) |
| `THMANYAH_FONTS_ZIP` (**file**, secret) | ✓ | ✓ | ✓ | Arabic typeface, unpacked by `scripts/eas-fonts.mjs` |
| `EXPO_PUBLIC_DEMO_HINTS` | `yes` (in `eas.json`) | — | never | Demo code hints |
| `EXPO_PUBLIC_API_MODE` | — | — | never `mock` (doctor checks) | |

**Vercel (Mada Ops / madatrips.sa, Production).** Everything in AUTH.md §6 and INTEGRATIONS.md, plus for the stores:

| Variable | What |
|---|---|
| `APP_REVIEW_LOGIN`, `APP_REVIEW_CODE` | The review sign-in. Only while a review is open. |
| `SUPABASE_SERVICE_ROLE_KEY` | Needed by the review sign-in and account recovery |
| `EXPO_ACCESS_TOKEN` | Optional: Expo push with "enhanced security" on |

**Claude Code environment settings (Secrets).** `EXPO_TOKEN` (robot token) so the lead/Claude can run `eas build`, `eas submit`, `eas update` and `eas env:*`. Nothing else is needed there for the stores.

**GitHub Actions secrets** (if builds run in CI): `EXPO_TOKEN`.

---

## Versions and updates

- `app.json` › `version` is the marketing version (1.0.0). Build numbers (`buildNumber`, `versionCode`) live on EAS (`appVersionSource: remote`) and go up by one on every production build. To start from a number, `npx eas-cli build:version:set`.
- `runtimeVersion` follows `version`: an over-the-air update (`eas update --channel production`) only reaches builds with the same version. **Bump `version` whenever native code or config changes** (a new library, a permission, an icon).
- Channels: `development`, `preview`, `production`, one per build profile.
- The Help screen's version line comes from `VERSION` in `src/components/wallet/AccountScreen.tsx` (hard-coded `1.0 (build 1)` today). TODO: read it from `expo-application` so testers see the real build.

## Checks before every store build

```
npm run mobile:doctor        # expo-doctor + 57 store checks (permissions, strings, icons, channels, fonts, keys)
npm run store:listing        # listing lengths and copy rules; rewrites docs/app/store/LISTING.md
npm run typecheck && npm run lint && npm test
node tools/legal/build.mjs --check
```

Screenshots: `EXPO_PUBLIC_API_MODE=mock npx expo export --platform web --output-dir dist` in `apps/mobile`, then `npm run store:screenshots` (writes `docs/app/store/screenshots/`; the full-size folders are gitignored, the overviews are committed).
