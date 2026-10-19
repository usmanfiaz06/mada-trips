# TBO Air: real flights (owner and desk guide, 19 Oct 2026)

Mada can search, hold and ticket flights through **TBO Air** (TBO Holidays' air API). The code is built and tested
against a fake TBO; it works as soon as TBO's credentials do. Until then, and until you switch it on, flights keep going
to the desk as requests (`APP_FLIGHTS_MODE=request`, the safe default).

Code: `platform/src/lib/app/suppliers/live/tbo-air.ts` (the adapter), `booking/supplier-flights.ts` (what the desk's
buttons do), `components/desk/flight-supplier.tsx` (the TBO card on a desk order). Tests: `platform/test/app/tbo-air.test.ts`.

## 1. What to get from TBO

Ask your TBO account manager (or `apisupport` at TBO) for:

1. **API access switched on for your API user.** Your agency login to the TBO website is not enough: the API user
   is separate, and "credentials not working" is usually this. Ask which user name is the **API** user.
2. **ClientId** (TBO issues one per integration; their samples show `ApiIntegrationNew` on test), **UserName** and
   **Password** for the **test (staging)** environment first. Live ones come only after certification.
3. **The current API documentation and URLs** for your account: the Authenticate URL and the Air service base URL, test
   and live. TBO's public pages describe two generations of the API with different hosts; ours follows the JSON "Air
   API" (Authenticate with ClientId/UserName/Password/EndUserIp → TokenId; Search → TraceId + ResultIndex). If TBO
   hands you the newer `xmloutapi` / `xmloutbookingapi` hosts instead, send us the documents: the method names are the
   same, a few field names differ.
4. **IP whitelisting.** TBO accepts API calls only from the public IP(s) you register with them (their certification
   page: "share your static public IP or gateway"). See §2: Vercel has no fixed outbound IP by default.
5. Which **content** your contract includes (GDS full-service airlines like Saudia, Turkish; low-cost like flynas,
   flyadeal), the **currency** your wallet is in (SAR is simplest), and how the **deposit / credit line** is topped up:
   TBO takes the money from your wallet at ticketing.
6. Their **certification test cases** and validation checklist (§4).

Never send credentials in chat or email to us: put them straight into Vercel (§3).

## 2. Whitelisted IPs and Vercel

Vercel functions leave from changing addresses, so a TBO IP allowlist will refuse them at random. Options, best first:

- **Vercel Static IPs** (Vercel's add-on for Pro/Enterprise projects: outbound traffic from fixed IPs in one region).
  Turn it on for the Mada Ops project in the region the functions run in (Frankfurt or the region you use), then give
  TBO those IPs. Simplest; no code change.
- **A small egress proxy** with a fixed IP (for example a tiny VM in the same region with a static address running a
  forward proxy), and point `TBO_AIR_BASE_URL`, `TBO_AIR_BOOKING_URL` and `TBO_AUTH_URL` at it. More to look after.
- Ask TBO whether they can **skip IP whitelisting on the test environment** while we certify; many accounts are open
  on test and locked only on live.

Whatever you choose, set `TBO_END_USER_IP` to the whitelisted IP (TBO wants it in every request). If it's unset the
server looks its own address up once (api.ipify.org), which is only right with a fixed egress IP.

## 3. Settings (Vercel → Mada Ops → Environment Variables)

Staging first. Required:

| Variable | Value |
|---|---|
| `SUPPLIER_MODE_FLIGHTS` | `tbo` |
| `TBO_AIR_BASE_URL` | the Air service base from TBO, e.g. test `http://api.tektravels.com/BookingEngineService_Air/AirService.svc/rest` (check against their documents) |
| `TBO_CLIENT_ID`, `TBO_USERNAME`, `TBO_PASSWORD` | from TBO (the API user) |
| `TBO_END_USER_IP` | your whitelisted egress IP |
| `TBO_ENV` | `test` (default) or `live` |

Optional: `TBO_AUTH_URL` (default: TBO's test or live Authenticate URL for `TBO_ENV`), `TBO_AIR_BOOKING_URL` (Book,
Ticket and GetBookingDetails, when TBO gives a separate booking host), `TBO_AIR_MARKUP_BPS` (Mada's margin on top of
the published fare, default 0: the commission TBO pays is already Mada's), `TBO_ADDRESS_LINE`, `TBO_ADDRESS_CITY`,
`TBO_CONTACT_EMAIL` (the address and email on bookings), `APP_FX_RATES` (if your TBO wallet isn't in SAR).

Guards built in: a production deployment refuses to book on `TBO_ENV=test` (test tickets aren't real), and a staging
deployment refuses to book on `TBO_ENV=live` unless `TBO_ALLOW_LIVE_BOOKING_OUTSIDE_PRODUCTION=yes`. Searching is
always allowed. A missing key answers `NOT_CONFIGURED` and searches fall back to the desk; nothing crashes.

## 4. Certification (TBO's usual process)

TBO signs off before giving live access. Their published list (dealint.tboair.com/APIDocument/Certification.aspx):

1. LCC, 2 adults, one way non-stop
2. LCC, 2 adults + 1 child + 1 infant, one way non-stop
3. LCC, 1 adult + 1 child + 1 infant, return, one stop
4. LCC, 1 adult + 1 child + 1 infant, one way one stop, with extra baggage and meal
5. LCC, 2 adults + 1 child + 1 infant, return one stop, with extra baggage and meal
6. Non-LCC, 2 adults, one way non-stop
7. Non-LCC, 2 adults + 1 child + 1 infant, one way one stop, with meal
8. Non-LCC, 3 adults, return non-stop
9. Non-LCC, 2 adults + 1 child + 1 infant, return one stop, with meal
10. Price and schedule change handling in Book and Ticket (non-LCC)
11. "In progress" ticketing handled with GetBookingDetails, never a duplicate booking

For each: the JSON request and response of every call, and the PNR and ticket numbers, sent separately. Turnaround is
4–5 working days; then a production KYC form and one live non-LCC hold to check the set-up. Our side: the desk runs
each case on staging from the order page (Confirm and hold with TBO → Ticket now), and we export the request/response
logs. Paid extra baggage and meals on low-cost airlines (cases 4 and 5) aren't sold in the app yet: the desk adds them
in TBO for the certification run, or we build the SSR step first if TBO insists.

## 5. Switching staging to live search

1. Set the variables in §3 on **staging** with the TBO **test** keys, and `APP_FLIGHTS_MODE=live`.
2. Redeploy. The launch checks (`npm run app:preflight`) warn if a TBO key is missing or production is on TBO's test environment.
3. Search RUH→IST in the app: options come from TBO with TBO's fares per adult, child and baby.
4. Book one: on the desk's order page the **TBO** card shows **Confirm and hold with TBO**, then **Ticket now**.
5. To go back to the desk at any time: `APP_FLIGHTS_MODE=request` (Ask sends requests again; nothing else changes).

Production: live keys, `TBO_ENV=live`, the whitelisted IP, then `APP_FLIGHTS_MODE=live` once certified.

## 6. How it behaves

- **Search**: fares at TBO's published price per passenger type, converted to riyals and rounded up to a riyal each,
  bags, seats left (only when TBO says), and best / lowest / earliest / fastest picks. If TBO doesn't answer for a
  route, that search goes to the desk as a request.
- **Price check before paying**: FareQuote and the fare rules, again; the app's "the price moved" flow shows a rise. A
  search older than 14 minutes (TBO's TraceId lasts 15) is redone and the same flights found by number and time.
- **Hold** (desk): full-service airlines are held with Book (a PNR and a last day to ticket); low-cost airlines can't
  be held, so the fare is confirmed and the desk tickets straight away. Child meals and seat preferences go with a
  full-service booking; anything TBO doesn't carry (a bassinet; meals and seats on low-cost airlines) is listed on the
  card for the desk to add with the airline.
- **Ticket now** (desk, issuing right): Ticket at TBO, then the card is captured and the trip written with the PNR,
  every traveller's ticket number and the airline's change and refund fees.
- **Never twice**: every hold and ticket request is written on the order before it's sent; a retry, a second click
  or a lost answer looks the booking up at TBO instead of booking or ticketing again.
- **Outcomes**: fare rose → the traveller sees the new price and takes it or stops; sold out → the order closes,
  nothing charged; tickets refused → "tickets didn't issue", card hold released, the traveller can ask Mada to try by
  phone; times changed or TBO still working → stays with the desk (Check with TBO). If the card can't be captured
  after TBO issued, the card says so: **void the tickets at TBO the same day**.
- **Cancel**: before ticketing the hold is released (ReleasePNRRequest); after, a refund request (SendChangeRequest)
  and the airline's rules decide the amount. Not on a desk button yet: ask us to wire it to the refunds page.

## 7. Confirmed vs assumed

Read 19 Oct 2026 from TBO's public API pages (dealint.tboair.com/APIDocument: API guide, Pathway, Authentication,
Search, FareQuote, Book, Ticket, GetBookingDetails, SendChangeRequest, FAQ, Certification). Details in the header of
`tbo-air.ts`.

| Confirmed by TBO's pages | Assumed (check on the first test call) |
|---|---|
| Method order Authenticate → Search → FareRule → FareQuote → (SSR) → Book (non-LCC only) → Ticket → GetBookingDetails; ReleasePNRRequest and SendChangeRequest to cancel | Exact URLs and hosts (two API generations on TBO's pages) |
| One token a day, sent with EndUserIp on every call; TraceId valid 15 minutes | Authenticate body `{ ClientId, UserName, Password, EndUserIp }` → `{ Status, TokenId }`; an expired token answers ErrorCode 6 / ResponseStatus 4 |
| PassengerType 1/2/3, JourneyType 1/2, cabin codes, ResponseStatus and TicketStatus codes | Answers wrapped in `Response`; Search `Results` and `Segments` as one array per direction; Book/Ticket details under `Response.Response` |
| LCC ticketed straight away with passengers; non-LCC held with Book, ticketed by PNR + BookingId; SSR in Ticket for LCC, Book for non-LCC; no bag/seat SSR for infants | Passenger field names (`PaxType`, `Gender` 1/2, `ContactNo`, `Meal`/`Seat` objects, empty `Baggage`/`MealDynamic`/`SeatDynamic` arrays) |
| FareBreakdown per passenger type for PassengerCount people; PublishedFare and OfferedFare formulas | OtherCharges shared equally between passengers in the Book/Ticket fare |
| IsPriceChanged / IsTimeChanged at Book and Ticket; IsPriceChangeAccepted on a re-sent non-LCC Ticket; InProgress → GetBookingDetails, no duplicates | GetBookingDetails by TraceId + lead name when no BookingId came back; ticket numbers of 10 digits with the airline's 3 in front |
| Certification cases 1–11, IP whitelisting after sign-off, wallet debited at ticketing | SendChangeRequest RequestType 1 / CancellationType 3; the token's day ending at midnight India time; fees read from free-text fare rules |
