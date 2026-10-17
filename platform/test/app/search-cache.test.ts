import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSearchCache } from "@/db/app-schema-booking";
import { cached, clearSearchCache } from "@/lib/app/booking/search";

/* A live supplier's answer is shared through app_search_cache for 10 minutes, so another server instance doesn't ask again. */

const answer = [{ id: "hb-1", name: "Bereketzade Hotel", total: { amount: 182_000, currency: "SAR" } }];

describe("search cache", () => {
  it("answers another instance from the database, then asks the supplier again after 10 minutes", async () => {
    const key = `test:${Math.random()}`;
    const supplier = vi.fn(async () => answer);
    const first = await cached(key, supplier, true);
    await first.saved;
    expect(supplier).toHaveBeenCalledTimes(1);

    clearSearchCache(); // another instance: nothing in its memory
    const second = await cached(key, supplier, true);
    expect(supplier).toHaveBeenCalledTimes(1);
    expect(second.value).toEqual(answer);
    expect(Math.abs(second.at - first.at)).toBeLessThan(5_000);

    clearSearchCache();
    await db.update(appSearchCache).set({ createdAt: sql`now() - interval '11 minutes'` }).where(eq(appSearchCache.key, key));
    await (await cached(key, supplier, true)).saved;
    expect(supplier).toHaveBeenCalledTimes(2);
    const [row] = await db.select().from(appSearchCache).where(eq(appSearchCache.key, key));
    expect(Date.now() - row!.createdAt.getTime()).toBeLessThan(60_000);
  });

  it("keeps a mock supplier's answers in memory only", async () => {
    const key = `test:${Math.random()}`;
    await (await cached(key, async () => answer)).saved;
    expect(await db.select().from(appSearchCache).where(eq(appSearchCache.key, key))).toHaveLength(0);
  });

  it("clears answers over an hour old when it writes", async () => {
    await db.insert(appSearchCache).values({ key: "test:old", value: answer, createdAt: sql`now() - interval '2 hours'` });
    await (await cached(`test:${Math.random()}`, async () => answer, true)).saved;
    expect(await db.select().from(appSearchCache).where(eq(appSearchCache.key, "test:old"))).toHaveLength(0);
  });
});
