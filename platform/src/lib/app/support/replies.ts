import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { DESK_PHONE, firstNameOf, t, type SupportCard, type SupportIntent } from "@mada/shared";
import { db } from "@/db";
import { appPayments, appPeople, appRefunds, appSegments, appTrips } from "@/db/app-schema";
import { appCards } from "@/db/app-schema-wallet";
import { supplierMode } from "../config";
import { cardLabel } from "../account/cards";

/*
 * Instant answers from Mada (Support.jsx `answer`), in Mada's voice ("we"), written for what was asked.
 * Nothing claims to be done unless it was: rebooking, seats and bag claims are "we're on it", and a person
 * confirms them. Safety answers (someone hurt, help at the airport) are fixed templates and always sent.
 */

export type Reply = { body: string; card?: SupportCard };

export type ReplyInput =
  | { kind: "intent"; intent: SupportIntent; userId: string; tripId: string | null; text: string }
  | { kind: "pick"; choice: string; label: string; userId: string; tripId: string | null; text: string }
  | { kind: "bag"; ref: string; to: string; userId: string; tripId: string | null; text: string }
  | { kind: "bagNone"; userId: string; tripId: string | null; text: string };

export const isSafetyIntent = (i: SupportIntent) => i === "urgent" || i === "airport";

/** Instant answers beyond the safety templates: on in mock mode, or with SUPPORT_AUTOREPLY=on. */
export function autoReplyOn(): boolean {
  const v = process.env.SUPPORT_AUTOREPLY;
  if (v === "on") return true;
  if (v === "off") return false;
  return supplierMode("ai") === "mock";
}

async function nextTrip(userId: string, tripId: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  const [trip] = tripId
    ? await db.select().from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, userId)))
    : await db.select().from(appTrips).where(and(eq(appTrips.ownerId, userId), gte(appTrips.startDate, today))).orderBy(asc(appTrips.startDate)).limit(1);
  if (!trip) return null;
  const segments = await db.select().from(appSegments).where(eq(appSegments.tripId, trip.id)).orderBy(asc(appSegments.sort));
  return { trip, segments };
}

async function latestRefund(userId: string) {
  const [r] = await db.select({ amount: appRefunds.amount, stage: appRefunds.stage, reason: appRefunds.reason, label: appPayments.label })
    .from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId))
    .where(eq(appPayments.ownerId, userId)).orderBy(desc(appRefunds.createdAt)).limit(1);
  return r ?? null;
}

async function defaultCardLabel(userId: string) {
  const [c] = await db.select().from(appCards).where(and(eq(appCards.userId, userId), isNull(appCards.deletedAt))).orderBy(desc(appCards.createdAt)).limit(1);
  return c ? cardLabel(c) : "your card";
}

export async function autoReplies(input: ReplyInput): Promise<Reply[]> {
  if (input.kind === "bagNone") return [{ body: t("support.reply.bagNone") }];
  if (input.kind === "bag") {
    return [{
      body: t("support.reply.bagFiled", { ref: input.ref }),
      card: {
        steps: [t("support.reply.bagStep1"), t(/hotel/i.test(input.to) ? "support.reply.bagStep2Hotel" : "support.reply.bagStep2Home"), t("support.reply.bagStep3"), t("support.reply.bagStep4")],
        resolved: true,
      },
    }];
  }
  if (input.kind === "pick") {
    if (input.choice === "refund") return [{ body: t("support.reply.pickedRefund"), card: { action: { label: t("support.reply.refundStart"), to: "/trips" } } }];
    return [{ body: t("support.reply.picked", { flight: input.label.split(" · ")[0] ?? input.label }), card: { resolved: true } }];
  }

  const text = input.text.toLowerCase();
  switch (input.intent) {
    case "urgent":
      return [{ body: t("support.reply.urgent", { phone: DESK_PHONE }), card: { urgent: true, intent: "urgent" } }];
    case "airport":
      return [{ body: t("support.reply.airport"), card: { urgent: true, intent: "airport" } }];
    case "bag":
      return [{ body: t("support.reply.bag"), card: { form: "bag", intent: "bag" } }];
    case "missed": {
      const next = await nextTrip(input.userId, input.tripId);
      if (next?.segments.length) {
        return [{
          body: t("support.reply.missedTrip"),
          card: { intent: "missed", choices: [{ label: "Saudia SV265 · leaves 13:30", key: "sv265" }, { label: "flynas XY125 · leaves 10:25", key: "xy125" }, { label: t("support.reply.leaveLater"), key: "refund" }] },
        }];
      }
      return [{ body: t("support.reply.missed") }];
    }
    case "refund": {
      if (/twice|double|charged|deducted/.test(text)) {
        const next = await nextTrip(input.userId, input.tripId);
        return [{ body: next?.trip.bookingRef ? t("support.reply.refundTwiceRef", { ref: next.trip.bookingRef }) : t("support.reply.refundTwice") }];
      }
      const r = await latestRefund(input.userId);
      if (r) {
        return [{
          body: t("support.reply.refundLatest"),
          card: { refund: { amount: r.amount, title: r.reason ?? "Refund", stage: r.stage, card: r.label ?? (await defaultCardLabel(input.userId)) }, action: { label: t("support.reply.refundAnother"), to: "/trips" } },
        }];
      }
      return [{ body: t("support.reply.refundNone"), card: { action: { label: t("support.reply.refundStart"), to: "/trips" } } }];
    }
    case "seat": {
      const next = await nextTrip(input.userId, input.tripId);
      const seg = next?.segments[0];
      if (!next || !seg) return [{ body: t("support.reply.seatNoTrip") }];
      const people = next.trip.travellerIds.length
        ? await db.select({ id: appPeople.id, givenNames: appPeople.givenNames, isSelf: appPeople.isSelf }).from(appPeople).where(inArray(appPeople.id, next.trip.travellerIds))
        : [];
      const names = people.map((p) => ({ name: firstNameOf(p.givenNames), isSelf: p.isSelf })).filter((p) => p.name);
      const who = names.find((p) => new RegExp(`\\b${p.name.toLowerCase()}\\b`).test(text)) ?? names.find((p) => p.isSelf) ?? names[0];
      const other = names.find((p) => p !== who);
      return [{
        body: t("support.reply.seat", { airline: seg.carrierName, seat: t(/window/.test(text) ? "support.reply.seatWindow" : "support.reply.seatAisle"), next: other ? t("support.reply.seatNext", { name: other.name }) : "" }),
      }];
    }
    case "change": {
      const next = await nextTrip(input.userId, input.tripId);
      return [{ body: t("support.reply.change"), ...(next ? { card: { action: { label: t("support.reply.changeFlight"), to: `/trips/${next.trip.id}` } } } : {}) }];
    }
    case "docs":
      return [{ body: t("support.reply.docs") }];
    case "other":
      return [{ body: t("support.reply.other") }];
    case "photo":
      return [{ body: t("support.reply.photo") }];
    default:
      return [{ body: t("support.reply.free") }];
  }
}
