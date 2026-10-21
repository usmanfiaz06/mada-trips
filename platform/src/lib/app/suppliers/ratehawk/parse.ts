import type { StayAmenity, StayFacts } from "@mada/shared";
import type { BookingHotelOffer } from "../booking-types";
import { sellHalalas } from "../hotelbeds/money";

/*
 * RateHawk answers as our offers. A search answer (SERP) has prices only; names, places and stars come from hotel
 * info (kept a day per hotel). Prices: RateHawk's amount (net, in the currency we asked for) through the same stay
 * markup as Hotelbeds (APP_STAY_MARKUP_BPS), so "cheaper here" compares like with like.
 */

export type RhPaymentType = { amount?: string; currency_code?: string; type?: string; cancellation_penalties?: { free_cancellation_before?: string | null } };
export type RhRate = { match_hash?: string; book_hash?: string; room_name?: string; meal?: string; payment_options?: { payment_types?: RhPaymentType[] }; allotment?: number };
export type RhHotel = { id?: string; hid?: number; rates?: RhRate[] };
export type RhInfo = { id?: string; name?: string; address?: string; latitude?: number; longitude?: number; star_rating?: number; images?: string[]; kind?: string; amenity_groups?: { amenities?: string[] }[] };

export type RhQuery = { regionId: number; city: string; checkIn: string; nights: number; adults: number; childAges: number[]; rooms: number };
export type RhKey = { h: string; m: string | null; room: string | null; meal: string | null; q: RhQuery };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const encodeRh = (k: RhKey) => `ratehawk.${b64(k)}.${k.q.adults + k.q.childAges.length}`;
export function decodeRh(id: string): { key: RhKey; party: number } | null {
  // "~<book hash>" after a price(): what book() needs.
  const m = /^ratehawk\.([\w-]+?)(?:~[\w-]+)?\.(\d+)$/.exec(id);
  if (!m) return null;
  try { return { key: JSON.parse(Buffer.from(m[1]!, "base64url").toString("utf8")) as RhKey, party: Number(m[2]) }; } catch { return null; }
}

export const checkOut = (checkIn: string, nights: number) => new Date(Date.parse(`${checkIn}T00:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10);

const BOARD: [RegExp, StayFacts["board"]][] = [[/all.?inclusive/, "AI"], [/full.?board/, "FB"], [/half.?board/, "HB"], [/breakfast/, "BB"], [/nomeal|room.?only/, "RO"]];
const AMENITY: [RegExp, StayAmenity][] = [[/pool/i, "pool"], [/beach/i, "beach"], [/kids.?club|children'?s club/i, "kidsClub"], [/gym|fitness/i, "gym"], [/spa|sauna/i, "spa"], [/parking/i, "parking"], [/connecting/i, "connecting"], [/wheelchair|accessib/i, "accessible"], [/family room/i, "familyRooms"], [/wi-?fi|internet/i, "wifi"]];

/** The cheapest rate that's paid by us (deposit), for one hotel. */
export function cheapestRate(h: RhHotel): { rate: RhRate; pay: RhPaymentType } | null {
  let best: { rate: RhRate; pay: RhPaymentType } | null = null;
  for (const rate of h.rates ?? []) {
    for (const pay of rate.payment_options?.payment_types ?? []) {
      if (pay.type && pay.type !== "deposit") continue;
      if (!Number.isFinite(Number(pay.amount)) || !pay.currency_code) continue;
      if (!best || Number(pay.amount) < Number(best.pay.amount)) best = { rate, pay };
    }
  }
  return best;
}

export function offerOf(h: RhHotel, rate: RhRate, pay: RhPaymentType, info: RhInfo | null, q: RhQuery, now = new Date()): BookingHotelOffer | null {
  if (!h.id) return null;
  let total: number;
  try { total = sellHalalas(Number(pay.amount), pay.currency_code!, "stay"); } catch { return null; }
  const free = pay.cancellation_penalties?.free_cancellation_before ?? null;
  const freeDay = free && Date.parse(free) > now.getTime() ? free.slice(0, 10) : null;
  const meal = (rate.meal ?? "").toLowerCase();
  const board = BOARD.find(([re]) => re.test(meal))?.[1] ?? (meal ? "other" : null);
  const amenities = [...new Set((info?.amenity_groups ?? []).flatMap((g) => g.amenities ?? []).flatMap((a) => AMENITY.filter(([re]) => re.test(a)).map(([, v]) => v)))];
  const room = rate.room_name ? rate.room_name.slice(0, 80) : null;
  const stars = info?.star_rating ? Math.max(0, Math.min(5, Math.round(info.star_rating))) : null;
  const lat = typeof info?.latitude === "number" ? info.latitude : null;
  const lng = typeof info?.longitude === "number" ? info.longitude : null;
  const facts: StayFacts = {
    stars, apartment: /apart/i.test(info?.kind ?? ""), board, room, refundable: !!freeDay, payAtHotel: null, zone: null, lat, lng,
    content: !!info?.amenity_groups?.length, amenities, views: [], quiet: false, deal: false, shared: /hostel|dorm|shared/i.test(`${info?.kind ?? ""} ${room ?? ""}`),
  };
  const name = info?.name ?? h.id.replace(/_/g, " ");
  const image = info?.images?.[0]?.replace("{size}", "640x400") ?? null;
  const note = [room ? `${room}.` : "", board === "BB" ? "Breakfast included." : board === "HB" ? "Breakfast and dinner." : ""].filter(Boolean).join(" ");
  return {
    id: encodeRh({ h: h.id, m: rate.match_hash ?? null, room, meal: rate.meal ?? null, q }), supplier: "ratehawk", label: "best",
    name, area: [q.city, stars ? `${stars}★` : null].filter(Boolean).join(" · "), address: info?.address ?? q.city, note, rating: null,
    nightly: { amount: Math.round(total / q.nights), currency: "SAR" }, total: { amount: total, currency: "SAR" }, nights: q.nights, rooms: q.rooms,
    cancellation: freeDay ? `Free to cancel until ${freeDay}.` : "Not refundable.", freeCancelUntil: freeDay, cancelFee: freeDay ? null : total,
    imageUrl: image?.startsWith("https://") ? image : null, expiresAt: new Date(now.getTime() + 20 * 60_000).toISOString(),
    meta: { photo: "hotel-room", focal: "50% 50%", noteOne: note, noteTwo: note, label: "best", imageUrl: image?.startsWith("https://") ? image : null, room, board: rate.meal ?? null, facts },
  };
}
