import "server-only";

/*
 * Domain events for the living plan (ASK-INTEGRATED §1.3). A write that touches a trip (an order confirmed, an eSIM
 * bought, a stay cancelled, the plan changed) emits one event after its transaction commits; listeners bring the plan
 * up to date (link the booking to its item, cache its status, write a plan event). A listener that fails is logged and
 * never fails the write that emitted it: the plan's read derives statuses from the booking rows anyway.
 */

export type PlanDomainEvent =
  /** An order is in (the pay sheet slid): the plan items its draft names, or the item whose request's quote it pays (U7). */
  | { kind: "order.created"; orderId: string; ownerId: string; planItemIds: string[]; requestId: string | null }
  | { kind: "order.confirmed"; orderId: string; tripId: string | null; ownerId: string }
  | { kind: "order.cancelled"; orderId: string; tripId: string | null; ownerId: string }
  | { kind: "stay.changed"; tripId: string }
  | { kind: "segment.changed"; tripId: string }
  | { kind: "esim.bought"; tripId: string | null; ownerId: string }
  | { kind: "plan.changed"; tripId: string; planId: string; version: number; by: "ask" | "traveller" | "desk" | "system" };

type Kind = PlanDomainEvent["kind"];
type Listener<K extends Kind> = (e: Extract<PlanDomainEvent, { kind: K }>) => Promise<void> | void;

const listeners = new Map<Kind, Listener<Kind>[]>();

export function on<K extends Kind>(kind: K, fn: Listener<K>): () => void {
  const list = listeners.get(kind) ?? [];
  list.push(fn as unknown as Listener<Kind>);
  listeners.set(kind, list);
  return () => listeners.set(kind, (listeners.get(kind) ?? []).filter((x) => x !== (fn as unknown)));
}

/** Runs every listener for the event, one after another; errors are logged, never thrown. */
export async function emit(e: PlanDomainEvent): Promise<void> {
  ensureListeners();
  for (const fn of listeners.get(e.kind) ?? []) {
    try {
      await fn(e as never);
    } catch (err) {
      console.warn(`[plans] listener for ${e.kind} failed`, err instanceof Error ? err.message : err);
    }
  }
}

/* The plan's own listeners, registered on first emit (the import stays one-way: plans.ts never imports a caller). */
let registered = false;
function ensureListeners() {
  if (registered) return;
  registered = true;
  const sync = async (tripId: string | null) => {
    if (!tripId) return;
    const { syncTripBookings } = await import("./plans");
    await syncTripBookings(tripId);
  };
  on("order.created", async (e) => {
    if (!e.planItemIds.length && !e.requestId) return;
    const { linkOrder } = await import("./booking");
    await linkOrder(e.ownerId, e.orderId, e.planItemIds, e.requestId);
  });
  on("order.confirmed", (e) => sync(e.tripId));
  on("order.cancelled", (e) => sync(e.tripId));
  on("stay.changed", (e) => sync(e.tripId));
  on("segment.changed", (e) => sync(e.tripId));
  on("esim.bought", (e) => sync(e.tripId));
}
