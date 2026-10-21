import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { t, type TravellerRole, type TripChatResponse } from "@mada/shared";
import { db } from "@/db";
import { appAskThreads } from "@/db/app-schema-ask";
import { appTripTravellers } from "@/db/app-schema-trips";
import { AppError } from "../http";
import { localeOfUser } from "../locale";
import { peopleByIds } from "../circles/common";
import { roleOf, tripName } from "../trips/travellers";
import { appendLineTo, type Thread } from "./store";

/*
 * The shared trip chat (docs/app/ASK-INTEGRATED.md §5.5, U8). The trip's owner turns it on: one thread (kind "trip")
 * that everyone going on the trip with a Mada account reads and writes, with Mada in it. It belongs to the owner
 * (owner_id) and its members are the trip's own travellers, read from app_trip_travellers every time, so taking
 * someone off the trip takes them out of the chat. Each person's private chats with Mada stay private. In the chat
 * Mada says who asked for what, and a change asked by someone who can suggest is approved in place: the card goes into
 * this thread, not the owner's own chat (trips/change-requests.ts). Turning it off archives it; what was said is kept.
 */

type Row = typeof appAskThreads.$inferSelect;
export type Member = { userId: string; name: string; initial: string; owner: boolean; role: "owner" | TravellerRole };

const UUID = /^[0-9a-f-]{36}$/i;
const firstOf = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** The owner and everyone going with a Mada account, owner first: the people in the trip chat. */
export async function membersOf(tripId: string, ownerId: string): Promise<Member[]> {
  const rows = await db.select({ userId: appTripTravellers.userId, role: appTripTravellers.role }).from(appTripTravellers)
    .where(and(eq(appTripTravellers.tripId, tripId), eq(appTripTravellers.status, "going"))).orderBy(asc(appTripTravellers.createdAt));
  const others = rows.filter((r): r is { userId: string; role: string } => !!r.userId && r.userId !== ownerId);
  const names = await peopleByIds([ownerId, ...others.map((r) => r.userId)]);
  const of = (id: string) => firstOf(names.get(id)?.short ?? "") || t("circles.someone");
  return [
    { userId: ownerId, name: of(ownerId), initial: initialOf(of(ownerId)), owner: true, role: "owner" as const },
    ...others.map((r) => ({ userId: r.userId, name: of(r.userId), initial: initialOf(of(r.userId)), owner: false, role: r.role as TravellerRole })),
  ];
}

/** The trip's chat row, on or off (archived), or null when it was never turned on. */
async function chatRow(tripId: string): Promise<Row | null> {
  const [r] = await db.select().from(appAskThreads).where(and(eq(appAskThreads.tripId, tripId), eq(appAskThreads.kind, "trip"))).limit(1);
  return r ?? null;
}

const view = (members: Member[], viewer: string) => members.map((m) => ({ name: m.name, initial: m.initial, owner: m.owner, me: m.userId === viewer }));

/** Whether the trip chat is on, its thread and who's in it. Anyone on the trip may ask; others get NOT_FOUND. */
export async function tripChat(userId: string, tripId: string): Promise<TripChatResponse> {
  const who = await roleOf(userId, tripId);
  if (!who) throw new AppError("NOT_FOUND");
  const row = await chatRow(tripId);
  const on = !!row && !row.archivedAt;
  return { on, threadId: on ? row!.id : null, canManage: who.role === "owner", members: view(await membersOf(tripId, who.trip.ownerId), userId) };
}

/**
 * The owner turns the trip chat on (a thread titled with the trip, and one line from Mada saying who reads it) or off
 * (archived: nothing is deleted, and turning it on again brings the same thread back).
 */
export async function setTripChat(ownerId: string, tripId: string, on: boolean): Promise<TripChatResponse> {
  const who = await roleOf(ownerId, tripId);
  if (!who) throw new AppError("NOT_FOUND");
  if (who.role !== "owner") throw new AppError("FORBIDDEN");
  const row = await chatRow(tripId);
  if (on && !row) {
    const lang = await localeOfUser(ownerId);
    const title = await tripName(who.trip);
    const [made] = await db.insert(appAskThreads).values({ ownerId, tripId, kind: "trip", lang, title, titledBy: "traveller" }).onConflictDoNothing().returning({ id: appAskThreads.id });
    if (made) await appendLineTo(made.id, { who: "mada", text: t("tripChat.first", { trip: title }, lang), at: new Date().toISOString() });
  } else if (row) {
    await db.update(appAskThreads).set({ archivedAt: on ? null : new Date(), ...(on ? { lastAt: new Date() } : {}) }).where(eq(appAskThreads.id, row.id));
  }
  return tripChat(ownerId, tripId);
}

/**
 * A trip chat this person may read and write: on (not archived), on a trip they're going on. The owner reads it as
 * one of their own threads, so this is only asked for someone else's.
 */
export async function sharedThreadRow(userId: string, threadId: string | null | undefined): Promise<Row | null> {
  if (!threadId || !UUID.test(threadId)) return null;
  const [r] = await db.select().from(appAskThreads).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.kind, "trip"))).limit(1);
  if (!r || !r.tripId || r.archivedAt) return null;
  return (await roleOf(userId, r.tripId)) ? r : null;
}

/** The trip chats someone else owns that this person is in: for the conversations list. */
export async function sharedThreadIds(userId: string): Promise<string[]> {
  const going = await db.select({ tripId: appTripTravellers.tripId }).from(appTripTravellers)
    .where(and(eq(appTripTravellers.userId, userId), eq(appTripTravellers.status, "going")));
  if (!going.length) return [];
  const rows = await db.select({ id: appAskThreads.id, ownerId: appAskThreads.ownerId }).from(appAskThreads)
    .where(and(eq(appAskThreads.kind, "trip"), inArray(appAskThreads.tripId, going.map((g) => g.tripId))));
  return rows.filter((r) => r.ownerId !== userId).map((r) => r.id);
}

/**
 * The context line for a turn in the trip chat: who's in it and what each may do, and the rule that Mada says who
 * asked for what. The words of each message come in front of it as "Name: …".
 */
export async function tripChatContext(thread: Pick<Thread, "tripId" | "title">, ownerId: string, speaker: string): Promise<string> {
  const members = thread.tripId ? await membersOf(thread.tripId, ownerId) : [];
  const roles = members.map((m) => `${m.name} (${m.owner ? "organiser" : m.role === "edit" ? "can edit" : m.role === "view" ? "can view" : "can suggest"})`).join(", ");
  const me = members.find((m) => m.userId === speaker);
  return [
    `This is the shared trip chat for ${thread.title ?? "the trip"}: everyone on the trip reads it. People: ${roles}.`,
    `Each message starts with the name of who wrote it; this one is from ${me?.name ?? "a traveller"}${me && !me.owner ? ` (${me.role === "edit" ? "can edit" : me.role === "view" ? "can view" : "can suggest"})` : ""}. Say who asked for what when it helps.`,
    me && !me.owner ? "Changes they ask for go to the organiser with request_change; the organiser approves them here." : "",
  ].filter(Boolean).join(" ");
}

/** The name in front of a member's words for the model, first name only. */
export async function speakerName(userId: string): Promise<string> {
  return firstOf((await peopleByIds([userId])).get(userId)?.short ?? "") || "Traveller";
}
