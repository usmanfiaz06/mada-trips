"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { agentForOps } from "@/lib/app/desk/agents";
import { ZodError } from "zod";
import { db } from "@/db";
import { appAuditLog } from "@/lib/app/audit";
import { deskNoteEsim, deskRefundEsim, deskRetryEsim, deskTopupEsim, resendEsim } from "@/lib/app/esim/service";
import { editRules, pricingRules, savePricingRules } from "@/lib/app/esim/pricing";
import { syncCatalogue } from "@/lib/app/esim/catalogue";
import { esimBalance } from "@/lib/app/esim/ops";

/*
 * The desk's eSIM actions (esims/page.tsx, esims/[id], finance/esim-pricing): send the install details again, refund one eSIM
 * (its share of the order back to the card; the supplier asked for its money or the unused eSIM cancelled), order a stuck
 * one again (looked up at the supplier first, never bought twice), top up on the traveller's behalf, a note to them;
 * and the owner's pricing rules (settings.manage only, every change in the audit trail).
 */

const id = (fd: FormData, k: string) => { const v = str(fd, k); if (!isUuid(v)) throw new Error("Not found"); return v; };
async function actor(perm: "desk.act" | "desk.refund") {
  const u = await requirePerm(perm);
  const me = await agentForOps(u.id);
  return { name: me?.displayName ?? u.name.split(" ")[0]!, opsUserId: u.id };
}
const done = (ok: string): ActionState => { revalidatePath("/adminwork/desk/esims"); return { ok }; };
const REASONS = ["INSTALLATION_FAILURE", "NO_COVERAGE", "TRIP_CANCELLATION", "WRONG_PURCHASE", "INCOMPATIBLE_DEVICE", "OTHERS"] as const;

export async function esimResendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await resendEsim(id(fd, "esimId"), await actor("desk.act")); return done("Sent to the traveller's inbox and phone"); } catch (e) { return toState(e); }
}

export async function esimRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const raw = str(fd, "reason");
    const reason = (REASONS as readonly string[]).includes(raw) ? (raw as (typeof REASONS)[number]) : "OTHERS";
    await deskRefundEsim(id(fd, "esimId"), await actor("desk.refund"), reason);
    return done("Refunded to the traveller. The supplier was asked for its money back");
  } catch (e) { return toState(e); }
}

export async function esimRetryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await deskRetryEsim(id(fd, "orderId"), await actor("desk.act")); return done("Checked with the supplier and ordered if it wasn't"); } catch (e) { return toState(e); }
}

/* ───────────── pricing (admin only), balance, the order view ───────────── */

async function admin() {
  const u = await requirePerm("settings.manage");
  const me = await agentForOps(u.id);
  return { name: me?.displayName ?? u.name.split(" ")[0]!, opsUserId: u.id };
}
const priced = (ok: string): ActionState => { revalidatePath("/adminwork/desk/finance/esim-pricing"); revalidatePath("/adminwork/desk/esims"); return { ok }; };
const fields = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));

export async function esimRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const who = await admin();
    const { rules, what } = editRules(await pricingRules(), { kind: "global", fields: fields(fd) });
    await savePricingRules(rules, who, what);
    return priced("Saved. Prices follow the new rules now");
  } catch (e) { return toState(e instanceof ZodError ? new Error("Check the numbers: one is out of range") : e); }
}

export async function esimPlaceRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const who = await admin();
    const code = str(fd, "code");
    if (!/^[A-Za-z0-9-]{2,24}$/.test(code)) throw new Error("Pick a place first");
    const { rules, what } = editRules(await pricingRules(), { kind: "place", code, marginPct: str(fd, "marginPct"), minProfitSar: str(fd, "minProfitSar") });
    await savePricingRules(rules, who, what);
    return priced("Saved for this place");
  } catch (e) { return toState(e instanceof ZodError ? new Error("Check the numbers: one is out of range") : e); }
}

export async function esimPlanRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const who = await admin();
    const packageId = str(fd, "packageId");
    if (!packageId || packageId.length > 80) throw new Error("Not found");
    const op = str(fd, "op");
    const base = await pricingRules();
    const edit = op === "hide" || op === "show" ? { kind: "hide" as const, packageId, hidden: op === "hide" }
      : op === "pick" || op === "unpick" ? { kind: "recommend" as const, packageId, code: str(fd, "code"), on: op === "pick" }
      : { kind: "plan" as const, packageId, marginPct: str(fd, "marginPct"), minProfitSar: str(fd, "minProfitSar"), fixedSar: str(fd, "fixedSar") };
    const { rules, what } = editRules(base, edit);
    await savePricingRules(rules, who, what);
    return priced(op === "hide" ? "Hidden from travellers" : op === "show" ? "Shown to travellers" : op === "pick" ? "Recommended" : op === "unpick" ? "No longer recommended" : "Saved for this plan");
  } catch (e) { return toState(e instanceof ZodError ? new Error("Check the numbers: one is out of range") : e); }
}

export async function esimSyncAction(): Promise<ActionState> {
  try {
    const who = await admin();
    const r = await syncCatalogue();
    await db.transaction((tx) => appAuditLog(tx, { actorKind: "agent", actorId: who.opsUserId, action: "esim.catalogue_sync", entityType: "app_runtime", entityId: "esim.catalogue", summary: `${who.name} synced the eSIM catalogue: ${r.total} plans, cost up on ${r.up.length}, down on ${r.down.length}` }));
    return priced("Catalogue synced");
  } catch (e) { return toState(e); }
}

export async function esimBalanceAction(): Promise<ActionState> {
  try { await requirePerm("desk.view"); await esimBalance({ fresh: true }); revalidatePath("/adminwork/desk/esims"); return { ok: "Balance checked" }; } catch (e) { return toState(e); }
}

export async function esimTopupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const packageId = str(fd, "packageId");
    if (!packageId) throw new Error("Pick a top-up first");
    const ask = str(fd, "ask");
    if (!isUuid(ask)) throw new Error("Not found");
    const esimId = id(fd, "esimId");
    await deskTopupEsim(esimId, packageId, await actor("desk.refund"), ask);
    revalidatePath(`/adminwork/desk/esims/${esimId}`);
    return done("Topped up. The traveller has a line in the app");
  } catch (e) { return toState(e); }
}

export async function esimNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const esimId = id(fd, "esimId");
    await deskNoteEsim(esimId, str(fd, "note"), await actor("desk.act"));
    revalidatePath(`/adminwork/desk/esims/${esimId}`);
    return done("Sent to the traveller");
  } catch (e) { return toState(e); }
}
