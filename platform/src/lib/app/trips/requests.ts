import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { askSpec, deskStatus, formatSar, type CreateTripAskRequest, type TripDetail, type TripRequestView } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appQuotes, appRequests } from "@/db/app-schema";
import { appTripIdempotency } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { supplierMode } from "../config";
import { AppError } from "../http";
import type { Exec } from "./core";
import { notify } from "./notify";

/*
 * Asks from the trip (special requests, hotel options, an eSIM, a call about a change) go through the one request pipe,
 * app_requests, where the desk in Ops picks them up. Prices come from the rules in @mada/shared, never from the phone.
 * In mock mode a scripted desk answers them, the way the prototype does: sent, then asking, then the answer at 12 s.
 */

type RequestRow = typeof appRequests.$inferSelect;
export type RequestDetails = {
  area?: TripRequestView["area"]; short?: string | null; detail?: string | null; withWhom?: TripRequestView["withWhom"]; withName?: string | null;
  outcome?: "yes" | "no" | null; scriptedOutcome?: "yes" | "no"; alt?: string | null; yesText?: string | null; quoteText?: string | null;
  quote?: number | null; clientKey?: string; askKind?: string; option?: string | null;
};

const PENDING = ["sent", "reviewing"];

export function toRequestView(r: RequestRow): TripRequestView {
  const d = (r.details ?? {}) as RequestDetails;
  return {
    id: r.id, tripId: r.tripId, kind: d.askKind ?? r.kind, area: d.area ?? (r.kind === "refund" ? "refund" : r.kind === "change" ? "change" : "other"),
    status: r.status as TripRequestView["status"], title: r.summary, short: d.short ?? null, detail: d.detail ?? null,
    withWhom: d.withWhom ?? "faisal", withName: d.withName ?? null, outcome: d.outcome ?? null, alt: d.alt ?? null, yesText: d.yesText ?? null,
    quote: d.quote ? { amount: d.quote, currency: "SAR" } : null, quoteText: d.quoteText ?? null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

/** The mock desk: moves scripted requests on by their age. Only where the desk isn't real (mock mode). */
export async function progressMockDesk(ownerId: string, tx: Exec = db): Promise<void> {
  let mock = false;
  try { mock = supplierMode("flightStatus") === "mock"; } catch { mock = false; }
  if (!mock) return;
  const rows = await tx.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), inArray(appRequests.status, PENDING)));
  const now = Date.now();
  for (const r of rows) {
    const d = (r.details ?? {}) as RequestDetails;
    if (!d.scriptedOutcome || d.quote) continue;
    const next = deskStatus(r.createdAt.getTime(), now, d.scriptedOutcome, d.withWhom ?? "faisal");
    if (next === r.status) continue;
    const decided = next === "confirmed" || next === "done" || next === "cancelled";
    await tx.update(appRequests).set({ status: next, updatedAt: new Date(), details: decided ? { ...d, outcome: d.scriptedOutcome } : d }).where(eq(appRequests.id, r.id));
  }
}

export async function listRequests(ownerId: string, tripId?: string): Promise<TripRequestView[]> {
  await progressMockDesk(ownerId);
  const where = tripId ? and(eq(appRequests.ownerId, ownerId), eq(appRequests.tripId, tripId)) : eq(appRequests.ownerId, ownerId);
  const rows = await db.select().from(appRequests).where(where).orderBy(desc(appRequests.createdAt)).limit(100);
  return rows.map(toRequestView);
}

export const isOpen = (r: TripRequestView) => !["done", "confirmed", "cancelled"].includes(r.status);

/** Runs an action once per client key: a phone that queued it offline and sends it twice gets the first answer back. */
export async function once<T extends Record<string, unknown>>(ownerId: string, scope: string, key: string, run: (tx: Tx) => Promise<T>): Promise<T> {
  const [seen] = await db.select().from(appTripIdempotency).where(and(eq(appTripIdempotency.ownerId, ownerId), eq(appTripIdempotency.scope, scope), eq(appTripIdempotency.key, key)));
  if (seen) return seen.result as T;
  return db.transaction(async (tx) => {
    const result = await run(tx);
    const [ins] = await tx.insert(appTripIdempotency).values({ ownerId, scope, key, result }).onConflictDoNothing().returning({ key: appTripIdempotency.key });
    if (!ins) throw new AppError("VALIDATION", { message: "That was already sent." });
    return result;
  });
}

/** Creates a request row (and its quote when priced) inside a transaction. */
export async function insertRequest(tx: Tx, o: {
  ownerId: string; tripId: string | null; kind: string; summary: string; details: RequestDetails; status?: string; travellerIds?: string[]; ipHash?: string | null; agentName?: string | null;
}): Promise<RequestRow> {
  const status = o.status ?? (o.details.quote ? "quoted" : "sent");
  const [r] = await tx.insert(appRequests).values({
    ownerId: o.ownerId, kind: o.kind, status, summary: o.summary, travellerIds: o.travellerIds ?? [], tripId: o.tripId,
    agentName: o.agentName ?? null, promisedBy: new Date(Date.now() + 2 * 3_600_000), details: o.details,
  }).returning();
  if (o.details.quote) {
    await tx.insert(appQuotes).values({
      requestId: r!.id, lines: [{ label: o.summary, amount: o.details.quote, kind: "other" }], total: o.details.quote, status: "open",
      expiresAt: new Date(Date.now() + 24 * 3_600_000), offerSnapshot: { source: "trip-rules", kind: o.details.askKind ?? o.kind },
    });
  }
  await appAuditLog(tx, {
    actorKind: "user", actorId: o.ownerId, action: "request.created", entityType: "app_request", entityId: r!.id,
    summary: `Asked for: ${o.summary}${o.details.quote ? ` (${formatSar(o.details.quote)})` : ""}`, data: { kind: o.kind, area: o.details.area ?? null }, ipHash: o.ipHash ?? null,
  });
  return r!;
}

/** An ask from the trip screens. */
export async function createAsk(ownerId: string, trip: TripDetail, input: CreateTripAskRequest, ipHash: string | null): Promise<TripRequestView> {
  const spec = askSpec(trip, { area: input.area, kind: input.kind, option: input.option, travellerIds: input.travellerIds, count: input.count, day: input.day, note: input.note });
  if ("problem" in spec) throw new AppError("VALIDATION", { message: spec.problem });
  const { request } = await once(ownerId, "ask", input.clientKey, async (tx) => {
    const r = await insertRequest(tx, {
      ownerId, tripId: trip.id, kind: input.area === "other" && input.kind === "call" ? "change" : input.area === "hotel" ? "stay" : "general", summary: spec.title, ipHash, agentName: trip.agent.name,
      travellerIds: input.travellerIds?.length ? input.travellerIds : trip.travellerIds,
      details: {
        area: spec.area, short: spec.short, detail: spec.detail, withWhom: spec.withWhom, withName: spec.withName, outcome: null, scriptedOutcome: spec.outcome,
        alt: spec.alt, yesText: spec.yesText, quoteText: spec.quoteText, quote: spec.quote, clientKey: input.clientKey, askKind: spec.kind, option: input.option ?? null,
      },
    });
    return { request: toRequestView(r) as unknown as Record<string, unknown> };
  });
  const view = request as unknown as TripRequestView;
  if (view.quote) await notify(ownerId, { kind: "agent_reply", level: "active", copy: "notify.price", vars: { what: view.short ?? view.title, amount: formatSar(view.quote.amount) }, href: "/trips?tab=requests" });
  return view;
}
