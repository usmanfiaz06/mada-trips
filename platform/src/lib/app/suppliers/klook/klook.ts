import type { Experience } from "@mada/shared";
import type { ActivitiesSupplier } from "../activities-types";
import { markedUp } from "../sell";

/*
 * Klook (Asia's widest catalogue: Japan, Thailand, Singapore, Malaysia, Indonesia, Korea, also the Gulf), next to
 * Hotelbeds Activities, GetYourGuide and Viator, ranked with them (suppliers/activities.ts rankExperiences). Search
 * only: for the beta every booking goes through the desk, who books Klook on the agent portal (CONNECT.md §26).
 *   KLOOK_API_KEY   the partner key (header X-API-KEY)
 *   KLOOK_ENV       sandbox | live
 * Assumed until Klook issues access: the hosts, GET /v3/products?city=&lang=&currency=&limit=, and the answer
 * (result.activities[] with activity_id, title, sub_title, cover_image_url, review_score, review_count, from_price,
 * currency, duration_minutes, free_cancellation, min_age). The parser drops anything it can't read.
 */

export type KlookActivity = {
  activity_id?: number | string; title?: string; sub_title?: string; cover_image_url?: string; review_score?: number; review_count?: number;
  from_price?: string | number; currency?: string; duration_minutes?: number | null; free_cancellation?: boolean; min_age?: number | null;
};

export const KLOOK_MARKUP_ENV = "APP_KLOOK_MARKUP_BPS";

export function parseKlook(data: unknown, limit: number): Experience[] {
  const d = data as { result?: { activities?: KlookActivity[] } } | KlookActivity[];
  const list = Array.isArray(d) ? d : d?.result?.activities ?? [];
  const out: Experience[] = [];
  for (const a of list) {
    const code = a.activity_id != null ? String(a.activity_id) : "";
    const price = typeof a.from_price === "number" ? a.from_price : Number(a.from_price);
    if (!/^\d{1,12}$/.test(code) || !a.title || !Number.isFinite(price) || price <= 0) continue;
    let sell: number;
    try { sell = markedUp(price, a.currency ?? "USD", KLOOK_MARKUP_ENV, 1500); } catch { continue; } // a currency we can't convert
    out.push({
      id: `klook:${code}`, supplier: "klook", code, modality: null, title: a.title.slice(0, 160), summary: a.sub_title ? a.sub_title.slice(0, 280) : null,
      image: a.cover_image_url?.startsWith("https://") ? { url: a.cover_image_url, credit: "Klook" } : null, photo: null,
      priceFrom: { amount: sell, currency: "SAR" }, durationMin: a.duration_minutes && a.duration_minutes > 0 ? Math.round(a.duration_minutes) : null,
      rating: typeof a.review_score === "number" ? Math.min(5, Math.max(0, a.review_score)) : null, reviews: typeof a.review_count === "number" ? Math.max(0, Math.round(a.review_count)) : null,
      family: /family|kids|children|zoo|aquarium|theme park|universal|disney/i.test(a.title), minAge: typeof a.min_age === "number" ? a.min_age : null, freeCancel: a.free_cancellation ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export const klook = (key: string): ActivitiesSupplier => ({
  name: "klook",
  async search(q) {
    const host = process.env.KLOOK_ENV === "live" ? "https://api.klook.com" : "https://sandbox-api.klook.com";
    const url = `${host}/v3/products?${new URLSearchParams({ city: q.city, country: q.countryCode, lang: q.language === "ar" ? "ar_SA" : "en_US", currency: "USD", limit: String(q.limit) })}`;
    const res = await fetch(url, { headers: { "X-API-KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`klook answered ${res.status}`);
    return parseKlook(await res.json(), q.limit);
  },
});
