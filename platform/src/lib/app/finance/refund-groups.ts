import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { formatSar } from "@mada/shared";
import { db, schema, type Tx } from "@/db";
import { appPayments, appRefunds } from "@/db/app-schema";
import { appRefundGroups, appRefundItems } from "@/db/app-schema-trips";
import { supplierMode } from "@/lib/app/config";
import { bookingSuppliers } from "@/lib/app/booking/common";
import { appAuditLog } from "@/lib/app/audit";
import { shortRef } from "@/lib/app/desk/core";
import { notify } from "@/lib/app/trips/notify";

/*
 * The traveller's refund (app_refund_groups, what the Requests tracker shows) and the desk's refunds (app_refunds, one
 * per payment) move together: whenever the desk, the finance job or the rules move an app_refunds row, the group takes
 * the stage of its slowest live row (requested < approved < sent) and the bank reference. The traveller hears once per
 * step of the group, never once per payment (one push per step: requested, approved, sent, or in the Mada Wallet).
 */

const RANK: Record<string, number> = { requested: 0, awaiting_lead: 0, lead_approved: 0, approved: 1, sent: 2, settled: 2 };
const STAGES = ["requested", "approved", "sent"] as const;
type Group = typeof appRefundGroups.$inferSelect;
export type GroupStep = { group: Group; before: string; changed: boolean };

/** Bring the group of this app_refunds row up to date. Null when the refund has no group (a booking order's refund). */
export async function syncRefundGroup(tx: Tx, refundId: string, at = new Date()): Promise<GroupStep | null> {
  const [it] = await tx.select({ groupId: appRefundItems.groupId }).from(appRefundItems).where(eq(appRefundItems.refundId, refundId));
  if (!it) return null;
  const [g] = await tx.select().from(appRefundGroups).where(eq(appRefundGroups.id, it.groupId)).for("update");
  if (!g || g.stage === "withdrawn") return null;
  const rows = await tx.select({ stage: appRefunds.stage, destination: appRefunds.destination, ref: appRefunds.bankReference, sentAt: appRefunds.sentAt, autoRule: appRefunds.autoRule, reason: appRefunds.reason })
    .from(appRefunds).innerJoin(appRefundItems, eq(appRefundItems.refundId, appRefunds.id)).where(eq(appRefundItems.groupId, g.id));
  const live = rows.filter((r) => r.stage !== "rejected");
  const stage = live.length ? STAGES[Math.min(...live.map((r) => RANK[r.stage] ?? 0))]! : "rejected";
  const ref = [...new Set(live.map((r) => r.ref).filter((x): x is string => !!x))].join(" / ") || null;
  const sent = live.map((r) => r.sentAt?.getTime() ?? 0).filter(Boolean);
  // The desk may send it the other way than asked (to the card when the wallet was asked, or the other way round).
  const destination = g.destination === "instalments" ? g.destination : live.length && live.every((r) => r.destination === "credit") ? "credit" : live.length ? "original" : g.destination;
  const patch: Partial<Group> = {
    stage, destination, bankReference: ref, auto: live.length > 0 && live.every((r) => !!r.autoRule),
    sentAt: stage === "sent" ? (sent.length ? new Date(Math.max(...sent)) : g.sentAt ?? at) : null,
    ...(stage === "rejected" && !g.anyway ? { reject: rows.find((r) => r.stage === "rejected")?.reason ?? g.reject } : {}),
  };
  const same = (Object.keys(patch) as (keyof Group)[]).every((k) => String(patch[k] ?? "") === String(g[k] ?? "") || (patch[k] instanceof Date && g[k] instanceof Date && (patch[k] as Date).getTime() === (g[k] as Date).getTime()));
  if (same) return { group: g, before: g.stage, changed: false };
  const [u] = await tx.update(appRefundGroups).set({ ...patch, updatedAt: at }).where(eq(appRefundGroups.id, g.id)).returning();
  return { group: u!, before: g.stage, changed: u!.stage !== g.stage };
}

const TRACKER = "/trips?tab=requests";
export const WALLET_HREF = "/wallet?credit=1";

/**
 * The one push for a group's new step: approved (card), sent to the card (with the bank's reference when there is one),
 * or in the Mada Wallet. Requested-and-waiting is sent by createRefund; a no comes from the desk with its reason.
 */
