import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { audit } from "./audit";
import { nextRef } from "./refs";
import { getSettings } from "./settings";
import { sar } from "./money";
import { riyadhDate } from "./dates";
import type { Permission } from "./permissions";

export type ApprovalKind = "credit" | "expense" | "refund" | "credit_limit" | "settlement";

/** People who may vote on a request from a given pool. The requester never votes on their own request,
 *  except on the Day-25 settlement, where every director (including whoever prepared it) signs. */
export async function eligibleApprovers(tx: Tx, pool: string, requesterId: string, kind: string) {
  const selfAllowed = kind === "settlement";
  const users = await tx.select({ id: schema.users.id, name: schema.users.name, perms: schema.roles.permissions, isDirector: schema.partners.isDirector })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .leftJoin(schema.partners, eq(schema.partners.id, schema.users.partnerId))
    .where(eq(schema.users.active, true));
  return users.filter((u) => {
    if (!selfAllowed && u.id === requesterId) return false;
    if (pool === "directors") return !!u.isDirector && (u.perms as string[]).includes("approvals.decide");
    if (pool.startsWith("permission:")) return (u.perms as string[]).includes(pool.slice(11) as Permission);
    return false;
  });
}

type CreateInput = {
  kind: ApprovalKind; entityType: string; entityId: string; title: string;
  amount: number; reason?: string | null; requestedBy: string;
};

/** Open an approval request, choosing the route from the governance rules. */
export async function createApproval(tx: Tx, input: CreateInput) {
  const s = await getSettings(tx);
  let pool = "directors", required = 1, requiresAll = false, rule = "";

  if (input.kind === "credit" || input.kind === "credit_limit") {
    if (input.amount <= s.creditDualLimit) {
      required = 2; rule = `Up to SAR ${sar(s.creditDualLimit)}: any 2 directors approve`;
    } else {
      requiresAll = true; rule = `Above SAR ${sar(s.creditDualLimit)}: all directors must agree`;
    }
  } else if (input.kind === "expense") {
    pool = "permission:expenses.verify";
    required = input.amount > s.expenseDualLimit ? 2 : 1;
    rule = required === 2 ? `Above SAR ${sar(s.expenseDualLimit)}: 2 verifiers` : "1 verifier (never the person who submitted it)";
  } else if (input.kind === "refund") {
    required = s.refundApprovals; rule = `${required} director approves refunds`;
  } else if (input.kind === "settlement") {
    requiresAll = true; rule = "All directors sign the Day-25 settlement";
  }

  const eligible = await eligibleApprovers(tx, pool, input.requestedBy, input.kind);
  if (requiresAll) required = eligible.length;
  if (eligible.length < required) {
    throw new Error(`This needs ${required} approvers but only ${eligible.length} eligible people exist. Check team roles.`);
  }

  const ref = await nextRef(tx, "AP");
  const [req] = await tx.insert(schema.approvalRequests).values({
    ref, kind: input.kind, entityType: input.entityType, entityId: input.entityId,
    title: input.title, amount: input.amount, reason: input.reason ?? null, requestedBy: input.requestedBy,
    requiredApprovals: required, requiresAll, approverPool: pool, rule,
  }).returning();

  await audit(tx, {
    actorId: input.requestedBy, action: "approval.requested", entityType: "approval", entityId: req.id, entityRef: ref,
    summary: `Requested ${input.kind.replace("_", " ")} approval: ${input.title}`, changes: { rule, amount: input.amount },
  });
  return req;
}

export class ApprovalError extends Error {}

/** Cast a vote. Resolves the request (and applies its effect) when the rule is met or can no longer be met. */
export async function decide(tx: Tx, requestId: string, userId: string, decision: "approve" | "reject", remark: string | null) {
  const [req] = await tx.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, requestId)).for("update");
  if (!req) throw new ApprovalError("Request not found");
  if (req.status !== "pending") throw new ApprovalError("This request is already decided");
  if (decision === "reject" && !remark?.trim()) throw new ApprovalError("Add a remark so the requester knows why");

  const eligible = await eligibleApprovers(tx, req.approverPool, req.requestedBy, req.kind);
  if (!eligible.some((e) => e.id === userId)) throw new ApprovalError("You are not an approver for this request");

  const existing = await tx.select().from(schema.approvalDecisions)
    .where(and(eq(schema.approvalDecisions.requestId, requestId), eq(schema.approvalDecisions.userId, userId)));
  if (existing.length) throw new ApprovalError("You already voted on this request");

  await tx.insert(schema.approvalDecisions).values({ requestId, userId, decision, remark: remark?.trim() || null });
  await audit(tx, {
    actorId: userId, action: decision === "approve" ? "approval.approved_vote" : "approval.rejected_vote",
    entityType: "approval", entityId: req.id, entityRef: req.ref,
    summary: `${decision === "approve" ? "Approved" : "Rejected"} ${req.ref}: ${req.title}${remark ? ` · "${remark.trim()}"` : ""}`,
  });

  const votes = await tx.select().from(schema.approvalDecisions).where(eq(schema.approvalDecisions.requestId, requestId));
  const approvals = votes.filter((v) => v.decision === "approve").length;
  const rejections = votes.filter((v) => v.decision === "reject").length;
  const stillPossible = eligible.length - rejections;

  let outcome: "approved" | "rejected" | null = null;
  if (approvals >= req.requiredApprovals) outcome = "approved";
  else if (stillPossible < req.requiredApprovals) outcome = "rejected";

  if (outcome) {
    await tx.update(schema.approvalRequests).set({ status: outcome, decidedAt: new Date() }).where(eq(schema.approvalRequests.id, requestId));
    await audit(tx, {
      actorId: userId, action: `approval.${outcome}`, entityType: "approval", entityId: req.id, entityRef: req.ref,
      summary: `${req.ref} ${outcome}: ${req.title}`,
    });
    await applyOutcome(tx, req, outcome, userId);
  }
  return outcome;
}

