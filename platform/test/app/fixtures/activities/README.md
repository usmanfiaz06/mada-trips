Answers for test/app/activities.test.ts. The sandbox's network is restricted (Overpass resets the connection and
Wikimedia rate-limits shared IPs), so only `open-meteo-riyadh.json` is a live recording (2026-10-11). The others are
hand-made in each API's documented answer shape, trimmed to what our parsers read, with made-up ids:

- `overpass-alula.json`: Overpass API `[out:json]` with `out center tags` (nodes have lat/lon, ways and relations a center).
- `wikidata.json`: `wbgetentities` with labels, descriptions, sitelinks and claims (P18).
- `pageviews.json`: Wikimedia REST `metrics/pageviews/per-article/…/monthly`.
- `commons.json`: Commons `prop=imageinfo&iiprop=url|size|extmetadata`.
- `ticketmaster.json`: Discovery API v2 `events.json`.
- `hotelbeds-availability.json`, `hotelbeds-detail.json`, `hotelbeds-booking.json`: Hotelbeds Activities API 3.0
  (fields from developer.hotelbeds.com; image and duration shapes are assumptions, see suppliers/hotelbeds/activities.ts).