export async function notifyGroupStep(tx: Tx | typeof db, g: Group) {
  const amount = formatSar(g.amount);
  const data = { refundGroupId: g.id };
  if (g.stage === "sent" && g.destination === "credit") return notify(g.ownerId, { kind: "refund_moved", level: "active", copy: "notify.trip.credit", vars: { amount }, href: WALLET_HREF, data }, tx);
  if (g.stage === "sent") return notify(g.ownerId, { kind: "refund_moved", level: "active", copy: g.bankReference ? "notify.refundRef" : "notify.refund", vars: { amount, card: g.card, ...(g.bankReference ? { ref: g.bankReference } : {}) }, href: TRACKER, data }, tx);
  if (g.stage === "approved") return notify(g.ownerId, { kind: "refund_moved", level: "active", copy: "notify.refundApproved", vars: { amount, card: g.card }, href: TRACKER, data }, tx);
  return null;
}

/** "We're looking at your refund": only when it waits for a person. */
export const notifyLooking = (ownerId: string, g: Pick<Group, "id" | "amount">) =>
  notify(ownerId, { kind: "refund_moved", level: "active", copy: "notify.refundLooking", vars: { amount: formatSar(g.amount) }, href: TRACKER, data: { refundGroupId: g.id } });

const SEEDED = /^mf_seed_/;

/**
 * A card refund the rules approved goes straight to the provider, as the desk's approval would (finance job then
 * confirms it sent). If the provider turns it down it goes back to the desk to decide, and the rule is cleared.
 * Returns whether every row reached the provider.
 */
export async function sendAutoCardRefunds(refundIds: string[]): Promise<boolean> {
  let all = true;
  for (const id of refundIds) {
    const [x] = await db.select({ f: appRefunds, p: appPayments }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId)).where(eq(appRefunds.id, id));
    if (!x || x.f.stage !== "approved" || x.f.providerRef) continue;
    let providerRef: string | null = null;
    if (x.p.providerRef && x.p.method !== "credit") {
      if (supplierMode("payments") === "mock" && SEEDED.test(x.p.providerRef)) providerRef = `${x.p.providerRef}_rf${id.slice(0, 6)}`;
      else {
        const res = await bookingSuppliers.payments().refund(x.p.providerRef, x.f.amount, `refund:${id}`).catch(() => null);
        providerRef = res && (res.status === "refunded" || res.status === "partially_refunded") ? res.providerRef : null;
      }
    }
    await db.transaction(async (tx) => {
      const now = new Date();
      if (providerRef) {
        await tx.update(appRefunds).set({ providerRef, updatedAt: now }).where(eq(appRefunds.id, id));
        const [s] = await tx.select({ s: sql<number>`coalesce(sum(${appRefunds.amount}),0)::bigint` }).from(appRefunds).where(and(eq(appRefunds.paymentId, x.p.id), inArray(appRefunds.stage, ["approved", "sent", "settled"])));
        await tx.update(appPayments).set({ status: Number(s?.s ?? 0) >= x.p.amount ? "refunded" : "partially_refunded", updatedAt: now }).where(eq(appPayments.id, x.p.id));
        return;
      }
      all = false;
      await tx.update(appRefunds).set({ stage: "requested", autoRule: null, decidedAt: null, note: "Approved by the rules, but the card refund didn't go through at the provider. Decide it again", updatedAt: now }).where(eq(appRefunds.id, id));
      await tx.insert(schema.auditEvents).values({ actorId: null, action: "desk.refund.auto_failed", entityType: "desk", entityId: id, entityRef: shortRef(id, "F"), summary: `The rules approved a card refund of ${formatSar(x.f.amount)}, but the provider didn't take it; it is back with the desk` });
      await syncRefundGroup(tx, id, now);
    });
  }
  return all;
}

/** Write an auto-approval to both logs: the app's audit (the traveller's account) and Ops (what the desk reads). */
export async function auditAuto(tx: Tx, v: { ownerId: string; groupId: string | null; refundIds: string[]; amount: number; rule: string; destination: string }) {
  await appAuditLog(tx, {
    actorKind: "system", actorId: null, action: "refund.auto_approved", entityType: "app_refund_group", entityId: v.groupId ?? v.refundIds[0]!,
    summary: `Approved a refund of ${formatSar(v.amount)} at once by the rules: ${v.rule}`, data: { rule: v.rule, refundIds: v.refundIds, destination: v.destination, userId: v.ownerId }, ipHash: null,
  });
  for (const id of v.refundIds) {
    await tx.insert(schema.auditEvents).values({ actorId: null, action: "desk.refund.auto_approved", entityType: "desk", entityId: id, entityRef: shortRef(id, "F"),
      summary: `Auto-approved a refund to ${v.destination === "credit" ? "the Mada Wallet" : "the card"}: ${v.rule}` });
  }
}
