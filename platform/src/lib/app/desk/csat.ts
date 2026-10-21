import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { appAudit } from "@/db/app-schema";
import { appAgents, deskTicketEvents, deskTickets } from "@/db/app-schema-desk";
import { applyMove, type TicketStatus } from "./ticket-state";
import { AppError } from "../http";

/*
 * CSAT (DESK-PLAN.md §7 default 4): after the desk resolves a conversation or ticket that a person answered, the
 * traveller's support chat shows a one-tap rating, once. Rated or skipped, csat_at is set and it isn't asked again;
 * a rating also closes a resolved ticket (the plan's "CSAT given → closed"). Shown per agent on Performance.
 */

/** How long after resolving the rating is still asked. */
export const CSAT_WINDOW_DAYS = 7;

/** The resolved ticket waiting for this traveller's rating, newest first, or null. */
export async function pendingCsat(userId: string, now = new Date()) {
  const [row] = await db.select({ id: deskTickets.id, agent: appAgents.displayName }).from(deskTickets)
    .leftJoin(appAgents, eq(appAgents.id, deskTickets.ownerAgentId))
    .where(and(
      eq(deskTickets.customerId, userId), inArray(deskTickets.status, ["resolved", "closed"]), isNull(deskTickets.csatAt), isNull(deskTickets.mergedIntoId),
      isNotNull(deskTickets.firstResponseAt), gt(deskTickets.resolvedAt, new Date(now.getTime() - CSAT_WINDOW_DAYS * 86400_000)),
    ))
    .orderBy(desc(deskTickets.resolvedAt)).limit(1);
  return row ? { ticketId: row.id, agent: row.agent ?? null } : null;
}

/** The traveller's answer: 1–5, or null to skip. Answering twice keeps the first answer. */
export async function rateTicket(userId: string, ticketId: string, score: number | null, now = new Date()) {
  if (score !== null && !(Number.isInteger(score) && score >= 1 && score <= 5)) throw new AppError("VALIDATION");
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(deskTickets).where(and(eq(deskTickets.id, ticketId), eq(deskTickets.customerId, userId))).for("update");
    if (!t) throw new AppError("NOT_FOUND");
    if (t.csatAt) return { csat: t.csat, already: true };
    if (t.status !== "resolved" && t.status !== "closed") throw new AppError("NOT_FOUND");
    const close = score !== null && t.status === "resolved" ? applyMove({ ...t, status: t.status as TicketStatus }, "close", now) : {};
    await tx.update(deskTickets).set({ ...close, csat: score, csatAt: now, updatedAt: now }).where(eq(deskTickets.id, t.id));
    await tx.insert(deskTicketEvents).values({ ticketId: t.id, actorId: null, kind: "csat", to: score === null ? "skipped" : String(score), at: now,
      body: score === null ? "The traveller skipped the rating" : `The traveller rated it ${score} of 5` });
    if (close.status) await tx.insert(deskTicketEvents).values({ ticketId: t.id, actorId: null, kind: "status", from: t.status, to: close.status, at: now, body: "Rated: closed" });
    await tx.insert(appAudit).values({ actorKind: "user", actorId: userId, action: "support.csat", entityType: "desk_ticket", entityId: t.id,
      summary: score === null ? "Skipped rating the help" : `Rated the help ${score} of 5`, data: { score } });
    return { csat: score, already: false };
  });
}
