import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { audit } from "./audit";
import { nextRef } from "./refs";
import { getSettings } from "./settings";
import { sar } from "./money";
import { riyadhDate } from "./dates";
import type { Permission } from "./permissions";

export type ApprovalKind = "credit" | "expense" | "refund" | "credit_limit" | "settlement" | "governance";

type ReqLike = { approverPool: string; requestedBy: string; kind: string; entityId: string; payload?: unknown };

/**
 * The partner (if any) with a personal stake in a request, who therefore can't vote on it:
 * the partner reimbursed by an expense, or the partner receiving an advance.
 */
async function conflictedPartner(tx: Tx, r: ReqLike): Promise<string | null> {
  if (r.kind === "expense") {
    const [e] = await tx.select({ p: schema.expenses.partnerId, by: schema.expenses.paidBy }).from(schema.expenses).where(eq(schema.expenses.id, r.entityId));
    return e?.by === "partner" ? e.p : null;
  }
  const p = r.payload as { partnerId?: string } | null | undefined;
  return r.kind === "governance" && p?.partnerId ? p.partnerId : null;
}

/**
 * People who may vote on a request. Separation of duties is by person AND by partner: the requester never votes on their
 * own request (except the Day-25 settlement, which every director signs), nor does anyone linked to the same partner,
 * nor a partner who personally benefits from it.
 */
export async function eligibleApprovers(tx: Tx, r: ReqLike) {
  const selfAllowed = r.kind === "settlement";
  const users = await tx.select({ id: schema.users.id, name: schema.users.name, partnerId: schema.users.partnerId, perms: schema.roles.permissions, isDirector: schema.partners.isDirector })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .leftJoin(schema.partners, eq(schema.partners.id, schema.users.partnerId))
    .where(eq(schema.users.active, true));
  const requester = users.find((u) => u.id === r.requestedBy);
  const [{ p: requesterPartner } = { p: null }] = requester ? [{ p: requester.partnerId }]
    : await tx.select({ p: schema.users.partnerId }).from(schema.users).where(eq(schema.users.id, r.requestedBy));
  const conflict = await conflictedPartner(tx, r);
  const seenPartner = new Set<string>();
  return users.filter((u) => {
    if (!selfAllowed && (u.id === r.requestedBy || (requesterPartner && u.partnerId === requesterPartner))) return false;
    if (conflict && u.partnerId === conflict) return false;
    let ok = false;
    if (r.approverPool === "directors") ok = !!u.isDirector && (u.perms as string[]).includes("approvals.decide");
    else if (r.approverPool.startsWith("permission:")) ok = (u.perms as string[]).includes(r.approverPool.slice(11) as Permission);
    // One vote per partner, however many logins might point at them.
    if (ok && u.partnerId) { if (seenPartner.has(u.partnerId)) return false; seenPartner.add(u.partnerId); }
    return ok;
  });
}

/** For "all directors must agree": every director partner who is allowed to vote on it, counted from the partners table. */
async function allDirectorsRequired(tx: Tx, r: ReqLike) {
  const directors = await tx.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.isDirector, true));
  const [req] = await tx.select({ p: schema.users.partnerId }).from(schema.users).where(eq(schema.users.id, r.requestedBy));
  const conflict = await conflictedPartner(tx, r);
  return directors.filter((d) => (r.kind === "settlement" || d.id !== req?.p) && d.id !== conflict).length;
}

type CreateInput = {
  kind: ApprovalKind; entityType: string; entityId: string; title: string;
  amount: number; reason?: string | null; requestedBy: string;
  routeAmount?: number;  // the amount the rules look at, when it differs from the amount shown (e.g. the client's total exposure)
  payload?: unknown;     // governance changes: what will be applied
};

