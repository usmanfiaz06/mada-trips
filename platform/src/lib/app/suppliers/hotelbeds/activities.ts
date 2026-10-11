import type { Experience } from "@mada/shared";
import type { ActivitiesSupplier, ActivityBooking, ActivityOffer, ActivitySearch } from "../activities-types";
import { HotelbedsClient, HotelbedsError, type HotelbedsClientOptions } from "./client";
import { costHalalas, pricingRules, type PricingRules } from "./money";

/*
 * Hotelbeds (HBX Group) Activities API, version 3.0. Keys: HOTELBEDS_ACTIVITIES_API_KEY / HOTELBEDS_ACTIVITIES_SECRET,
 * host by HOTELBEDS_ENV (test → api.test.hotelbeds.com, the sandbox; live after certification). Signing, retries and
 * errors are the shared client's (client.ts).
 *
 * What the public docs (developer.hotelbeds.com, Activities → Booking API) confirm:
 *   POST /activity-api/3.0/activities/availability   { filters: [{ searchFilterItems: [{ type: "destination", value }] }],
 *        from, to, language, paxes: [{ age }], pagination: { itemsPerPage, page }, order }. Pax distribution is required.
 *        Answers activities[] with content (code, name, …), modalities[], amountsFrom, rateKeys in
 *        modalities[].rates[].rateDetails[] (valid 30 minutes, usable once), operationDates, currency.
 *   POST /activity-api/3.0/activities/details        { code, from, to, language, paxes, modalityCode? } → activity.modalities[]
 *        with code, name, duration, minChildrenAge, amountsFrom, rates[].rateDetails[] (rateKey, operationDates with
 *        cancellationPolicies, paxAmounts, totalAmount { amount, boxOfficeAmount }). /details/full adds content.
 *   PUT  /activity-api/3.0/bookings                   { language, clientReference, holder { name, surname, email, country },
 *        activities: [{ rateKey, from, to, paxes: [{ age, name, surname, type }], answers? }] } → booking.reference,
 *        booking.status (CONFIRMED | CANCELLED), booking.total. Adults listed before children.
 *   DELETE /activity-api/3.0/bookings/{language}/{reference}?cancellationFlag=SIMULATION|CANCELLATION
 * Assumed (not on the public pages; check against the sandbox before certification):
 *   - a "gps" searchFilterItem with latitude/longitude (seen in a public integration; "destination" with a Hotelbeds
 *     destination code is the documented one, and is used when HOTELBEDS_ACTIVITY_DESTINATIONS maps the city);
 *   - content.media.images[].urls[] { sizeType, resource } for photos, content.description for the summary;
 *   - modalities[].duration { value, metric: HOURS | DAYS | MINUTES }; the activity's currency in `currency`;
 *   - booking.total as a number; the cancel answer's amount in `booking.cancelValuation` or `booking.total`.
 */

const BASE = "/activity-api/3.0";

type Amount = { paxType?: string; ageFrom?: number; ageTo?: number; amount?: number };
type RateDetail = { rateKey?: string; totalAmount?: { amount?: number }; operationDates?: { from?: string; to?: string; cancellationPolicies?: { dateFrom?: string; amount?: number }[] }[] };
type Modality = { code?: string; name?: string; duration?: { value?: number; metric?: string }; amountsFrom?: Amount[]; minChildrenAge?: number; maxChildrenAge?: number; rates?: { rateCode?: string; rateDetails?: RateDetail[] }[] };
type HbActivity = {
  code?: string; name?: string; currency?: string; currencyName?: string; amountsFrom?: Amount[]; type?: string;
  content?: { name?: string; description?: string; media?: { images?: { visualizationOrder?: number; urls?: { sizeType?: string; resource?: string }[] }[] }; activityFactsheetType?: string };
  modalities?: Modality[];
};

/** The traveller's price for a supplier amount: our rate plus FX buffer, then the activities margin, up to a riyal. */
export function activitySell(net: number, currency: string, rules: PricingRules = pricingRules()): number {
  const markup = Number(process.env.APP_ACTIVITY_MARKUP_BPS ?? 1500);
  const bps = Number.isFinite(markup) && markup >= 0 && markup <= 10_000 ? markup : 1500;
  return Math.ceil((costHalalas(net, currency, rules) * (1 + bps / 10_000)) / 100) * 100;
}

