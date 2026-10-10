# Mada Trips app: sign-in

**Status:** built (mock and live). **Builds on:** [FLOWS.md §1](FLOWS.md) for the onboarding flow, [INTEGRATIONS.md](INTEGRATIONS.md) for vendors.

> **Only identity lives in Supabase.** Supabase Auth proves who someone is: a phone number, an email address, an Apple ID or a Google account. Everything else (the household, passports, bookings, payments, chats) stays in our own Postgres, behind our own Core API session. Passport numbers never go near Supabase Auth.

---

## 1. How it works

```
 app                         Supabase Auth                    Core API (platform/)
 ───                         ─────────────                    ────────────────────
 phone code    ───────────▶  signInWithOtp(phone) ──hook──▶   POST /auth/sms-hook ─▶ Unifonic / Taqnyat ─▶ SMS
 email code    ───────────▶  signInWithOtp(email)  ─────────▶ (Supabase's SMTP: Amazon SES)
 Apple (iOS)   ── native ─▶  signInWithIdToken(apple, nonce)
 Google        ── native ─▶  signInWithIdToken(google)   (web: OAuth redirect to /auth-callback)
                             ◀── Supabase access token
 POST /auth/session { accessToken } ───────────────────────▶  verify against the project's JWKS (jose),
                                                               find or create the Mada account,
 ◀── { tokens, user, isNew }  (our own access + refresh) ────  issue our session. Every other route is unchanged.
```

**Finding the account** (`platform/src/lib/app/supabase-session.ts`):
1. the account already linked to this Supabase user id; else
2. an account with the same **verified phone**, then the same **verified email**: linked now (audited as `account.identity_linked`); else
3. a new account.

Then what Supabase proved is copied across: `supabase_user_id`, the phone (`phone_verified`), the email (`email_verified`, only when the account had none or it's the same address), and the ways in (`auth_providers`: phone, email, apple, google). Migration `0018_supabase_auth` added these columns and marked numbers already on accounts as verified.

**Verify your phone.** Saudi travel needs a number that reaches the traveller. Accounts that start with Apple, Google or email see *Verify your phone* right after sign-in (they may choose *Later*), a *Verify your phone* row in Profile, and `POST /orders` answers `403 PHONE_REQUIRED` until a number is verified (the pay screen then opens the same step). The number is added to the Supabase user (`updateUser({ phone })`, a code to the new number, `verifyOtp(type: 'phone_change')`), then `POST /auth/session/sync` copies it onto the account.

**Sign-in methods** (Profile): phone accounts add email (a code), Google or Apple (`linkIdentity` with the native ID token) the same way; each change ends with `/auth/session/sync`. Apple and Google can be removed (`unlinkIdentity`) while another way in remains. The phone stays: it can be changed, not removed. A phone or Supabase user that belongs to another Mada account is refused (`409 PHONE_TAKEN` / `IDENTITY_TAKEN`); at sign-in such a conflict is skipped instead, so nobody is locked out.

**Endpoints**

| Route | What it does |
|---|---|
| `POST /api/app/v1/auth/session` | `{ accessToken, givenName?, device? }` → `{ tokens, user, isNew }` |
| `POST /api/app/v1/auth/session/sync` | Bearer + `{ accessToken }` → `{ user }` |
| `POST /api/app/v1/auth/sms-hook` | Supabase's *Send SMS* hook. Standard Webhooks signature with `SUPABASE_SMS_HOOK_SECRET`, 5-minute window. A phone change goes to the new number; Arabic when `user_metadata.locale` is `ar`. |
| `/auth/refresh`, `/auth/logout`, everything else | Unchanged. |
| `/auth/otp/*`, `/auth/apple`, `/auth/google` | The pre-Supabase routes. Kept for tests and tools; **off on a production deployment** (404) unless `APP_LEGACY_AUTH=yes`. |

---

## 2. Supabase project setup

Use the Supabase project Mada already pays for (or a dedicated one). In the dashboard:

1. **Authentication › Sign In / Providers**
   - **Phone**: on. SMS provider: leave unset (the hook sends). *SMS OTP expiry* **600** seconds and *OTP length* **6** (the SMS says "expires in 10 minutes").
   - **Email**: on. *Confirm email* **on**. *Secure email change* **off** (the app asks for one code, sent to the new address). *Email OTP expiry* **600**, *length* **6**. The app never offers passwords.
   - **Apple**: on. *Client IDs*: `sa.madatrips.app` (the iOS bundle id) and the Services ID from §3 (web). *Secret key (for OAuth)*: the client secret generated from the Apple key in §3. It expires after 6 months: put the renewal in the calendar.
   - **Google**: on. *Client IDs*: the **web**, **iOS** and **Android** client ids from §4, comma-separated, web first. *Client secret*: the web client's secret. *Skip nonce checks*: **on** (the native Google Sign-In SDK on iOS doesn't let us pass a nonce; Apple keeps its nonce check).
