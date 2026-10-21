import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { insurance, type InsuranceQuoteInput } from "@/lib/app/suppliers/insurance";
import { clearMockInsurance } from "@/lib/app/suppliers/insurance/mock";
import { parseBooking, parseQuote, quoteRequest, signHeaders } from "@/lib/app/suppliers/insurance/xcover";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* Travel insurance (Cover Genius XCover): the switch, the mock quote/bind/cancel/status, the signature and parsers. */

const input = (over: Partial<InsuranceQuoteInput> = {}): InsuranceQuoteInput => ({
  reference: "order-ins-1",
  trip: { from: "SA", to: ["TR"], depart: "2027-03-09", return: "2027-03-15", tripCost: 1_200_000 },
  travellers: [{ id: "a", firstName: "Sara", lastName: "Alharbi", age: 34, residence: "SA" }, { id: "b", firstName: "Omar", lastName: "Alharbi", age: 70, residence: "SA" }],
  ...over,
});
const holder = { firstName: "Sara", lastName: "Alharbi", email: "s@example.com", phone: "+966500000002", country: "SA" };
const KEYS = ["XCOVER_API_KEY", "XCOVER_API_SECRET", "XCOVER_PARTNER_CODE"];

afterEach(() => {
  for (const k of [...KEYS, "SUPPLIER_MODE_INSURANCE", "VERCEL_ENV"]) delete process.env[k];
  vi.unstubAllGlobals();
  clearMockInsurance();
  resetBreakers();
});

describe("switch", () => {
  it("needs all three XCover keys to go live; off on production without them", () => {
    expect(insurance().name).toBe("mock");
    process.env.XCOVER_API_KEY = "k"; process.env.XCOVER_API_SECRET = "s";
    expect(insurance().name).toBe("mock");
    process.env.XCOVER_PARTNER_CODE = "MADA";
    expect(insurance().name).toBe("xcover");
    for (const k of KEYS) delete process.env[k];
    process.env.VERCEL_ENV = "production";
    expect(() => insurance()).toThrow(expect.objectContaining({ code: "NOT_CONFIGURED" }));
  });
});

describe("mock insurance", () => {
  it("quotes three options; older travellers and longer trips cost more", async () => {
    const q = await insurance().quote(input());
    expect(q.options.map((o) => o.product)).toEqual(["basic", "comprehensive", "cancellation"]);
    const comp = q.options[1]!;
    expect(comp.covers.find((c) => c.name === "Trip cancellation")!.limit).toBe(1_200_000);
    expect(comp.premium).toBeGreaterThan(q.options[0]!.premium);
    expect(q.options.every((o) => o.premium % 100 === 0)).toBe(true);
    const younger = await insurance().quote(input({ reference: "r2", travellers: [input().travellers[0]!, { ...input().travellers[1]!, age: 30 }] }));
    expect(younger.options[0]!.premium).toBeLessThan(q.options[0]!.premium);
    expect(q.options[0]!.schengenOk).toBe(true);
  });
  it("binds once per reference, reads status, refunds in the cooling-off period", async () => {
    const q = await insurance().quote(input());
    const p = await insurance().bind({ quoteId: q.id, optionIds: [q.options[1]!.id], holder, reference: "order-ins-1" });
    expect(p).toMatchObject({ status: "confirmed", premium: q.options[1]!.premium, reference: "order-ins-1" });
    expect(p.policies).toHaveLength(1);
    expect((await insurance().bind({ quoteId: q.id, optionIds: [q.options[1]!.id], holder, reference: "order-ins-1" })).id).toBe(p.id);
    expect((await insurance().status(p.id)).status).toBe("confirmed");
    expect(await insurance().cancel(p.id, "trip cancelled")).toEqual({ cancelled: true, refund: p.premium });
    expect((await insurance().status(p.id)).status).toBe("cancelled");
    await expect(insurance().bind({ quoteId: q.id, optionIds: [q.options[0]!.id], holder: { ...holder, firstName: "Declined" }, reference: "order-ins-9" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(insurance().bind({ quoteId: "nope", optionIds: ["x"], holder, reference: "r" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("XCover", () => {
  it("signs the Date header with HMAC-SHA512", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    const h = signHeaders("key1", "secret1", now);
    const sig = encodeURIComponent(createHmac("sha512", "secret1").update(`date: ${now.toUTCString()}`).digest("base64"));
    expect(h).toEqual({ "X-Api-Key": "key1", Date: now.toUTCString(), Authorization: `Signature keyId="key1",algorithm="hmac-sha512",signature="${sig}"` });
  });
  it("asks for a quote per product with the trip and our reference", () => {
    const r = quoteRequest(input());
    expect(r.request).toHaveLength(3);
    expect(r.request[0]).toMatchObject({ policy_type: "travel_medical", total_trip_cost: 12000, destinations: [{ country: "TR" }], origin_country: "SA" });
    expect(r).toMatchObject({ currency: "SAR", partner_transaction_id: "order-ins-1" });
  });
  it("parses a quote package and a booking", () => {
    const q = parseQuote({ id: "pkg1", quotes: [{ id: "q1", price: 89.5, currency: "SAR", policy: { policy_type: "travel_medical", content: { title: "Travel medical", benefits: [{ description: "Emergency medical expenses", benefit_limit: 150000 }], excess: 250, pds_url: "https://xcover.com/pds/1" } } }, { id: "q2" }] }, "ref");
    expect(q).toMatchObject({ id: "pkg1", supplier: "xcover", options: [{ id: "q1", product: "basic", premium: 8950, excess: 25000, schengenOk: true, wordingUrl: "https://xcover.com/pds/1" }] });
    expect(q.options).toHaveLength(1);
    const b = parseBooking({ id: "bk1", status: "CONFIRMED", partner_transaction_id: "ref", quotes: [{ id: "q1", policy_number: "XC-123", certificate_url: "https://xcover.com/c/1", price: 89.5, currency: "SAR" }] }, "ref");
    expect(b).toEqual({ id: "bk1", reference: "ref", status: "confirmed", premium: 8950, policies: [{ number: "XC-123", certificateUrl: "https://xcover.com/c/1" }] });
  });
  it("sends signed requests to the partner's path; a 4xx is the insurer's no", async () => {
    process.env.XCOVER_API_KEY = "k"; process.env.XCOVER_API_SECRET = "s"; process.env.XCOVER_PARTNER_CODE = "MADA";
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.staging.xcover.com/x/partners/MADA/quotes/");
      expect((init.headers as Record<string, string>).Authorization).toMatch(/^Signature keyId="k"/);
      return new Response(JSON.stringify({ errors: ["destination not covered"] }), { status: 400 });
    });
    vi.stubGlobal("fetch", f);
    await expect(insurance().quote(input())).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