const minutes = (d: Modality["duration"]) => {
  if (!d?.value || d.value <= 0) return null;
  const m = (d.metric ?? "").toUpperCase();
  return Math.round(m.startsWith("DAY") ? d.value * 24 * 60 : m.startsWith("MIN") ? d.value : d.value * 60);
};

const adultFrom = (a: Amount[] | undefined) => (a ?? []).filter((x) => typeof x.amount === "number" && (x.paxType ?? "ADULT").toUpperCase() === "ADULT").map((x) => x.amount!).sort((x, y) => x - y)[0] ?? null;

function photo(a: HbActivity): Experience["image"] {
  const imgs = [...(a.content?.media?.images ?? [])].sort((x, y) => (x.visualizationOrder ?? 99) - (y.visualizationOrder ?? 99));
  for (const i of imgs) {
    const urls = i.urls ?? [];
    const u = urls.find((x) => /LARGE|XLARGE/i.test(x.sizeType ?? "")) ?? urls.find((x) => /MEDIUM/i.test(x.sizeType ?? "")) ?? urls[0];
    if (u?.resource?.startsWith("https://")) return { url: u.resource, credit: "Hotelbeds" };
  }
  return null;
}

const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n) > n / 2 ? s.lastIndexOf(" ", n) : n)}…` : s);

/** Availability answer → what the app lists. Unpriced or unnamed activities are left out. */
export function parseHotelbedsAvailability(data: unknown, q: Pick<ActivitySearch, "ages" | "limit">, rules?: PricingRules): Experience[] {
  const acts = ((data as { activities?: HbActivity[] })?.activities ?? []);
  const out: Experience[] = [];
  const kids = q.ages.filter((a) => a < 18);
  for (const a of acts) {
    const code = a.code ?? (a.content as { code?: string } | undefined)?.code;
    const title = a.content?.name ?? a.name;
    if (!code || !title || !/^[\w.~-]{1,80}$/.test(code)) continue;
    const currency = (a.currency ?? "EUR").toUpperCase();
    // The cheapest modality that takes the youngest child (when there is one).
    const mods = (a.modalities ?? []).filter((m) => !kids.length || m.minChildrenAge == null || Math.min(...kids) >= m.minChildrenAge);
    const priced = mods.map((m) => ({ m, from: adultFrom(m.amountsFrom) })).filter((x) => x.from !== null).sort((x, y) => x.from! - y.from!)[0];
    const from = priced?.from ?? adultFrom(a.amountsFrom);
    if (from === null) continue;
    let sell: number;
    try { sell = activitySell(from, currency, rules); } catch { continue; }
    const minAge = (a.modalities ?? []).map((m) => m.minChildrenAge).filter((x): x is number => typeof x === "number").sort((x, y) => x - y)[0] ?? null;
    out.push({
      id: `hotelbeds:${code}`, supplier: "hotelbeds", code, modality: priced?.m.code ?? null, title: title.slice(0, 160),
      summary: a.content?.description ? clip(strip(a.content.description), 280) : null, image: photo(a), photo: null, priceFrom: { amount: sell, currency: "SAR" },
      durationMin: minutes(priced?.m.duration ?? a.modalities?.[0]?.duration), rating: null, reviews: null,
      family: minAge !== null ? minAge <= 6 : /family|kids|children|zoo|aquarium|theme park|water ?park/i.test(title), minAge, freeCancel: null,
    });
    if (out.length >= q.limit) break;
  }
  return out;
}

/** Detail answer → rates the desk can confirm with. */
export function parseHotelbedsDetail(data: unknown, code: string, rules?: PricingRules): ActivityOffer[] {
  const a = (data as { activity?: HbActivity })?.activity;
  const currency = (a?.currency ?? "EUR").toUpperCase();
  const out: ActivityOffer[] = [];
  for (const m of a?.modalities ?? []) {
    for (const r of m.rates ?? []) {
      for (const d of r.rateDetails ?? []) {
        const total = d.totalAmount?.amount;
        const op = d.operationDates?.[0];
        if (!d.rateKey || typeof total !== "number" || !op?.from) continue;
        const firstFee = (op.cancellationPolicies ?? []).map((c) => c.dateFrom).filter((x): x is string => !!x).sort()[0] ?? null;
        out.push({ code, modality: m.code ?? "", modalityName: m.name ?? m.code ?? "", rateKey: d.rateKey, from: op.from, to: op.to ?? op.from, sell: activitySell(total, currency, rules), net: { amount: total, currency }, freeCancelUntil: firstFee });
      }
    }
  }
  return out.sort((x, y) => x.sell - y.sell);
}

/** Optional: our city id → Hotelbeds destination code ("108410=RUH,745044=IST"), for the documented destination filter. */
function destinationFor(placeId: string): string | null {
  for (const part of (process.env.HOTELBEDS_ACTIVITY_DESTINATIONS ?? "").split(",")) {
    const [k, v] = part.split("=").map((s) => s?.trim());
    if (k === placeId && v && /^[A-Z0-9]{2,6}$/.test(v)) return v;
  }
  return null;
}

const paxesOf = (ages: number[]) => (ages.length ? ages : [30, 30]).map((age) => ({ age }));

export function hotelbedsActivities(opts: Partial<HotelbedsClientOptions> = {}): ActivitiesSupplier {
  const client = () => new HotelbedsClient({ product: "activities", ...opts });
  return {
    name: "hotelbeds",
    async search(q) {
      const dest = destinationFor(q.placeId);
      const item = dest ? { type: "destination", value: dest } : { type: "gps", latitude: q.lat, longitude: q.lon };
      const data = await client().request<unknown>({
        method: "POST", path: `${BASE}/activities/availability`, safe: true,
        body: { filters: [{ searchFilterItems: [item] }], from: q.from, to: q.to, language: q.language, paxes: paxesOf(q.ages), pagination: { itemsPerPage: Math.min(50, q.limit * 2), page: 1 }, order: "DEFAULT" },
      });
      return parseHotelbedsAvailability(data, q);
    },
    async offers(code, q) {
      const data = await client().request<unknown>({
        method: "POST", path: `${BASE}/activities/details`, safe: true,
        body: { code, from: q.from, to: q.to, language: q.language, paxes: paxesOf(q.ages), ...(q.modality ? { modalityCode: q.modality } : {}) },
      });
      return parseHotelbedsDetail(data, code);
    },
    async book(b) {
      const paxes = [...b.paxes].sort((x, y) => (x.type === y.type ? 0 : x.type === "ADULT" ? -1 : 1));
      const data = await client().request<{ booking?: { reference?: string; status?: string; total?: number; currency?: string } }>({
        method: "PUT", path: `${BASE}/bookings`, safe: false,
        body: { language: b.language, clientReference: b.clientReference.slice(0, 20), holder: b.holder, activities: [{ rateKey: b.rateKey, from: b.from, to: b.to, paxes }] },
      });
      const bk = data?.booking;
      if (!bk?.reference) throw new HotelbedsError("REJECTED", "Hotelbeds activities booking came back without a reference", { product: "activities" });
      return { reference: bk.reference, status: bk.status === "CANCELLED" ? "CANCELLED" : "CONFIRMED", total: { amount: Number(bk.total ?? 0), currency: (bk.currency ?? "EUR").toUpperCase() } };
    },
    async cancel(reference, simulate, language = "en") {
      const data = await client().request<{ booking?: { total?: number; currency?: string; cancelValuation?: number } }>({
        method: "DELETE", path: `${BASE}/bookings/${language}/${encodeURIComponent(reference)}`, query: { cancellationFlag: simulate ? "SIMULATION" : "CANCELLATION" }, safe: simulate,
      });
      return { amount: Number(data?.booking?.cancelValuation ?? data?.booking?.total ?? 0), currency: (data?.booking?.currency ?? "EUR").toUpperCase() };
    },
  };
}
