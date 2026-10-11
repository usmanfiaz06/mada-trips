import { CITY_CENTRES, DESTINATIONS, GeocodeResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { geocode } from "@/lib/app/activities/trips";

// GET /geocode?q=Dubai Hills Mall&city=dubai → { point } for "Distance from: a place I type". OpenStreetMap Nominatim
// through the cached geocoder (one request a second at most, each query once); a point far from the city is dropped.
export const dynamic = "force-dynamic";

export const GET = bookingRoute(async (req) => {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 120);
  const city = (u.searchParams.get("city") ?? "").trim().toLowerCase();
  if (q.length < 2) throw new AppError("VALIDATION", { fields: { q: "Type a place or an address" } });
  const name = DESTINATIONS[city]?.name ?? "";
  const p = await geocode(name && !q.toLowerCase().includes(name.toLowerCase()) ? `${q}, ${name}` : q, (url, init) => fetch(url, init)).catch(() => null);
  const centre = CITY_CENTRES[city];
  const near = p && (!centre || Math.abs(p.lat - centre.lat) < 1 && Math.abs(p.lon - centre.lng) < 1);
  return json(GeocodeResponse.parse({ point: p && near ? { lat: p.lat, lng: p.lon, name: q } : null }));
});
