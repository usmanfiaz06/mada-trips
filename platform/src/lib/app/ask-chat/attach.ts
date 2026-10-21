import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { DESTINATIONS, nameIn, t, type AskChatEvent, type AskIntent } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { askFastModel, costMicros } from "./config";
import { addSpend } from "./store";
import { datesOf, placeOf, type TitleTrip } from "./titles";

/*
 * New chat or continue (docs/app/ASK-INTEGRATED.md §2.2, owner decision 2): a chat attaches to a trip silently only
 * from the trip page. A first message that names a place the traveller already has a trip to (any city of an upcoming
 * trip, dates overlapping or not said) is answered with one question and a card, "About your AlUla trip, 20–22 Nov?",
 * before any chat is made: "Yes, that trip" sends the same words into the trip's chat, "Something new" starts its own.
 * A trip in the past is never asked about.
 */

type TripRow = { id: string; city: string; startDate: string; endDate: string | null };

/** The caller's own trip, or null (an id that isn't theirs is ignored, as if none was sent). */
export async function ownTrip(ownerId: string, tripId: string): Promise<TripRow | null> {
  const [row] = await db.select({ id: appTrips.id, city: appTrips.city, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips)
    .where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, ownerId))).limit(1);
  return row ?? null;
}

/** What a title needs from the trip a chat is about. */
export async function tripTitleOf(ownerId: string, tripId: string): Promise<TitleTrip | null> {
  const row = await ownTrip(ownerId, tripId);
  return row ? { city: row.city, startDate: row.startDate, endDate: row.endDate } : null;
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z؀-ۿ]+/g, "");

/** Same place: the city as said or its destination key, in English or Arabic. */
function samePlace(city: string, i: Pick<AskIntent, "destination" | "destinationName">): boolean {
  const said = placeOf(i);
  const names = [said, i.destination && i.destination !== "other" ? DESTINATIONS[i.destination]?.name : null].filter((x): x is string => !!x);
  const c = norm(city);
  return !!c && names.some((n) => norm(n) === c || norm(nameIn(n, "ar")) === norm(nameIn(city, "ar")));
}

/** Days said overlap the trip's, or none were said. A month only: the trip touches that month. */
function sameTime(trip: TripRow, i: Pick<AskIntent, "depart" | "return" | "monthOnly">): boolean {
  const end = trip.endDate ?? trip.startDate;
  if (i.depart) return i.depart <= end && (i.return ?? i.depart) >= trip.startDate;
  if (i.monthOnly) {
    const m = `${i.monthOnly.year}-${String(i.monthOnly.month).padStart(2, "0")}`;
    return trip.startDate.slice(0, 7) <= m && end.slice(0, 7) >= m;
  }
  return true;
}

/** The upcoming trip the words are about, or null. */
export async function tripFor(ownerId: string, i: AskIntent, today: string): Promise<TripRow | null> {
  if (!placeOf(i)) return null;
  const rows = await db.select({ id: appTrips.id, city: appTrips.city, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips)
    .where(and(eq(appTrips.ownerId, ownerId), ne(appTrips.status, "cancelled"), sql`coalesce(${appTrips.endDate}, ${appTrips.startDate}) >= ${today}`))
    .orderBy(asc(appTrips.startDate)).limit(20);
  return rows.find((r) => samePlace(r.city, i) && sameTime(r, i)) ?? null;
}

/** The one question, with its card. Nothing is stored: no chat exists until they answer. */
export async function askAttach(ownerId: string, trip: TripRow, slots: { intent: AskIntent; usage: Anthropic.Beta.BetaUsage | null }, lang: string, emit: (e: AskChatEvent) => void): Promise<void> {
  const l = lang === "ar" ? "ar" : "en";
  const place = nameIn(trip.city, l);
  const when = datesOf(trip.startDate, trip.endDate, null, l);
  const line = when ? t("chat.attach.askWhen", { place, when }, l) : t("chat.attach.ask", { place }, l);
  emit({ type: "intent", intent: slots.intent });
  emit({ type: "replace", text: line });
  emit({ type: "cards", cards: [{ type: "attach", tripId: trip.id, place, when }] });
  emit({ type: "done", text: line });
  const cost = slots.usage ? costMicros(askFastModel(), { input: slots.usage.input_tokens ?? 0, output: slots.usage.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 }) : 0;
  if (cost) await addSpend(ownerId, cost);
  console.info(`[ask-chat] attach asked trip=${trip.id}`);
}
