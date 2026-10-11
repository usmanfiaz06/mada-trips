import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import type { StayOption } from "@mada/shared";
import { t } from "@mada/shared";
import { db } from "@/db";
import { appHotelbedsHotels } from "@/db/app-schema-hotelbeds";
import { appOffers } from "@/db/app-schema-booking";
import { isProductionDeploy, supplierMode } from "../../config";
import { AppError } from "../../http";
import { callSupplier, supplierDown } from "../../resilience/breaker";
import type { BookingHotelOffer, BookingHotelSupplier } from "../booking-types";
import { HotelbedsClient, HotelbedsError, hotelbedsCredentials, hotelbedsEnv, type HotelbedsProduct } from "./client";
import { HotelbedsHotels, amenitiesOf, type FactsLookup, type HotelFacts } from "./hotels";
import { HotelbedsTransfers } from "./transfers";
import { mockHotelbedsHotels, mockHotelbedsTransfers } from "./mock";

/*
 * Hotelbeds inside the Core API: which adapter (mock or the real API), the circuit breaker, our content cache, and the
 * beta booking policy. docs/app/HOTELBEDS.md is the owner's guide.
 *
 *   SUPPLIER_MODE_HOTELS      mock (the prototype's catalogue) | hotelbeds (or live) | hotelbeds-mock (fixtures, for a staging demo)
 *   SUPPLIER_MODE_TRANSFERS   mock (fixtures) | hotelbeds (or live)
 *   APP_STAYS_MODE            request | live. request: a paid stay goes to the desk, who books it on Hotelbeds from the
 *                             order in one click. live: the stay is booked on Hotelbeds as soon as the desk picks the
 *                             order up. Default: live on staging, request everywhere else (production in the beta).
 */

/* ───────────── where we are ───────────── */

export const isStaging = () => process.env.APP_ENV === "staging" || process.env.VERCEL_ENV === "preview";

export type StaysMode = "request" | "live";

/**
 * Whether a real Hotelbeds booking may be made here. The test environment never takes a booking for a real traveller
 * on a production deployment (it would be a booking that doesn't exist); the live environment only on production.
 */
export function hotelbedsBookingAllowed(product: HotelbedsProduct): { ok: true } | { ok: false; why: string } {
  const env = hotelbedsEnv();
  if (supplierModeOf(product) === "mock") return { ok: true }; // fixtures: nothing leaves the server
  if (env === "test" && isProductionDeploy()) return { ok: false, why: "HOTELBEDS_ENV=test on a production deployment: test bookings aren't real. Swap in the live keys after certification." };
  if (env === "live" && !isProductionDeploy() && process.env.HOTELBEDS_ALLOW_LIVE_OUTSIDE_PRODUCTION !== "yes") return { ok: false, why: "Live Hotelbeds keys outside production. Use the test keys here." };
  return { ok: true };
}

export function staysMode(): StaysMode {
  const raw = process.env.APP_STAYS_MODE?.toLowerCase();
  const wanted: StaysMode = raw === "live" ? "live" : raw === "request" ? "request" : isStaging() ? "live" : "request";
  if (wanted === "live" && !hotelbedsBookingAllowed("hotels").ok) return "request";
  return wanted;
}

function supplierModeOf(product: HotelbedsProduct): "mock" | "live" {
  if (product === "hotels") {
    const raw = process.env.SUPPLIER_MODE_HOTELS?.toLowerCase();
    if (raw === "hotelbeds-mock") return "mock";
    return supplierMode("hotels");
  }
  if (product === "transfers") return supplierMode("transfers");
  return supplierMode("activities");
}

/** "hotelbeds" when stays come from Hotelbeds (real or fixtures), else the catalogue (or RateHawk, not built). */
export function hotelVendor(): "hotelbeds" | "hotelbeds-mock" | "catalogue" | "ratehawk" {
  const raw = process.env.SUPPLIER_MODE_HOTELS?.toLowerCase();
  if (raw === "hotelbeds-mock") return "hotelbeds-mock";
  if (supplierMode("hotels") !== "live") return "catalogue";
  return process.env.HOTELS_VENDOR?.toLowerCase() === "ratehawk" ? "ratehawk" : "hotelbeds";
}

/* ───────────── the breaker and errors ───────────── */

const BREAKER_NAME: Record<HotelbedsProduct, string> = { hotels: "hotels", transfers: "transfers", activities: "activities" };

/** Every Hotelbeds call goes through the app's circuit breaker; an outage counts, an answer doesn't. */
export const guardFor = (product: HotelbedsProduct) => <T>(fn: () => Promise<T>) =>
  callSupplier(BREAKER_NAME[product], async () => {
    try { return await fn(); } catch (e) {
      if (e instanceof HotelbedsError && e.transport) throw new AppError("SUPPLIER_UNAVAILABLE", { details: { supplier: BREAKER_NAME[product], reason: e.code } });
      throw e;
    }
  }, { timeoutMs: 120_000 });