/** Open an approval request, choosing the route from the governance rules. */
export async function createApproval(tx: Tx, input: CreateInput) {
  const s = await getSettings(tx);
  let pool = "directors", required = 1, requiresAll = false, rule = "";
  const routeAmount = Math.max(input.amount, input.routeAmount ?? 0);

  if (input.kind === "credit" || input.kind === "credit_limit") {
    if (routeAmount <= s.creditDualLimit) {
      required = 2; rule = `Up to SAR ${sar(s.creditDualLimit)}: any 2 directors approve`;
    } else {
      requiresAll = true; rule = `Above SAR ${sar(s.creditDualLimit)} (client total ${sar(routeAmount)}): all directors must agree`;
    }
  } else if (input.kind === "expense") {
    // Money paid back to a partner is decided by the other directors; everyday expenses by verifiers.
    const [e] = await tx.select({ by: schema.expenses.paidBy }).from(schema.expenses).where(eq(schema.expenses.id, input.entityId));
    if (e?.by === "partner") pool = "directors";
    else pool = "permission:expenses.verify";
    required = input.amount > s.expenseDualLimit ? 2 : 1;
    rule = pool === "directors" ? `Partner reimbursement: ${required} other director${required > 1 ? "s" : ""}` : required === 2 ? `Above SAR ${sar(s.expenseDualLimit)}: 2 verifiers` : "1 verifier (never the person who submitted it)";
  } else if (input.kind === "refund") {
    required = s.refundApprovals; rule = `${required} director approves refunds`;
  } else if (input.kind === "settlement") {
    requiresAll = true; rule = "All directors sign the Day-25 settlement";
  } else if (input.kind === "governance") {
    requiresAll = true; rule = "Governance change: every other director must agree";
  }

  const probe = { approverPool: pool, requestedBy: input.requestedBy, kind: input.kind, entityId: input.entityId, payload: input.payload };
  const eligible = await eligibleApprovers(tx, probe);
  if (requiresAll) required = await allDirectorsRequired(tx, probe);
  // A partner reimbursement recorded by another partner leaves fewer uninvolved directors (neither the one who
  // recorded it nor the one being repaid may vote). Then every director who isn't involved must approve.
  if (input.kind === "expense" && pool === "directors" && eligible.length >= 1 && eligible.length < required) {
    required = eligible.length;
    rule = "Partner reimbursement: every director not involved approves";
  }
  if (required < 1 || eligible.length < required) {
    throw new Error("Not enough approvers are available for this request. Ask a partner to check the team's roles");
  }

  const ref = await nextRef(tx, "AP");
  const [req] = await tx.insert(schema.approvalRequests).values({
    ref, kind: input.kind, entityType: input.entityType, entityId: input.entityId,
    title: input.title, amount: input.amount, reason: input.reason ?? null, requestedBy: input.requestedBy,
    requiredApprovals: required, requiresAll, approverPool: pool, rule, payload: input.payload ?? null,
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

  const eligible = await eligibleApprovers(tx, req);
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

  // Only votes from people who are still eligible count (someone deactivated or moved off the role no longer does).
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const votes = (await tx.select().from(schema.approvalDecisions).where(eq(schema.approvalDecisions.requestId, requestId))).filter((v) => eligibleIds.has(v.userId));
  const approvals = votes.filter((v) => v.decision === "approve").length;
  const rejections = votes.filter((v) => v.decision === "reject").length;
  // "All directors" can only grow while the request is open, never shrink.
  const required = req.requiresAll ? Math.max(req.requiredApprovals, await allDirectorsRequired(tx, req)) : req.requiredApprovals;
  const stillPossible = eligible.length - rejections;

  let outcome: "approved" | "rejected" | null = null;
  if (approvals >= required) outcome = "approved";
  else if (stillPossible < required) outcome = "rejected";

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
      await audit(tx, { actorId: null, action: ok ? "booking.credit_granted" : "booking.voided", entityType: "booking", entityId: b.id, entityRef: b.ref,
        summary: ok ? `Credit approved for ${b.ref}; sent to issuance` : `${b.ref} voided: credit ${outcome}` });
      return;
    }
    case "credit_limit": {
      if (!ok) return;
      const [c] = await tx.select().from(schema.clients).where(eq(schema.clients.id, req.entityId));
      if (!c) return;
      await tx.update(schema.clients).set({ creditLimit: req.amount }).where(eq(schema.clients.id, c.id));
      await audit(tx, { actorId: null, action: "client.credit_limit_changed", entityType: "client", entityId: c.id, entityRef: c.name,
        summary: `Credit limit for ${c.name} set to SAR ${sar(req.amount)}`, changes: { creditLimit: { from: c.creditLimit, to: req.amount } } });
      return;
    }
    case "expense": {
      const [e] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, req.entityId));
      if (!e || e.status !== "pending") return;
      const status = ok ? "approved" : "rejected";
      await tx.update(schema.expenses).set({ status }).where(eq(schema.expenses.id, e.id));
      await audit(tx, { actorId: null, action: `expense.${status}`, entityType: "expense", entityId: e.id, entityRef: e.ref, summary: `${e.ref} ${status}: ${e.description}` });
      // Paid personally by a partner → the company now owes it back (Partner Equity Ledger).
      if (ok && e.paidBy === "partner" && e.partnerId) {
        await tx.insert(schema.ledgerEntries).values({
          partnerId: e.partnerId, type: e.isStartup ? "advance" : "expense", amount: e.amount,
          description: `${e.ref} · ${e.description}`, sourceType: "expense", sourceId: e.id, entryDate: riyadhDate(), createdBy: actorId,
        });
        await audit(tx, { actorId: null, action: "ledger.credited", entityType: "expense", entityId: e.id, entityRef: e.ref, summary: `SAR ${sar(e.amount)} added to partner ledger from ${e.ref}` });
      }
      return;
    }
    case "refund": {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, req.entityId));
      if (!b || !ok) return;
      await tx.update(schema.bookings).set({ status: "refunded", updatedAt: new Date() }).where(eq(schema.bookings.id, b.id));
      await audit(tx, { actorId: null, action: "booking.refunded", entityType: "booking", entityId: b.id, entityRef: b.ref, summary: `${b.ref} refunded` });
      return;
    }
    case "governance": {
      if (!ok) return;
      const { applyGovernance } = await import("./governance");
      await applyGovernance(tx, req, actorId);
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
    const el = await eligibleApprovers(tx, p);
    if (el.some((e) => e.id === userId)) out.push(p);
  }
  return out;
}

