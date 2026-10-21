import { AppError } from "../../http";
import type { InsuranceOption, InsurancePolicy, InsuranceQuote, InsuranceSupplier } from "./types";

/*
 * Mock insurance: three options priced from the trip's cost, days and ages (older travellers cost more), with the
 * limits a Gulf traveller typically sees. Policies live in memory; cancelling within 14 days of buying (and before
 * the trip) refunds in full. A holder named "Declined" is refused, for the "insurer said no" path.
 */

const SAR = (n: number) => n * 100;
const ageFactor = (age: number) => (age < 18 ? 0.6 : age < 65 ? 1 : age < 75 ? 2 : 3.5);
const days = (a: string, b: string) => Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1);
const up = (h: number) => Math.ceil(h / 100) * 100;

const g = globalThis as unknown as { __madaMockInsurance?: { quotes: Map<string, { q: InsuranceQuote; depart: string }>; policies: Map<string, InsurancePolicy & { boughtAt: number; depart: string }> } };
const store: NonNullable<typeof g.__madaMockInsurance> = (g.__madaMockInsurance ??= { quotes: new Map(), policies: new Map() });
export const clearMockInsurance = () => { store.quotes.clear(); store.policies.clear(); };

export const mockInsurance: InsuranceSupplier = {
  name: "mock",
  async quote(input) {
    const d = days(input.trip.depart, input.trip.return);
    const worldwide = input.trip.to.some((c) => ["US", "CA", "MX", "BR", "AU", "NZ", "JP"].includes(c));
    const region = worldwide ? 1.6 : 1;
    const people = input.travellers.reduce((s, t) => s + ageFactor(t.age), 0);
    const medical = (perDay: number) => up(Math.max(SAR(39) * input.travellers.length, SAR(perDay) * d * people * region));
    const cancel = up(Math.round(input.trip.tripCost * 0.045));
    const id = `mockq_${input.reference}`;
    const options: InsuranceOption[] = [
      { id: `${id}.basic`, product: "basic", name: "Medical and baggage", premium: medical(4), excess: SAR(250), wordingUrl: null, schengenOk: true,
        covers: [{ name: "Emergency medical", limit: SAR(150_000) }, { name: "Medical evacuation", limit: SAR(500_000) }, { name: "Lost or delayed baggage", limit: SAR(3_000) }] },
      { id: `${id}.comprehensive`, product: "comprehensive", name: "Comprehensive", premium: medical(4) + cancel + up(SAR(3) * d * input.travellers.length), excess: SAR(150), wordingUrl: null, schengenOk: true,
        covers: [{ name: "Emergency medical", limit: SAR(1_000_000) }, { name: "Medical evacuation", limit: null }, { name: "Trip cancellation", limit: input.trip.tripCost }, { name: "Lost or delayed baggage", limit: SAR(8_000) }, { name: "Flight delay (over 6 hours)", limit: SAR(1_000) }] },
      { id: `${id}.cancellation`, product: "cancellation", name: "Cancellation only", premium: Math.max(cancel, SAR(29)), excess: null, wordingUrl: null, schengenOk: false,
        covers: [{ name: "Trip cancellation", limit: input.trip.tripCost }, { name: "Trip curtailment", limit: input.trip.tripCost }] },
    ];
    const q: InsuranceQuote = { id, supplier: "mock", reference: input.reference, options, expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString() };
    store.quotes.set(id, { q, depart: input.trip.depart });
    return q;
  },
  async bind({ quoteId, optionIds, holder, reference }) {
    const had = [...store.policies.values()].find((p) => p.reference === reference && p.status !== "cancelled");
    if (had) return had;
    const got = store.quotes.get(quoteId);
    const q = got?.q;
    const chosen = q?.options.filter((o) => optionIds.includes(o.id)) ?? [];
    if (!q || !chosen.length) throw new AppError("NOT_FOUND");
    if (`${holder.firstName} ${holder.lastName}`.toLowerCase().startsWith("declined")) throw new AppError("VALIDATION", { message: "The insurer can't cover this trip." });
    const n = store.policies.size + 1;
    const p = { id: `mockb_${n}`, reference, status: "confirmed" as const, policies: chosen.map((o, i) => ({ number: `MOCK-POL-${n}${i}`, certificateUrl: null })), premium: chosen.reduce((s, o) => s + o.premium, 0), boughtAt: Date.now(), depart: got!.depart };
    store.policies.set(p.id, p);
    const { boughtAt: _b, depart: _d, ...out } = p;
    return out;
  },
  async cancel(policyId) {
    const p = store.policies.get(policyId);
    if (!p) throw new AppError("NOT_FOUND");
    if (p.status === "cancelled") return { cancelled: true, refund: 0 };
    const coolingOff = Date.now() - p.boughtAt < 14 * 86_400_000 && new Date().toISOString().slice(0, 10) < p.depart;
    store.policies.set(policyId, { ...p, status: "cancelled" });
    return { cancelled: true, refund: coolingOff ? p.premium : 0 };
  },
  async status(policyId) {
    const p = store.policies.get(policyId);
    if (!p) throw new AppError("NOT_FOUND");
    const { boughtAt: _b, depart: _d, ...out } = p;
    return out;
  },
};
