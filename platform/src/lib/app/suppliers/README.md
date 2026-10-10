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
| `hotels` | `HotelSupplier` (search, price) | **Not built**: RateHawk, then WebBeds | `RATEHAWK_KEY_ID`, `RATEHAWK_API_KEY` | Istanbul: rooms near Galata Tower (SAR 980/night), Sultanahmet garden hotel, Bosphorus rooms. Free cancellation until 6 days before, then SAR 400. Other cities: none. |
| `payments` | `PaymentSupplier` (authorize, capture, void, refund; idempotent by key) | **Not built**: MyFatoorah | `MYFATOORAH_API_KEY`, `MYFATOORAH_BASE_URL` | In-memory gateway. Token `tok_decline` → declined; `tok_3ds` → `requires_action` with a redirect; `tok_fail_capture` → capture fails (then void). Anything else authorises. Same idempotency key → same result. |
| `sms` | `SmsSupplier` | Unifonic REST | `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID` (registered "MadaTrips" with CST) | Logs the message (with the code) to the console and the in-memory `outbox`. In mock mode every sign-in code is **123456**. |
| `whatsapp` | `WhatsAppSupplier` (approved templates) | Meta Cloud API, directly | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, optional `WHATSAPP_API_VERSION` | Logs `template[locale](params)` to the outbox. |
| `email` | `EmailSupplier` | **Not built**: Amazon SES (lands with the first email flow) | `AWS_*` (SES) | Logs subject and body to the outbox. |
| `flightStatus` | `FlightStatusSupplier` (lookup, watch) | FlightAware AeroAPI v4 (lookup built; alerts webhook in M3) | `FLIGHTAWARE_API_KEY` | SV263 RUH→IST, 09:40, Terminal 3, gate B12, on time. Other numbers: a plausible schedule from the number (as the prototype). Gates, delays and schedules come from here only. |
| `flightPositions` | `FlightPositionsSupplier` (byCallsign, byHex; **never throws**) | adsb.lol, falling back to the OpenSky Network. **Live by default.** | none required; set `ADSB_CONTACT` to a monitored address (adsb.lol refuses generic user agents) | SVA263 cruising over the Gulf of Aqaba at 37,000 ft; anything else not airborne (null). |
| `ai` | `AiSupplier` (parseIntent, answer) | Claude via `@anthropic-ai/sdk` (structured intent, short answers under COPY.md; banned-word check before anything goes out; server-side refusal fallback on) | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | Rule-based: finds the city, Eid (9 Mar 2027), "4 of us", and the one missing detail to ask for. Never prices. |
| `identity` | `IdentitySupplier` (Sign in with Apple / Google) | Verifies the provider's identity token against Apple's / Google's published keys (jose JWKS) | `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS` (comma-separated audiences) | Accepts `mock:<id>[:<email>]`; an `@privaterelay.appleid.com` email counts as Apple's hidden email. |

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
- Position and altitude only. Gates, delays and schedules stay with `flightStatus` (FlightAware).

## Adding a supplier

1. Add its interface to `types.ts` and its name to `SUPPLIERS` in `../config.ts`.
2. Write the mock in `mock/` with data that matches the prototype, and the live adapter in `live/` (use
   `requireEnv` so missing credentials become `NOT_CONFIGURED`).
3. Register both in `index.ts`, add a row above, and cover the mock in `test/app/suppliers.test.ts`.
