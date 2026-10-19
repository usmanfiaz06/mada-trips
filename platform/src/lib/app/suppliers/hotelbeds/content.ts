import "server-only";
import { and, desc, eq, getTableColumns, gte, inArray, sql } from "drizzle-orm";
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
 * Run hourly (new hotels from searches; what changed only in the 03:xx UTC run): Vercel Cron → GET /api/cron/hotelbeds
 * (lib/app/jobs.ts, platform/vercel.json). Hours with nothing new make no call to Hotelbeds.
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

/** One upsert per batch (was one per hotel: 100 round trips to a far-away database, so a run could time out). */
async function store(hotels: HbContentHotel[]) {
  const rows = [...new Map(hotels.map((h) => [h.code, rowOf(h)])).values()];
  if (!rows.length) return 0;
  // Every column rowOf writes, from the incoming row (excluded.<column>).
  const columns = getTableColumns(appHotelbedsHotels) as Record<string, { name: string }>;
  const set = Object.fromEntries(Object.keys(rows[0]!).filter((k) => k !== "code").map((k) => [k, sql.raw(`excluded."${columns[k]!.name}"`)]));
  await db.insert(appHotelbedsHotels).values(rows).onConflictDoUpdate({ target: appHotelbedsHotels.code, set });
  return rows.length;
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

export async function refreshHotelContent(opts: { api?: HotelbedsHotels; maxCalls?: number; changes?: boolean } = {}): Promise<ContentRun> {
  const api = opts.api ?? hotelbedsHotels();
  const maxCalls = opts.maxCalls ?? 40; // the evaluation keys allow 50 calls a day
  let calls = 0, missing = 0, changed = 0;
  const todo = await missingCodes();
  const changes = opts.changes ?? true;
  // Nothing new and not the daily pass: no call to Hotelbeds at all (the job runs hourly).
  if (!todo.length && !changes) return { missing: 0, changed: 0, calls: 0, since: null };
  if (!facilityNames.size) { await loadFacilityNames(api); calls += 1; }
  for (let i = 0; i < todo.length && calls < maxCalls; i += 100) {
    const batch = todo.slice(i, i + 100);
    const r = await api.content({ codes: batch, from: 1, to: batch.length });
    calls += 1;
    missing += await store(r.hotels ?? []);
  }
  // Changes since the last run, a day of overlap; first run: nothing to compare against, the by-code pass fills it.
  const [last] = await db.select({ at: sql<Date>`max(${appHotelbedsHotels.fetchedAt})` }).from(appHotelbedsHotels);
  const since = last?.at ? new Date(new Date(last.at).getTime() - 86_400_000).toISOString().slice(0, 10) : null;
  if (since && changes) {
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

/*
 * Hotels seen in a search that the store doesn't hold yet. The hourly job (missingCodes) catches them within the hour,
 * but the first traveller to search would see them without a photo, a street address or amenities (on staging, 39 of
 * 200 London hotels). So they are fetched by code right then, in batches of 100 like the job does, stored, and used
 * for that same answer: one Content API call per 100 new hotels, never the same hotel twice in 6 hours per server
 * instance (a hotel Hotelbeds holds no content for isn't asked again and again), and within a short budget so the
 * traveller isn't kept waiting (what doesn't arrive in time is stored when it does, or by the job).
 */
const askedAt = new Map<number, number>();
const ASK_AGAIN_MS = 6 * 3600_000;

export async function fillContentNow(codes: number[], opts: { api?: HotelbedsHotels; budgetMs?: number; maxCodes?: number } = {}): Promise<number> {
  const now = Date.now();
  const todo = [...new Set(codes)].filter((c) => now - (askedAt.get(c) ?? 0) > ASK_AGAIN_MS).slice(0, opts.maxCodes ?? 300);
  if (!todo.length) return 0;
  for (const c of todo) askedAt.set(c, now);
  if (askedAt.size > 20_000) for (const [c, at] of askedAt) if (now - at > ASK_AGAIN_MS) askedAt.delete(c);
  const api = opts.api ?? hotelbedsHotels();
  const budget = { timeoutMs: opts.budgetMs ?? 3_500, retries: 0 };
  const batches: number[][] = [];
  for (let i = 0; i < todo.length; i += 100) batches.push(todo.slice(i, i + 100));
  const [, ...answers] = await Promise.all([
    loadFacilityNames(api),
    ...batches.map((batch) => api.content({ codes: batch, from: 1, to: batch.length }, budget).then((r) => r.hotels ?? [], () => [] as HbContentHotel[])),
  ]);
  try { return await store(answers.flat()); } catch { return 0; }
}
export const forgetContentAsks = () => askedAt.clear();

/** One hotel's stored content for the app's hotel details (never a live call). */
export async function hotelContent(code: number) {
  const [h] = await db.select().from(appHotelbedsHotels).where(eq(appHotelbedsHotels.code, code));
  return h ?? null;
}

/** The daily job: only when stays come from Hotelbeds (real keys); nothing to do on the catalogue or the fixtures. */
export async function hotelbedsContentJob(): Promise<Record<string, number>> {
  if (hotelVendor() !== "hotelbeds") return { skipped: 1 };
  // Hourly: hotels that showed up in searches since the last run get their photos and facts within the hour; what
  // changed at Hotelbeds is fetched once a day (03:xx UTC), as before.
  const r = await refreshHotelContent({ changes: new Date().getUTCHours() === 3 });
  return { missing: r.missing, changed: r.changed, calls: r.calls };
}
