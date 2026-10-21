import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Drizzle runs only migrations dated after the last one a database ran, so a migration dated earlier than one already
// deployed is skipped there for good (0043 and 0045 were, on staging). Each new entry takes a `when` after every
// earlier one. 0045 was re-dated after 0048 to reach databases that had skipped it; it is the one known exception.
const MOVED = new Set(["0045_trip_travellers"]);

describe("migration journal", () => {
  it("dates every migration after all the ones before it", () => {
    const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
    let latest = 0;
    const late: string[] = [];
    for (const e of entries) {
      if (MOVED.has(e.tag)) continue;
      if (e.when <= latest) late.push(`${e.tag} (${e.when} ≤ ${latest})`);
      latest = Math.max(latest, e.when);
    }
    expect(late).toEqual([]);
  });

  it("keeps a moved migration after everything it was moved past", () => {
    const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string; when: number }[] };
    const moved = entries.find((e) => e.tag === "0045_trip_travellers")!;
    expect(moved.when).toBeGreaterThan(Math.max(...entries.filter((e) => e.tag < "0049" && !MOVED.has(e.tag)).map((e) => e.when)));
  });
});
