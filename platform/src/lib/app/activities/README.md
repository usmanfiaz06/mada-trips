# Things to do

Real, current things to do for any city, from sources we are allowed to use. Nothing is scraped: GetYourGuide,
Viator, Klook, Webook, Platinumlist, TripAdvisor and Google forbid it in their terms, so they are only used through
their partner APIs (or not at all).

## What the app shows, and where it comes from

| Part | Source | How | Licence / terms | What we must do |
|---|---|---|---|---|
| Places worth a visit (museums, galleries, viewpoints, theme parks, zoos, aquariums, water parks, historic sites, notable parks and mosques), opening hours, Arabic names | **OpenStreetMap** via the **Overpass API** | `opendata.ts` (`overpassQuery`, `parseOverpass`), loaded per city by `ingest.ts`, refreshed every 30 days | **ODbL 1.0** | Show "© OpenStreetMap contributors" with a link to openstreetmap.org/copyright wherever the data shows (every list and sheet carries it in `attributions`). Our table is a derived database: if we ever publish it, it is ODbL too |
| Descriptions (en, ar), the photo's file name, how many Wikipedias have it | **Wikidata** `wbgetentities` | `parseWikidata` | **CC0** | Nothing required; credited anyway |
| How popular it is | **Wikipedia pageviews** (Wikimedia REST API, last two full months) + Wikidata sitelinks | `fetchPageviews`, `rawScore`, `popularityOf` | Wikimedia API terms (CC BY-SA content) | Name us in the User-Agent; stay within rate limits (we call it at most 40 times per city per month) |
| Photos | **Wikimedia Commons** imageinfo | `places/wiki.ts commonsImage` | Per file; free licences only (CC BY, CC BY-SA, CC0, PD) | "Photo: author, licence" with a link to the file page, on the photo |
| City guide extracts ("See", "Do") | **Wikivoyage** | `places/wiki.ts` (already on the city page) | CC BY-SA 4.0 | "From Wikivoyage, CC BY-SA" beside each extract |
| Today's weather | **Open-Meteo** forecast API (no key) | `weather.ts`, cached 1 hour per city | CC BY 4.0 | "Weather data by Open-Meteo.com" (in `attributions`) |
| Prayer times | Worked out on the server and phone (Umm al-Qura: Fajr 18.5°, Isha 90 min after Maghrib) | `prayerTimes`, `nextPrayer` in `@mada/shared` | — | — |
| Events (outside Saudi Arabia) | **Ticketmaster Discovery API v2** (`TICKETMASTER_KEY`) | `ticketmaster.ts`, cached 6 hours per city | Ticketmaster API terms of use | "Events from Ticketmaster"; the event's page is shown as its source |
| Saudi events | **The desk's "What's on" list** (Ops → Desk → What's on) | `desk/whats-on.ts`, table `app_whats_on` | Ours; each photo needs a credit | — |
| Tours and tickets ("Book with Mada") | **Hotelbeds Activities** (primary), **GetYourGuide** and **Viator** (optional) | `suppliers/hotelbeds/activities.ts`, `suppliers/live/getyourguide.ts`, `suppliers/live/viator.ts` | Partner agreements | Never send people to the partner's site: the beta books through the desk |
| Hotel → point, for "near the hotel" | **Nominatim** (OpenStreetMap) | `trips.ts geocode`, cached for good in `app_geocodes` | ODbL; Nominatim usage policy (≤ 1 request/second, a real User-Agent) | Credit OSM |

## Partner APIs: confirmed vs assumed

**Hotelbeds Activities API 3.0** (developer.hotelbeds.com, Activities → Booking API; test host `api.test.hotelbeds.com`, live `api.hotelbeds.com`):
- Confirmed from the public docs: auth headers `Api-key` + `X-Signature` = hex SHA-256 of apiKey + secret + Unix seconds;
  `POST /activity-api/3.0/activities/availability` (filters → searchFilterItems with type `destination`, from, to,
  language, paxes [{age}], pagination, order); `POST /activity-api/3.0/activities/details` and `/details/full`
  (code, from, to, language, paxes, optional modalityCode) answering `activity.modalities[].rates[].rateDetails[]` with
  `rateKey` (valid 30 minutes, usable once), `operationDates[].cancellationPolicies`, `paxAmounts`, `totalAmount`;
  `PUT /activity-api/3.0/bookings` (language, clientReference, holder {name, surname, email, country},
  activities [{rateKey, from, to, paxes [{age, name, surname, type}]}], adults before children) → `booking.reference`,
  `booking.status` (CONFIRMED | CANCELLED), `booking.total`; `DELETE /activity-api/3.0/bookings/{language}/{reference}?cancellationFlag=SIMULATION|CANCELLATION`.
  No shopping cart on their side.
- Assumed (check in the sandbox before certification): a `gps` searchFilterItem with latitude/longitude (seen in a public
  integration; set `HOTELBEDS_ACTIVITY_DESTINATIONS="108410=RUH,745044=IST"` to use the documented destination filter
  instead); photos at `content.media.images[].urls[] {sizeType, resource}`; `modalities[].duration {value, metric}`; the
  activity's `currency`; `minChildrenAge` on modalities; the cancel answer's amount field; the Content API paths
  (`/activity-content-api/3.0/...`, not used yet).

