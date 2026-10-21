import { createHmac } from "node:crypto";
import { AppError } from "../../http";
import { requireEnv } from "../live/not-configured";
import { plainHalalas } from "../sell";
import type { InsuranceOption, InsurancePolicy, InsuranceQuote, InsuranceQuoteInput, InsuranceSupplier } from "./types";

/*
 * Cover Genius XCover API v2 (xcover.com/en/developers):
 *   POST  /partners/{partner}/quotes/                         a quote package for the trip (one or more products)
 *   PUT   /partners/{partner}/bookings/{quotePackageId}       bind: buy the chosen quotes for the policyholder
 *   POST  /partners/{partner}/bookings/{bookingId}/cancel     cancel (preview with ?preview=true)
 *   GET   /partners/{partner}/bookings/{bookingId}            status, policy numbers, certificates
 * Auth: X-Api-Key plus an HTTP Signature over the Date header, HMAC-SHA512 with the secret.
 *   XCOVER_API_KEY, XCOVER_API_SECRET, XCOVER_PARTNER_CODE, XCOVER_ENV (staging | live)
 * Confirmed from XCover's public docs: the resources, the signature scheme, quotes[].price in the quote's currency.
 * Assumed until Cover Genius issues access: the hosts, the policy_type names for travel and the exact quote fields we
 * read (product, cover limits). The product names in XCOVER_POLICY_TYPES let the owner set them without code.
 */

const HOSTS = { staging: "https://api.staging.xcover.com/x", live: "https://api.xcover.com/x" };
const host = () => HOSTS[process.env.XCOVER_ENV === "live" ? "live" : "staging"];
const creds = () => requireEnv("insurance (XCover)", ["XCOVER_API_KEY", "XCOVER_API_SECRET", "XCOVER_PARTNER_CODE"]);

