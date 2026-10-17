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
| 11 | TBO | flights (and a second hotel source) | To build | Owner + code |
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

### 11. TBO — to build
TBO (TBO Holidays / TBO Air) can give real flight search, fares and ticketing, which today goes to the desk.
1. Send: which TBO products your contract covers (Air API? Hotel API?), the API documentation they gave you, and
   sandbox credentials (into Vercel as `TBO_*`, never in chat).
2. Code: a `flights` live adapter on TBO (search, fare rules, price check, hold/book, ticket, cancel), child/infant
   fares, seat/meal SSRs, then `APP_FLIGHTS_MODE=live`. If their hotel API is in the contract, it can be a second hotel
   source ranked alongside Hotelbeds.
3. TBO certification on their sandbox, then live keys. Payment to TBO is by your agency deposit/credit line.

### 12. Flights today
Nothing to do: flights go to the desk as requests until TBO (or another GDS) is connected.

### 13. eSIM — Airalo (built, needs keys)
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
