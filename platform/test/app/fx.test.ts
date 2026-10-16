import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { FX_FALLBACK, FxResponse } from "@mada/shared";
import { db } from "@/db";
import { appRuntime } from "@/db/app-schema-resilience";
import { clearFxCache, fetchRates, getRates } from "@/lib/app/fx";
import { GET as fxGet } from "@/app/api/app/v1/fx/route";
import { call } from "./helpers";

/* Exchange rates (owner audit item 4): fetched once a day, cached, stale when the source is down, the built-in
   table when there is nothing, and always dated. SAR stays the charging currency; this is only the "≈ AED" line. */

const sample = (rates: Record<string, number>, when = "2026-10-16T00:00:05Z") => ({ result: "success", base_code: "SAR", time_last_update_unix: Math.floor(Date.parse(when) / 1000), rates });
const fetcherOf = (answer: () => Promise<unknown> | never) => {
  let calls = 0;
  const f = async () => { calls += 1; const json = await answer(); return { ok: true, json: async () => json }; };
  return { f, calls: () => calls };
};

describe("exchange rates", () => {
  beforeEach(async () => { clearFxCache(); await db.delete(appRuntime).where(eq(appRuntime.key, "fx")); });

  it("mock mode serves the built-in table, dated", async () => {
    const fx = await getRates({ mode: "mock" });
    expect(fx).toEqual(FX_FALLBACK);
    expect(fx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const r = await call(fxGet);
    expect(r.status).toBe(200);
    expect(FxResponse.parse(r.json).fx.base).toBe("SAR");
  });

  it("live mode fetches once a day and keeps the table in the database", async () => {
    const src = fetcherOf(async () => sample({ AED: 0.9793, USD: 0.2667, EUR: 0.2301, GBP: 0.1994 }));
    const now = new Date("2026-10-16T08:00:00Z");
    const a = await getRates({ mode: "live", fetcher: src.f, now });
    expect(a.source).toBe("open.er-api.com");
    expect(a.rates.EUR).toBe(0.2301);
    expect(a.date).toBe("2026-10-16");
    expect(a.stale).toBe(false);
    const b = await getRates({ mode: "live", fetcher: src.f, now: new Date("2026-10-16T20:00:00Z") });
    expect(b).toEqual(a);
    expect(src.calls()).toBe(1);
    clearFxCache(); // another server instance: reads the database, no second request
    const c = await getRates({ mode: "live", fetcher: src.f, now: new Date("2026-10-16T22:00:00Z") });
    expect(c.rates).toEqual(a.rates);
    expect(src.calls()).toBe(1);
    const [row] = await db.select().from(appRuntime).where(eq(appRuntime.key, "fx"));
    expect((row!.value as { source: string }).source).toBe("open.er-api.com");
    // The next day the source is asked again.
    await getRates({ mode: "live", fetcher: src.f, now: new Date("2026-10-17T09:00:00Z") });
    expect(src.calls()).toBe(2);
  });

  it("serves yesterday's table marked stale when the source is down, and the fallback when there is nothing", async () => {
    const down = fetcherOf(async () => { throw new Error("ECONNRESET"); });
    const none = await getRates({ mode: "live", fetcher: down.f, now: new Date("2026-10-16T08:00:00Z") });
    expect(none.source).toBe("fallback");
    expect(none.stale).toBe(true);
    expect(none.date).toBe(FX_FALLBACK.date);
    clearFxCache();
    await db.insert(appRuntime).values({ key: "fx", value: { ...FX_FALLBACK, source: "open.er-api.com", date: "2026-10-14", fetchedAt: "2026-10-14T06:00:00Z" } });
    const old = await getRates({ mode: "live", fetcher: down.f, now: new Date("2026-10-16T08:00:00Z") });
    expect(old.source).toBe("open.er-api.com");
    expect(old.date).toBe("2026-10-14");
    expect(old.stale).toBe(true);
    // Not hammered: inside ten minutes the same stale table comes back without another attempt.
    const before = down.calls();
    await getRates({ mode: "live", fetcher: down.f, now: new Date("2026-10-16T08:05:00Z") });
    expect(down.calls()).toBe(before);
  });

  it("refuses a malformed answer", async () => {
    const bad = fetcherOf(async () => ({ result: "success", base_code: "USD", rates: { AED: 3.67 } }));
    expect(await fetchRates(bad.f as never, new Date())).toBeNull();
    const notOk = async () => ({ ok: false, json: async () => ({}) });
    expect(await fetchRates(notOk as never, new Date())).toBeNull();
  });
});
