import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import type { FlightSearchRequest, FlightSearchResponse, OrderPreview, StaySearchRequest, StaySearchResponse } from "@mada/shared";
import { db } from "@/db";
import { appSearchLog } from "@/db/app-schema-dropoffs";

/*
 * The per-traveller search log behind the desk's Drop-offs (lib/app/desk/dropoffs.ts): which booking searches and pay
 * sheets a signed-in traveller opened, as one line each. Guests aren't logged. What goes in is a summary built here from
 * the structured request (places, days, party size, cabin) and the prices the server worked out, nothing the traveller
 * typed and nothing from a passport. A log write never fails the search.
 */

const REPEAT_MS = 10 * 60_000;
const day = (iso: string | null | undefined) => (iso ? `${Number(iso.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]}` : "");
const people = (n: number) => `${n} traveller${n === 1 ? "" : "s"}`;
const lowest = (xs: { total: { amount: number } }[]) => (xs.length ? Math.min(...xs.map((x) => x.total.amount)) : null);

export function flightSummary(q: FlightSearchRequest, r: Pick<FlightSearchResponse, "destinationName">) {
  return [`${q.from} → ${r.destinationName}`, q.return ? `${day(q.depart)} – ${day(q.return)}` : `${day(q.depart)}, one way`, people(q.travellerIds.length), q.cabin ?? "economy"].join(" · ");
}
export function staySummary(q: StaySearchRequest, r: Pick<StaySearchResponse, "destinationName">) {
  return [`Stay in ${r.destinationName}`, `${day(q.checkIn)} · ${q.nights} night${q.nights === 1 ? "" : "s"}`, people(q.travellerIds.length)].join(" · ");
}

async function write(userId: string | null, kind: "flight" | "stay" | "pay_sheet", summary: string, value: number | null, results: number | null) {
  if (!userId) return;
  try {
    const text = summary.slice(0, 200);
    // The same search again within a few minutes (a refresh, a filter) is the same moment: move it on, don't add a row.
    const moved = await db.update(appSearchLog).set({ at: new Date(), value, results })
      .where(and(eq(appSearchLog.userId, userId), eq(appSearchLog.kind, kind), eq(appSearchLog.summary, text), gt(appSearchLog.at, sql`now() - ${`${REPEAT_MS / 1000} seconds`}::interval`)))
      .returning({ id: appSearchLog.id });
    if (!moved.length) await db.insert(appSearchLog).values({ userId, kind, summary: text, value, results });
  } catch (e) {
    console.warn("[search-log] not written", (e as Error).message);
  }
}

export const logFlightSearch = (userId: string | null, q: FlightSearchRequest, r: FlightSearchResponse) =>
  write(userId, "flight", flightSummary(q, r), lowest(r.options), r.options.length);
export const logStaySearch = (userId: string | null, q: StaySearchRequest, r: StaySearchResponse) =>
  write(userId, "stay", staySummary(q, r), lowest(r.options), r.options.length);
/** The order sheet opened (POST /orders/preview): its title and all-in total. */
export const logPaySheet = (userId: string, p: Pick<OrderPreview, "title" | "total">) => write(userId, "pay_sheet", p.title, p.total.amount, null);