2. **Authentication › Settings**: *Allow manual linking* **on** (Profile › Sign-in methods uses `linkIdentity`). Leave anonymous sign-ins off.
3. **Authentication › Emails › Templates**: in *Magic link*, *Confirm signup* and *Change email address*, replace the link with the code, for example `{{ .Token }} is your Mada Trips code. It expires in 10 minutes. Never share it.` The app enters codes; it never opens links.
   **SMTP Settings**: use **Amazon SES** (sender `no-reply@madatrips.sa`). Supabase's built-in mailer allows only a few emails an hour.
4. **Authentication › Hooks › Send SMS hook**: type **HTTPS**, URL `https://<ops domain>/api/app/v1/auth/sms-hook` (for example `https://ops.madatrips.sa/api/app/v1/auth/sms-hook`). *Generate secret* and copy the whole `v1,whsec_…` value into the platform's `SUPABASE_SMS_HOOK_SECRET`.
5. **Authentication › URL Configuration**: *Site URL* `https://madatrips.sa`. *Redirect URLs*: `https://madatrips.sa/auth-callback`, `madatrips://auth-callback`, and for development `http://localhost:8081/auth-callback`.
6. **Authentication › Rate limits**: keep 60 seconds between codes to one number or address (the app's countdown matches). Raise *SMS sent per hour* to fit the launch.
7. **Project Settings › JWT Keys**: use **asymmetric signing keys** (ECC P-256, the default for new projects); the Core API reads `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. A project still on the legacy shared secret also needs `SUPABASE_JWT_SECRET` on the platform until it migrates.
8. **Project Settings › API**: copy the *Project URL* and the *publishable (anon) key* for the app (§6).

---

## 3. Apple

In the Apple Developer account (organisation, INTEGRATIONS.md 0.1):

1. **Identifiers › App ID** `sa.madatrips.app`: enable **Sign in with Apple** (the `expo-apple-authentication` config plugin adds the entitlement; `ios.usesAppleSignIn` is already true in app.json).
2. **Identifiers › Services ID** for the web, e.g. `sa.madatrips.web`: enable Sign in with Apple, *Domains* `madatrips.sa` and `<project>.supabase.co`, *Return URL* `https://<project>.supabase.co/auth/v1/callback`.
3. **Keys**: a key with Sign in with Apple, linked to the App ID. Keep the `.p8`, the Key ID and the Team ID; generate the OAuth client secret from them (Supabase's Apple guide has the generator) and paste it into Supabase (§2.1).
4. **Sign in with Apple for Email Communication**: register `madatrips.sa` and `no-reply@madatrips.sa` (with SPF/DKIM from SES), so email reaches people who chose *Hide My Email*.

Apple is offered on iOS only, with Apple's own black *Continue with Apple* button.

---

## 4. Google

In Google Cloud (a project owned by Mada):

1. **OAuth consent screen**: External, app name *Mada Trips*, support email, the `madatrips.sa` domain verified, scopes `openid`, `email`, `profile`. Publish it (no sensitive scopes, so no review beyond branding).
2. **Credentials › OAuth client ID**, three of them:
   - **Web application**: *Authorized JavaScript origins* `https://madatrips.sa`; *Authorized redirect URIs* `https://<project>.supabase.co/auth/v1/callback`. Its id is `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (the native SDK asks for ID tokens issued to it) and goes into Supabase with its secret.
   - **iOS**: bundle id `sa.madatrips.app`. Its id is `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`; `app.config.js` derives the reversed URL scheme for the Google Sign-In plugin from it.
   - **Android**: package `sa.madatrips.app` and the **SHA-1** of both the EAS upload key and Google Play's app-signing key.

Google Sign-In uses `@react-native-google-signin/google-signin`, so it needs a development build (not Expo Go). The web build signs in with Google by redirect.

---

## 5. SMS in Saudi Arabia

Supabase makes the code; our hook sends it through a Saudi aggregator with a CST-registered sender ID, which reaches Saudi numbers far more reliably than Twilio.

| Provider | Platform env | Notes |
|---|---|---|
| **Unifonic** (default) | `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID` | Register the sender "MadaTrips" with CST through Unifonic. |
| **Taqnyat** | `SMS_PROVIDER=taqnyat`, `TAQNYAT_BEARER_TOKEN`, `TAQNYAT_SENDER_NAME` | Same sender registration through Taqnyat. |

Both need `SUPPLIER_MODE_SMS=live` (a production deployment defaults to live). Ask the provider to file the message text as an OTP template if they require it: `{code} is your Mada Trips code. It expires in 10 minutes. Never share it.` (and the Arabic version). WhatsApp authentication messages can later be sent from the same hook.

---

## 6. Environment variables

**Platform (Vercel, Mada Ops)**

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPPLIER_MODE_SUPABASE` | `live` (the default on a production deployment) |
| `SUPABASE_SMS_HOOK_SECRET` | `v1,whsec_…` from §2.4 |
| `SUPABASE_JWT_SECRET` | Only for a project still on legacy HS256 keys |
| `SUPPLIER_MODE_SMS`, `SMS_PROVIDER`, `UNIFONIC_*` or `TAQNYAT_*` | §5 |
| `APP_LEGACY_AUTH` | Leave unset (old routes off in production); `yes` keeps them on |
| `APP_ALLOW_MOCKS` | Never on the real launch. `yes` lets a staging copy run the mock Supabase adapter |

**App (EAS secrets / `.env`)**

| Variable | Value |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | The publishable (anon) key |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | §4 web client id |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | §4 iOS client id |

The Supabase session is stored in the Keychain / Keystore (`expo-secure-store`, chunked); it is kept only so a signed-in traveller can add or change a way in later. Signing out ends both sessions on the phone.

---

## 7. Mock mode

No Supabase project is needed to develop, test or take screenshots.

- **App**: without `EXPO_PUBLIC_SUPABASE_URL` (or with `EXPO_PUBLIC_API_MODE=mock`) the app uses Supabase's stand-in, `apps/mobile/src/lib/auth/mock.ts`: codes are always **123456**, 60 seconds between codes, Apple and Google answer at once (a stand-in sheet shows Apple's *Hide my email* choice), and it issues unsigned `mocksb.` tokens.
- **Platform**: `SUPPLIER_MODE_SUPABASE=mock` (the default outside production) reads those tokens. `supplierMode` **refuses mock on a production deployment** unless `APP_ALLOW_MOCKS=yes`, like every other supplier, because anyone can mint a mock token. The SMS hook logs codes to the mock outbox instead of sending.
- **Tests**: `platform/test/app/supabase-auth.test.ts` (the live verifier against a local key set: valid, expired, wrong issuer, audience, key and role, legacy HS256; find-or-create; linking by phone and email; phone before booking; sync conflicts; the SMS hook's signatures and replays), `apps/mobile/test/unit/auth.test.ts`, and `apps/mobile/test/e2e-auth.mjs`, which walks every way in on the web export with screenshots.

---

## 8. Open items

- **Account deletion** clears the Supabase link on our side (`supabase_user_id`, providers). Deleting the Supabase user too needs the service-role key on the platform (`auth.admin.deleteUser`); add it with the deletion job.
- Supabase has no Saudi region. Only phone numbers and email addresses are stored there; confirm with counsel that this fits PDPL (INTEGRATIONS.md 0.10).

---

## 8. Going live on Mada's existing Supabase project

Mada already runs a Supabase project, so sign-in goes into that one: no new project, and the people who can see Mada's data stay the same. Do it in three passes; each ends with a check that proves it works before the next starts.

**Pass 1: email codes (the beta can start on this alone)**
1. *Authentication › Sign In / Providers › Email*: on, *Confirm email* on, *Secure email change* off, code length 6, expiry 600 s.
2. *Authentication › Emails › SMTP Settings*: **custom SMTP is required**. Supabase's built-in mailer only sends to the project's own team members and a handful an hour, so travellers would never get a code. Use the mailbox provider behind `madatrips.sa` (Google Workspace, Microsoft 365 or Zoho all give SMTP details) or Amazon SES. Sender `no-reply@madatrips.sa`, name *Mada Trips*.
3. DNS for `madatrips.sa`: SPF and DKIM for that sender, and a DMARC record (`p=none` to start). Without them codes land in junk.
4. *Emails › Templates* (Magic link, Confirm signup, Change email address): replace the link with the code, in English and Arabic:
   `{{ .Token }} is your Mada Trips code. It expires in 10 minutes. Never share it.`
   `رمزك في مادا: {{ .Token }}. صالح لعشر دقائق. لا تشاركه مع أحد.`
5. *URL Configuration*, *Rate limits*, *JWT Keys*: as §2.5 to §2.7.
6. Keys into the environment settings (never in chat or git): platform `SUPABASE_URL`, plus `SUPABASE_JWT_SECRET` only if the project is on legacy keys; app `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. For removing a deleted account from Supabase, `SUPABASE_SERVICE_ROLE_KEY` on the platform only.

*Check:* a code reaches a Gmail, an Outlook and a madatrips.sa inbox within a minute and not in junk; the code signs in on a test build; a wrong code shows the friendly error; a sixth try is slowed down; the Core API's `/auth/session` creates the account once, and signing in again finds the same one.

**Pass 2: phone codes**
1. Register the sender "MadaTrips" with CST through Unifonic or Taqnyat (§5); their OTP template in both languages.
2. *Providers › Phone*: on, no SMS provider. *Hooks › Send SMS*: HTTPS, `https://<ops domain>/api/app/v1/auth/sms-hook`, generate the secret, put it in the platform's `SUPABASE_SMS_HOOK_SECRET`.

*Check:* codes arrive on STC, Mobily and Zain numbers within 30 seconds, from "MadaTrips", in the phone's language; an email account verifies its phone in Profile; booking stays blocked until it does; the hook refuses a call without the right signature.

**Pass 3: Apple and Google** (needs the developer accounts, §3 and §4)

*Check:* each signs in on a real iPhone and Android build; Apple's *Hide my email* still gets receipts; adding and removing them in Profile › Sign-in methods works; a Google account with the same verified email as an existing account links to it instead of making a second one.

**Before inviting testers:** deleting a test account removes it from both our database and Supabase; logs show no codes or tokens; `APP_ALLOW_MOCKS` and `APP_LEGACY_AUTH` are unset on production.
