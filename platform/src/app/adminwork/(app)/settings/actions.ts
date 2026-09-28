"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getSettings, setSetting, type Settings } from "@/lib/settings";
import { toHalalas, sar } from "@/lib/money";
import { str, toState, type ActionState } from "@/lib/actions";

const MONEY: (keyof Settings)[] = ["creditDualLimit", "expenseDualLimit", "iataBuffer", "iataReserveHeld"];
const PCT: (keyof Settings)[] = ["repaymentPctBps", "targetMarginBps"];
const INT: [keyof Settings, number, number][] = [["closeHour", 12, 23], ["cutoffDay", 1, 28], ["refundApprovals", 1, 3]];
const LABEL: Record<string, string> = {
  creditDualLimit: "2-director credit limit", expenseDualLimit: "Single-verifier expense limit", iataBuffer: "IATA safety buffer", iataReserveHeld: "IATA reserve held",
  repaymentPctBps: "Default repayment share", targetMarginBps: "Target margin", closeHour: "Daily close hour", cutoffDay: "Settlement cut-off day", refundApprovals: "Refund approvals",
};

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("settings.manage");
  try {
    const before = await getSettings();
    const next: Partial<Record<keyof Settings, number>> = {};
    for (const k of MONEY) next[k] = toHalalas(str(fd, k));
    for (const k of PCT) { const v = Number(str(fd, k)); if (!(v >= 0 && v <= 100)) throw new Error(`${LABEL[k]} must be 0–100%`); next[k] = Math.round(v * 100); }
    for (const [k, lo, hi] of INT) { const v = Number(str(fd, k)); if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${LABEL[k]} must be between ${lo} and ${hi}`); next[k] = v; }
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== before[k]);
    if (!changed.length) return { ok: "No changes" };
    const fmt = (k: keyof Settings, v: number) => MONEY.includes(k) ? `SAR ${sar(v)}` : PCT.includes(k) ? `${v / 100}%` : String(v);
    await db.transaction(async (tx) => {
      for (const k of changed) {
        await setSetting(tx, k, next[k]!, u.id);
        await audit(tx, { actorId: u.id, action: "settings.changed", entityType: "settings", entityRef: LABEL[k], summary: `Changed ${LABEL[k]} from ${fmt(k, before[k])} to ${fmt(k, next[k]!)}`, changes: { [k]: { from: fmt(k, before[k]), to: fmt(k, next[k]!) } } });
      }
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: "Rules updated. They apply to everything from now on" };
}

export async function saveEquity(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("settings.manage");
  try {
    const partners = await db.select().from(schema.partners);
    const next = partners.map((p) => ({ p, bps: Math.round(Number(str(fd, `eq_${p.id}`)) * 100) }));
    if (next.some((n) => !(n.bps >= 0))) throw new Error("Enter a percentage for every partner");
    const total = next.reduce((s, n) => s + n.bps, 0);
    if (total !== 10000) throw new Error(`Equity must add up to 100.00% (now ${(total / 100).toFixed(2)}%)`);
    await db.transaction(async (tx) => {
      for (const n of next) if (n.bps !== n.p.equityBps) {
        await tx.update(schema.partners).set({ equityBps: n.bps }).where(eq(schema.partners.id, n.p.id));
        await audit(tx, { actorId: u.id, action: "equity.changed", entityType: "partner", entityRef: n.p.name, summary: `Changed ${n.p.name}'s equity from ${n.p.equityBps / 100}% to ${n.bps / 100}%`, changes: { equity: { from: `${n.p.equityBps / 100}%`, to: `${n.bps / 100}%` } } });
      }
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: "Equity updated" };
}
