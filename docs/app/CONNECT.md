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
| 7 | Tabby / Tamara | pay later | Built (backend, §29); pay sheet hook-up to do | Owner + code |
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
| 26 | Klook | things to do in Asia, ranked with Hotelbeds/GYG/Viator | Ready (search; desk books) | Owner |
| 27 | Sherpa | visa / entry rules for every passport, behind the entry check | Ready (built-in rules until key) | Owner |
| 28 | Cover Genius XCover | travel insurance: quote, buy, cancel | Ready in code; **needs Saudi licensing** | Owner + legal |
| 29 | Tabby and Tamara | pay later in 4 (backend) | Ready (mock until keys); app pay sheet to do | Owner + code |

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

### 7. Tabby / Tamara (pay later) — backend built, see §29
1. Apply as a merchant with each (CR, website, expected volume); they review travel merchants case by case.
2. Put the sandbox keys in Vercel (§29). Backend done: checkout session, webhooks, capture, refund, cancel, the
   instalment line. Still to do: the pay sheet in the app and the order flow (§29, "Hook-up").

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

### 26. Klook — activities (Asia)
**What it does.** A fourth source of bookable experiences next to Hotelbeds Activities, GetYourGuide and Viator, strongest
in Japan, Thailand, Singapore, Malaysia, Indonesia and Korea (also Dubai). All sources are **ranked together**: the
same product from two suppliers is shown once (the cheaper), then best first by a review-weighted rating (a 4.6 with
thousands of reviews beats a 5.0 with three). Prices in SAR with `APP_KLOOK_MARKUP_BPS` (default 1500 = 15%). As with
the others in the beta, "Book with Mada" makes a request and the desk books it (on Klook's agent portal).

**Apply.** Klook has two partner routes: the **Affiliate Partner Programme** (affiliate.klook.com: links and
commission; no booking API) and the **Klook Agent / Distribution API** (partner.klook.com → "Become an agent", for
travel agencies that resell). Apply for the **Agent API** as a Saudi travel agency (CR, tourism licence, website,
expected volume); ask for sandbox access, the API documentation, and whether booking by API is open to us or only
search + agent portal at first.

**Keys in Vercel.** `KLOOK_API_KEY`, `KLOOK_ENV` (`sandbox` / `live`), `APP_KLOOK_MARKUP_BPS`;
`SUPPLIER_MODE_KLOOK=live|mock|off` (`mock` shows the fixture activities on staging).

**Certification.** Klook reviews the integration on sandbox (search and content display; with booking, a test order
and a cancellation) before live keys.

**Cost model.** Agent API: **net rates** (Mada adds its margin) and a prepaid deposit or credit line with Klook.
Affiliate: commission (about 2–5%) and the traveller pays Klook — not used here, because the app keeps the traveller
in Mada.

**Licence notes.** Klook's content (photos, descriptions) may be shown only for selling Klook products and must keep
"Klook" credit on the image (the app does). Check whether the agreement allows showing Klook next to competitors'
products (ranking together); some agent agreements restrict price comparison.

### 27. Sherpa — visa and entry requirements
**What it does.** Becomes the source of each traveller's **visa line** in the entry check (`POST /search/entry`): for
every passport in the party, Sherpa says visa-free, visa on arrival, e-Visa/ETA, embassy visa or not allowed, with the
text, the length of stay and the passport validity it wants. Where Sherpa has an answer it replaces the visa line (or
the "we check by hand" line for passports the built-in rules don't know: today they only know Saudi and Philippine
passports for six countries). Passport validity, iqama, exit/re-entry and the UK ETA lines stay as the built-in rules
write them. If Sherpa is down, not configured or has nothing, **the built-in rules answer, as today**. Answers are kept
6 hours per nationality/country/month.

**Apply.** joinsherpa.com → "Partners / API" → talk to sales; ask for the **Requirements API v3** (trips) with a
sandbox key, Arabic content, and the "Visa & entry requirements" product (not only the widget). They sign a data
licence agreement.

**Keys in Vercel.** `SHERPA_API_KEY`, `SHERPA_ENV` (`sandbox` / `live`); `SUPPLIER_MODE_SHERPA=live|mock|off`
(`mock` uses illustrative fixtures on staging; `off` = built-in rules only).

**Certification.** None formal; Sherpa reviews how the requirements are shown (their attribution and the "check with
the embassy" disclaimer). Test on staging with a Saudi, an Indian and a British passport to Istanbul.

**Cost model.** Annual licence or per-request tiers (a few cents per trip lookup at low volume; ask for a startup
tier). Our cache keeps calls to about one per nationality/country/month per server.

**Licence notes.** Content is licensed for display to our own travellers, not for resale or bulk storage; keep the
"Powered by Sherpa°" credit where the rules show and the disclaimer that the embassy has the final word. Sherpa is
already built on Timatic-grade sources; see "IATA" below for why Timatic itself isn't used directly.

### 28. Travel insurance — Cover Genius XCover
**What it does.** `insurance()` (`suppliers/insurance`): **quote** for the trip (countries, dates, trip cost, each
traveller's age and residence) → options (medical and baggage, comprehensive with cancellation, cancellation only)
with the premium in SAR, the main limits, the excess, the policy wording link and whether it meets the Schengen visa
minimum (EUR 30,000 medical); **bind** (buy the chosen option, idempotent on our order id); **status** (policy
numbers and certificates); **cancel** (full refund in the cooling-off period, then the insurer's terms). Premiums are
the insurer's price, with no markup (Mada earns the partner commission). Not yet on the order sheet: the app needs an
"Add insurance" line there (mobile + order lines) once licensing is settled.

**Saudi licensing — read first.** In Saudi Arabia only an insurer or an intermediary licensed by the **Insurance
Authority** (IA, which took over insurance supervision from SAMA) may sell or arrange insurance, and policies for
Saudi residents generally must be issued by an IA-licensed insurer. Before switching this on for Saudi travellers:
(1) ask Cover Genius which **licensed Saudi insurer/fronting partner** issues their policies in KSA (they work
through local partners in regulated markets); (2) take legal advice on whether Mada must be registered as an
insurance **agent/aggregator** or can sell embedded under the insurer's licence (an "embedded"/referral model); (3)
get the Arabic policy wording and the IA-required disclosures. Outbound travel insurance bought for a Schengen visa
must also be accepted by the embassy. Until (1)–(3) are done, keep `SUPPLIER_MODE_INSURANCE=off` on production.

**Apply.** covergenius.com → Partners → "Get in touch"; ask for **XCover API** partner onboarding for travel
insurance in KSA and the GCC, staging keys, the travel `policy_type` names for our markets, and their KSA licensing
answer above.

**Keys in Vercel.** `XCOVER_API_KEY`, `XCOVER_API_SECRET`, `XCOVER_PARTNER_CODE`, `XCOVER_ENV` (`staging`/`live`),
optional `XCOVER_POLICY_TYPES` (e.g. `travel_medical:basic,travel_comprehensive:comprehensive,travel_cancellation:cancellation`
— the names Cover Genius gives us); `SUPPLIER_MODE_INSURANCE=live|mock|off`.

**Certification.** Cover Genius reviews the purchase flow (screenshots: options, wording links, disclosures, the
confirmation email) and runs test quotes, a bind and a cancellation on staging before live keys.

**Cost model.** No fee to Mada; Cover Genius pays **commission** on each premium (typically 20–35% of net premium,
negotiated). Premiums are collected either by Mada (merchant of record, remitted monthly) or by XCover directly — ask
which they support with a Saudi insurer.

**Licence notes.** The traveller must see the policy wording and key exclusions before buying (the option carries
`wordingUrl`); Mada must not describe cover beyond what the wording says. Keep claims with Cover Genius (their
claims link goes in the confirmation).

### 29. Pay later — Tabby and Tamara
**What it does.** `payLater("tabby" | "tamara")` (`suppliers/pay-later`): a **checkout session** for an order (the
provider's page, opened in the app's browser sheet), **webhooks** at `/api/app/v1/payments/tabby/webhook` and
`/api/app/v1/payments/tamara/webhook` (authenticated, then the payment is read back from the provider before anything
acts on it; Tamara's approved order is **authorised** there, as Tamara requires), **capture** when the booking is
confirmed, **refund** (part or full), **cancel** before capture. `payLaterOptions(amount, today)` gives the pay sheet
its **instalment line** per provider ("4 payments of SAR 300.01, the first today", due dates monthly), only within the
limits (`PAYLATER_MIN_SAR`, `TABBY_MAX_SAR`, `TAMARA_MAX_SAR`; the provider decides the real limit per traveller).

**Hook-up still needed (not in this change).** (1) Mobile pay sheet: show the instalment line under the card options
and open `checkoutUrl`; on return, poll the order. (2) Order flow: a new payment method `tabby`/`tamara` in the order
service — on the `authorized` webhook mark the order paid-on-hold and send it to the desk as today; capture when the
desk confirms (ticketed/booked); cancel if the booking fails; refunds through the existing refund path.

**Apply.** Tabby: tabby.ai/business → "Get started" (CR, VAT, website, bank IBAN); travel merchants are reviewed case
by case — ask for **Tabby Pay in 4** with merchant code for KSA and **sandbox keys**. Tamara: tamara.co/business →
"Join Tamara" (same documents); ask for **Pay in 3/4** and **sandbox** API and notification tokens. Both ask for the
refund and delivery policy for non-physical goods (e-tickets).

**Keys in Vercel.** Tabby: `TABBY_SECRET_KEY`, `TABBY_MERCHANT_CODE`, `TABBY_WEBHOOK_SECRET` (a long random value you
choose; register the webhook with Tabby — `POST /api/v1/webhooks` or in their dashboard — with header title
`X-Mada-Webhook` and this value; without it every Tabby webhook is refused), optional `TABBY_MAX_SAR`;
`SUPPLIER_MODE_TABBY=live|mock|off`. Tamara: `TAMARA_API_TOKEN`, `TAMARA_NOTIFICATION_TOKEN`, `TAMARA_ENV`
(`sandbox`/`live`), optional `TAMARA_INSTALMENTS=3`, `TAMARA_MAX_SAR`; `SUPPLIER_MODE_TAMARA=live|mock|off`. Shared:
`PAYLATER_MIN_SAR`.

**Certification.** Both run a go-live review on sandbox: a full checkout with their test customers (approve and
reject), capture, partial refund, cancel, and screenshots of how the instalments and their logos/terms appear on
the pay sheet. Tabby also requires their promo snippet/"split in 4" messaging to follow their brand guide.

**Cost model.** The merchant pays: a fee per transaction (typically 4–7% + a fixed fee, negotiated; travel is often at
the higher end); the traveller pays no interest or fee if on time. Settlement to Mada's IBAN in full, usually within
a few days of capture. Refunds return the fee only partly — check the contract.

**Licence notes.** Both are licensed by SAMA as BNPL providers; Mada needs no licence of its own to offer them, but
must show their terms link and must not call it a loan. Pay later can't be used for items they exclude (ask whether
flights for third parties and eSIMs are allowed).
