# Staging: a copy of the platform and the app on Vercel

Two Vercel projects in the team, both built from the staging branch (`claude/nice-pasteur-qmk758` today):

| Project | Serves | URL |
|---|---|---|
| `mada-staging` | `platform/`: Mada Ops at `/adminwork`, the Core API at `/api/app/v1`, the website | https://mada-staging.vercel.app (later `staging.madatrips.sa`) |
| `mada-app-staging` | `apps/mobile` web export (`expo export --platform web`), live mode | https://mada-app-staging.vercel.app |

The app talks to the API on its **own origin**: `apps/mobile/vercel.json` rewrites `/api/*` to `mada-staging.vercel.app`
(no CORS, same as `test/e2e-web.mjs` does locally). When `staging.madatrips.sa` exists, point that rewrite at it.

## How it stays a staging copy

- The staging branch is each project's **production branch**, so the URL is stable, crons run (`platform/vercel.json`)
  and `vercel-build` runs the migrations and the first-time bootstrap on every deploy, against `DATABASE_URL` =
  **the staging database only**. The production project (`mada-trips`) and its variables are never touched.
- `APP_ENV=staging` makes the code treat it as **not production** even on Vercel's production target
  (`isProductionDeploy()` in `platform/src/lib/app/config.ts`): mocks are allowed (SMS codes are `123456`), the
  Hotelbeds **test** keys book (`HOTELBEDS_ENV=test`), stays default to `live` (booked automatically on the test
  environment, the certification path in [HOTELBEDS.md](HOTELBEDS.md)), the mock desk confirms orders by itself.
- Vercel Authentication stays on for preview URLs only; the production `*.vercel.app` URL is open for testers.
  Builds run for the staging branch only (the project's "ignored build step" skips every other branch).

## Set it up (one command)

Needs a Vercel token for a team **Owner or Member** (a token limited to one project is refused with
`You don't have permission to create the project`), and these in the shell: `VERCEL_TOKEN`, `VERCEL_TEAM`
(slug or dashboard URL), `STAGING_DATABASE_URL` (+ `STAGING_DIRECT_URL` for a pooler), `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, the six Hotelbeds test keys,
`AERODATABOX_API_KEY` (+ `AERODATABOX_MARKET`), `AVIATIONSTACK_API_KEY`, `ADSB_CONTACT`, `PLACES_CONTACT`.
`CRON_SECRET`, `APP_JWT_SECRET`, `APP_DATA_KEY`, `APP_OTP_PEPPER` and `STAGING_SEED_PASSWORD` are generated when missing.

```bash
node tools/staging/vercel-staging.mjs --dry-run     # what it would create and set
node tools/staging/vercel-staging.mjs               # create/update both projects, set env, deploy, print the URLs
```

What it sets on `mada-staging`: `APP_ENV=staging`, `APP_STAYS_MODE=live`, `APP_ALLOW_MOCKS=yes`,
`SUPPLIER_MODE_HOTELS=hotelbeds`, `SUPPLIER_MODE_TRANSFERS=hotelbeds`, `SUPPLIER_MODE_ACTIVITIES=hotelbeds`, `SUPPLIER_MODE_SUPABASE=live`,
`SUPPLIER_MODE_FLIGHT_STATUS=aerodatabox`, `HOTELBEDS_ENV=test`, `HOTELBEDS_MAX_RESULTS=200`, the keys above,
`DATABASE_URL` (= the staging database), `APP_PUBLIC_URL`, `APP_LINK_BASE_URL=https://mada-staging.vercel.app` (invite links
read `https://mada-staging.vercel.app/join/<code>`, which this project serves; without it a staging copy falls back to
`APP_PUBLIC_URL`, never to madatrips.sa), `APP_BOOKING_REQUIRES_PHONE=no` (email-only testers may book). On `mada-app-staging`: `EXPO_PUBLIC_API_MODE=live`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_DEMO_HINTS=yes`.
Re-running is safe: it updates settings and upserts values.

## Database and data

```bash
cd platform
export DATABASE_URL="$STAGING_DATABASE_URL"            # never the production database
npm run db:migrate                                     # also runs on every mada-staging deploy
npx tsx scripts/places/ingest.ts --download            # cities, airports, names (GeoNames, OurAirports); ~1 min
# Things to do (OpenStreetMap + Wikidata + Wikipedia), one city at a time:
PLACES_CONTACT=ops@example.com npx tsx --conditions=react-server scripts/activities/refresh.ts --place 108410   # Riyadh
#   105343 Jeddah · 745044 Istanbul · 292223 Dubai
```

`refresh.ts` reads `OVERPASS_URL` (default `https://overpass-api.de/api/interpreter`). From a network where that host
is blocked, `https://overpass.openstreetmap.fr/api/interpreter` answers (slowly, 40–50 s a city);
`overpass.kumi.systems` returned `500 Internal Server Error` to the real query on 11 Oct 2026.

## Checks

```bash
curl -s https://mada-staging.vercel.app/api/app/v1/health
curl -s https://mada-staging.vercel.app/api/app/v1/status | jq .launch
npm --prefix platform run hotelbeds:smoke              # test keys from the shell; 12 steps, every booking cancelled
curl -s -H "Authorization: Bearer $CRON_SECRET" https://mada-staging.vercel.app/api/cron/flights
```

Sign in to Mada Ops at `/adminwork` as `abdulaziz@madatrips.com` with `STAGING_SEED_PASSWORD` (the bootstrap creates
the three partners on the first deploy). In the app, any phone number signs in with code **123456** (SMS is mock).
