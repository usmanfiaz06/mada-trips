# App Privacy (App Store) and Data safety (Google Play)

**Status:** answers for the 1.0 beta, mapped from what the code does on 11 October 2026. Re-check this page whenever a feature starts collecting something new (location, analytics, voice). The public policy is [madatrips.sa/privacy](https://madatrips.sa/privacy) (source: `tools/legal/content-en.mjs`); keep the two in step.

## What the app actually collects (and where in the code)

| Data | Collected? | Where | Notes |
|---|---|---|---|
| Name | Yes | onboarding name, household (`people`) | Linked to the account |
| Phone number | Yes | Supabase Auth + `app_users.phone` | Sign-in, contact |
| Email address | Yes | Supabase Auth + `app_users.email` | Sign-in, receipts, data export link |
| Passport / ID details | Yes | Wallet, passport scan (`passport/*`) | Number encrypted (AES-256-GCM, `lib/app/crypto.ts`); MRZ read on the phone |
| Dates of birth, nationality | Yes | household and passports | |
| Document photos / PDFs | Yes, when the traveller adds them | `lib/pick.ts`, Wallet | |
| Profile photo | Yes, optional | `PhotoSheet` | |
| Messages | Yes | support chat, Circles posts and chats | |
| Purchase history | Yes | orders, payments, invoices, refunds | |
| Payment card | Brand and last 4 only | MyFatoorah embedded session (`lib/booking.ts`) | The full number goes straight to the provider |
| Contacts | **Hashed on the phone, matched, not stored** | `people/index.tsx` → `POST /friends/contacts` | Only with permission; only hashes leave |
| Precise or coarse location | **No** | no location library in the app; Android location permissions blocked | Who's around uses trip cities, not GPS |
| Device ID / advertising ID | **No** | | No IDFA, no AppTrackingTransparency |
| Push token, device model, app version | Yes | `registerForPush`, `deviceInfo()` | For notifications and signed-in devices |
| Crash data | Yes, when `EXPO_PUBLIC_SENTRY_DSN` is set | `lib/net/report.ts` | `sendDefaultPii: false`; names, numbers, tokens scrubbed on the phone |
| Performance data | Yes, with Sentry (10% of sessions) | same | |
| Product analytics | **Not in 1.0** | consent toggle exists (`/consents`), no SDK wired | Update both forms before PostHog ships |
| Hashed IP | Yes | `ipHash` in audit and sessions | Security only |

## App Store Connect › App Privacy

**Do you or your third-party partners collect data from this app?** Yes.
**Tracking:** No data is used to track (no data linked with third-party data for advertising, no data brokers). Do not add the AppTrackingTransparency prompt.

For every type below: **Linked to the user: Yes** (except Diagnostics), **Used for tracking: No**.

| Category › Type | Collected | Purposes |
|---|---|---|
| Contact Info › Name | Yes | App Functionality |
| Contact Info › Email Address | Yes | App Functionality |
| Contact Info › Phone Number | Yes | App Functionality |
| Contact Info › Other User Contact Info | No | |
| Financial Info › Payment Info | Yes (via the payment provider's embedded form) | App Functionality |
| Purchases › Purchase History | Yes | App Functionality |
| User Content › Photos or Videos | Yes | App Functionality |
| User Content › Emails or Text Messages | Yes (chats with Mada, Circles) | App Functionality |
| User Content › Customer Support | Yes | App Functionality |
| User Content › Other User Content | Yes (Circles posts, saved places) | App Functionality |
| Identifiers › User ID | Yes | App Functionality |
| Identifiers › Device ID | No | |
| Sensitive Info | No (passports are declared under Other Data) | |
| Contacts | **No**: processed on the phone and in real time only, nothing retained (Apple's definition of "collect" excludes this). Keep it this way or change the answer. | |
| Location | No | |
| Usage Data › Product Interaction | No (until analytics ships) | |
| Diagnostics › Crash Data | Yes · **Not linked** | App Functionality |
| Diagnostics › Performance Data | Yes · **Not linked** | App Functionality |
| Other Data › Other Data Types | Yes: passport and ID details, dates of birth, nationality | App Functionality |

## Google Play Console › App content › Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Is all of the user data collected by your app encrypted in transit?** Yes.
- **Do you provide a way for users to request that their data is deleted?** Yes: in the app (Profile › Privacy) and at `https://madatrips.sa/delete-account`.
- **Account creation:** the app lets users create an account (phone, email, Apple, Google). **Delete account URL:** `https://madatrips.sa/delete-account`.
- **Shared** (Play's sense: transferred to a third party that isn't a service provider): **Personal info › Name**, **Other info (passport details)** and **Phone/Email** are shared with airlines, hotels and embassies **to fulfil the booking the user asked for**. Play exempts transfers the user initiates and expects; mark these "Collected", and "Shared: No" is acceptable only if counsel agrees the user-initiated exemption applies. Default answer: **Shared: Yes, App functionality**.

| Data type | Collected | Shared | Ephemeral | Required / optional | Purposes |
|---|---|---|---|---|---|
| Personal info › Name | Yes | Yes (bookings) | No | Required | App functionality, Account management |
| Personal info › Email address | Yes | No | No | Optional (phone or email) | Account management, App functionality |
| Personal info › Phone number | Yes | Yes (bookings) | No | Optional (phone or email) | Account management, App functionality |
| Personal info › Other info (passport and ID details, date of birth, nationality) | Yes | Yes (bookings) | No | Optional (needed to book) | App functionality |
| Financial info › Purchase history | Yes | No | No | Required to book | App functionality |
| Financial info › User payment info | Yes (provider) | No | No | Required to pay | App functionality |
| Messages › Other in-app messages | Yes | No | No | Optional | App functionality |
| Photos and videos › Photos | Yes | No | No | Optional | App functionality |
| Contacts › Contacts | Yes | No | **Yes** (hashed, matched, discarded) | Optional | App functionality |
| App activity › Other user-generated content | Yes (Circles) | No | No | Optional | App functionality |
| App info and performance › Crash logs | Yes | No | No | Required when enabled | Analytics (crash diagnosis) |
| App info and performance › Diagnostics | Yes | No | No | Required when enabled | Analytics |
| Device or other IDs | Yes (push token) | No | No | Optional | App functionality (notifications) |
| Location | No | | | | |
| Web browsing, Audio, Calendar, Health, Files and docs | No (documents are photos/PDFs: declared under Photos) | | | | |

## Before each release

- [ ] `grep -r "expo-location\|posthog\|@react-native-voice" apps/mobile/src` still finds nothing, or the forms above were updated.
- [ ] `npm run mobile:doctor` (location and microphone permissions stay blocked).
- [ ] The privacy page lists every processor in `platform/src/lib/app/suppliers/live/`.
