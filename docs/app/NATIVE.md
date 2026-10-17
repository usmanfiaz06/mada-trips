# Lock-screen flights, boarding passes and Apple Wallet

**For:** the owner (Bader) and the lead. **Status:** built and tested without an Apple Developer account. Each piece
switches itself on the moment its credentials exist, and hides itself until then. Nothing here needs a code change
to go live: only the Apple steps and the variables below.

Never paste a key, password or certificate into chat, an issue or git. Each goes straight into Vercel, EAS or Keychain.

---

## What there is, and what works today

| Piece | Works now | Works after the Apple steps |
|---|---|---|
| **Boarding passes from the airline.** The traveller adds the PDF, screenshot or Wallet file (.pkpass) from the airline's check-in (Wallet › For this trip › Add a boarding pass); the desk can upload it on the order (Desk › order › Boarding passes). The server reads the IATA BCBP barcode (PDF417, Aztec or QR), matches each leg to the trip's flight and each name to a traveller, and keeps the barcode's own text. The pass shows the barcode drawn again at full width, the screen at full brightness, one pass per traveller, saved on the phone for the gate. | Yes, everywhere (server, app, desk). | — |
| **Before a pass exists.** "Check-in opens Mon 8 Mar at 09:40" and, once open, "Check in with Saudia" (the airline's page). Never a barcode we made. | Yes. | — |
| **Apple Wallet passes.** "Add to Apple Wallet" on each boarding pass and for the hotel. Signed `.pkpass`; the gate, times and seat update on the pass when they change. | Hidden (no certificate). | Yes, with the Pass Type ID certificate. |
| **Lock-screen flight (iPhone).** A Live Activity on the lock screen and in the Dynamic Island: flight, route, gate, seat, boarding and departure time, status (on time, delayed N min, boarding, gate changed, in the air, landed, cancelled) and "Leave for the airport at 07:05". Starts by itself when Mada is opened in the 4 hours before take-off, or from Today › Follow on lock screen; ends 30 minutes after landing. | Needs a development or store build (not Expo Go, not the web). | Updates while Mada is open as soon as there's a build; updates with Mada closed once the APNs key is set. |
| **Home-screen widget (iPhone).** Small and medium: the next trip, its flight, gate and seat. | Needs a build. | Yes. |
| **Android.** An ongoing notification with the same lines, pinned until landing. Updates while Mada is open; the usual pushes (gate change, delay, cancellation) still arrive when it's closed. | Needs a build. | — |

Code: `packages/shared/src/schemas/bcbp.ts` (the BCBP reader), `schemas/boarding.ts` (what the lock screen shows,
check-in times), `platform/src/lib/app/boarding` (reading files), `lib/app/wallet-pass` (signing, the PassKit web
service), `lib/app/live` and `lib/app/apns.ts` (pushes), `apps/mobile/modules/mada-live` (the iOS bridge),
`apps/mobile/targets/live` (the widget extension in Swift), `apps/mobile/plugins/with-mada-live.js` (the config plugin).

---

## 1. Apple Developer: what to create

Needs the Apple Developer Program membership (LAUNCH.md step 4). All of this is under
developer.apple.com › Certificates, Identifiers & Profiles. The **Team ID** is at the top right of Membership details.

1. **App Group.** Identifiers › + › App Groups › `group.sa.madatrips.app` (description "Mada Trips"). The app and its
   widget share it, so the widget can read the next trip.
2. **App ID for the app** `sa.madatrips.app` (LAUNCH.md step 5 makes it; edit it if it already exists). Capabilities:
   - **App Groups** › Configure › tick `group.sa.madatrips.app`
   - **Push Notifications** (Live Activity pushes and ordinary pushes)
   - **Time Sensitive Notifications**, **Sign in with Apple**, **Associated Domains** (already listed in LAUNCH.md)
   - Live Activities need no capability: the app says so in its Info.plist (the plugin adds it).
3. **App ID for the widget extension** `sa.madatrips.app.live`, type App, description "Mada Trips widget".
   Capability: **App Groups** › tick `group.sa.madatrips.app`. Nothing else.
4. **APNs key** (for Live Activity pushes from our server). Keys › + › name "Mada APNs" › tick **Apple Push
   Notifications service (APNs)** › Configure › Environment *Sandbox & Production*, Key Restriction *Team Scoped (All
   Topics)* › Register › **Download** the `AuthKey_XXXXXXXXXX.p8` (only once) and note the **Key ID**.
   Use this same key for Expo push too: in `npx eas-cli credentials` › iOS › Push Notifications, choose "use an
   existing key" and upload it, instead of letting EAS make a second one (Apple allows two per team).
5. **Pass Type ID** (for Apple Wallet). Identifiers › + › Pass Type IDs › description "Mada Trips", identifier
   `pass.sa.madatrips.trip` › Register. Then open it › **Create Certificate**:
   - On a Mac: Keychain Access › Certificate Assistant › *Request a Certificate From a Certificate Authority*, your
     email, *Saved to disk* → upload the `.certSigningRequest` → download `pass.cer`.
   - Double-click `pass.cer` (it lands in Keychain with its private key) › right-click "Pass Type ID:
     pass.sa.madatrips.trip" › **Export** as `pass.p12` with a password.
   - Download Apple's **WWDR intermediate, G4** from apple.com/certificateauthority (`AppleWWDRCAG4.cer`).
   - The certificate lasts a year: renew it in the same place and replace the variables before it lapses (passes
     already added keep working; updates stop until it's replaced).

Turning a file into a variable value (on a Mac; nothing is printed to the screen):
`base64 -i pass.p12 | tr -d '\n' | pbcopy`, then paste into Vercel. The same for `AuthKey_….p8` and
`AppleWWDRCAG4.cer`. Delete the copies on disk afterwards; keep the originals in the company password manager.

---

## 2. Vercel (the Core API), Production and Preview

| Variable | Value | Turns on |
|---|---|---|
| `APPLE_TEAM_ID` | the 10-character Team ID | Wallet and APNs |
| `APPLE_PASS_TYPE_ID` | `pass.sa.madatrips.trip` | Wallet |
| `APPLE_PASS_CERT_P12` | base64 of `pass.p12` | Wallet |
| `APPLE_PASS_CERT_PASSWORD` | the export password | Wallet |
| `APPLE_WWDR_CERT` | base64 of `AppleWWDRCAG4.cer` | Wallet |
| `APNS_KEY_P8` | base64 of `AuthKey_….p8` | Live Activity pushes |
| `APNS_KEY_ID` | the Key ID | Live Activity pushes |
| `APNS_BUNDLE_ID` | `sa.madatrips.app` (the default; set only if the bundle id changes) | — |
| `APNS_ENV` | `production` on Production; leave unset on Preview (sandbox, for development builds) | — |
| `APP_PUBLIC_URL` | `https://madatrips.sa` (already set): must be https, Wallet only talks to https | Wallet updates |
| `APPLE_WALLET=off` / `LIVE_ACTIVITY_PUSH=off` | only to switch either off without removing the keys | — |

Instead of the `.p12`, `APPLE_PASS_CERT_PEM` and `APPLE_PASS_KEY_PEM` (base64 of the certificate and its private key
as PEM) also work. `GET /api/app/v1/config` › `features.appleWallet` and `features.liveActivityPush` say whether the
server read them correctly (true/false, never the values).

Already in place, nothing to do: the `live` job (`/api/cron/live`, every 5 minutes, in `platform/vercel.json`), the
database tables (migration `0029_native_passes_live.sql`, run by the deploy), and the PassKit web service at
`/api/app/v1/wallet/passkit/v1/…`.

**Development builds and sandbox.** A development build gets Live Activity tokens from Apple's *sandbox*; a TestFlight
or App Store build gets *production* tokens. Point a development build at a deployment with `APNS_ENV` unset (sandbox),
and keep Production on `production`. A wrong environment shows as `400 BadDeviceToken` in `app_live_activities.last_error`.

---

## 3. EAS (the app)

| Where | Variable | Value |
|---|---|---|
| expo.dev › project › Environment variables (all three environments), *Plain text* | `APPLE_TEAM_ID` | the Team ID (signs the widget extension with the app) |
| optional | `MADA_LIVE_ACTIVITY=off` | a build without the widget extension and Live Activities |

The extension is declared to EAS automatically (`@bacons/apple-targets` adds it to
`extra.eas.build.experimental.ios.appExtensions`), so `eas credentials` and `eas build` make a provisioning profile
for `sa.madatrips.app.live` alongside the app's. If EAS asks whether to let it manage the App Group, say yes.

## 4. Test it on an iPhone (development build)

1. Register the phone: `cd apps/mobile && npx eas-cli device:create` and open the link on the iPhone.
2. Build: `npx eas-cli build --profile development --platform ios`. Install from the QR code EAS shows (Settings ›
   General › VPN & Device Management › trust the developer the first time; iOS 16+ also needs Settings › Privacy &
   Security › Developer Mode on).
3. Run the bundler: `npx expo start --dev-client` and open the app (same Wi-Fi, or `--tunnel`).
4. **Lock screen:** sign in with a trip whose flight is within 24 hours (on a staging deployment with mock flight
   status, the demo trip and the travel-day demo phase work). Today › **Follow on lock screen** → lock the phone: the
   flight is on the lock screen; long-press the Dynamic Island for the expanded view. With the APNs key set, change the
   gate (a flight alert, or `npm run app:jobs -- flights` with a live status supplier) and watch it update with the app
   closed; `npm run app:jobs -- live` pushes boarding/in-the-air/landed when their time comes.
5. **Widget:** long-press the home screen › + › Mada › Next trip (small or medium).
6. **Boarding pass:** Wallet › For this trip › Add a boarding pass › pick the airline's PDF (or
   `apps/mobile/test/fixtures/demo-boarding-passes.pdf` for the demo trip). With the Wallet variables set,
   **Add to Apple Wallet** opens Safari, which offers the pass.
7. Settings › Mada › Live Activities off → Today says so and offers Settings.

## 5. What it can't do yet (and the next step)

- **Starting with Mada closed.** iOS only lets an app start a Live Activity while it's open, so "starts by itself 4
  hours before" happens the first time Mada is opened in that window (most travellers open it on travel day). iOS
  17.2's *push-to-start* tokens would let the server start it too: a small addition to `modules/mada-live` and
  `lib/app/live` once there's a build to test on.
- **Android with Mada closed.** The ongoing notification updates while Mada runs; closed, the regular pushes carry
  the change. Server-driven updates would need an FCM data message handled in the background.
- **Barcodes drawn as shapes in a PDF.** Most check-in PDFs embed the barcode as a picture, which is read. When an
  airline draws it as vector shapes there's no picture to read, and the traveller is asked for a screenshot instead.
  HEIC photos aren't read (iPhone screenshots are PNG, which is what people send).
- **Opening a pass from Mail or the airline's app straight into Mada** ("Open in Mada") needs document types in the
  Info.plist; for now the traveller picks the file in Mada.
- **Check-in opening hours** per airline are in `CHECK_IN` (`packages/shared/src/schemas/boarding.ts`); flynas,
  flyadeal and Qatar Airways are marked ASSUMED (48 hours) and the links are the airlines' home pages. The desk should
  confirm them.
- **Google Wallet** isn't built. It needs a Google Pay & Wallet Console issuer account, a service account and a
  "Boarding pass" class; passes are a signed JWT link (`https://pay.google.com/gp/v/save/<jwt>`), with updates by the
  REST API. About a day of work on top of what's here (the BCBP text and the pass fields are the same).

## Fixtures

`apps/mobile/test/fixtures/demo-boarding-passes.pdf` (four real PDF417 passes for the demo family, SV263 RUH→IST on
9 March 2027) and `apps/mobile/src/lib/mock/boarding-fixtures.ts` (what the mock build returns after reading it) were
made with `buildBcbp` (`packages/shared/src/schemas/bcbp-build.ts`, tests and demos only) and zxing-wasm's writer,
the same drawing the server uses. The platform test `native.test.ts` reads the PDF back through the real pipeline.
