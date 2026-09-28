import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db";

/** Human reference numbers: S-10042, EX-1007, AP-1003 ... gap-free per prefix, safe under concurrency. */
export async function nextRef(tx: Tx, prefix: string, start = 1000): Promise<string> {
  const rows = await tx.execute<{ value: number }>(sql`
    INSERT INTO counters (key, value) VALUES (${prefix}, ${start + 1})
    ON CONFLICT (key) DO UPDATE SET value = counters.value + 1
    RETURNING value`);
  return `${prefix}-${rows[0].value}`;
}