/** The Date header and its signature (HTTP Signatures, hmac-sha512 over "date: …"). */
export function signHeaders(key: string, secret: string, now = new Date()): Record<string, string> {
  const date = now.toUTCString();
  const signature = encodeURIComponent(createHmac("sha512", secret).update(`date: ${date}`).digest("base64"));
  return { "X-Api-Key": key, Date: date, Authorization: `Signature keyId="${key}",algorithm="hmac-sha512",signature="${signature}"` };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const c = creds();
  const res = await fetch(`${host()}/partners/${encodeURIComponent(c.XCOVER_PARTNER_CODE)}${path}`, {
    method, headers: { "Content-Type": "application/json", ...signHeaders(c.XCOVER_API_KEY, c.XCOVER_API_SECRET) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(14_000),
  });
  const text = await res.text();
  if (res.status >= 500) throw new Error(`xcover answered ${res.status}`);
  if (res.status === 404) throw new AppError("NOT_FOUND");
  if (!res.ok) throw new AppError("VALIDATION", { message: `The insurer refused: ${text.slice(0, 160)}` });
  return (text ? JSON.parse(text) : {}) as T;
}

const POLICY_TYPES = () => (process.env.XCOVER_POLICY_TYPES ?? "travel_medical:basic,travel_comprehensive:comprehensive,travel_cancellation:cancellation")
  .split(",").map((p) => p.split(":") as [string, InsuranceOption["product"]]);

export function quoteRequest(input: InsuranceQuoteInput) {
  const sar = (h: number) => Math.round(h) / 100;
  return {
    request: POLICY_TYPES().map(([policyType]) => ({
      policy_type: policyType,
      policy_type_version: "1",
      policy_start_date: `${input.trip.depart}T00:00:00+03:00`,
      travellers: input.travellers.map((t) => ({ first_name: t.firstName, last_name: t.lastName, age: t.age, country_of_residence: t.residence })),
      trip_start_date: `${input.trip.depart}T00:00:00+03:00`,
      trip_end_date: `${input.trip.return}T23:59:59+03:00`,
      total_trip_cost: sar(input.trip.tripCost),
      destinations: input.trip.to.map((c) => ({ country: c })),
      origin_country: input.trip.from,
    })),
    currency: "SAR",
    customer_country: input.travellers[0]?.residence ?? "SA",
    customer_language: input.language === "ar" ? "ar" : "en",
    partner_metadata: { reference: input.reference },
    partner_transaction_id: input.reference,
  };
}

type XQuote = { id?: string; policy?: { policy_type?: string; policy_name?: string; content?: { title?: string; benefits?: { description?: string; benefit_limit?: number | null }[]; excess?: number | null; pds_url?: string } }; price?: number; currency?: string };
type XPackage = { id?: string; quotes?: XQuote[]; expires_at?: string; partner_transaction_id?: string };

export function parseQuote(data: unknown, reference: string): InsuranceQuote {
  const pkg = data as XPackage;
  if (!pkg?.id) throw new Error("xcover answered a quote without an id");
  const product = new Map(POLICY_TYPES());
  const options: InsuranceOption[] = [];
  for (const q of pkg.quotes ?? []) {
    if (!q.id || typeof q.price !== "number") continue;
    const cur = q.currency ?? "SAR";
    const covers = (q.policy?.content?.benefits ?? []).filter((b) => b.description).map((b) => ({ name: b.description!.slice(0, 80), limit: typeof b.benefit_limit === "number" ? plainHalalas(b.benefit_limit, cur) : null }));
    const medical = covers.find((c) => /medical/i.test(c.name))?.limit ?? 0;
    options.push({
      id: q.id, product: product.get(q.policy?.policy_type ?? "") ?? "basic", name: q.policy?.content?.title ?? q.policy?.policy_name ?? "Travel insurance",
      premium: plainHalalas(q.price, cur), covers, excess: typeof q.policy?.content?.excess === "number" ? plainHalalas(q.policy.content.excess, cur) : null,
      wordingUrl: q.policy?.content?.pds_url?.startsWith("https://") ? q.policy.content.pds_url : null,
      // EUR 30,000 is about SAR 122,000.
      schengenOk: medical >= 12_200_000,
    });
  }
  return { id: pkg.id, supplier: "xcover", reference, options, expiresAt: pkg.expires_at ?? new Date(Date.now() + 24 * 3_600_000).toISOString() };
}

type XBooking = { id?: string; status?: string; partner_transaction_id?: string; quotes?: { id?: string; status?: string; policy_number?: string; pds_url?: string; certificate_url?: string; price?: number; currency?: string }[]; total_price?: number; currency?: string };

export function parseBooking(data: unknown, reference: string): InsurancePolicy {
  const b = data as XBooking;
  if (!b?.id) throw new Error("xcover answered a booking without an id");
  const s = (b.status ?? "").toUpperCase();
  const quotes = b.quotes ?? [];
  const total = typeof b.total_price === "number" ? plainHalalas(b.total_price, b.currency ?? "SAR") : quotes.reduce((n, q) => n + (typeof q.price === "number" ? plainHalalas(q.price, q.currency ?? "SAR") : 0), 0);
  return {
    id: b.id, reference: b.partner_transaction_id ?? reference, premium: total,
    status: /CANCEL/.test(s) ? "cancelled" : /CONFIRM|ACTIVE|RECEIVED/.test(s) ? "confirmed" : "pending",
    policies: quotes.filter((q) => q.policy_number).map((q) => ({ number: q.policy_number!, certificateUrl: q.certificate_url?.startsWith("https://") ? q.certificate_url : null })),
  };
}

export const xCover: InsuranceSupplier = {
  name: "xcover",
  async quote(input) {
    return parseQuote(await call("POST", "/quotes/", quoteRequest(input)), input.reference);
  },
  async bind({ quoteId, optionIds, holder, reference }) {
    const body = {
      quotes: optionIds.map((id) => ({ id })),
      policyholder: { first_name: holder.firstName, last_name: holder.lastName, email: holder.email, phone: holder.phone, country: holder.country },
      partner_transaction_id: reference,
    };
    return parseBooking(await call("PUT", `/bookings/${encodeURIComponent(quoteId)}`, body), reference);
  },
  async cancel(policyId, reason) {
    const r = await call<{ status?: string; total_refund?: number; refund_value?: number; currency?: string }>("POST", `/bookings/${encodeURIComponent(policyId)}/cancel`, { reason_for_cancellation: reason.slice(0, 200) });
    const refund = r.total_refund ?? r.refund_value ?? 0;
    return { cancelled: /CANCEL/i.test(r.status ?? "CANCELLED"), refund: plainHalalas(refund, r.currency ?? "SAR") };
  },
  async status(policyId) {
    return parseBooking(await call("GET", `/bookings/${encodeURIComponent(policyId)}`), "");
  },
};
