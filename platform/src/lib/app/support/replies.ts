import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { DESK_PHONE, firstNameOf, isSafetyIntent, supportReplies, type SupportAsk, type SupportContext, type SupportReply } from "@mada/shared";
import { db } from "@/db";
import { appPayments, appPeople, appRefunds, appSegments, appTrips } from "@/db/app-schema";
import { appCards } from "@/db/app-schema-wallet";
import { supplierMode } from "../config";
import { cardLabel } from "../account/cards";

/*
 * Instant answers from Mada: the shared supportReplies (packages/shared/src/support.ts), with what we know about
 * the traveller's trip and refunds. Safety answers (someone hurt, help at the airport) are always sent; the rest run
 * in mock mode, or with SUPPORT_AUTOREPLY=on, until the desk answers everything by hand.
 */

export type Reply = SupportReply;
export { isSafetyIntent };

export function autoReplyOn(): boolean {
  const v = process.env.SUPPORT_AUTOREPLY;
  if (v === "on") return true;
  if (v === "off") return false;
  return supplierMode("ai") === "mock";
}

async function context(userId: string, tripId: string | null): Promise<SupportContext> {
  const today = new Date().toISOString().slice(0, 10);
  const [trip] = tripId
    ? await db.select().from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, userId)))
    : await db.select().from(appTrips).where(and(eq(appTrips.ownerId, userId), gte(appTrips.startDate, today))).orderBy(asc(appTrips.startDate)).limit(1);
  let tripCtx: SupportContext["trip"] = null;
  if (trip) {
    const [seg] = await db.select({ carrierName: appSegments.carrierName }).from(appSegments).where(eq(appSegments.tripId, trip.id)).orderBy(asc(appSegments.sort)).limit(1);
    const people = trip.travellerIds.length
      ? await db.select({ givenNames: appPeople.givenNames, isSelf: appPeople.isSelf }).from(appPeople).where(inArray(appPeople.id, trip.travellerIds))
      : [];
    tripCtx = { id: trip.id, bookingRef: trip.bookingRef, airline: seg?.carrierName ?? null, travellers: people.map((p) => ({ name: firstNameOf(p.givenNames), self: p.isSelf })) };
  }
  const [r] = await db.select({ amount: appRefunds.amount, stage: appRefunds.stage, reason: appRefunds.reason, label: appPayments.label })
    .from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId))
    .where(eq(appPayments.ownerId, userId)).orderBy(desc(appRefunds.createdAt)).limit(1);
  let card = r?.label ?? null;
  if (r && !card) {
    const [c] = await db.select().from(appCards).where(and(eq(appCards.userId, userId), isNull(appCards.deletedAt))).orderBy(desc(appCards.createdAt)).limit(1);
    card = c ? cardLabel(c) : "your card";
  }
  return { trip: tripCtx, refund: r ? { amount: r.amount, title: r.reason ?? "Refund", stage: r.stage, card: card! } : null, deskPhone: DESK_PHONE };
}

export type ReplyInput = SupportAsk & { userId: string; tripId: string | null; text: string };

export async function autoReplies(input: ReplyInput): Promise<Reply[]> {
  return supportReplies(input, await context(input.userId, input.tripId));
}
