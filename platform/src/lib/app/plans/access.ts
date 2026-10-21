import "server-only";
import { t, type LivingPlanResponse, type Plan } from "@mada/shared";
import { AppError } from "../http";
import { peopleByIds } from "../circles/common";
import { roleOf, sharePricesOf, travellerNames } from "../trips/travellers";
import { readPlan } from "./plans";

/*
 * The plan as each person on the trip may read it (ASK-INTEGRATED.md §5.3, §5.5; U8 plan screen). The owner reads
 * everything. A companion reads the owner's plan through their role: no prices, quotes, totals or booking references
 * unless the owner shares prices with those who can edit. Writes stay with plans/ops.ts (the owner) and
 * trips/change-requests.ts (a companion's edit becomes a change request, or applies at once for "Can edit").
 */

const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();

/** A plan with nothing about money or booking references in it, for a companion who isn't shown prices. */
export function withoutPrices(plan: Plan): Plan {
  return {
    ...plan,
    totals: null,
    items: plan.items.map((i) => ({
      ...i, price: null, quote: null, priceExpired: undefined,
      booking: i.booking ? { ...i.booking, ref: null } : null,
      // "Quote ready · SAR 4,200" carries a price; the status says enough.
      statusLine: i.status === "requested" ? null : i.statusLine,
    })),
  };
}

export async function planFor(userId: string, tripId: string): Promise<LivingPlanResponse & { people: { name: string; initial: string }[] }> {
  const who = await roleOf(userId, tripId);
  if (!who) throw new AppError("NOT_FOUND");
  const people = (await travellerNames(tripId)).map((name) => ({ name, initial: initialOf(name) }));
  if (who.role === "owner") return { plan: await readPlan(userId, tripId), access: { role: "owner", prices: true, ownerName: null }, people };
  const [plan, shared, names] = await Promise.all([readPlan(who.trip.ownerId, tripId), sharePricesOf(tripId), peopleByIds([who.trip.ownerId])]);
  const prices = who.role === "edit" && shared;
  const ownerName = names.get(who.trip.ownerId)?.short?.split(/\s+/)[0] || t("circles.someone");
  return { plan: prices ? plan : withoutPrices(plan), access: { role: who.role, prices, ownerName }, people };
}
