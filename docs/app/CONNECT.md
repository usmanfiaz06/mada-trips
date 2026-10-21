# Connecting the real services (owner checklist, 17 Oct 2026)

Each service is built behind a switch: until its keys are in Vercel (Production for the real app, Preview/Staging for
staging) it runs on a stand-in or says plainly that it is not available. Keys go **only** into Vercel or EAS
environment variables, never into chat, email or the repo. After adding keys, tell the coordinator and the service is
tested on staging before production.

Legend: **Ready** = code done, needs your keys · **Partly** = code done for part of it · **To build** = needs code too.

| # | Service | What it does in the app | Status | Who acts first |
|---|---|---|---|---|
| 1 | Apple Developer + App Store Connect | iPhone app, Sign in with Apple, push, Live Activity, Apple Wallet | Ready (in process) | Owner |
| 2 | Google Play Console | Android app | Ready | Owner |
| 3 | Supabase (auth) | phone/email/Google/Apple sign-in | Ready | Owner |
| 4 | WhatsApp codes (Meta + Zoho CPaaS) | sign-in codes on WhatsApp | Ready | Owner |
| 5 | SMS (Unifonic or Taqnyat) | sign-in codes by SMS, fallback | Ready | Owner |
| 6 | MyFatoorah | card, mada, Apple Pay payments, refunds | Ready | Owner |
| 7 | Tabby / Tamara | pay later | To build | Owner + code |
| 8 | Hotelbeds Hotels | hotel search, prices, booking, vouchers | Ready (test keys work) | Owner (live keys) |
| 9 | Hotelbeds Transfers | airport and pre-booked cars | Ready | Owner (live keys) |
| 10 | Hotelbeds Activities / Viator / GetYourGuide | things to do | Ready | Owner |
| 11 | TBO | flights (and a second hotel source) | Built (flights); needs working keys + IP whitelist | Owner |
| 12 | Flights today | desk books by request (`APP_FLIGHTS_MODE=request`) | Ready | — |
| 13 | eSIM (Airalo) | data on landing | Built, needs Airalo keys | Owner |
| 14 | Car right now (on demand) | instant car | No open supplier | Decision |
| 15 | AeroDataBox | flight status, gates, delays | Ready | Owner |
| 16 | APNs + Expo push | notifications, Live Activity updates | Ready | Owner (after #1) |
| 17 | Apple Wallet passes | boarding pass / hotel pass in Wallet | Ready | Owner (after #1) |
| 18 | Google Maps (Android) | maps on Android | Ready | Owner |
| 19 | Claude (Anthropic) | Ask understanding, reply drafts | Ready | Owner |
| 20 | Email (ZeptoMail) | receipts, sign-in links | Partly | Owner |
| 21 | Sentry | crash reports | Ready | Owner |
| 22 | Ticketmaster | events | Ready | Owner |
| 23 | Free/open (FX, weather, places, ADS-B) | rates, weather, places, aircraft position | Working | — (OpenSky needs a licence for commercial use) |
| 24 | Google Routes API | daily drives in plans: km, hours, border crossings | Ready (mock until key) | Owner |
| 25 | CarTrawler (car hire) | self-drive cars: search, deposit, insurance, book, cancel | Ready (mock until key) | Owner |

## Processes

### 1. Apple Developer + App Store Connect (in process)
1. Finish enrolment as an organisation (D-U-N-S number) and add the developer as Admin.
2. Follow `docs/app/NATIVE.md`: App ID `com.mada.trips` (or the final one) with Push, Sign in with Apple, App Groups;
   a Push key (.p8); a Pass Type ID with its certificate.
3. Put into Vercel: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`, `APNS_BUNDLE_ID`, `APNS_ENV`, the Wallet certificate
   variables listed in NATIVE.md, and `APPLE_CLIENT_IDS`.
4. App Store Connect: create the app, add the review sign-in (`APP_REVIEW_LOGIN`/`APP_REVIEW_CODE`), privacy answers.
5. Coordinator then runs an EAS development build so you can test on your iPhone, then TestFlight.

### 2. Google Play Console
1. Create the developer account (organisation, D-U-N-S), pay the fee, verify identity.
2. Create the app, set up internal testing, invite testers by email.
3. Coordinator uploads the first EAS Android build to internal testing.

### 3. Supabase
1. In the Supabase project: enable Phone provider, Email, Google and Apple providers.
2. Auth → Hooks → Send SMS hook to `https://<api domain>/api/app/v1/auth/sms-hook`; copy its secret into Vercel as
   `SUPABASE_SMS_HOOK_SECRET`.
3. Auth → URL configuration: add the app and staging URLs as redirect URLs.
4. SMTP: ZeptoMail's SMTP details (see #20).
5. Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; EAS/app: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### 4. WhatsApp sign-in codes (Meta + Zoho CPaaS)
1. Meta Business verification for the company.
2. A dedicated phone number not used on any WhatsApp app.
3. In Zoho CPaaS: connect the number, create authentication templates `mada_code_en` and `mada_code_ar`, get them approved.
4. Vercel: `ZOHO_CPAAS_API_KEY`, `ZOHO_CPAAS_WHATSAPP_SENDER`, `ZOHO_CPAAS_TEMPLATE_EN`, `ZOHO_CPAAS_TEMPLATE_AR`,
   `SUPPLIER_MODE_WHATSAPP=live`, `PHONE_CODE_CHANNEL=whatsapp_then_sms`.

### 5. SMS (Unifonic or Taqnyat)
1. Open an account; register the sender name "MadaTrips" with CST (takes days, start early).
2. Vercel: Unifonic `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID`; or Taqnyat `SMS_PROVIDER=taqnyat`,
   `TAQNYAT_BEARER_TOKEN`, `TAQNYAT_SENDER_NAME`.

### 6. MyFatoorah
1. Open a Saudi merchant account (CR, IBAN, ID), enable mada, Visa/Mastercard and Apple Pay.
2. Apple Pay: verify the domain in the MyFatoorah portal (needs #1 for the app).
3. Webhook URL `https://<api domain>/api/app/v1/payments/webhook`; copy its secret.
4. Vercel: `MYFATOORAH_API_KEY`, `MYFATOORAH_BASE_URL` (test first), `MYFATOORAH_WEBHOOK_SECRET`.
5. Coordinator runs test cards end to end on staging, then you switch to the live key.

### 7. Tabby / Tamara (pay later) — to build
1. Apply as a merchant with each (CR, website, expected volume); they review travel merchants case by case.
2. Send sandbox keys via Vercel. Code: checkout session, webhook, refunds, and the instalment line on Money/Payments.

### 8–10. Hotelbeds (Hotels, Transfers, Activities)
1. Ask your Hotelbeds account manager for **live** keys for each API you signed (Hotels, Transfers, Activities) and
   for certification: Hotelbeds certifies the integration before go-live (they test a booking and a cancellation).
2. Vercel Production: `HOTELBEDS_ENV=live`, `HOTELBEDS_HOTEL_API_KEY/SECRET`, `HOTELBEDS_TRANSFERS_API_KEY/SECRET`,
   `HOTELBEDS_ACTIVITIES_API_KEY/SECRET`, `SUPPLIER_MODE_HOTELS=hotelbeds`, `SUPPLIER_MODE_TRANSFERS=hotelbeds`,
   markups `APP_STAY_MARKUP_BPS`, `APP_TRANSFER_MARKUP_BPS`, `APP_ACTIVITY_MARKUP_BPS`.
3. Hotelbeds payment model: confirm with them whether you pay them by credit line/deposit (usual) — the app charges the
   traveller via MyFatoorah and books on your Hotelbeds account.
4. Viator / GetYourGuide (optional extra activities): partner sign-up → `VIATOR_API_KEY`, `GYG_PARTNER_TOKEN`.

### 11. TBO — built, needs working keys
TBO Air (search, fare rules, price check, hold, ticket, booking details, cancel; child and infant fares; the desk's
TBO card with "Confirm and hold with TBO" and "Ticket now") is built and tested against a fake TBO. Everything the
owner must get from TBO (API access for the API user, ClientId, **IP whitelisting: Vercel has no fixed outbound IP**),
the settings, TBO's certification and how to switch staging to live search: **[TBO.md](TBO.md)**.
If their hotel API is in the contract, it can be a second hotel source ranked alongside Hotelbeds.

### 12. Flights today
Nothing to do: flights go to the desk as requests until TBO (or another GDS) is connected.

### 13. eSIM — eSIM Access (built, needs keys); Airalo optional
The owner registered with eSIM Access: keys, webhook, credit, margins and the support playbook are in **docs/app/ESIM.md**.
Airalo stays as a second supplier (`SUPPLIER_MODE_ESIM=airalo`), set up as below.

Built: plans for the trip's country and days in 2–3 sizes, one eSIM per traveller, the phone check, paid on the order
sheet, bought from Airalo once the card is captured (never twice), iPhone one-tap install, Android QR and codes, what's
left and top-ups on the trip, "Not connecting?", the desk's eSIM page, an automatic refund when Airalo can't give one.
Runs on mock fixtures until the keys are in.
1. Sign the Airalo Partner agreement; in the Partner Platform create API credentials (sandbox first). Add Vercel's
   outbound IPs to the allowlist if you turn it on.
2. Vercel (staging first): `AIRALO_CLIENT_ID`, `AIRALO_CLIENT_SECRET`, `AIRALO_ENV=sandbox`, `SUPPLIER_MODE_ESIM=live`,
   `APP_ESIM_MARKUP_BPS` (e.g. 3000 for 30% over Airalo's net price). Sandbox orders cost nothing and can't be installed.
3. Opt in to low-data notices (Partner Platform or `POST /v2/notifications/opt-in`) with
   `<APP_PUBLIC_URL>/api/app/v1/esim/airalo/webhook`.
4. For launch: switch the Airalo account to production (one way), top up the Airalo balance, set `AIRALO_ENV=live` on
   production only.
5. Ask your accountant how VAT applies to reselling data.

### 14. Car right now — decision
Careem and Uber have no open booking API for agencies. Options: (a) keep "Mada calls you back" for instant cars
(built), (b) use Hotelbeds Transfers whenever the pickup is far enough ahead (built for airports; can extend to any
ride), (c) a local fleet/limo partner in Riyadh/Jeddah with an API or WhatsApp dispatch. Recommendation: (b) now,
(c) when volume justifies.

### 15. AeroDataBox (flight status)
Subscribe on API.Market or RapidAPI (the plan sized to tracked flights), then Vercel: `AERODATABOX_API_KEY`,
`AERODATABOX_MARKET`, `AERODATABOX_PLAN`, `AERODATABOX_WEBHOOK_SECRET`, `AERODATABOX_WEBHOOK_BASE_URL`.

### 16. Push (APNs + Expo)
After #1: `EXPO_ACCESS_TOKEN`, `EAS_PROJECT_ID`, APNs variables from #1; Android push via Firebase project →
upload its key to EAS.

### 17. Apple Wallet
After #1: Pass Type ID certificate → `APPLE_PASS_TYPE_ID`, `APPLE_PASS_CERT_P12`, `APPLE_PASS_CERT_PASSWORD` (details in NATIVE.md). It switches on by itself once these are set.

### 18. Google Maps (Android)
Google Cloud project → enable Maps SDK for Android → restricted key → EAS: `GOOGLE_MAPS_ANDROID_API_KEY`.

### 19. Claude (Anthropic)
Anthropic Console → organisation API key with a monthly limit → Vercel: `ANTHROPIC_API_KEY`.

### 20. Email (ZeptoMail)
Verify the sending domain (SPF/DKIM) in ZeptoMail; SMTP details into Supabase (#3) for sign-in mail. Receipts
by email still need wiring (small).

### 21. Sentry
Create org/project → `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`.

### 22. Ticketmaster
Developer key → `TICKETMASTER_KEY`.

### 23. Free and open data
Working with no keys. Before commercial launch: an OpenSky licence (or rely on adsb.lol only), and keep the
attributions shown in the app.

## Added one by one (21 Oct 2026): live by adding keys

Each of these has its own switch, `SUPPLIER_MODE_<NAME>`: `live` (or the vendor's name), `mock` or `off`. Left unset,
it goes **live by itself as soon as all its keys are set**; without keys it runs on its fixtures outside production and
is **off** on production (mock there only with `APP_ALLOW_MOCKS=yes`). None of them can close the app at launch (they
are not in the launch guard's list). Each live adapter runs behind its own circuit breaker and shows in
`GET /api/app/v1/health` (`suppliers.<name>`: mock or live; `breakers.<name>` when it is failing). Code:
`platform/src/lib/app/config.ts` (`KEYED_SUPPLIERS`) and `platform/src/lib/app/suppliers/<name>/`.

### 24. Google Routes API — daily drives
**What it does.** For a plan with drives (Riyadh → AlUla, Dammam → Bahrain), each day's drive: kilometres, hours
without traffic, and whether it **crosses a border** (both countries known and different, or Google's own "crosses
country borders" warning). One call per origin/destination/day, kept 24 hours per server; if Google is down or not set
up, the plan shows an estimate (straight line × 1.3 at 85 km/h, +45 min at a border), marked as an estimate.
Interface: `driveLeg()` and `dailyDrives(stops)` in `suppliers/routes` (used by plans, `ASK-INTEGRATED.md`).

**Apply.** Google Cloud console (the same project as Maps for Android is fine) → enable **Routes API** → billing
account → Credentials → create an API key, restrict it to *Routes API* only (server key: no app restriction; Vercel
has no fixed IP so IP restriction can't be used). Set a daily quota cap (e.g. 2,000 requests/day) as a safety net.

**Keys in Vercel.** `GOOGLE_ROUTES_API_KEY` (optional `SUPPLIER_MODE_ROUTES=live|mock|off`).

**Certification.** None. Test: set the key on staging, open a plan with a drive; `GET /health` shows `routes: live`.

**Cost.** Pay per call. We ask for `TRAFFIC_UNAWARE` and only distance, duration, warnings and the line, which keeps
every call on the **Compute Routes Essentials** SKU (about USD 5 per 1,000 calls after the monthly free calls; check
the current price list). Asking for traffic or toll prices moves calls to the Pro SKU (about double): don't change
the field mask without checking cost.

**Licence notes.** Google Maps Platform terms: Routes content may be cached only briefly (we keep 24 h, in memory,
never in the database), and a route **line** may be drawn only **on a Google map** (Android's map is Google; on iPhone,
show the line only on a Google map or show text only — km and hours — which is fine anywhere). Keep "Google" credited
where the figures appear.

### 25. Car hire (self-drive) — CarTrawler
**What it does.** One interface, `carHire()` (`suppliers/car-hire`): search by pickup and drop-off place and time
(airport code or a point), driver's age and licence country → cars with class (economy, SUV, van…), seats and bags,
total and per-day price in SAR (net + `APP_CAR_MARKUP_BPS`, default 1000 = 10%), the **deposit** held on the driver's
card, the **insurance** included (CDW, theft, third party), the **excess** and an optional full cover, mileage, fuel
policy, whether the desk is in the terminal, whether driving into another country is allowed, free cancellation until.
Then quote (price again before payment), book (our order id as the idempotency key), status and cancel. CarTrawler
was chosen over Rentalcars Connect because its OTA API is open to new agencies and covers Yelo, Theeb, Budget, Hertz
and Sixt in Saudi Arabia; Rentalcars (Booking Holdings) only takes large affiliates. Another supplier can be added
behind the same interface.

**Apply.** cartrawler.com → Partners → "Become a partner" (travel agency / OTA). Ask for **OTA API (XML/JSON)
access** and test credentials. They review the business, then issue a **Client ID**. Ask them: the test and
production hosts, whether they whitelist IPs (Vercel has no fixed outbound IP — ask for client-ID-only access or use a
fixed-IP proxy), how payment works (see Cost) and their Arabic content.

**Keys in Vercel.** `CARTRAWLER_CLIENT_ID`, `CARTRAWLER_ENV` (`test` first, `live` after certification), optional
`CARTRAWLER_BASE_URL` (if they give a different host), `APP_CAR_MARKUP_BPS`; `SUPPLIER_MODE_CAR_HIRE=live|mock|off`.

**Certification.** CarTrawler certifies the integration on their test host: a search, a booking, a retrieve and a
cancellation, with screenshots of how price, deposit, insurance and the rental terms are shown. Then live access.

**Cost model.** No fee to integrate. Usually **"pay at desk" or "pay now"**: with pay now CarTrawler charges the card
and pays Mada a commission (typically 6–12% of the rental); with Mada as merchant of record we charge the traveller
(MyFatoorah) and settle net with CarTrawler. Confirm which they give us; the code supports our own markup either way.

**Licence/commercial notes.** Show the supplier's rental terms (deposit, excess, fuel, mileage, cross-border) before
payment — CarTrawler requires it. A driver usually needs a credit card in their own name for the deposit and, for
visitors, an International Driving Permit; the app says so on the card.
