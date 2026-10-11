import type { Experience } from "@mada/shared";
import type { ActivitiesSupplier } from "../activities-types";
import { activitySell } from "../hotelbeds/activities";

/*
 * Viator Partner API v2 (optional; only with VIATOR_API_KEY). Affiliate "Basic access" is free and covers search and
 * content; booking endpoints need Full + Booking access, so for us the desk books.
 * Confirmed from docs.viator.com / partnerresources.viator.com: base https://api.viator.com/partner (sandbox
 * https://api.sandbox.viator.com/partner), headers exp-api-key, Accept: application/json;version=2.0,
 * Accept-Language; POST /products/search (by destination id) and POST /search/freetext.
 * Assumed until a key is issued: /search/freetext's body ({ searchTerm, searchTypes: [{ searchType: "PRODUCTS",
 * pagination }], currency }) and answer (products.results[] with productCode, title, description,
 * images[].variants[].url, reviews.combinedAverageRating / totalReviews, duration.fixedDurationInMinutes,
 * pricing.summary.fromPrice).
 */

type VProduct = {
  productCode?: string; title?: string; description?: string; images?: { variants?: { url?: string; width?: number }[] }[];
  reviews?: { combinedAverageRating?: number; totalReviews?: number }; duration?: { fixedDurationInMinutes?: number; variableDurationFromMinutes?: number };
  pricing?: { summary?: { fromPrice?: number }; currency?: string }; flags?: string[];
};

export function parseViator(data: unknown, limit: number): Experience[] {
  const d = data as { products?: { results?: VProduct[] } | VProduct[] };
  const list = Array.isArray(d?.products) ? d.products : d?.products?.results ?? [];
  const out: Experience[] = [];
  for (const p of list) {
    const from = p.pricing?.summary?.fromPrice;
    if (!p.productCode || !/^[\w-]{1,40}$/.test(p.productCode) || !p.title || typeof from !== "number") continue;
    const img = (p.images?.[0]?.variants ?? []).filter((v) => v.url?.startsWith("https://")).sort((a, b) => Math.abs((a.width ?? 0) - 720) - Math.abs((b.width ?? 0) - 720))[0]?.url;
    out.push({
      id: `viator:${p.productCode}`, supplier: "viator", code: p.productCode, modality: null, title: p.title.slice(0, 160), summary: p.description ? p.description.slice(0, 280) : null,
      image: img ? { url: img, credit: "Viator" } : null, photo: null, priceFrom: { amount: activitySell(from, p.pricing?.currency ?? "USD"), currency: "SAR" },
      durationMin: p.duration?.fixedDurationInMinutes ?? p.duration?.variableDurationFromMinutes ?? null,
      rating: typeof p.reviews?.combinedAverageRating === "number" ? Math.min(5, p.reviews.combinedAverageRating) : null, reviews: p.reviews?.totalReviews ?? null,
      family: /family|kids|children/i.test(p.title), minAge: null, freeCancel: p.flags?.includes("FREE_CANCELLATION") ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export const viator = (key: string): ActivitiesSupplier => ({
  name: "viator",
  async search(q) {
    const host = process.env.VIATOR_ENV === "sandbox" ? "https://api.sandbox.viator.com/partner" : "https://api.viator.com/partner";
    const res = await fetch(`${host}/search/freetext`, {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { "exp-api-key": key, Accept: "application/json;version=2.0", "Accept-Language": q.language === "ar" ? "ar" : "en-US", "Content-Type": "application/json" },
      body: JSON.stringify({ searchTerm: q.city, searchTypes: [{ searchType: "PRODUCTS", pagination: { start: 1, count: q.limit } }], currency: "USD" }),
    });
    if (!res.ok) throw new Error(`api.viator.com answered ${res.status}`);
    return parseViator(await res.json(), q.limit);
  },
});
