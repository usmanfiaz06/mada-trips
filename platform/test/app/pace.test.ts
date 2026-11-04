import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PACE_STALE_MS, paceFrom, paceSettings } from "@/lib/app/booking/pace";

const S = { on: true, ratio: 50, floor: 200, person: 15 };
const MIN = 60_000;
afterEach(() => { delete process.env.FLIGHTS_PACE_RATIO; delete process.env.FLIGHTS_PACE; });

describe("pace: live flight searches in step with bookings", () => {
  it("plenty of room: a search is reused for 10 minutes", () => {
    expect(paceFrom({ looks: 50, books: 0, mine: 0 }, false, S)).toMatchObject({ freshMs: 10 * MIN, live: true });
  });
  it("closer to the line: reused for longer, still live", () => {
    expect(paceFrom({ looks: 130, books: 0, mine: 0 }, false, S)).toMatchObject({ freshMs: 30 * MIN, live: true });
    expect(paceFrom({ looks: 190, books: 0, mine: 0 }, false, S)).toMatchObject({ freshMs: 120 * MIN, live: true });
  });
  it("each booking makes room", () => {
    expect(paceFrom({ looks: 200, books: 0, mine: 0 }, false, S).live).toBe(false);
    expect(paceFrom({ looks: 200, books: 10, mine: 0 }, false, S)).toMatchObject({ freshMs: 10 * MIN, live: true });
  });
  it("at the line: only earlier answers, up to 12 hours old", () => {
    expect(paceFrom({ looks: 450, books: 5, mine: 0 }, false, S)).toMatchObject({ freshMs: PACE_STALE_MS, live: false });
  });
  it("one person searching far more than anyone does is held back on their own", () => {
    expect(paceFrom({ looks: 10, books: 0, mine: 15 }, false, S).live).toBe(false);
    expect(paceFrom({ looks: 10, books: 0, mine: 15 }, true, S).live).toBe(true);
  });
  it("set from the environment, and can be turned off", () => {
    process.env.FLIGHTS_PACE_RATIO = "70";
    expect(paceSettings().ratio).toBe(70);
    process.env.FLIGHTS_PACE = "off";
    expect(paceSettings().on).toBe(false);
  });
});

import { db } from "@/db";
import { appPace } from "@/db/app-schema-booking";
import { PaceHeld, cached, clearSearchCache } from "@/lib/app/booking/search";
import { paceBook, paceCall, paceLook, paceMine } from "@/lib/app/booking/pace";

describe("pace: counted in the database, and what a held-back search shows", () => {
  it("counts searches, bookings and one person's hour; the call follows them", async () => {
    await db.delete(appPace);
    process.env.FLIGHTS_PACE_FLOOR = "2"; process.env.FLIGHTS_PACE_RATIO = "1";
    try {
      const who = "00000000-0000-4000-8000-0000000000aa";
      expect((await paceCall(who)).live).toBe(true);
      await paceLook(); await paceLook(); await paceMine(who);
      expect((await paceCall(who)).live).toBe(false);
      await paceBook(); await paceBook();
      expect((await paceCall(who)).live).toBe(true);
      const rows = await db.select().from(appPace);
      expect(rows.find((r) => r.key.startsWith("fl:l:"))?.n).toBe(2);
      expect(rows.find((r) => r.key.startsWith("fl:b:"))?.n).toBe(2);
      expect(rows.find((r) => r.key.startsWith(`fl:w:${who}:`))?.n).toBe(1);
    } finally { delete process.env.FLIGHTS_PACE_FLOOR; }
  });

  it("held back: an earlier answer is shown (even hours old); with none, no supplier call", async () => {
    clearSearchCache();
    const run = vi.fn(async () => ["offer"]);
    const key = JSON.stringify(["f", "test", Date.now()]);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await cached(key, run, false);
      vi.setSystemTime(Date.now() + 3 * 60 * MIN);
      expect((await cached(key, run, false, { freshMs: PACE_STALE_MS, live: false })).value).toEqual(["offer"]);
      expect(run).toHaveBeenCalledTimes(1);
      await expect(cached(key + "x", run, false, { freshMs: PACE_STALE_MS, live: false })).rejects.toBeInstanceOf(PaceHeld);
      expect(run).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});
