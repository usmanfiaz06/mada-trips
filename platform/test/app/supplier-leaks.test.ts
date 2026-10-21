import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { addDays, todayIn, StaySearchResponse, StayRoomsResponse } from "@mada/shared";
import { z } from "zod";
import { sql, db } from "@/db";
import { appHotelbedsHotels } from "@/db/app-schema-hotelbeds";
import { runIngest } from "@/lib/app/places/ingest";
import { body } from "@/lib/app/http";
import { hotelCodeOf, imageOf, imageProxyPath, isPartnerUrl, scrubResponse, seal, unseal, unsealDeep } from "@/lib/app/shield";
import { clearImageCache, proxiedImage } from "@/lib/app/image-proxy";
import { outgoingProblems, partnersIn } from "@/lib/app/ask-chat/guard";
import { clearSearchCache } from "@/lib/app/booking/search";
import { fixtureFetch, mockHotelbedsHotels, resetMockHotelbeds } from "@/lib/app/suppliers/hotelbeds/mock";
import { refreshHotelContent } from "@/lib/app/suppliers/hotelbeds/content";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { POST as searchStays } from "@/app/api/app/v1/search/stays/route";
import { GET as roomsGet } from "@/app/api/app/v1/offers/[id]/rooms/route";
import { GET as offerGet } from "@/app/api/app/v1/offers/[id]/route";
import { GET as hotelGet } from "@/app/api/app/v1/hotels/[code]/route";
import { GET as thingsGet } from "@/app/api/app/v1/places/[id]/things/route";
import { GET as plansGet } from "@/app/api/app/v1/esim/plans/route";
import { GET as statusGet } from "@/app/api/app/v1/status/route";
import { GET as healthGet } from "@/app/api/app/v1/health/route";
import { GET as configGet } from "@/app/api/app/v1/config/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { callP, signIn } from "./wallet-helpers";
// The same denylist the app's web export is scanned with (plain ESM, shared with apps/mobile).
import { scanJson, scanText } from "../../../tools/leak-scan/denylist.mjs";

/*
 * Travellers never learn who Mada books with, how prices are fetched or what Mada pays (docs/app/SUPPLIER-PRIVACY.md).
 * The shield (lib/app/shield.ts) seals partner ids, proxies partner photos and scrubs every JSON answer; this file
 * checks the pieces, then sweeps the Core API's answers in partner-mock modes against the denylist the app's web export
 * is scanned with too (tools/leak-scan/denylist.mjs).
 */

type Hit = { kind: string; path?: string; match: string };
const leaks = (v: unknown): Hit[] => scanJson(v) as Hit[];
const ENV0 = { ...process.env };
afterEach(() => {
  for (const k of ["SUPPLIER_MODE_HOTELS", "SUPPLIER_MODE_ACTIVITIES"]) { if (ENV0[k] === undefined) delete process.env[k]; else process.env[k] = ENV0[k]; }
  resetBreakers();
});

