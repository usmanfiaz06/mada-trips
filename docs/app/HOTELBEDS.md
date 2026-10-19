# Hotelbeds (HBX Group): hotels, airport pickups, certification

Mada has an HBX Group **API Suite** account with **test keys** for Hotels, Activities and Transfers (sandbox account
"HOTELBEDS SPAIN - PRUEBAS"). Hotelbeds certifies every integration before it issues live keys. This page is the
owner's guide (what to set, how to get certified, how to go live) and the engineers' notes (what is built, what is
confirmed in Hotelbeds' documentation and what is assumed).

Code: `platform/src/lib/app/suppliers/hotelbeds/` (client, hotels, transfers, money, voucher, content, bookings, app
wiring, fixtures). Activities live next to it in `activities.ts` (another builder) and use the same `client.ts`.

---

## 1. What the owner sets

| Variable | Where | Value |
|---|---|---|
| `HOTELBEDS_ENV` | staging, production | `test` until certified, then `live` (production only) |
| `HOTELBEDS_HOTEL_API_KEY`, `HOTELBEDS_HOTEL_SECRET` | staging, production | Hotels key pair from developer.hotelbeds.com → Dashboard |
| `HOTELBEDS_TRANSFERS_API_KEY`, `HOTELBEDS_TRANSFERS_SECRET` | staging, production | Transfers key pair |
| `SUPPLIER_MODE_HOTELS` | staging, production | `hotelbeds` (real API with the keys above). `mock` = the prototype's catalogue; `hotelbeds-mock` = Hotelbeds-shaped fixtures, no network |
| `SUPPLIER_MODE_TRANSFERS` | staging, production | `hotelbeds`; `mock` serves fixtures |
| `APP_STAYS_MODE` | production | `request` during the beta (default in production). `live` after certification with live keys |
| `APP_ENV=staging` | staging | makes stays default to `live` there (booked on the **test** environment) |
| `APP_FX_RATES` | everywhere | SAR per unit, e.g. `EUR=4.12,USD=3.75,GBP=4.80`. Keep EUR current: Hotelbeds prices in EUR |
| `APP_FX_BUFFER_BPS` | optional | card FX and drift buffer, default 150 (1.5%) |
| `APP_STAY_MARKUP_BPS`, `APP_TRANSFER_MARKUP_BPS` | optional | Mada's margin: default 1000 (10%) rooms, 1500 (15%) pickups |
| `APP_CANCEL_BUFFER_DAYS` | optional | days of margin before Hotelbeds' deadline we stop showing "free to cancel". Default **0** (certification checks we show their deadline) |
| `HOTELBEDS_MAX_RESULTS` | staging for certification | how many hotels the app lists (default 8). Set `200` so testers see the whole result set |
| `HOTELBEDS_TOLERANCE_PCT` | optional | price rise Hotelbeds may accept silently at booking (default 0: a rise fails and the desk decides) |
| `HOTELBEDS_VOUCHER_EMAIL` | optional | contact on transfer bookings (default the account's email, else desk@madatrips.com) |
| `CRON_SECRET` | production | already used by the jobs; the daily content refresh runs at `/api/cron/hotelbeds` |

Never put keys in the app or in the repo. `npm run hotelbeds:smoke` refuses `HOTELBEDS_ENV=live`.

## 2. The beta booking policy

- **Production, beta:** stays and pickups are **desk requests**. A traveller picks a room and pays (the card is
  authorised, captured only when the desk confirms). The order reaches the desk with the Hotelbeds rate key on it; the
  desk clicks **Book on Hotelbeds**, sees the supplier reference, then confirms. Pickups: the traveller picks one, the
  request carries the rate key, the desk books in one click, quotes, the traveller pays in the app.
- **Staging:** `APP_ENV=staging` → stays book **automatically** on the Hotelbeds **test** environment as soon as the card
  is authorised (`APP_STAYS_MODE=live` is the staging default). This is the certification URL.
- **Safety rails** (`app.ts` `hotelbedsBookingAllowed`): the test environment never books for a production deployment;
  live keys never book outside production (unless `HOTELBEDS_ALLOW_LIVE_OUTSIDE_PRODUCTION=yes`); a stays mode of
  `live` that isn't allowed falls back to `request`.
- **After certification:** swap in the live keys, `HOTELBEDS_ENV=live`, then `APP_STAYS_MODE=live` when the owner wants
  bookings to go through without the desk's click.

## 3. Getting certified (owner's steps)

1. **Complete the profile** at developer.hotelbeds.com (company, contact, distribution channels: B2C app + agent desk).
2. **Run the smoke test** with the test keys: `HOTELBEDS_HOTEL_API_KEY=… HOTELBEDS_HOTEL_SECRET=… HOTELBEDS_TRANSFERS_API_KEY=… HOTELBEDS_TRANSFERS_SECRET=… npm run hotelbeds:smoke`.
   It runs status → availability → checkrates (only for RECHECK) → booking → detail → cancellation simulation → cancel,
   and the same for a transfer, and prints PASS/FAIL per step. Every booking it makes is cancelled. `--record` saves the
   answers (names removed) to `platform/scratch/hotelbeds-recorded/` to refresh our fixtures; `--no-book` only searches.
   The evaluation keys allow **50 calls a day**; one run uses about 10.
3. **Set up staging** for their testers (section 5) and check the flow end to end yourself.
4. **Send the certification request** (section 6) to **apitude@hotelbeds.com**.
5. Hotelbeds tests and may ask for changes. Their **live check** (§6 of their list): make a real booking about six
   months ahead for 2 adults and 2 children on a free-cancellation rate, send them the voucher and the price, **ask them
   before cancelling**, then cancel it (or Mada is charged).
6. **Go live:** live keys in production, `HOTELBEDS_ENV=live`, `SUPPLIER_MODE_HOTELS=hotelbeds`,
   `SUPPLIER_MODE_TRANSFERS=hotelbeds`; keep `APP_STAYS_MODE=request` for the beta, `live` when ready. Run the content
   job once by hand (`npm run app:jobs -- hotelbeds`) so hotel content is in our database before the first search.

## 4. How it works (engineers)

### Client (`client.ts`)
- Hosts: `https://api.test.hotelbeds.com` (test), `https://api.hotelbeds.com` (live), by `HOTELBEDS_ENV`.
- Headers on every call: `Api-key`, `X-Signature` = hex(SHA-256(apiKey + secret + UNIX seconds)), `Accept: application/json`,
  `Accept-Encoding: gzip`, our `X-Request-Id`.
- Timeouts per attempt (12 s; booking 65 s, certification asks ≥ 60 s). Retries (2, backed off) **only for safe calls**:
  GETs, availability, checkrates, the cancellation *simulation*. A booking or a cancellation is never sent twice by us.
- `429`, or `403` with a quota message (evaluation keys: 50 a day), → `RATE_LIMITED`, honouring `Retry-After`.
  `401/403` otherwise → `NOT_CONFIGURED`; `5xx`/timeouts → outage (counts for the circuit breaker); sold out / price
  moved → `PRICE_CHANGED`.
- Logs: product, method, path, status, ms, our request id and Hotelbeds' `auditData.token`. Never the key, secret or signature.
- The app wraps every call in the circuit breaker (`resilience/breaker.ts`, names `hotels` and `transfers`).

### Hotels (`hotels.ts`)
- Availability `POST /hotel-api/1.0/hotels`: by geolocation (our city centre + radius, `HB_PLACES`), destination code
  (`HOTELBEDS_USE_DESTINATION_CODES=yes`) or hotel codes; one call carries all rooms (identical occupancies grouped with
  `rooms`, children as `CH` paxes with ages); filters `paymentType=AT_WEB`, `maxHotels=2000`, optional `maxRate`,
  `minCategory`/`maxCategory`, `boards`.
- We sell only `AT_WEB`, non-`packaging` rates; one rate per hotel (the cheapest that fits); "lowest" and "best" labels.
- **CheckRate only for `RECHECK`** rates (before the order sheet shows the total, and again before booking). A BOOKABLE rate
  stands as shown; its comments come from the Content API's `ratecommentdetails` by `rateCommentsId` and check-in day.
- Booking `POST /hotel-api/1.0/bookings` with holder, every guest by room (children with age), `clientReference` = our order
  id (20 chars), `remark` with our order reference. Detail `GET /bookings/{ref}`. Cancel `DELETE /bookings/{ref}` with
  `cancellationFlag=SIMULATION` first (fee), then `CANCELLATION`.
- Content (`content.ts`): daily job, stores hotels in `app_hotelbeds_hotels` (name, category, address, phone,
  description, every image path, facilities with names and paid flag). Hotels in our offers but not stored are fetched
  by code; changes since the last run with `lastUpdateTime`. Hotels that show up in a search and aren't stored yet are
  also fetched by code right then (`fillContentNow`: batches of 100, a 3.5 s budget, each hotel at most once in 6 h per
  instance), so the first traveller sees their photos; `HOTELBEDS_CONTENT_ON_SEARCH=no` turns that off and leaves it to
  the job, which is what certification answer §8 below describes. Photo picked: GEN, then HAB, then COM, by visualOrder.
  Images: `https://photos.hotelbeds.com/giata/{bigger|xl}/{path}`. App: `GET /api/app/v1/hotels/{code}`.

### Money (`money.ts`)
Hotelbeds prices in the contract currency (EUR on the test account; the Booking API has no currency parameter that we
found). Price shown = net × our rate × (1 + FX buffer) × (1 + markup), rounded up to a whole riyal, and **never below
`sellingRate` when `hotelMandatory` is true**. Unknown currency → that hotel isn't shown (never guessed). Cancellation fees
in riyals are the supplier fee in proportion to what the traveller paid. If HBX can set the account to SAR, set
`APP_FX_RATES` aside: SAR converts 1:1 already.

### Cancellation rules
Their policies (`amount` from `from`, with the hotel's offset) become: "Free to cancel until 2 Mar, 23:59 hotel time. After
that, SAR 600. From 7 Mar, 23:59: SAR 3,000." The deadline is the hotel's clock (certification 3.8). Past deadline or
`NRF` → "Not refundable once booked."

### Transfers (`transfers.ts`)
Availability `GET /transfer-api/1.0/availability/{lang}/from/IATA/{airport}/to/ATLAS/{hotelCode}|GPS/{lat,lng}/{yyyy-mm-ddTHH:mm:ss}/{adults}/{children}/{infants}`;
book `POST /transfer-api/1.0/bookings` (holder with email and phone, flight details, clientReference); cancel
`DELETE /transfer-api/1.0/bookings/{lang}/reference/{ref}` (`?simulation=true` first). One option per vehicle and kind that
fits everyone; pickup instructions shown as Hotelbeds writes them. App: `GET/POST /api/app/v1/trips/{id}/transfers`.

### Desk
Order and request pages show a **Hotelbeds** card: environment badge, **Book on Hotelbeds** (one click; RECHECK rates are
re-checked first), the supplier reference and our reference, status (`booking`, `confirmed`, `failed`, `unknown` = no
answer: look it up in their extranet by our reference before trying again), the voucher (en/ar) and cancellation
(simulation, then confirm). Every booking is a row in `app_supplier_bookings` (one live row per order/request: a double
click never books twice) and an audit entry.

### Vouchers
Built from Hotelbeds' confirmation (`voucher.ts`, page in `@mada/shared` `voucherHtml`): hotel name, address, category,
destination, phone; HBX Group reference and our reference; lead guest, a name per room, children's ages; check-in and
check-out; room and board; essential information (rate comments) in full; the cancellation rule; and the payment statement
**without any price**: "Payable through {supplier}, acting as agent for the service operating company, details of which
can be provided upon request. VAT: {supplier VAT} Reference: {HBX reference}" (supplier name and VAT from the booking
response). In the app (Trip → Hotel voucher; download as HTML to print or save as PDF), on the desk, and from
`GET /api/app/v1/vouchers/{id}?format=html&lang=en|ar`. Traveller cancellation from the voucher: simulation first.

## 5. Staging for HBX testers (the certification URL)

```
APP_ENV=staging                APP_ALLOW_MOCKS=yes
SUPPLIER_MODE=mock             (sign-in codes, payments, flights stay mock)
SUPPLIER_MODE_HOTELS=hotelbeds SUPPLIER_MODE_TRANSFERS=hotelbeds
HOTELBEDS_ENV=test             + the four test keys
APP_STAYS_MODE=live            HOTELBEDS_MAX_RESULTS=200
APP_BOOKING_REQUIRES_PHONE=no  (or use the test phone below)
```
Web app: the mobile web export pointed at staging (`EXPO_PUBLIC_API_URL=<staging>`, live API mode).
- **Login:** phone +966 50 000 4127, code **123456** (mock sign-in codes on staging).
- **Payment:** any card number, e.g. **4111 1111 1111 1111**, any future expiry, any CVV (the staging payment provider
  is the mock; nothing is charged). The desk's mock autopilot confirms the order after a few seconds.
- **Only HBX Group product:** with `SUPPLIER_MODE_HOTELS=hotelbeds` every room in Stays comes from Hotelbeds (the
  catalogue is off; RateHawk/WebBeds aren't connected). Hotelbeds rooms carry a "Hotel details" link and their own
  cancellation rule; the hotel page and voucher are marked "HBX Group".

Tester's path: Ask → "A hotel in Istanbul" (or Dubai, Cairo, London, Paris) → pick travellers (add a child with a date
of birth to test ages) → see every hotel → Review → the order sheet shows the cancellation rule in hotel time and the
hotel's essential information (CheckRate runs here for RECHECK rates) → pay with the test card → booked on Hotelbeds →
Trips → the trip → **Hotel voucher** → Download → **Cancel this booking** (shows Hotelbeds' simulated fee, then cancels).
Pickups: the trip → Airport pickup → choose → sent to the desk; the desk books it from the request.

## 6. Certification request (draft, ready to send)

> **To:** apitude@hotelbeds.com
> **Subject:** Certification request: Mada Trips (Mada Travel and Tourism Co., Riyadh) – Hotels and Transfers
>
> Hello APItude team,
>
> We would like to certify our integration of the Booking API (Hotels) and the Transfers API. Details below.
>
> **1. Workflow, by distribution channel**
> - *Mada Trips app (B2C, iOS/Android/web):* the traveller searches a city and dates (availability by geolocation,
>   one request for all rooms, up to 2,000 hotels, `paymentType=AT_WEB`). We show every hotel returned with price,
>   room, board, category and photos, and the cancellation policy with deadlines in the hotel's local time. When the
>   traveller picks a rate we call CheckRate only if `rateType` is `RECHECK`; for BOOKABLE rates we get rate comments
>   from the Content API (`ratecommentdetails`). Rate comments are shown in full before payment. The traveller pays
>   us; we then confirm the booking (holder, all paxes per room with children's ages, clientReference = our order id,
>   60-second timeout). The voucher is in the app (and downloadable) right after confirmation. Cancellation:
>   simulation first (fee shown), then cancellation.
> - *Mada agent desk (B2B2C, our travel consultants):* during our beta the app's bookings reach our desk, which books
>   the exact rate the traveller chose with one click (same workflow and calls as above) and can view the voucher and
>   cancel (simulation, then cancellation).
> - *Transfers:* airport → hotel pickups for a booked trip: availability IATA → ATLAS hotel code (GPS when the hotel
>   isn't Hotelbeds), booking with flight number and holder contact, cancellation with simulation first.
>
> **2. Commercial decisions:** we sell only AT_WEB rates; opaque (packaging) rates are not shown on their own;
> destinations currently Istanbul, Dubai, Cairo, London, Paris, Baku, Tbilisi, Jeddah, AlUla, Abha, Bali, the
> Maldives; no room-type, board or hotel exclusions. Prices are shown in SAR (converted from the contract currency
> with our margin), never below `sellingRate` when `hotelMandatory` is true.
>
> **3. Certification URL:** https://STAGING-URL (web app) – desk: https://STAGING-URL/adminwork/desk
>
> **4. Login:** app: phone +966 50 000 4127, code 123456. Desk: user `hbx-cert@madatrips.com`, password sent separately.
>
> **5. Payment:** test card 4111 1111 1111 1111, any future expiry, any CVV (test payment provider; nothing is charged).
>
> **6. Guide:** English interface by default (Arabic available in Settings). Steps: Ask → "A hotel in Istanbul" →
> choose travellers (add a child to test ages) → Review → pay → Trips → the trip → Hotel voucher → Download / Cancel.
> Screenshots: `docs/app/hotelbeds-cert/` (to attach: search results, order sheet with rate comments, voucher en/ar,
> cancellation).
>
> **7. HBX Group products only:** on this environment every room shown comes from HBX Group (no other hotel supplier
> is connected); Hotelbeds hotels are marked "HBX Group" on the hotel page and the voucher.
>
> **8. Other:** content is loaded from the Content API daily (updates with `lastUpdateTime`) into our database and never
> requested in real time; images from photos.hotelbeds.com. Our smoke test report from the test environment is attached.
>
> Thank you,
> [Name], Mada Trips · [phone] · [email]

## 7. Pre-flight checklist (their sections → our code → proof)

| Their item | Where | Proof |
|---|---|---|
| 1 Technical: request configuration, **GZIP** | `client.ts` headers | test "signs … sends Accept JSON and gzip" |
| 2.1–2.2 Order: availability → checkrate (if needed) → booking; no repeated availability | `hotels.ts` `price()` (no call for BOOKABLE), `booking/hotelbeds-stays.ts`, `bookings.ts` | test "only asks checkrates for a RECHECK rate" (no second checkrates while held) |
| 2.3 Many hotels per call (≤ 2000) | `availabilityBody` `maxHotels: 2000` | test "asks for many hotels with our filters" |
| 2.4 All rooms in one availability | `occupanciesOf` / `splitParty` | test "groups identical rooms, carries children's ages" |
| 2.5 CheckRate only for RECHECK | `price()`, `withHotelbedsEssentials` | test above |
| 2.6 ≤ 10 rates per CheckRate | `checkRate()` guard | code |
| 2.7 Show promotions | `offerOf` note "Includes …" | code |
| 3.1 Full product: prices, rooms, dates, boards, categories, pagination | stay card (room, board, category, photo, rule), `HOTELBEDS_MAX_RESULTS` | e2e shots + test "sells AT_WEB …" |
| 3.3 Children with ages | `search.ts` child ages from dates of birth → CH paxes | test "groups … children's ages" |
| 3.4 Multi-room | `occupanciesOf` | test |
| 3.5 No opaque rates alone | `bestRate` skips `packaging` | code |
| 3.6 sourceMarket | not used | — |
| 3.7 Filters | maxRate, category, boards in `availabilityBody` (not yet in the app UI) | test |
| 3.8 Cancellation policies, hotel time | `stayRule` / `hotelTime` | test "states the hotel's cancellation deadline in the hotel's time" |
| 3.9 Rate comments before confirmation | `hotelbedsRule` on the order sheet | test "From the hotel: …" in the preview |
| 3.11 Booking timeout ≥ 60 s | `book()` 65 s | code |
| 3.12 Selling rate / hotelMandatory | `sellHalalas` floor | test "never below the hotel's mandatory price" |
| 4.1–4.5 Voucher | `voucher.ts`, `voucher-html.ts`, app `voucher/[id].tsx`, desk route | test "the voucher (cert. §4)…", e2e shots en/ar |
| 5 Content stored, refreshed, hotel detail for missing | `content.ts`, cron `hotelbeds` daily | test "keeps hotel content in our store…" |
| 5.2–5.6 Category, all images, facilities, descriptions | `GET /hotels/{code}`, app `hotel/[code].tsx` | test + e2e shot |
| 5.5 Crawler spec | not built (we don't crawl) | — |
| 6 Live booking 2+2, then cancel | owner, after live keys (section 3.5) | — |
| 6.3 Non-breaking changes | we read only the fields we need; unknown fields ignored; enums compared leniently | code review |

## 8. Confirmed vs assumed

Confirmed on developer.hotelbeds.com (October 2026):
- Test host `api.test.hotelbeds.com`; headers `Api-key` and `X-Signature` = SHA-256 hex of key + secret + UNIX seconds;
  evaluation keys limited to 50 requests a day, quota answered with 403
  ([getting started](https://developer.hotelbeds.com/documentation/getting-started/)). The test host answered our
  smoke script (403 to a bad key) from this environment.
- Live host `api.hotelbeds.com` (Transfers pages show both hosts; [booking API](https://developer.hotelbeds.com/documentation/transfers/booking-api/)).
- Hotels workflow: `POST /hotel-api/1.0/checkrates` with `rooms[].rateKey`, `POST /hotel-api/1.0/bookings` with holder,
  rooms/paxes (roomId, type, name, surname), clientReference, remark, tolerance; `rateType` RECHECK/BOOKABLE
  ([workflow](https://developer.hotelbeds.com/documentation/hotels/booking-api/workflow/)).
- Certification list, voucher fields and the request email items
  ([certification process](https://developer.hotelbeds.com/documentation/hotels/knowledge-base/certification-process/)).
- Content API `/hotel-content-api/1.0/hotels?fields=all&language=ENG&from&to`, `lastUpdateTime`, daily updates, store
  locally, never real-time ([how to use](https://developer.hotelbeds.com/documentation/hotels/content-api/how-use-content-api/));
  images under `photos.hotelbeds.com/giata/` with size folders ([images](https://developer.hotelbeds.com/documentation/hotels/content-api/use-images/));
  rate comments by `rateCommentsId` = incoming|code|rateCodes and check-in date
  ([rate comments](https://developer.hotelbeds.com/documentation/hotels/content-api/use-rate-comments/)).
- Transfers availability path, response fields (transferType, vehicle, category, pickupInformation, price.totalAmount,
  currencyId, rateKey, cancellationPolicies, TRFTIME), booking body and response, cancellation path with
  `?simulation=` ([availability](https://developer.hotelbeds.com/documentation/transfers/booking-api/search-availability/availability-simple/),
  [booking](https://developer.hotelbeds.com/documentation/transfers/booking-api/booking-post-booking/booking-request/),
  [cancellation](https://developer.hotelbeds.com/documentation/transfers/booking-api/booking-post-booking/booking-cancellation/)).

Assumed (from community clients and long-standing APItude behaviour; check with the smoke test or the API reference
pages, which render only in a browser):
- `POST /hotel-api/1.0/hotels` for availability (listed on APIs.io), request field names `stay`, `occupancies`,
  `destination.code`, `geolocation{latitude,longitude,radius,unit}`, `hotels.hotel[]`, `filter{maxRate,minCategory,maxCategory,paymentType,maxHotels,maxRatesPerRoom}`,
  `boards{board[],included}`; response `hotels.hotels[].rooms[].rates[]` with `net`, `sellingRate`, `hotelMandatory`,
  `paymentType`, `packaging`, `taxes`, `promotions`, `offers`.
- `GET /hotel-api/1.0/bookings/{reference}` and `DELETE …?cancellationFlag=SIMULATION|CANCELLATION`; the simulated fee in
  `booking.hotel.cancellationAmount`.
- `GET /hotel-content-api/1.0/types/facilities` and `/types/ratecommentdetails?date&code` paths and shapes.
- Transfer booking detail `GET /transfer-api/1.0/bookings/{lang}/reference/{ref}` (by symmetry with the cancel path) and
  GPS codes as `lat,lng`.
- The voucher payment statement wording (the certification page names supplier, VAT and reference; the sentence is the
  one HBX Group vouchers carry). Ask the certification team to confirm.
- The rate key layout (dates, hotel code, room, board, occupancy by position): used only to search the same hotel again
  when the party changes, never relied on otherwise.
- No currency parameter on availability: prices come in the account's contract currency.
- Destination codes IST/DXB/CAI/LON/PAR (only used with `HOTELBEDS_USE_DESTINATION_CODES=yes`; geolocation by default).

## 9. Known gaps

- Traveller remarks for the hotel (special requests) aren't sent as the booking `remark` yet; the desk passes them on.
- Hotel content is stored in English; Arabic (`language=ARA`) not loaded yet.
- Filters (board, price cap, category) exist in the adapter, not yet in the app's Stays screen.
- Cancelling a stay from the trip's "Cancel" (refund flow) doesn't cancel on Hotelbeds by itself; cancel from the voucher
  or the desk.
- RateHawk / WebBeds not connected; `HOTELS_VENDOR=ratehawk` answers NOT_CONFIGURED.
- The crawler specification (5.5) isn't implemented: we don't crawl.
