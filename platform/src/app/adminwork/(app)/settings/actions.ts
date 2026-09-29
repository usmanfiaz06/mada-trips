"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getSettings, setSetting, type Settings } from "@/lib/settings";
import { toHalalas, sar } from "@/lib/money";
import { str, toState, type ActionState } from "@/lib/actions";
import { proposeGovernance, type GovernancePayload } from "@/lib/governance";

const MONEY: (keyof Settings)[] = ["creditDualLimit", "expenseDualLimit", "iataBuffer", "iataReserveHeld"];
const PCT: (keyof Settings)[] = ["repaymentPctBps", "targetMarginBps"];
const INT: [keyof Settings, number, number][] = [["closeHour", 12, 23], ["cutoffDay", 1, 28], ["refundApprovals", 1, 3]];
// Everyday settings apply at once. The rest decide who approves what and how profit is shared, so every other director must agree.
const OPERATIONAL: (keyof Settings)[] = ["targetMarginBps", "closeHour"];
const LABEL: Record<string, string> = {
  creditDualLimit: "2-director credit limit", expenseDualLimit: "Single-verifier expense limit", iataBuffer: "IATA safety buffer", iataReserveHeld: "IATA reserve held",
  repaymentPctBps: "Default repayment share", targetMarginBps: "Target margin", closeHour: "Daily close hour", cutoffDay: "Settlement cut-off day", refundApprovals: "Refund approvals",
};

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("settings.manage");
  try {
    const before = await getSettings();
    const next: Partial<Record<keyof Settings, number>> = {};
    for (const k of MONEY) {
      if (!str(fd, k)) throw new Error(`Enter ${LABEL[k]}`);
      const v = toHalalas(str(fd, k));
      if (v < 0) throw new Error(`${LABEL[k]} can't be negative`);
      next[k] = v;
    }
    for (const k of PCT) { const v = Number(str(fd, k)); if (!(v >= 0 && v <= 100)) throw new Error(`${LABEL[k]} must be 0–100%`); next[k] = Math.round(v * 100); }
    for (const [k, lo, hi] of INT) { const v = Number(str(fd, k)); if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${LABEL[k]} must be between ${lo} and ${hi}`); next[k] = v; }
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== before[k]);
    if (!changed.length) return { ok: "No changes" };
    const fmt = (k: keyof Settings, v: number) => MONEY.includes(k) ? `SAR ${sar(v)}` : PCT.includes(k) ? `${v / 100}%` : String(v);
    const now = changed.filter((k) => OPERATIONAL.includes(k));
    const later = changed.filter((k) => !OPERATIONAL.includes(k));
    let proposed = "";
    await db.transaction(async (tx) => {
      for (const k of now) {
        await setSetting(tx, k, next[k]!, u.id);
        await audit(tx, { actorId: u.id, action: "settings.changed", entityType: "settings", entityRef: LABEL[k], summary: `Changed ${LABEL[k]} from ${fmt(k, before[k])} to ${fmt(k, next[k]!)}`, changes: { [k]: { from: fmt(k, before[k]), to: fmt(k, next[k]!) } } });
      }
      if (later.length) {
        const changes: Extract<GovernancePayload, { type: "settings" }>["changes"] = {};
        for (const k of later) changes[k] = { from: before[k], to: next[k]!, label: LABEL[k], shown: { from: fmt(k, before[k]), to: fmt(k, next[k]!) } };
        const r = await proposeGovernance(tx, u.id, `Change rules: ${later.map((k) => `${LABEL[k]} ${fmt(k, before[k])} → ${fmt(k, next[k]!)}`).join("; ")}`, { type: "settings", changes });
        proposed = r.ref;
      }
    });
    revalidatePath("/adminwork", "layout");
    if (proposed) return { ok: `${now.length ? "Saved the everyday settings. " : ""}The governance changes were sent to the other directors as ${proposed}. They apply once everyone agrees` };
  } catch (e) { return toState(e); }
  return { ok: "Rules updated. They apply to everything from now on" };
}

export async function saveEquity(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("settings.manage");
  let ref = "";
  try {
    const partners = await db.select().from(schema.partners);
    const next = partners.map((p) => {
      const raw = str(fd, `eq_${p.id}`);
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(raw)) throw new Error("Enter a percentage for every partner");
      return { p, bps: Math.round(Number(raw) * 100) };
    });
    if (next.some((n) => n.bps <= 0 || n.bps > 10000)) throw new Error("Every partner needs a share above 0%");
    const total = next.reduce((s, n) => s + n.bps, 0);
    if (total !== 10000) throw new Error(`Equity must add up to 100.00% (now ${(total / 100).toFixed(2)}%)`);
    const shares = next.filter((n) => n.bps !== n.p.equityBps).map((n) => ({ partnerId: n.p.id, name: n.p.name, from: n.p.equityBps, to: n.bps }));
    if (!shares.length) return { ok: "No changes" };
    ref = await db.transaction(async (tx) => (await proposeGovernance(tx, u.id, `Change equity: ${shares.map((s) => `${s.name} ${s.from / 100}% → ${s.to / 100}%`).join("; ")}`, { type: "equity", shares })).ref);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: `Sent to the other directors as ${ref}. Equity changes once everyone agrees` };
}