describe("the shield's pieces", () => {
  it("seals a partner id to a stable opaque id only the server reads, per kind", () => {
    const a = seal("hotel", "99701");
    expect(a).toMatch(/^m_[\w-]+$/);
    expect(a).not.toContain("99701");
    expect(seal("hotel", "99701")).toBe(a);
    expect(unseal("hotel", a)).toBe("99701");
    expect(unseal("esim", a)).toBeNull(); // another kind never opens it
    expect(unseal("hotel", `${a.slice(0, -2)}xx`)).toBeNull(); // tampered
    expect(hotelCodeOf(a)).toBe(99701);
    expect(hotelCodeOf("99701")).toBeNull(); // a partner's own code is not an id
  });

  it("puts sealed ids back in request bodies before the handler reads them", async () => {
    const id = seal("esim", "merhaba-7days-1gb");
    const req = new Request("http://x/api/app/v1/orders/preview", { method: "POST", body: JSON.stringify({ draft: { packageId: id, note: "m_hello there" } }) });
    const got = await body(req, z.object({ draft: z.object({ packageId: z.string(), note: z.string() }) }));
    expect(got.draft).toEqual({ packageId: "merhaba-7days-1gb", note: "m_hello there" });
    expect(unsealDeep({ ref: { id: seal("exp", "hotelbeds:E-1") } })).toEqual({ ref: { id: "hotelbeds:E-1" } });
  });

  it("scrubs an answer: partner photos through our host, ids sealed, cost and partner fields gone, names out of text", () => {
    const raw = {
      options: [{
        id: "6a1c0b5e-1111-4111-8111-111111111111", total: { amount: 98000, currency: "SAR" }, cancellation: "Free until 3 May. Hotelbeds charges after that.",
        hotel: { code: 99701, imageUrl: "https://photos.hotelbeds.com/giata/bigger/00/000001/000001a_hb_a_001.jpg", supplier: "hotelbeds", rateCommentsId: "123|456" },
        net: { amount: 50, currency: "EUR" }, markupBps: 1500, rateKey: "20261010|20261012|W|1|99701|DBL.ST|ID_B2B_26|BB||1~2~0||N@05",
      }],
      plans: [{ id: "merhaba-7days-1gb", coverage: { kind: "local", code: "TR" }, gb: 1, days: 7, price: { amount: 2500, currency: "SAR" } }],
      recommended: "merhaba-7days-1gb",
      experiences: [{ id: "viator:5513P12", supplier: "viator", code: "5513P12", modality: null, priceFrom: { amount: 19900, currency: "SAR" }, durationMin: 90, image: { url: "https://media-cdn.tripadvisor.com/media/a.jpg", credit: "Viator" } }],
      ride: { supplier: "mock" },
      voucher: { payableThrough: "Payable through HOTELBEDS PROFESSIONAL SERVICES, S.L.U, acting as agent for the service operating company, details of which can be provided upon request. VAT: ESB38877676 Reference: 1-234", transfer: { pickup: "Go to the Hotelbeds desk in the arrivals hall." } },
      stays: [{ hotelCode: 99702 }],
      token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0-hbx-Klook_x0123456789",
    };
    const out = scrubResponse(raw, "https://api.madatrips.sa") as typeof raw & Record<string, unknown>;
    const o = out.options[0]!;
    expect(o).not.toHaveProperty("net");
    expect(o).not.toHaveProperty("markupBps");
    expect(o).not.toHaveProperty("rateKey");
    expect(o.hotel).toEqual({ code: seal("hotel", "99701"), imageUrl: expect.stringMatching(/^https:\/\/api\.madatrips\.sa\/api\/app\/v1\/img\/m_[\w-]+$/) });
    expect(imageOf(o.hotel.imageUrl.split("/img/")[1]!)).toBe(raw.options[0]!.hotel.imageUrl);
    expect(o.cancellation).toBe("Free until 3 May. our partner charges after that.");
    expect(out.plans[0]!.id).toBe(seal("esim", "merhaba-7days-1gb"));
    expect(out.recommended).toBe(seal("esim", "merhaba-7days-1gb"));
    expect(out.experiences[0]).toEqual({ id: seal("exp", "viator:5513P12"), priceFrom: { amount: 19900, currency: "SAR" }, durationMin: 90, image: { url: expect.stringContaining("/api/app/v1/img/m_"), credit: "our partner" } });
    expect(out.ride).toEqual({ supplier: "mock" });
    expect(out.voucher.payableThrough).toBe(raw.voucher.payableThrough); // the contract's line (docs/app/HOTELBEDS.md §4)
    expect(out.voucher.transfer.pickup).toBe("Go to the transfer desk in the arrivals hall.");
    expect(out.stays[0]!.hotelCode).toBe(seal("hotel", "99702"));
    expect(out.token).toBe(raw.token); // no spaces: a token, never rewritten
    expect(leaks(out)).toEqual([]);
    expect(leaks(raw).length).toBeGreaterThan(5);
  });

  it("knows partner hosts, and only proxies those", () => {
    expect(isPartnerUrl("https://photos.hotelbeds.com/giata/xl/a.jpg")).toBe(true);
    expect(isPartnerUrl("https://images.tboholidays.com/a.jpg")).toBe(true);
    expect(isPartnerUrl("https://cdn.worldota.net/t/1024x768/content/a.jpeg")).toBe(true);
    expect(isPartnerUrl("https://upload.wikimedia.org/a.jpg")).toBe(false);
    expect(isPartnerUrl("https://notahotelbeds.com.evil.io/a.jpg")).toBe(false);
  });
});