**GetYourGuide Partner API** (optional, `GYG_PARTNER_TOKEN`): confirmed from the open spec (github.com/getyourguide/partner-api-spec):
base `https://api.getyourguide.com`, versioned paths (`/1/…`), header `X-ACCESS-TOKEN`, `GET /1/tours` searching by query or
coordinates. Assumed: the query names (`cnt_language`, `currency`, `coordinates[]`, `limit`) and the answer's shape
(`data.tours[]` …). Access needs an approved partner account (the affiliate programme alone gives widgets).

**Viator Partner API v2** (optional, `VIATOR_API_KEY`, `VIATOR_ENV=sandbox` for the sandbox): confirmed from Viator's partner
docs: base `https://api.viator.com/partner` (sandbox `https://api.sandbox.viator.com/partner`), headers `exp-api-key`,
`Accept: application/json;version=2.0`, `Accept-Language`; `POST /products/search` and `POST /search/freetext`. Basic (free)
affiliate access covers search and content; booking endpoints need Full + Booking access. Assumed: the freetext body and
the product summary fields we read.

**Ticketmaster Discovery API v2** (`TICKETMASTER_KEY`, free from developer.ticketmaster.com, 5,000 calls a day): confirmed
`GET https://app.ticketmaster.com/discovery/v2/events.json` with `apikey`, `latlong`, `radius`, `unit`, `startDateTime`,
`endDateTime`, `size`, `sort`, `locale`; answer `_embedded.events[]`. Coverage is mostly North America, Europe, Australia,
the UAE; not Saudi Arabia.

## Endpoints (signed in)

- `GET /places/:id/things?near=&open=&family=&ages=&day=&kind=&limit=` → `ThingsResponse` (status `ready | gathering | none`).
  The first visit to a city we haven't loaded starts the load in the background ("gathering"; the app asks again).
- `GET /trips/:id/things?day=…` → the same for the trip's city, measured from the hotel, for the children going (ages
  from the household's birth years), on a trip day. Owner only.
- `POST /things/book` → 201 `{ request, message }`: a desk request (kind `activity`, askKind `todo`) carrying
  `details.activity` (supplier, code, Hotelbeds modality, day, everyone's ages). Idempotent by `clientId`.
- `GET|POST /trips/:id/ideas`, `DELETE /trips/:id/ideas/:ideaId`: "Add to my plan". Ideas show on the itinerary on their
  day (`buildItinerary({ planned })`), never in the calendar file.
- `GET /cron/activities` (Vercel Cron, `Authorization: Bearer CRON_SECRET`, daily at 02:17 UTC in `platform/vercel.json`):
  refreshes a few due cities. Also `npx tsx scripts/activities/refresh.ts [--place 108410] [--limit 20]`.

## The desk

- Ops → Desk → **What's on**: add, edit, hide events (title and line in English and Arabic, dates, city, venue, time, photo
  link with its credit, the organiser's page, good for families). Shown in the app the same minute.
- Activity requests land in the inbox tagged **Activity**. The request page shows what they want, the supplier code and
  **Book on Hotelbeds** (a fresh rate key for the day and party, then confirm; the reference is kept on the request).
  Mock in mock mode; live only once Hotelbeds certifies the integration.

## Environment

| Variable | What |
|---|---|
| `SUPPLIER_MODE_ACTIVITIES` | `live` for Hotelbeds (+ GYG/Viator when their keys are set); mock otherwise |
| `HOTELBEDS_ACTIVITIES_API_KEY`, `HOTELBEDS_ACTIVITIES_SECRET`, `HOTELBEDS_ENV` | Hotelbeds Activities keys; `test` (sandbox) or `live` |
| `HOTELBEDS_ACTIVITY_DESTINATIONS` | Optional: our city id → Hotelbeds destination code |
| `APP_ACTIVITY_MARKUP_BPS` | Mada's margin on activities (default 1500 = 15%), on top of `APP_FX_RATES` + buffer |
| `GYG_PARTNER_TOKEN`, `VIATOR_API_KEY`, `VIATOR_ENV` | Optional partners |
| `TICKETMASTER_KEY` | Events outside Saudi Arabia |
| `SUPPLIER_MODE_EVENTS`, `SUPPLIER_MODE_WEATHER`, `SUPPLIER_MODE_OPEN_DATA` | Live by default (keyless); `mock` for offline development and tests |
| `OVERPASS_URL`, `OPEN_METEO_URL` | Optional mirrors |
| `CRON_SECRET` | Guards `/cron/activities` |
| `PLACES_CONTACT` | A monitored address for the User-Agent every open-data request sends |

## Tables (migrations 0022, 0023)

`app_activities` (per city, keyed by city and OSM id), `app_activity_cities` (load state and the weather/events/experiences
caches), `app_whats_on`, `app_trip_ideas`, `app_geocodes`.
