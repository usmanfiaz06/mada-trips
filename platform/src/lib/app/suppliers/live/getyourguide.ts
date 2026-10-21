import type { SupplierExperience as Experience } from "../activities-types";
import type { ActivitiesSupplier } from "../activities-types";
import { activitySell } from "../hotelbeds/activities";

/*
 * GetYourGuide Partner API (optional; only with GYG_PARTNER_TOKEN). Access needs an approved partner account; the
 * affiliate programme alone gives widgets, not the API.
 * Confirmed from GetYourGuide's open spec (github.com/getyourguide/partner-api-spec): base https://api.getyourguide.com,
 * versioned paths (/1/…), header X-ACCESS-TOKEN, GET /1/tours searches by query or coordinates; /1/tours/{id},
 * availability and options exist. Assumed until the account is approved: the query names (cnt_language, currency,
 * coordinates[]=lat,lon,radius, limit) and the answer's shape (data.tours[] with tour_id, title, abstract,
 * pictures[].url, price.values.amount, duration + duration_unit, overall_rating, number_of_ratings).
 * Search only: bookings go to the desk, who books in GetYourGuide's partner tools.
 */

type GygTour = { tour_id?: number | string; title?: string; abstract?: string; pictures?: { url?: string }[]; price?: { values?: { amount?: number } }; duration?: number; duration_unit?: string; overall_rating?: number; number_of_ratings?: number };

export function parseGyg(data: unknown, limit: number): Experience[] {
  const tours = (data as { data?: { tours?: GygTour[] } })?.data?.tours ?? [];
  const out: Experience[] = [];
  for (const t of tours) {
    const code = t.tour_id != null ? String(t.tour_id) : "";
    const amount = t.price?.values?.amount;
    if (!/^\d{1,12}$/.test(code) || !t.title || typeof amount !== "number") continue;
    const unit = (t.duration_unit ?? "hour").toLowerCase();
    const dur = typeof t.duration === "number" && t.duration > 0 ? Math.round(unit.startsWith("day") ? t.duration * 1440 : unit.startsWith("min") ? t.duration : t.duration * 60) : null;
    const img = t.pictures?.[0]?.url?.replace("[format_id]", "21");
    out.push({
      id: `getyourguide:${code}`, supplier: "getyourguide", code, modality: null, title: t.title.slice(0, 160), summary: t.abstract?.slice(0, 280) ?? null,
      image: img?.startsWith("https://") ? { url: img, credit: "GetYourGuide" } : null, photo: null, priceFrom: { amount: activitySell(amount, "USD"), currency: "SAR" },
      durationMin: dur, rating: typeof t.overall_rating === "number" ? Math.min(5, t.overall_rating) : null, reviews: t.number_of_ratings ?? null,
      family: /family|kids|children/i.test(t.title), minAge: null, freeCancel: null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export const getYourGuide = (token: string): ActivitiesSupplier => ({
  name: "getyourguide",
  async search(q) {
    const params = new URLSearchParams({ cnt_language: q.language === "ar" ? "ar" : "en", currency: "USD", limit: String(q.limit) });
    params.append("coordinates[]", String(q.lat));
    params.append("coordinates[]", String(q.lon));
    params.append("coordinates[]", "25");
    const res = await fetch(`https://api.getyourguide.com/1/tours?${params.toString()}`, { headers: { "X-ACCESS-TOKEN": token, Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`api.getyourguide.com answered ${res.status}`);
    return parseGyg(await res.json(), q.limit);
  },
});