describe("the image route", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const token = (u: string) => imageProxyPath(u).slice("/img/".length);
  afterEach(() => clearImageCache());

  it("serves a partner photo from our host with our headers only, cached", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JPEG, { headers: { "content-type": "image/jpeg", server: "hbx-edge", "x-cache": "HIT from photos.hotelbeds.com", "set-cookie": "a=b" } }); };
    const tk = token("https://photos.hotelbeds.com/giata/xl/a.jpg");
    const r = await proxiedImage(tk, f);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toMatch(/public, max-age=86400/);
    expect(r.headers.get("server")).toBeNull();
    expect(r.headers.get("x-cache")).toBeNull();
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(JPEG);
    expect(seen[0]!.url).toBe("https://photos.hotelbeds.com/giata/xl/a.jpg");
    expect(JSON.stringify(seen[0]!.init.headers)).not.toMatch(/cookie|authorization|referer/i);
    await proxiedImage(tk, f);
    expect(seen).toHaveLength(1); // the second from our cache
  });

  it("refuses what isn't an image, what's too big, and anything not sealed by us for a partner host", async () => {
    const html = async () => new Response("<html>", { headers: { "content-type": "text/html" } });
    expect((await proxiedImage(token("https://photos.hotelbeds.com/a.jpg"), html)).status).toBe(404);
    const huge = async () => new Response(new Uint8Array(7 * 1024 * 1024), { headers: { "content-type": "image/jpeg" } });
    expect((await proxiedImage(token("https://photos.hotelbeds.com/b.jpg"), huge)).status).toBe(404);
    const never = async () => { throw new Error("must not fetch"); };
    expect((await proxiedImage(token("https://upload.wikimedia.org/c.jpg"), never)).status).toBe(404);
    expect((await proxiedImage(seal("hotel", "https://photos.hotelbeds.com/d.jpg"), never)).status).toBe(404);
    expect((await proxiedImage("m_not-ours-at-all-000000000000000000000000000", never)).status).toBe(404);
  });
});

describe("Ask's sentence guard", () => {
  it("holds back a reply that names a partner", () => {
    expect(partnersIn("Your room is booked through Hotelbeds.")).toEqual(["Hotelbeds"]);
    expect(outgoingProblems("Your eSIM comes from Airalo.").length).toBeGreaterThan(0);
    expect(outgoingProblems("The TBO fare is held for you.").length).toBeGreaterThan(0);
    expect(partnersIn("Your room in Istanbul is held until 18:00.")).toEqual([]);
  });
});

describe("the Core API's answers carry no partner and no cost (partner mocks)", () => {
  let token = "";
  let travellers: string[] = [];
  beforeAll(async () => {
    await runIngest({ dir: join(__dirname, "fixtures/places"), sql });
    token = (await signIn()).token;
    travellers = ((await callP(peopleGet, {}, { token })).json.people as { id: string }[]).map((p) => p.id);
  });

  it("stays from the partner: the list, the rooms, the offer and the hotel page", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    clearSearchCache(); resetMockHotelbeds();
    const s = await callP(searchStays, {}, { method: "POST", token, body: { destination: "istanbul", checkIn: addDays(todayIn(), 60), nights: 6, travellerIds: travellers } });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    expect(leaks(s.json)).toEqual([]);
    const list = StaySearchResponse.parse(s.json);
    // The hotels just offered get their content stored (the daily job), so the hotel page has something to show.
    await db.delete(appHotelbedsHotels).where(eq(appHotelbedsHotels.code, 99701));
    await refreshHotelContent({ api: mockHotelbedsHotels(undefined, fixtureFetch()) });
    resetMockHotelbeds();
    expect(list.options.length).toBeGreaterThan(0);
    const one = list.options.find((o) => o.hotel?.code === seal("hotel", "99701")) ?? list.options.find((o) => o.hotel)!;
    expect(one.hotel!.code).toMatch(/^m_/);
    for (const [name, r] of [["rooms", await callP(roomsGet, { id: one.id }, { token })], ["offer", await callP(offerGet, { id: one.id }, { token })], ["hotel", await callP(hotelGet, { code: one.hotel!.code }, { token })]] as const) {
      expect(r.status, `${name}: ${JSON.stringify(r.json)}`).toBe(200);
      expect(leaks(r.json)).toEqual([]);
      expect(JSON.stringify(r.json)).not.toMatch(/photos\.hotelbeds|hbx|giata/i);
    }
    StayRoomsResponse.parse((await callP(roomsGet, { id: one.id }, { token })).json);
  });

  it("things to do, eSIM plans, status, health and config", async () => {
    for (const [h, params, query] of [
      [thingsGet, { id: "108841" }, ""], [thingsGet, { id: "745044" }, ""], [plansGet, {}, "?destination=istanbul&days=7"],
      [statusGet, {}, ""], [healthGet, {}, ""], [configGet, {}, ""],
    ] as const) {
      const r = await callP(h, params, { method: "GET", token, query });
      expect(r.status, JSON.stringify(r.json)).toBeLessThan(500);
      expect(leaks(r.json), JSON.stringify(r.json).slice(0, 400)).toEqual([]);
    }
  });

  it("the denylist catches what Bookme leaked", () => {
    expect(scanText('<img src="https://api.tboholidays.com/imageresource.aspx?img=1.jpg">')).not.toEqual([]);
    expect(scanText("{supplier:'hotelbeds'}")).not.toEqual([]);
    expect(scanText("const p={netUsd:4.5}")).not.toEqual([]);
    expect(scanText('{"plans":[{"id":"m_abc","price":{"amount":2500}}],"from":"HBX","airport":"TBO"}')).toEqual([]);
  });
});
