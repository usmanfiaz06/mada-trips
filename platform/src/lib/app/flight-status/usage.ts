import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSupplierUsage } from "@/db/app-schema-flight-status";

/*
 * A hard monthly budget per paid flight-status supplier, shared by every server instance (app_supplier_usage).
 * A call is only made after its units are reserved; once the month's budget is reserved, adapters stop calling and
 * the app falls back to what it already knows (the booked times, the cache, an estimated position) with the honest
 * "status not available" wording. Months are calendar months in UTC. Vendors bill by subscription cycle, which may
 * not start on the 1st; keep a little headroom in the budget env if that matters.
 */

/** Thrown by an adapter when this month's budget is spent. Not an outage: the circuit breaker ignores it. */
export class BudgetSpent extends Error {
  override name = "BudgetSpent";
  constructor(readonly vendor: string, readonly budget: number) { super(`${vendor}: this month's budget is spent`); }
}

export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

/**
 * Reserve `units` of this month's budget. True when reserved (make the call), false when it would go over.
 * Atomic: two instances can't both take the last units.
 */
export async function reserve(vendor: string, units: number, budget: number, now = new Date()): Promise<boolean> {
  if (budget <= 0) return false;
  const month = monthOf(now);
  const rows = await db.execute<{ used: number }>(sql`
    INSERT INTO app_supplier_usage (vendor, month, used, calls) VALUES (${vendor}, ${month}, ${units}, 1)
    ON CONFLICT (vendor, month) DO UPDATE SET used = app_supplier_usage.used + ${units}, calls = app_supplier_usage.calls + 1, updated_at = now()
      WHERE app_supplier_usage.used + ${units} <= ${budget}
    RETURNING used`);
  const list = rows as unknown as { used: number }[];
  return list.length > 0 && Number(list[0]!.used) <= budget;
}

/** The vendor told us its quota is gone (aviationstack usage_limit_reached): stop for the rest of the month. */
export async function markSpent(vendor: string, budget: number, now = new Date()) {
  const month = monthOf(now);
  await db.insert(appSupplierUsage).values({ vendor, month, used: budget, calls: 0 })
    .onConflictDoUpdate({ target: [appSupplierUsage.vendor, appSupplierUsage.month], set: { used: sql`GREATEST(${appSupplierUsage.used}, ${budget})`, updatedAt: sql`now()` } });
}

export async function usageOf(vendor: string, now = new Date()): Promise<{ used: number; calls: number }> {
  const [r] = await db.select({ used: appSupplierUsage.used, calls: appSupplierUsage.calls }).from(appSupplierUsage)
    .where(and(eq(appSupplierUsage.vendor, vendor), eq(appSupplierUsage.month, monthOf(now))));
  return { used: r?.used ?? 0, calls: r?.calls ?? 0 };
}
