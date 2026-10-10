# Places: every city in the world

Mada covers the world. Any city can be searched, opened and planned. Cities we sell in the app (flights and rooms on
screen) go to Ask; every other city becomes a "Plan it with Mada" request that the desk plans by hand, and the
traveller's chat opens with their message already in it.

## Files

| File | What it does |
|---|---|
| `curated.ts` | Our own cities: GeoNames id, slug, photo key, booking key, whether we sell it, main airport, extra search names |
| `sources.ts` | Parses GeoNames and OurAirports, links airports to cities, builds the names search matches. Pure, no database |
| `ingest.ts` | Downloads the files once, loads everything in one transaction. Idempotent |
| `search.ts` | Typeahead (`searchPlaces`), lookup by id or name (`findPlace`), Popular |
| `wiki.ts` | Wikipedia summary, Commons image licence, Wikidata → Wikivoyage, Wikivoyage sections, attribution |
| `guide.ts` | Assembles the city guide, caches it for 30 days, refreshes it in the background |
| `plan.ts` | `POST /places/:id/plan`: a `destination` request for the desk, plus the first chat message |
| `scripts/places/ingest.ts` | `npx tsx scripts/places/ingest.ts --download` (also `--dry-run`, `--dir`, `--no-alt-names`) |
| `scripts/places/export-bundles.ts` | Offline city lists for the prototype (`docs/app/prototype-app/src/data/cities.json`) and the app's mock mode |

Tables (`src/db/app-schema-places.ts`, `drizzle/pending/places.sql`): `app_place_countries`, `app_places`,
`app_place_names` (one row per searchable name, trigram-indexed), `app_place_airports`, `app_place_guides` (cache),
`app_place_plans` (which cities people ask us to plan). The SQL enables `pg_trgm` and `unaccent` and defines
`app_places_norm()`, an IMMUTABLE wrapper over `unaccent` for indexes. Supabase has both extensions; if they live in
another schema than `public`, adjust the wrapper.

## Endpoints (signed in)

- `GET /places/search?q=` → up to 8 cities. Prefix first, then words inside names ("heathrow"), then typos (trigram),
  across English, other Latin spellings, Arabic names, airport names and codes ("IST"), country → capital ("Japan").
  Ranked by how well the name matched + size + whether we sell it / know it. No match → up to 3 `suggestions`.
- `GET /places/:id` → the city guide. `:id` is a GeoNames id or a name ("tbilisi", "mecca").
- `POST /places/:id/plan` → 201 `{ request, message }`. Idempotent with `clientId`.
- `GET /places/popular?from=RUH` → our cities in our order (not the one you're in), then the most-asked cities.

## Data sources and licences

| Source | Used for | Licence | What we must do |
|---|---|---|---|
| [GeoNames](https://www.geonames.org/) `cities15000`, `countryInfo`, `admin1CodesASCII`, `alternateNamesV2` | Cities, countries, currencies, regions, time zones, Arabic names, Wikipedia links | CC BY 4.0 | Credit "Places from GeoNames, CC BY 4.0" with a link (every guide carries it in `attributions`) |
| [OurAirports](https://ourairports.com/data/) `airports.csv` | Airports, IATA codes, distances | Public domain | Nothing required; we credit it anyway |
| [Wikipedia](https://en.wikipedia.org/) REST page summary | The city's lead paragraph, the lead image's file name, the Wikidata id | CC BY-SA 4.0 | Show "From Wikipedia, CC BY-SA" with a link; text shown **unmodified** |
| [Wikimedia Commons](https://commons.wikimedia.org/) imageinfo | The photo, its author and licence | Per file (CC BY, CC BY-SA, CC0, PD) | Only free licences are used (others are dropped); show "Photo: author, licence" linking to the file page. Files on English Wikipedia itself (often fair use) are never used |
| [Wikidata](https://www.wikidata.org/) | Finding the matching Wikivoyage article (London, Ontario never gets London's guide) | CC0 | Nothing required |
| [Wikivoyage](https://en.wikivoyage.org/) extracts | Understand, Get in, See, Do, Eat, Stay safe | CC BY-SA 4.0 | Show "From Wikivoyage, CC BY-SA" with a link beside every extract. Extracts are cut at a sentence end and marked "Shortened from the original"; they are never reworded. Listings (addresses, phones) are skipped. Share-alike: if we ever edit the text, the edit is CC BY-SA too |
| OpenStreetMap Overpass (not used yet) | Points of interest, later | ODbL | Credit "© OpenStreetMap contributors"; share-alike on derived databases |

Never scraped: only open dumps and the documented public APIs above. Every request sends
`User-Agent: MadaTrips-Places/1.0 (+https://madatrips.sa; <PLACES_CONTACT>)` (set `PLACES_CONTACT` to a monitored
address), waits at most 5 seconds, and is cached: a guide is fetched once per city per 30 days.

## Rules

- **Never invent a fact.** A section a source didn't give is left out. No best months, no halal notes, no prices unless a
  source or the desk provides them. The weather card is a placeholder until a forecast exists.
- **Caching.** Fresh for 30 days; then served stale while one background refresh runs (claimed with `refreshing_at`, so
  only one runs). A source that didn't answer (429, timeout) is retried after a day; nothing at all, after 6 hours. A
  failed refresh never replaces a good guide with an emptier one.
- **Curation levels** (never shown as words): `curated` (ours), `guide` (Wikivoyage had at least two sections; set
  automatically, never lowered by re-ingestion), `basic`.
- **Requests.** A plan is an `app_requests` row with `kind = 'destination'` and `details.place` (`id, name, country,
  airports, guideUrl`) that the desk's inbox reads (`desk/adapters.ts destinationOf`), shaped like an Ask request
  (`details.source = 'ask'`) so Trips → Requests and the request thread show it. The message is the first entry in the
  request's thread.

## Refreshing the data

```bash
cd platform
DATABASE_URL=… npx tsx scripts/places/ingest.ts --download     # ~30 s after download; 34k cities, 3.3k airports
npx tsx scripts/places/export-bundles.ts --dir .cache/places    # prototype + mock city lists
```
