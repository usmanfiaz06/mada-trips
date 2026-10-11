import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/db";

/*
 * Several writes in one statement: WITH w0 AS (INSERT …), w1 AS (UPDATE …) SELECT 1. One round trip instead of one per
 * write plus BEGIN and COMMIT, and still all-or-nothing (a statement is atomic). The writes run on one snapshot, so
 * none may read what another writes; rows referencing each other (a circle and its members) are fine, since foreign
 * keys are checked when the statement ends. Staging's functions are far from its database (~0.45 s a statement).
 */
export async function atOnce(writes: ({ getSQL(): SQL } | null | false | undefined)[], exec: Tx | typeof db = db): Promise<void> {
  const parts = writes.filter((w): w is { getSQL(): SQL } => !!w);
  if (!parts.length) return;
  await exec.execute(sql`WITH ${sql.join(parts.map((w, i) => sql`${sql.raw(`w${i}`)} AS (${w.getSQL()})`), sql`, `)} SELECT 1`);
}

/** Work that can wait for the response to go (Next's after()); run now where there is no request (tests, scripts). */
export async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(() => task().catch((e) => console.warn("[after]", e instanceof Error ? e.message : e)));
    return;
  } catch { /* outside a request */ }
  await task().catch((e) => console.warn("[after]", e instanceof Error ? e.message : e));
}
