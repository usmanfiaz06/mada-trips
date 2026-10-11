# Suppliers (Mada Trips Core API)

Every outside system sits behind an interface in [`types.ts`](types.ts). Route handlers and services call
`suppliers.<name>()` from [`index.ts`](index.ts), which picks the **mock** or the **live** adapter on every call.

**Choosing the mode**

- `SUPPLIER_MODE=mock|live` sets every supplier; `SUPPLIER_MODE_<NAME>=mock|live` overrides one
  (`SUPPLIER_MODE_SMS`, `SUPPLIER_MODE_FLIGHT_STATUS`, `SUPPLIER_MODE_FLIGHT_POSITIONS`, …).
- Default: **mock** in development, **live** on a production deployment (`VERCEL_ENV=production` or `APP_ENV=production`).
- A production deployment **refuses** mock mode unless `APP_ALLOW_MOCKS=yes` (for a staging copy), so the fixed mock
  sign-in code can never reach the real app.
- `flightPositions` is the exception: open data, free and keyless, so it is **live by default everywhere**. Only
  `SUPPLIER_MODE_FLIGHT_POSITIONS` switches it (the tests set it to `mock`).
- A live adapter whose credentials are missing answers `501 NOT_CONFIGURED`; nothing crashes.

| Supplier | Interface | Live adapter | Live env vars | Mock behaviour |
|---|---|---|---|---|
| `flights` | `FlightSupplier` (search, price, hold) | **Not built**: Mada's GDS Enterprise API (decision D15) + Travelfusion for flynas/flyadeal | `GDS_API_URL`, `GDS_CLIENT_ID`, `GDS_CLIENT_SECRET` | RUH→IST returns the prototype's three options: **Saudia SV263** 09:40→13:55 (best, SAR 2,160 pp), flynas XY125 to SAW (lowest, SAR 1,745), Turkish TK141 02:10 (earliest, SAR 2,328). Other routes: one direct per airline that flies it. `to: "XXX"` → no flights; `to: "ERR"` → supplier not answering; an offer id ending `-up` re-prices SAR 140 higher. Holds return PNR `X7K2QD` for SV263. |
| `hotels` | `HotelSupplier` (search, price) | **Hotelbeds** (`hotelbeds/`, `SUPPLIER_MODE_HOTELS=hotelbeds`; `hotelbeds-mock` serves its fixtures). RateHawk/WebBeds not built. See docs/app/HOTELBEDS.md | `HOTELBEDS_ENV`, `HOTELBEDS_HOTEL_API_KEY`, `HOTELBEDS_HOTEL_SECRET`, `APP_STAYS_MODE`, `APP_FX_RATES`, `APP_STAY_MARKUP_BPS` | Istanbul: rooms near Galata Tower (SAR 980/night), Sultanahmet garden hotel, Bosphorus rooms. Free cancellation until 6 days before, then SAR 400. Other cities: none. |
| `transfers` | `HotelbedsTransfers` (availability, book, detail, cancel; `hotelbeds/transfers.ts`) | **Hotelbeds Transfers** (`SUPPLIER_MODE_TRANSFERS=hotelbeds`) | `HOTELBEDS_TRANSFERS_API_KEY`, `HOTELBEDS_TRANSFERS_SECRET`, `APP_TRANSFER_MARKUP_BPS` | Fixtures (`hotelbeds/fixtures/transfers-availability.json`): from IST, a car (3), a minivan (7) and a shuttle, free to cancel until the day before. Other airports: nothing. |
| `payments` | `PaymentSupplier` (authorize, capture, void, refund; idempotent by key) | **Not built**: MyFatoorah | `MYFATOORAH_API_KEY`, `MYFATOORAH_BASE_URL` | In-memory gateway. Token `tok_decline` → declined; `tok_3ds` → `requires_action` with a redirect; `tok_fail_capture` → capture fails (then void). Anything else authorises. Same idempotency key → same result. |
| `sms` | `SmsSupplier` (also sends Supabase Auth's codes from `/auth/sms-hook`) | Unifonic REST, or Taqnyat REST with `SMS_PROVIDER=taqnyat` | `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID` (registered "MadaTrips" with CST); or `TAQNYAT_BEARER_TOKEN`, `TAQNYAT_SENDER_NAME` | Logs the message (with the code) to the console and the in-memory `outbox`. In mock mode every sign-in code is **123456**. |
| `whatsapp` | `WhatsAppSupplier` (approved templates; `sendAuthCode` for sign-in codes) | Templates (invites): Meta Cloud API, directly. Sign-in codes (`suppliers.whatsappCodes()`, the Send SMS hook): **Zoho CPaaS** (`live/zoho-cpaas.ts`, docs/app/AUTH.md §5a) | Meta: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, optional `WHATSAPP_API_VERSION`. Zoho: `ZOHO_CPAAS_API_KEY`, `ZOHO_CPAAS_WHATSAPP_SENDER`, `ZOHO_CPAAS_TEMPLATE_EN`, `ZOHO_CPAAS_TEMPLATE_AR`, optional `ZOHO_CPAAS_MERGE_KEY`, `ZOHO_CPAAS_BASE_URL`, `ZOHO_CPAAS_CONFIRM_MS` | Logs `template[locale](params)` or `auth_code[locale](code)` to the outbox. A number ending `0000` "isn't on WhatsApp" (`WhatsAppUndeliverable`), to try the fallback to SMS. |
| `email` | `EmailSupplier` | **Not built**: Amazon SES (lands with the first email flow) | `AWS_*` (SES) | Logs subject and body to the outbox. |
| `flightStatus` | `FlightStatusSupplier` (lookup, watch) | **AeroDataBox** (`live/aerodatabox.ts`, the beta), **aviationstack** (`live/aviationstack.ts`, development only), FlightAware AeroAPI v4 (`live/flight-status.ts`). Picked by `flight-status-vendor.ts` from the key that's set; read through the shared cache and cadence in `lib/app/flight-status/` | `AERODATABOX_API_KEY` (+ `AERODATABOX_MARKET`, `AERODATABOX_PLAN`, `AERODATABOX_MONTHLY_UNITS`, `AERODATABOX_WEBHOOK_SECRET`), or `AVIATIONSTACK_API_KEY` (+ `AVIATIONSTACK_MONTHLY_BUDGET`, `AVIATIONSTACK_PLAN`), or `FLIGHTAWARE_API_KEY`; optional `SUPPLIER_MODE_FLIGHT_STATUS=aerodatabox\|aviationstack\|flightaware\|mock` | SV263 RUH→IST, 09:40, Terminal 3, gate B12, on time. Other numbers: a plausible schedule from the number (as the prototype). Gates, delays and schedules come from here only. |
| `flightPositions` | `FlightPositionsSupplier` (byCallsign, byHex; **never throws**) | adsb.lol, falling back to the OpenSky Network. **Live by default.** | none required; set `ADSB_CONTACT` to a monitored address (adsb.lol refuses generic user agents) | SVA263 cruising over the Gulf of Aqaba at 37,000 ft; anything else not airborne (null). |
| `ai` | `AiSupplier` (parseIntent, answer) | Claude via `@anthropic-ai/sdk` (structured intent, short answers under COPY.md; banned-word check before anything goes out; server-side refusal fallback on) | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | Rule-based: finds the city, Eid (9 Mar 2027), "4 of us", and the one missing detail to ask for. Never prices. |
| `identity` | `IdentitySupplier` (Sign in with Apple / Google, pre-Supabase routes only) | Verifies the provider's identity token against Apple's / Google's published keys (jose JWKS) | `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS` (comma-separated audiences) | Accepts `mock:<id>[:<email>]`; an `@privaterelay.appleid.com` email counts as Apple's hidden email. |
| `supabase` | `SupabaseAuthSupplier` (verify an access token; see docs/app/AUTH.md) | jose against the project's JWKS (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`); legacy HS256 with `SUPABASE_JWT_SECRET`. Not behind a breaker: a bad token is not an outage. | `SUPABASE_URL`, optional `SUPABASE_JWT_SECRET` | Reads the app's unsigned `mocksb.` tokens (`encodeMockSupabaseToken` in @mada/shared). Refused on a production deployment unless `APP_ALLOW_MOCKS=yes`. |

## Live aircraft positions (open ADS-B)

`GET /api/app/v1/flights/{flightNo}/position` (signed in) maps the IATA flight number to an ICAO callsign
(`icaoCallsign` in `packages/shared`: SV→SVA, XY→KNE, F3→FAD, TK→THY, EK→UAE, QR→QTR, MS→MSR, EY→ETD, BA→BAW, LH→DLH)
and returns `{ flightNumber, callsign, position, attribution }`, where `position` is
`{ lat, lon, altitudeFt, groundSpeedKt, track, onGround, seenAt, source }` or `null` when the aircraft isn't airborne,
isn't seen, or the feeds are down.

- **adsb.lol** (primary): `GET https://api.adsb.lol/v2/callsign/{callsign}`, also `/v2/hex/{hex}` and
  `/v2/point/{lat}/{lon}/{radius_nm}`. Data under the **Open Database License (ODbL 1.0)**: commercial use is allowed
  **with attribution**, which every response carries (`FLIGHT_POSITION_ATTRIBUTION`) and the app must show next to any
  map or position. It rate-limits bursts (HTTP 429 seen while testing), so results are cached.
- **OpenSky Network** (fallback): `https://opensky-network.org/api/states/all` with `icao24=` or a bounding box (callsign
  lookups search the Middle East box). **Free for non-commercial use only; commercial use needs an agreement with
  OpenSky** before launch. Anonymous calls are rate-limited.
- 4-second timeout per call; results (including "not seen") cached for 45 seconds; any error becomes `null`.
- Position and altitude only. Gates, delays and schedules stay with `flightStatus`.
- With `?date=YYYY-MM-DD` the route asks `flightStatus` (through the cache) which aircraft flies it and looks it up on
  adsb.lol **by its ICAO hex** first (`match: "hex"`), then by callsign. With neither, and the flight due in the air,
  `estimate` is where its times put it on the great circle (`basis`: actual take-off, revised or schedule). The app
  always labels that "estimated". Saudi airspace has almost no community receivers yet: docs/app/ADSB-RECEIVER.md.

## Flight status: AeroDataBox, aviationstack, FlightAware

**Choosing.** `SUPPLIER_MODE_FLIGHT_STATUS` may name `aerodatabox`, `aviationstack`, `flightaware` or `mock`. Unset, the
first key present wins: `AERODATABOX_API_KEY` → AeroDataBox, else `AVIATIONSTACK_API_KEY` → aviationstack, else
`FLIGHTAWARE_API_KEY` → FlightAware, else mock (on a production deployment without `APP_ALLOW_MOCKS=yes`: "none", status
reads as not available). The choice is logged at start-up (`src/instrumentation.ts`) and shown in `GET /status`
(`flightStatusSource`).

**Cache, cadence, budget** (`lib/app/flight-status/`). Every lookup goes through `app_flight_status_cache` (shared by all
instances). `cadence.ts` decides when a flight may be asked again: Basic (AeroDataBox free, about 200 lookups a month)
24 h → 12 h (within 48 h) → 90 min (within 6 h) → 30 min (last 3 h and in the air) → stop after landing; Pro and
FlightAware 24 h → 3 h → 30 min → 10 min; aviationstack Free only inside the last 6 h (2 h, then 1 h). `usage.ts` keeps
a hard monthly budget per vendor in `app_supplier_usage` (`AERODATABOX_MONTHLY_UNITS`, default from `AERODATABOX_PLAN`:
basic 400, pro 5,000…; `AVIATIONSTACK_MONTHLY_BUDGET`, default 100). When it's spent, or the supplier fails or its
circuit breaker is open, the last answer stands; with none, the app keeps the booked times and estimated position.

**Changes → notices.** `/api/cron/flights` (every 5 minutes, `jobs.ts` → `flight-status/poll.ts`) takes every booked
segment and every tracked flight with alerts on from yesterday to three days out, asks when due, and runs the answer
through `applyAlert` (`trips/status.ts`): gate change, delay of 15 minutes or more (told again at each further half
hour), cancellation, each told once per person (`app_flight_events`), in their language. Tracked flights get their own
wording (`notify.tracked.*`): we're not holding seats for those.

**AeroDataBox alerts** (`flight-status/alerts.ts`, route `POST /api/app/v1/flights/alerts/aerodatabox/{secret}`). With
`AERODATABOX_WEBHOOK_SECRET` (24+ characters) set, the job subscribes each **flight number** (never an airport) while
one of our flights on it departs within 72 hours, and removes it after landing or when the trip is cancelled; tracking a
flight subscribes at once. Subscribed flights aren't polled. If AeroDataBox refuses (plan, balance at zero) the flight
is polled instead. Notifications aren't signed, so the URL carries the secret and only our own subscription ids count.
Override the public base with `AERODATABOX_WEBHOOK_BASE_URL` (else `APP_PUBLIC_URL`).

**Confirmed vs assumed** (read 2026-10-11; details and links in the adapters' header comments):

| | Confirmed | Assumed (check on the first live answer) |
|---|---|---|
| AeroDataBox | Bases and headers: RapidAPI `https://aerodatabox.p.rapidapi.com` + `X-RapidAPI-Key`, `X-RapidAPI-Host: aerodatabox.p.rapidapi.com`; API.Market `https://prod.api.market/api/v1/aedbx/aerodatabox` + `x-api-market-key`; direct `https://api.aerodatabox.com` + `X-Api-Key` (OpenAPI v1.15.4.0). `GET /flights/{searchBy}/{flightNumber}/{dateLocal}` (searchBy Number, Reg, CallSign or Icao24) with `dateLocalRole`, `withAircraftImage`, `withLocation`; 204 when unknown. Fields: scheduled/revised/predicted/runway times in `utc` and `local`, terminal, gate, check-in desk, baggage belt, quality (Basic/Live/Approximate), status enum incl. `Canceled`, `CanceledUncertain`, `Diverted`; aircraft `reg`, `modeS` (hex), `model`. Status is TIER 2 = 2 units; Basic 400 units/month at 1 req/s. Webhooks: `POST /subscriptions/webhook/FlightByNumber/{no}` {url, maxDeliveryRetries}, `DELETE /subscriptions/webhook/{id}`, `GET /subscriptions/balance`, 1 credit per flight per notification, credits = units, no expiry, notifications cover −6 h…+72 h. | The lower-case `number` path segment; time strings like `2026-10-11 06:40Z` (parsed leniently either way); notifications carry no signature; subscription limits per plan. |
| aviationstack | `https://api.aviationstack.com/v1/flights?access_key=…` over HTTPS on Free; filters `flight_iata`, `flight_icao`, `flight_date` (Basic plan and up only); fields departure/arrival scheduled/estimated/actual/runway, terminal, gate, baggage, delay; `flight_status` scheduled/active/landed/cancelled/incident/diverted; aircraft `registration`, `icao24`; `live`. Errors `{error:{code,message}}` (`invalid_access_key` seen live). Free: 100 calls/month, non-commercial. | Times are the airport's local wall clock despite `+00:00`; `usage_limit_reached` is the quota error code. |

## Adding a supplier

1. Add its interface to `types.ts` and its name to `SUPPLIERS` in `../config.ts`.
2. Write the mock in `mock/` with data that matches the prototype, and the live adapter in `live/` (use
   `requireEnv` so missing credentials become `NOT_CONFIGURED`).
3. Register both in `index.ts`, add a row above, and cover the mock in `test/app/suppliers.test.ts`.
