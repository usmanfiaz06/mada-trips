import { FxResponse } from "@mada/shared";
import { getRates } from "@/lib/app/fx";
import { json, route } from "@/lib/app/http";

// GET /api/app/v1/fx → { fx: { base: "SAR", date, rates: { AED, USD, EUR, GBP }, source, fetchedAt, stale } }.
// The display-currency table the app shows beside SAR amounts ("≈ AED 2,304 (rate of 16 Oct)"). Public, no secrets,
// cached for an hour at the edge; the platform itself asks the source once a day (lib/app/fx.ts).
export const dynamic = "force-dynamic";

export const GET = route(async () => json(FxResponse.parse({ fx: await getRates() }), 200, { "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" }), { ungated: true });
