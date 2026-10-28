import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { nameIn, type ChatPlace, type TripDetail } from "@mada/shared";
import { hotelContent } from "../suppliers/hotelbeds/content";
import { overview } from "../trips/overview";
import { tripDetail } from "../trips/core";
import { chatPlace, placeDetails, placesOn, searchPlaces, type PlacePoint, type PlaceRecord } from "../suppliers/places";
import type { ToolCtx, ToolOut } from "./tools";

/*
 * Places in Ask (docs/app/CONNECT.md §32): restaurants, cafés, sights, malls, mosques, pharmacies, "near our hotel",
 * "open now", from Google Places. Two read-only tools: find_places (up to 5, the `places` card) and place_details (one
 * place in full, the `place` card with Directions, Call, Website and Add to plan). Listed to the model only while
 * places are on (suppliers/places placesMode): without the key Ask isn't given them and suggests well-known places
 * from what it knows, never hours or ratings.
 * What the model reads: one short line a place (id, name, kind, rating, price level, open now and until when, the
 * distance from the hotel, the street), worked out at this moment. Hours, ratings and addresses only from here.
 */

const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, additionalProperties: false, required: Object.keys(properties), properties });
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });

export const PLACES_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "find_places",
    description: "Find real places from Google: restaurants, cafés, sights, malls, mosques, pharmacies, anything near the traveller's hotel or in a city. Returns up to 5 with rating, price level, open now and distance from the hotel; the app shows them as cards with Directions and Add to plan.",
    strict: true,
    input_schema: obj({
      query: { type: "string", description: "What they want, short, in their words: 'shawarma', 'mandi', 'pharmacy', 'family café with a view'." },
      city: nullable("string", { description: "The city in English, e.g. 'Istanbul'; null: the trip's city." }),
      near: nullable("string", { description: "'hotel' for their hotel on the trip, or a landmark or area as said ('Taksim Square'); null: anywhere in the city." }),
      open_now: { type: "boolean", description: "Only places open right now." },
      trip_id: nullable("string", { description: "The trip id from the context it is for; else null." }),
    }),
  },
  {
    name: "place_details",
    description: "One place from a find_places result in full: open now, today's and the week's hours, address, rating. The app shows its card with Directions, Call, Website and Add to plan.",
    strict: true,
    input_schema: obj({
      place_id: { type: "string", description: "The id from a find_places result." },
      trip_id: nullable("string", { description: "The trip id it is for; else null." }),
    }),
  },
];

export const PLACES_TOOL_NAMES = new Set(PLACES_TOOLS.map((t) => t.name));
/** Whether Ask is given the places tools now (the key is set, or the mock is asked for). */
export const placesToolsOn = placesOn;

export const PLACES_LEAN: Record<string, { d: string; p?: Record<string, string | null> }> = {
  find_places: { d: "Real places from Google near their hotel or in a city: up to 5 with rating, open now, distance (cards).", p: { query: "Their words: 'shawarma'.", city: "English; null: the trip's.", near: "'hotel', a landmark, or null.", trip_id: null } },
  place_details: { d: "One place in full: hours, open now, address (card).", p: { place_id: "From find_places.", trip_id: null } },
};

export const PLACES_STATUS = {
  en: { find_places: "Looking at places nearby", place_details: "Checking the opening hours" },
  ar: { find_places: "نشوف الأماكن القريبة", place_details: "نشوف أوقات الدوام" },
} as const;