export async function cancelApproval(tx: Tx, requestId: string, userId: string) {
  const [req] = await tx.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, requestId)).for("update");
  if (!req || req.status !== "pending") throw new ApprovalError("Only pending requests can be withdrawn");
  if (req.requestedBy !== userId) throw new ApprovalError("Only the requester can withdraw this");
  await tx.update(schema.approvalRequests).set({ status: "cancelled", decidedAt: new Date() }).where(eq(schema.approvalRequests.id, requestId));
  await audit(tx, { actorId: userId, action: "approval.cancelled", entityType: "approval", entityId: req.id, entityRef: req.ref, summary: `Withdrew ${req.ref}: ${req.title}` });
  await applyOutcome(tx, req, "cancelled", userId);
}

type Req = typeof schema.approvalRequests.$inferSelect;

/** What happens to the underlying record once a request is decided. */
async function applyOutcome(tx: Tx, req: Req, outcome: "approved" | "rejected" | "cancelled", actorId: string) {
  const ok = outcome === "approved";
  switch (req.kind) {
    case "credit": {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, req.entityId));
      if (!b || b.status !== "awaiting_credit") return;
      const status = ok ? "pending_issue" : "void";
      await tx.update(schema.bookings).set({ status, updatedAt: new Date(), returnNote: ok ? null : "Credit not approved" }).where(eq(schema.bookings.id, b.id));
      await audit(tx, { actorId, action: ok ? "booking.credit_granted" : "booking.voided", entityType: "booking", entityId: b.id, entityRef: b.ref,
        summary: ok ? `Credit approved for ${b.ref}; sent to issuance` : `${b.ref} voided: credit ${outcome}` });
      return;
    }
    case "credit_limit": {
      if (!ok) return;
      const [c] = await tx.select().from(schema.clients).where(eq(schema.clients.id, req.entityId));
      if (!c) return;
      await tx.update(schema.clients).set({ creditLimit: req.amount }).where(eq(schema.clients.id, c.id));
      await audit(tx, { actorId, action: "client.credit_limit_changed", entityType: "client", entityId: c.id, entityRef: c.name,
        summary: `Credit limit for ${c.name} set to SAR ${sar(req.amount)}`, changes: { creditLimit: { from: c.creditLimit, to: req.amount } } });
      return;
    }
    case "expense": {
      const [e] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, req.entityId));
      if (!e || e.status !== "pending") return;
      const status = ok ? "approved" : "rejected";
      await tx.update(schema.expenses).set({ status }).where(eq(schema.expenses.id, e.id));
      await audit(tx, { actorId, action: `expense.${status}`, entityType: "expense", entityId: e.id, entityRef: e.ref, summary: `${e.ref} ${status}: ${e.description}` });
      // Paid personally by a partner → the company now owes it back (Partner Equity Ledger).
      if (ok && e.paidBy === "partner" && e.partnerId) {
        await tx.insert(schema.ledgerEntries).values({
          partnerId: e.partnerId, type: e.isStartup ? "advance" : "expense", amount: e.amount,
          description: `${e.ref} · ${e.description}`, sourceType: "expense", sourceId: e.id, entryDate: riyadhDate(), createdBy: actorId,
        });
        await audit(tx, { actorId, action: "ledger.credited", entityType: "expense", entityId: e.id, entityRef: e.ref, summary: `SAR ${sar(e.amount)} added to partner ledger from ${e.ref}` });
      }
      return;
    }
    case "refund": {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, req.entityId));
      if (!b || !ok) return;
      await tx.update(schema.bookings).set({ status: "refunded", updatedAt: new Date() }).where(eq(schema.bookings.id, b.id));
      await audit(tx, { actorId, action: "booking.refunded", entityType: "booking", entityId: b.id, entityRef: b.ref, summary: `${b.ref} refunded` });
      return;
    }
    case "settlement": {
      const { finalizeSettlement, reopenSettlement } = await import("./settlement");
      if (ok) await finalizeSettlement(tx, req.entityId, actorId);
      else await reopenSettlement(tx, req.entityId);
      return;
    }
  }
}

/** Requests the given user can vote on right now. */
export async function pendingForUser(tx: Tx, userId: string) {
  const pending = await tx.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.status, "pending"));
  if (!pending.length) return [];
  const voted = await tx.select({ requestId: schema.approvalDecisions.requestId }).from(schema.approvalDecisions)
    .where(and(eq(schema.approvalDecisions.userId, userId), inArray(schema.approvalDecisions.requestId, pending.map((p) => p.id))));
  const votedSet = new Set(voted.map((v) => v.requestId));
  const out: Req[] = [];
  for (const p of pending) {
    if (votedSet.has(p.id)) continue;
    const el = await eligibleApprovers(tx, p.approverPool, p.requestedBy, p.kind);
    if (el.some((e) => e.id === userId)) out.push(p);
  }
  return out;
}

