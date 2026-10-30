# Supplier privacy: what the traveller never sees

The owner's rule: nobody looking at the app, its web bundle or its network traffic can tell which partners Mada books
with (hotel, flight, activity, eSIM, transfer, insurance, car hire, entry rules, flight status), how prices are fetched,
or what Mada pays (net cost, markup, margin, commission). A competitor found Bookme's supplier because its hotel pages
loaded photos straight from the supplier's image host; Mada's never do.

The desk (`/adminwork`) is internal and shows partners. What Mada pays and earns shows only to staff with finance rights
(`finance.view` or `desk.finance`, DESK-PLAN §4.3); support agents see the booking tools without the costs.

## How it holds

| Where | What | Code |
|---|---|---|
| Every JSON answer under `/api/app/v1` | Scrubbed on the way out: partner photo URLs become Mada image links, cost and partner fields are dropped (`supplier`, `net`, `netUsd`, `markup*`, `margin*`, `commission`, `rateKey`, `rateCommentsId`, `modality`, `supplierFee`, `supplierRef`…), partner ids are sealed, partner names in free text become "our partner" ("the Hotelbeds desk" becomes "the transfer desk") | `platform/src/lib/app/shield.ts` `scrubResponse`, applied in `http.ts` `resilient()` |
| Ask Mada's stream | The same scrub on every event; the sentence guard holds back any sentence naming a partner | `ask/chat/route.ts`, `ask-chat/guard.ts` `partnersIn` |
| Partner ids | Sealed into opaque ids (`m_…`, AES-GCM with a synthetic IV: stable, readable only by the server): hotel codes, eSIM package ids, experience ids. Request bodies are unsealed in `http.ts` `body()`; `/hotels/{id}` takes the sealed id only | `shield.ts` `seal` / `unseal` / `hotelCodeOf` |
| Offer ids | Already Mada UUIDs mapped to the partner's rate key on the server (`app_offers.supplier_offer_id`) | `booking/search.ts` |
| Partner photos | `GET /api/app/v1/img/{token}`: the token names one https URL on a partner host; fetched by the server without the caller's headers, image types only, 6 MB cap, 8 s timeout, cached (browser/CDN a day, s-maxage a week) | `image-proxy.ts`, `app/api/app/v1/img/[token]/route.ts` |
| `/status`, `/health` | Partner-named slots (klook, duffel, ratehawk, sherpa…) answer as the kind of service; the flight-status vendor as live/mock/none; launch problems stay in the logs | `shield.ts` `publicSlot(s)` |
| Flight status `source` | "Live" or "Schedule", never the vendor | `suppliers/live/aerodatabox.ts`, `aviationstack.ts`, `flight-status.ts` |
| The app's code | No partner names in strings or names; experiences, stays and eSIM plans carry no partner field; partner copy says "Mada's partners" | `apps/mobile/src`, `packages/shared/src` |
| Shared package | The eSIM price rules (net price, markup, the owner's margin rules) and the mock packages are server-only: `@mada/shared/internal`, never in the index the app bundles | `packages/shared/src/internal.ts` |
| Mock builds | The in-app mock API and its fixtures only ship in a mock build: a live build resolves `./mock-api` to an empty stub | `apps/mobile/metro.config.js`, `src/lib/mock-api.live.ts` |

## What stays visible because the contract says so

**Hotel vouchers (Hotelbeds certification §4.5):** the voucher document carries the payment statement "Payable through
HOTELBEDS PROFESSIONAL SERVICES, S.L.U, acting as agent for the service operating company, details of which can be
provided upon request. VAT: … Reference: …" and the booking reference the hotel looks the booking up by. That line
(`payableThrough`) is the one place a partner is named to a traveller: on the voucher screen, the printable voucher
(`/vouchers/{id}?format=html`) and the voucher's JSON. Nothing else on the voucher names them.

Owner, to confirm with HBX Group's certification team: the certification draft (HOTELBEDS.md §6 item 7) used to say
hotel pages and vouchers are "marked HBX Group". The app no longer shows that mark on the hotel page or as a tag on the
voucher (the payment statement above stays). If the certification requires the mark, it goes back on the voucher only.

## The check

`tools/leak-scan/denylist.mjs` lists partner names and hosts (tboholidays, hotelbeds, HBX Group, esimaccess, airalo,
aerodatabox, worldota, ratehawk, duffel, cartrawler, klook, sherpa, xcover, viator, getyourguide, giata…) and cost fields.
Three-letter names that are also airport codes (TBO, HBX, HBG) count only in lower case or as "HBX Group".

- `platform/test/app/supplier-leaks.test.ts`: the shield's pieces, the image route, the guard, and a sweep of the Core
  API's answers with the hotel partner's mock on (stays, rooms, offer, hotel page, things to do, eSIM plans, status,
  health, config). `hotelbeds.test.ts` scans the voucher too.
- `apps/mobile/test/unit/supplier-leaks.test.ts`: every string and name in the app's code and the shared package, the
  shared index's exports, and `dist/` when an export is there.
- `npm run export:web` (apps/mobile) ends with `npm run leak:scan` (`tools/leak-scan/scan.mjs dist --allow-mock`): the
  export fails on a finding. `--allow-mock` lets the mock API's own chunk keep the mock supplier's sample prices.

## Google Places (a source we credit, not a hidden partner)

Places in Ask (CONNECT.md §32) come from Google and the cards say so ("Google Maps", the photo's author), as Google's
terms require. What stays on the server: the API key (header only), the field masks, the photo media URLs (a card's
photo is `places.googleapis.com/v1/{photo}/media…` without any key; the scrub turns it into our `/img/{token}` link, and
the image route adds the key and fetches the image server to server). Google's place ids go to the app (they open the
details and are kept on plan items as `place.gid`): they are Google's public ids, not a partner's reference.
`platform/test/app/places-google.test.ts` checks a whole chat turn with the leak scan and that no key, mask or Google
host reaches the app.

## Cancel and refund in Ask

`refund_quote` (ASK-REFUND.md) reads the trip's own payments and rules: the model and the card get item titles, amounts,
the rule in words and the card label, never a supplier name, booking reference or net price.
`platform/test/app/ask-refund.test.ts` runs the tool's text and card through the denylist.

## Adding a partner

Add its image hosts to `PARTNER_IMAGE_HOSTS` and its name to `PARTNER_NAMES` (shield.ts) and `PARTNERS`
(denylist.mjs); give a keyed slot a kind in `SLOTS`; keep its ids, codes and references out of shared schemas (seal them,
or keep them in the server's own types like `SupplierExperience`).
