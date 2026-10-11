import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appOffers } from "@/db/app-schema-booking";
import { appHotelbedsHotels } from "@/db/app-schema-hotelbeds";
import { decodeOfferId, parseRateKey, HB_PLACES, type HbContentHotel, type HotelbedsHotels } from "./hotels";
import { hotelbedsHotels, hotelVendor } from "./app";

/*
 * Hotel content from the Hotelbeds Content API, kept in our database (app_hotelbeds_hotels). Hotelbeds asks partners to
 * load content in batch, store it, refresh it at least weekly (daily recommended, with lastUpdateTime) and never call the
 * Content API on a traveller's request; hotels missing from the store are fetched by code. Certification §5.
 *
 *   refreshHotelContent()   1. hotels seen in our offers this week but not stored yet (by code, 100 a call)
 *                           2. what changed since the last run (lastUpdateTime), for the destinations we sell
 *                           3. facility names (types/facilities), so the app can say "Wi-Fi", not "70/70"
 * Run daily: Vercel Cron → GET /api/cron/hotelbeds (lib/app/jobs.ts, platform/vercel.json).
 */

type Facility = { code: number; group: number; name: string | null; paid: boolean };

const facilityNames = new Map<string, string>();

function rowOf(h: HbContentHotel) {
  const images = [...(h.images ?? [])].sort((a, b) => (a.visualOrder ?? a.order ?? 0) - (b.visualOrder ?? b.order ?? 0)).map((i) => ({ path: i.path, type: i.imageTypeCode ?? null }));
  const facilities: Facility[] = (h.facilities ?? []).filter((f) => f.indLogic !== false && f.indYesOrNo !== false).map((f) => ({
    code: f.facilityCode, group: f.facilityGroupCode, name: facilityNames.get(`${f.facilityCode}|${f.facilityGroupCode}`) ?? null,
    paid: !!(f as { indFee?: boolean }).indFee,
  }));
  const phone = h.phones?.find((p) => p.phoneType === "PHONEHOTEL")?.phoneNumber ?? h.phones?.[0]?.phoneNumber ?? null;
  return {
    code: h.code, name: h.name?.content?.trim() || `Hotel ${h.code}`, category: h.categoryCode ?? null, destinationCode: h.destinationCode ?? null, zoneCode: h.zoneCode ?? null,
    address: h.address?.content?.trim() ?? null, postalCode: h.postalCode ?? null, city: h.city?.content ?? null,
    latitude: h.coordinates?.latitude ?? null, longitude: h.coordinates?.longitude ?? null, phone, description: h.description?.content?.trim() ?? null,
    images, facilities, lastUpdate: h.lastUpdate ?? null, fetchedAt: new Date(),
  };
}

async function store(hotels: HbContentHotel[]) {
  for (const h of hotels) {
    const r = rowOf(h);
    await db.insert(appHotelbedsHotels).values(r).onConflictDoUpdate({ target: appHotelbedsHotels.code, set: { ...r, code: undefined } as never });
  }
  return hotels.length;
}

async function loadFacilityNames(api: HotelbedsHotels) {
  if (facilityNames.size) return;
  try {
    const r = await api.client.request<{ facilities?: { code: number; facilityGroupCode: number; description?: { content?: string } }[] }>({
      method: "GET", path: "/hotel-content-api/1.0/types/facilities", query: { fields: "all", language: "ENG", from: 1, to: 1000, useSecondaryLanguage: false },
    });
    for (const f of r.facilities ?? []) if (f.description?.content) facilityNames.set(`${f.code}|${f.facilityGroupCode}`, f.description.content);
  } catch { /* names are a nicety: codes still stored */ }
}

/** Hotel codes in our offers of the last 7 days that the store doesn't have. */
async function missingCodes(): Promise<number[]> {
  const rows = await db.select({ id: appOffers.supplierOfferId }).from(appOffers)
    .where(and(eq(appOffers.supplier, "hotelbeds"), eq(appOffers.kind, "stay"), gte(appOffers.createdAt, new Date(Date.now() - 7 * 86_400_000)))).orderBy(desc(appOffers.createdAt)).limit(2000);
  const codes = new Set<number>();
  for (const r of rows) { const d = decodeOfferId(r.id); const k = d ? parseRateKey(d.rateKey) : null; if (k) codes.add(k.hotelCode); }
  if (!codes.size) return [];
  const have = await db.select({ code: appHotelbedsHotels.code }).from(appHotelbedsHotels).where(inArray(appHotelbedsHotels.code, [...codes]));
  const known = new Set(have.map((h) => h.code));
  return [...codes].filter((c) => !known.has(c));
}

export type ContentRun = { missing: number; changed: number; calls: number; since: string | null };

export async function refreshHotelContent(opts: { api?: HotelbedsHotels; maxCalls?: number } = {}): Promise<ContentRun> {
  const api = opts.api ?? hotelbedsHotels();
  const maxCalls = opts.maxCalls ?? 40; // the evaluation keys allow 50 calls a day
  let calls = 0, missing = 0, changed = 0;
  await loadFacilityNames(api); calls += 1;
  const todo = await missingCodes();
  for (let i = 0; i < todo.length && calls < maxCalls; i += 100) {
    const batch = todo.slice(i, i + 100);
    const r = await api.content({ codes: batch, from: 1, to: batch.length });
    calls += 1;
    missing += await store(r.hotels ?? []);
  }
  // Changes since the last run, a day of overlap; first run: nothing to compare against, the by-code pass fills it.
  const [last] = await db.select({ at: sql<Date>`max(${appHotelbedsHotels.fetchedAt})` }).from(appHotelbedsHotels);
  const since = last?.at ? new Date(new Date(last.at).getTime() - 86_400_000).toISOString().slice(0, 10) : null;
  if (since) {
    const destinations = new Set(Object.values(HB_PLACES).map((p) => p.code).filter(Boolean));
    for (let from = 1; calls < maxCalls; from += 1000) {
      const r = await api.content({ from, to: from + 999, lastUpdateTime: since });
      calls += 1;
      const ours = (r.hotels ?? []).filter((h) => !h.destinationCode || destinations.has(h.destinationCode));
      changed += await store(ours);
      if (!r.total || from + 999 >= r.total) break;
    }
  }
  return { missing, changed, calls, since };
}

/** One hotel's stored content for the app's hotel details (never a live call). */
export async function hotelContent(code: number) {
  const [h] = await db.select().from(appHotelbedsHotels).where(eq(appHotelbedsHotels.code, code));
  return h ?? null;
}

/** The daily job: only when stays come from Hotelbeds (real keys); nothing to do on the catalogue or the fixtures. */
export async function hotelbedsContentJob(): Promise<Record<string, number>> {
  if (hotelVendor() !== "hotelbeds") return { skipped: 1 };
  const r = await refreshHotelContent();
  return { missing: r.missing, changed: r.changed, calls: r.calls };
}
