import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { eligibleApprovers } from "./approvals";

export type Req = typeof schema.approvalRequests.$inferSelect;

type Board = { approvers: { id: string; name: string; decision: string | null; remark: string | null; at: Date | null }[]; approvals: number };

/** Who can vote, who has, and what they said. */
export async function voteBoard(reqs: Req[]): Promise<Map<string, Board>> {
  if (!reqs.length) return new Map();
  const decisions = await db.select({ d: schema.approvalDecisions, name: schema.users.name }).from(schema.approvalDecisions)
    .innerJoin(schema.users, eq(schema.users.id, schema.approvalDecisions.userId)).where(inArray(schema.approvalDecisions.requestId, reqs.map((r) => r.id)));
  const out = new Map<string, Board>();
  for (const r of reqs) {
    const pool = await db.transaction((tx) => eligibleApprovers(tx, r));
    const mine = decisions.filter((d) => d.d.requestId === r.id);
    const approvers: Board["approvers"] = pool.map((p) => {
      const d = mine.find((m) => m.d.userId === p.id);
      return { id: p.id, name: p.name, decision: d?.d.decision ?? null, remark: d?.d.remark ?? null, at: d?.d.createdAt ?? null };
    });
    // People who voted but have since lost eligibility still show.
    for (const m of mine) if (!approvers.some((a) => a.id === m.d.userId)) approvers.push({ id: m.d.userId, name: m.name, decision: m.d.decision, remark: m.d.remark, at: m.d.createdAt });
    // Only votes from people still eligible count, the same rule the engine uses.
    out.set(r.id, { approvers, approvals: approvers.filter((a) => a.decision === "approve" && pool.some((p) => p.id === a.id)).length });
  }
  return out;
}

export function entityHref(r: Req) {
  return r.entityType === "booking" ? `/adminwork/sales/${r.entityId}` : r.entityType === "expense" ? `/adminwork/expenses/${r.entityId}` : r.entityType === "client" ? `/adminwork/clients/${r.entityId}` : r.entityType === "settlement" ? `/adminwork/settlement/${r.entityId}` : r.entityType === "governance" ? ((r.payload as { type?: string } | null)?.type === "advance" ? "/adminwork/partners" : "/adminwork/settings") : r.entityType === "cash" || r.entityType === "bsp" ? "/adminwork/finance" : "#";
}