/* ───────────── where "near" is ───────────── */

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sameCity = (a: string, b: string) => { const x = words(a), y = words(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

/** The trip it's about: the one named, the chat's, the one in the city said, else the next one (no city said). */
async function tripFor(ctx: ToolCtx, tripId: string | null, city: string | null): Promise<TripDetail | null> {
  const open = async (id: string) => tripDetail(ctx.ownerId, id, null).catch(() => null);
  for (const id of [tripId, ctx.tripId]) {
    if (!id) continue;
    const t = await open(id);
    if (t && (!city || sameCity(t.city, city))) return t;
  }
  const r = await overview(ctx.ownerId, null).catch(() => null);
  const pick = r?.upcoming.find((t) => (city ? sameCity(t.city, city) : true));
  return pick ? open(pick.id) : null;
}

/** The stay they're in on `today`, else the next one, else the first. */
function stayOn(t: TripDetail, today: string) {
  const stays = t.stays.filter((s) => s.status !== "cancelled");
  const end = (s: (typeof stays)[number]) => new Date(Date.parse(`${s.checkIn}T00:00:00Z`) + s.nights * 86_400_000).toISOString().slice(0, 10);
  return stays.find((s) => s.checkIn <= today && today < end(s)) ?? stays.find((s) => s.checkIn > today) ?? stays[0] ?? null;
}

/** The hotel's point: our stored hotel content, else Google's own place for the hotel's name in the city. */
async function hotelPoint(t: TripDetail, stay: NonNullable<ReturnType<typeof stayOn>>, lang: "en" | "ar"): Promise<PlacePoint | null> {
  const code = Number(stay.hotelCode);
  if (Number.isInteger(code) && code > 0) {
    const h = await hotelContent(code).catch(() => null);
    if (h?.latitude != null && h?.longitude != null) return { lat: h.latitude, lng: h.longitude };
  }
  const [hit] = await searchPlaces({ query: `${stay.name}, ${t.city}`, near: null, openNow: false, lang, max: 1 }).catch(() => []);
  return hit?.lat != null && hit?.lng != null ? { lat: hit.lat, lng: hit.lng } : null;
}

type Near = { point: (PlacePoint & { radiusM: number }) | null; hotel: boolean; label: string | null; words: string; tripId: string | null; note: string | null };

/** Where to search around, and the words Google reads ("shawarma in Istanbul", "mandi near Taksim Square"). */
async function nearOf(ctx: ToolCtx, a: { query: string; city: string | null; near: string | null; tripId: string | null }): Promise<Near> {
  const wantsHotel = !!a.near && /^(?:the |our |my )?hotel$|فندق/i.test(a.near.trim());
  const trip = await tripFor(ctx, a.tripId, a.city);
  const city = a.city ?? trip?.city ?? null;
  const inCity = (q: string) => (city && !words(q).includes(words(city)) ? `${q} in ${city}` : q);
  if (wantsHotel) {
    const stay = trip ? stayOn(trip, ctx.today) : null;
    const point = trip && stay ? await hotelPoint(trip, stay, ctx.lang) : null;
    if (trip && stay && point) return { point: { ...point, radiusM: 2000 }, hotel: true, label: stay.name, words: inCity(a.query), tripId: trip.id, note: null };
    const why = !trip ? `No trip of theirs${city ? ` to ${city}` : ""} that we know` : !stay ? `No hotel on their ${trip.city} trip yet` : `Couldn't place ${stay?.name}`;
    // A hotel we can't place: the city instead, said so.
    return { point: null, hotel: false, label: city, words: inCity(a.query), tripId: trip?.id ?? null, note: `${why}: searched ${city ?? "by the words alone"}, not near a hotel. Say so in a few words.` };
  }
  // A landmark or a city: Google reads the place in the words ("mandi near Taksim Square, Istanbul") better than a circle.
  if (a.near) return { point: null, hotel: false, label: a.near, words: `${a.query} near ${a.near}${city && !words(a.near).includes(words(city)) ? `, ${city}` : ""}`, tripId: trip?.id ?? null, note: null };
  return { point: null, hotel: false, label: city, words: inCity(a.query), tripId: trip?.id ?? null, note: null };
}

/* ───────────── what the model reads ───────────── */

const PRICE_WORD = ["free", "low prices", "mid-range", "pricey", "very pricey"];
const metres = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(/\.0$/, "")} km`);
function openWords(p: ChatPlace): string {
  if (!p.open) return "hours unknown";
  if (p.open.now) return p.open.closes ? `open now, closes ${p.open.closes}` : "open now, 24 hours";
  return p.open.opens ? `closed now, opens ${p.open.opens}` : "closed now";
}
const street = (a: string | null) => (a ? a.split(",").slice(0, 2).join(",").trim() : null);

export const placeLine = (p: ChatPlace, i: number, hotel: boolean) => [
  `${i + 1}. id=${p.id}`, p.name, p.type,
  p.rating != null ? `${p.rating}★${p.ratings != null ? ` (${p.ratings.toLocaleString("en-US")})` : ""}` : null,
  p.price != null ? PRICE_WORD[p.price] : null,
  openWords(p),
  p.distanceM != null && hotel ? `${metres(p.distanceM)} from the hotel` : null,
  street(p.address),
].filter(Boolean).join(" · ");

/** The time at the place now ("21:40"), from its offset, so "open now" reads in its own clock. */
const localNow = (r: PlaceRecord | undefined) => (r?.utcOffsetMinutes != null ? new Date(Date.now() + r.utcOffsetMinutes * 60_000).toISOString().slice(11, 16) : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFER = "Hours, ratings, open now and addresses only as written here. Offer Directions and Add to my plan as choices.";
const DOWN = "Google's places didn't answer just now. Suggest well-known places from what you know, with no hours, ratings or opening times, and offer to look again.";

export const PLACES_RUN: Record<string, (ctx: ToolCtx, a: Record<string, unknown>) => Promise<ToolOut>> = {
  async find_places(ctx, a) {
    if (!placesToolsOn()) return { text: DOWN };
    const query = String(a.query ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!query) return { text: "Not searched: say what kind of place (shawarma, a pharmacy).", isError: true };
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
    const near = await nearOf(ctx, { query, city: str(a.city), near: str(a.near), tripId: str(a.trip_id) });
    let found: PlaceRecord[];
    try {
      found = await searchPlaces({ query: near.words, near: near.point, openNow: a.open_now === true, lang: ctx.lang, max: 5 });
    } catch (e) {
      console.warn("[ask-chat] places", e instanceof Error ? e.message.slice(0, 80) : "");
      return { text: DOWN };
    }
    const now = new Date();
    const from = near.hotel && near.point ? near.point : null;
    let places = found.map((p) => chatPlace(p, { from, now }));
    // Google's "open now" filter ran when the search was cached: checked again at this moment.
    if (a.open_now === true) places = places.filter((p) => p.open?.now !== false);
    if (from) places.sort((x, y) => (x.distanceM ?? 1e9) - (y.distanceM ?? 1e9));
    const where = near.hotel ? `near their hotel (${near.label})` : near.label ? `in ${near.label}` : "";
    if (!places.length) return { text: `${near.note ? `${near.note}\n` : ""}No places from Google for "${query}"${where ? ` ${where}` : ""}${a.open_now === true ? " open right now" : ""}. Say so plainly and offer another kind of place, or without open now.` };
    const clock = localNow(found[0]);
    const head = `Places from Google for "${query}" ${where}${clock ? `, local time ${clock}` : ""}:`;
    const nearLabel = near.hotel ? nameIn(near.label ?? "", ctx.lang) : near.label ? nameIn(near.label, ctx.lang) : null;
    return {
      text: [near.note, head, ...places.map((p, i) => placeLine(p, i, near.hotel)), OFFER].filter(Boolean).join("\n"),
      cards: [{ type: "places", query, near: near.hotel ? (ctx.lang === "ar" ? "فندقك" : "your hotel") : nearLabel, tripId: near.tripId ?? ctx.tripId ?? null, places }],
    };
  },

  async place_details(ctx, a) {
    if (!placesToolsOn()) return { text: DOWN };
    const id = String(a.place_id ?? "").trim();
    if (!id) return { text: "Not looked up: need a place id from find_places.", isError: true };
    let r: PlaceRecord | null;
    try {
      r = await placeDetails(id, ctx.lang);
    } catch {
      return { text: DOWN };
    }
    if (!r) return { text: `Google doesn't know the place ${id}. Say so and offer to search again by name.`, isError: true };
    const p = chatPlace(r, { full: true });
    const clock = localNow(r);
    const lines = [
      `${p.name} (id=${p.id})${p.type ? ` · ${p.type}` : ""}${p.rating != null ? ` · ${p.rating}★${p.ratings != null ? ` from ${p.ratings.toLocaleString("en-US")} reviews` : ""}` : ""}${p.price != null ? ` · ${PRICE_WORD[p.price]}` : ""}`,
      `${openWords(p)}${clock ? ` (local time ${clock})` : ""}${p.today ? ` · today ${p.today}` : ""}`,
      p.week?.length ? `Week: ${p.week.join("; ")}` : "No weekly hours from Google.",
      p.address ? `Address: ${p.address}` : null,
      `On the card: Directions${p.phone ? ", Call" : ""}${p.website ? ", Website" : ""}, Add to plan.`,
      OFFER,
    ];
    return { text: lines.filter(Boolean).join("\n"), cards: [{ type: "place", tripId: typeof a.trip_id === "string" && UUID.test(a.trip_id) ? a.trip_id : ctx.tripId ?? null, place: p }] };
  },
};
