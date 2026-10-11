# Hotelbeds in Mada Trips

Hotels, transfers and activities come from the Hotelbeds (HBX Group) API Suite. This is the owner's guide: the keys,
the modes, the booking policy for the beta, and the smoke test that proves the account works. The code is in
`platform/src/lib/app/suppliers/hotelbeds/` (one HTTP client, one adapter per product, the money rules and the voucher).

## 1. Keys and hosts

Each product has its own key pair on developer.hotelbeds.com. The signing is the same for all three: every request
carries `Api-key` and `X-Signature = hex(SHA-256(apiKey + secret + unix seconds))`.

| Variable | What |
|---|---|
| `HOTELBEDS_ENV` | `test` (default) or `live`. test → `api.test.hotelbeds.com`, live → `api.hotelbeds.com`. |
| `HOTELBEDS_HOTEL_API_KEY`, `HOTELBEDS_HOTEL_SECRET` | Hotels: Booking API 1.0 and Content API 1.0. |
| `HOTELBEDS_TRANSFERS_API_KEY`, `HOTELBEDS_TRANSFERS_SECRET` | Transfers. |
| `HOTELBEDS_ACTIVITIES_API_KEY`, `HOTELBEDS_ACTIVITIES_SECRET` | Activities. |

The evaluation keys on the test host allow 50 calls a day; a 403 that mentions the quota and a 429 both come out as
`RATE_LIMITED` and the app shows the supplier as busy. Only safe calls (GETs, availability, checkrates) are retried;
a booking or a cancellation is never sent twice by us.

## 2. Modes and the booking policy

| Variable | Values |
|---|---|
| `SUPPLIER_MODE_HOTELS` | `mock` (the prototype's catalogue), `hotelbeds` or `live` (the real API), `hotelbeds-mock` (recorded fixtures, for a staging demo). |
| `SUPPLIER_MODE_TRANSFERS` | `mock` (fixtures) or `hotelbeds` / `live`. |
| `APP_STAYS_MODE` | `request`: a paid stay goes to the desk, who books it on Hotelbeds from the order in one click. `live`: booked on Hotelbeds as soon as the desk picks the order up. Default: live on staging, request everywhere else. |
| `HOTELBEDS_MAX_RESULTS` | How many hotels the app lists (default 8; a certification staging shows them all, e.g. 200). |
| `HOTELBEDS_USE_DESTINATION_CODES` | `yes` to search by Hotelbeds destination code instead of city centre + radius (codes to be confirmed on the account first). |
| `HOTELBEDS_TOLERANCE_PCT` | Price tolerance passed on a booking, if any. |
| `APP_CANCEL_BUFFER_DAYS` | Days before the hotel's deadline that we stop offering free cancellation (default 0). |

A real booking is only ever made where it belongs: the test keys never take a booking for a real traveller on a
production deployment, and the live keys only work on production (or with `HOTELBEDS_ALLOW_LIVE_OUTSIDE_PRODUCTION=yes`
for a certification run). Only `AT_WEB` rates are sold: we pay Hotelbeds, the traveller pays us. Prices come back in
the account's contract currency (EUR on the test account) and become riyals through `APP_FX_RATES`, the FX buffer and
Mada's markup (`money.ts`); a hotel's mandatory selling price is never undercut.

## 3. The smoke test

`npm run hotelbeds:smoke` makes one real round trip on the **test** host with the account's own keys and the same
adapter the app uses: search → checkrates → book → read the booking back → build the voucher (en + ar) → cancel
(simulation, then for real). It refuses to run with `HOTELBEDS_ENV=live`. Six calls, so about an eighth of the
daily evaluation quota. The raw answers and both vouchers are written to a folder it prints (`--out` to choose).

```
npm run hotelbeds:smoke                                 Dubai, check-in in six weeks, two nights, two adults
npm run hotelbeds:smoke -- --city istanbul --nights 3   another of our cities
npm run hotelbeds:smoke -- --destination PMI            a Hotelbeds destination code
npm run hotelbeds:smoke -- --keep                       leave the booking (cancel it in the extranet yourself)
```

It picks the cheapest rate for one room that is still free to cancel for at least three more days, so the cancellation
costs nothing on the account. If booking succeeded but cancelling did not, the reference is printed in capitals:
cancel it in the Hotelbeds extranet.

*Run, 11 October 2026* (test host, Dubai, 22 to 24 November, two adults): 135 hotels in 1.6 s; the cheapest refundable
rate (Royal Falcon Hotel, 3 stars, double standard, room only, 92.30 EUR net, sells at SAR 428) checked unchanged;
booked and confirmed in 1.4 s with our client reference on it; read back with cancellation allowed; the voucher carried
the HBX reference, hotel name, category and destination, both guests by room, check-in and check-out, room, board,
the rate comments (city tax payable at the hotel) and the payment statement naming HOTELBEDS DMCC and its VAT number;
the cancellation simulation reported no fee and the cancellation came back `CANCELLED` with a cancellation reference.
Seven of seven steps, six calls, 7 seconds on the wire. The only gap: the voucher's hotel address and phone come from
our content cache (`app_hotelbeds_hotels`, filled by the content job), which the smoke test does not use, so they were
empty there; in the app they are filled once the content job has run for that hotel.

## 4. Vouchers

The voucher for a confirmed booking (certification §4) is built from what Hotelbeds confirmed, never from the search:
hotel name and address, category, destination, phone; the holder and at least one name per room, children's ages; the
HBX Group reference, check-in and check-out, room type, board, rate comments and our own reference; and the payment
statement with the supplier's name, VAT number and the reference, in English on every voucher with an Arabic line
beside it. It renders natively in the app, in the desk, and as a standalone printable HTML page.

## 5. Open items

- Confirm the destination codes for our cities on the account before `HOTELBEDS_USE_DESTINATION_CODES=yes`.
- The content job must have run for a hotel before its address and phone reach the voucher.
- `APP_FX_RATES` must be kept current by the owner; the defaults in `money.ts` are conservative placeholders.
