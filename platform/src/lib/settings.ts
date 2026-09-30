import "server-only";
import { db, schema, type Tx } from "@/db";

// Every governance number lives here so partners can change it without a code release.
export const DEFAULT_SETTINGS = {
  creditDualLimit: 2_000_000,       // SAR 20,000: up to this, any 2 directors approve; above, all directors
  expenseDualLimit: 2_000_000,      // expenses above this need 2 verifiers
  repaymentPctBps: 3000,            // Priority 3: 30% of what is left after the IATA reserve goes to partner repayments
  iataBuffer: 2_000_000,            // SAR 20,000 safety buffer on top of upcoming BSP debits
  iataReserveHeld: 0,               // reserve currently set aside (updated by each approved settlement)
  targetMarginBps: 800,             // 8%: margins below this show amber in the POS
  closeHour: 22,                    // 10:00 PM Riyadh
  cutoffDay: 25,
  bspPaymentDays: 14,               // IATA BSP: standard days from a 15-day closing to the payment due date
  bspGraceDays: 1,                  // one grace day the partners may use before a BSP payment counts as overdue
  refundApprovals: 1,
};
export type Settings = typeof DEFAULT_SETTINGS;

export async function getSettings(tx: Tx | typeof db = db): Promise<Settings> {
  const rows = await tx.select().from(schema.settings);
  const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in s) s[r.key] = r.value;
  return s as Settings;
}

export async function setSetting(tx: Tx, key: keyof Settings, value: number, userId: string) {
  await tx.insert(schema.settings).values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}