/** Hotelbeds' answers as the app's error envelope. The supplier's own words stay in the server log. */
export function toAppError(e: unknown, product: HotelbedsProduct = "hotels"): unknown {
  if (!(e instanceof HotelbedsError)) {
    if (e instanceof AppError && e.code === "SUPPLIER_UNAVAILABLE") return supplierDown(BREAKER_NAME[product], "failing", 30);
    return e;
  }
  console.warn(`[hotelbeds] ${product}: ${e.code}${e.info.status ? ` (${e.info.status})` : ""}${e.info.supplierCode ? ` ${e.info.supplierCode}` : ""} req ${e.info.requestId ?? "-"}`);
  switch (e.code) {
    case "NOT_CONFIGURED": return new AppError("NOT_CONFIGURED");
    case "RATE_LIMITED": return supplierDown(BREAKER_NAME[product], "failing", e.info.retryAfter ?? 60);
    case "TIMEOUT": case "UNAVAILABLE": return supplierDown(BREAKER_NAME[product], e.code === "TIMEOUT" ? "timeout" : "failing", 30);
    case "PRICE_CHANGED": case "NO_AVAILABILITY": case "NOT_FOUND": return new AppError("VALIDATION", { message: t("hb.gone") });
    default: return new AppError("SUPPLIER_UNAVAILABLE");
  }
}

/* ───────────── our content cache ───────────── */

const imageUrl = (path: string) => `https://photos.hotelbeds.com/giata/bigger/${path.replace(/^\//, "")}`;

/** Facts for the offers, from app_hotelbeds_hotels (filled by the content job). Missing hotels just use the availability names. */
export const dbFacts: FactsLookup = async (codes) => {
  const out = new Map<number, HotelFacts>();
  if (!codes.length) return out;
  try {
    const rows = await db.select().from(appHotelbedsHotels).where(inArray(appHotelbedsHotels.code, codes.slice(0, 200)));
    for (const r of rows) {
      out.set(r.code, {
        code: r.code, name: r.name, address: [r.address, r.city ? r.city.charAt(0) + r.city.slice(1).toLowerCase() : null].filter(Boolean).join(", ") || null,
        imageUrl: r.images[0] ? imageUrl(r.images[0].path) : null, phone: r.phone, latitude: r.latitude, longitude: r.longitude,
        // What the facilities and the description show; a hotel with neither stored says nothing ("can't tell").
        ...(r.facilities.length || r.description ? amenitiesOf(r.facilities.map((x) => x.name ?? "").filter(Boolean), r.description) : {}),
      });
    }
  } catch { /* the content table isn't there yet: names from availability */ }
  return out;
};

/* ───────────── the adapters ───────────── */

const clients = new Map<string, HotelbedsClient>();
function client(product: HotelbedsProduct): HotelbedsClient {
  const key = `${product}:${hotelbedsEnv()}:${hotelbedsCredentials(product)?.apiKey ?? "-"}`;
  let c = clients.get(key);
  if (!c) { c = new HotelbedsClient({ product, guard: guardFor(product) }); clients.set(key, c); }
  return c;
}

/** The real Hotels adapter (or the fixtures with SUPPLIER_MODE_HOTELS=hotelbeds-mock). */
export function hotelbedsHotels(): HotelbedsHotels {
  return hotelVendor() === "hotelbeds-mock" || supplierModeOf("hotels") === "mock" ? mockHotelbedsHotels(dbFacts) : new HotelbedsHotels(client("hotels"), dbFacts);
}

export function hotelbedsTransfers(): HotelbedsTransfers {
  return supplierModeOf("transfers") === "mock" ? mockHotelbedsTransfers() : new HotelbedsTransfers(client("transfers"));
}

export function hotelbedsMode(product: HotelbedsProduct): "mock" | "live" { return supplierModeOf(product); }

/** The offer as we last showed it, for a BOOKABLE rate that needs no call to Hotelbeds to stand (cert. 2.5). */
async function storedOffer(supplierOfferId: string): Promise<BookingHotelOffer | null> {
  const [row] = await db.select({ payload: appOffers.payload, supplier: appOffers.supplier }).from(appOffers).where(eq(appOffers.supplierOfferId, supplierOfferId)).orderBy(desc(appOffers.createdAt)).limit(1);
  if (!row || row.supplier !== "hotelbeds") return null;
  const s = row.payload as unknown as StayOption;
  if (!s?.total) return null;
  const label = s.label === "lowest" ? "lowest" : "best";
  return {
    id: supplierOfferId, supplier: "hotelbeds", label, name: s.name, area: s.area, address: s.address, note: s.note, rating: null,
    nightly: { amount: Math.round(s.total.amount / Math.max(1, s.nights)), currency: "SAR" }, total: s.total, nights: s.nights, rooms: s.rooms,
    cancellation: s.cancellation, freeCancelUntil: s.freeCancelUntil, cancelFee: null, imageUrl: s.hotel?.imageUrl ?? null, expiresAt: s.expiresAt,
    meta: { photo: s.photo, focal: s.focal, noteOne: s.note, noteTwo: s.note, label, hotelCode: s.hotel?.code, imageUrl: s.hotel?.imageUrl ?? null, category: s.hotel?.category ?? null,
      rateCommentsId: s.hotel?.rateCommentsId ?? null, rateComments: s.hotel?.rateComments ?? null, room: s.hotel?.room ?? null, board: s.hotel?.board ?? null,
      facts: s.facts ?? null, score: s.score, badge: s.badge ?? null },
  };
}

/** The booking service's hotel supplier when stays come from Hotelbeds: errors come out as the app's envelope. */
export function bookingHotelbeds(): BookingHotelSupplier {
  const inner = hotelbedsHotels();
  return {
    name: "hotelbeds",
    async search(q) { try { return await inner.search(q); } catch (e) { throw toAppError(e); } },
    async price(id): Promise<BookingHotelOffer> { try { return await inner.price(id, await storedOffer(id)); } catch (e) { throw toAppError(e); } },
    async rooms(id) { try { return await inner.rooms(id); } catch (e) { throw toAppError(e); } },
  };
}
