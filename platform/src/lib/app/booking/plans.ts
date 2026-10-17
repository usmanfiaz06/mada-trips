import "server-only";
import { PLANS, money, sarToHalalas, type BookingPlan, type CuratedPlan, type PlanDetail } from "@mada/shared";
import { AppError } from "../http";
import { householdOf } from "./common";

/* Curated plans (AlUla in two days, Istanbul in three): priced for the household's travellers, booked as a package. */

const planTotal = (p: CuratedPlan, n: number) => sarToHalalas((p.price.flights * n) / 2 + p.price.stay + (p.price.experiences * n) / 4);

function summary(p: CuratedPlan, n: number): BookingPlan {
  return { id: p.id, title: p.title, sub: p.sub, photo: p.photo, city: p.city, days: p.days, stops: p.plan.reduce((a, d) => a + d.stops.length, 0), total: money(planTotal(p, n)), travellers: n };
}

/** Signed in: the household going (helpers stay home). A guest: as many as they said, else two. */
async function party(ownerId: string | null, guests?: number | null) {
  if (!ownerId) return guests ?? 2;
  const people = await householdOf(ownerId);
  return Math.max(1, people.filter((p) => p.relation !== "helper").length);
}

/** ?travellers=1..9 from a guest's request; anything else is "not said". */
export function travellersParam(req: Request): number | null {
  const n = Number(new URL(req.url).searchParams.get("travellers"));
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
}

export async function listPlans(ownerId: string | null, guests?: number | null): Promise<BookingPlan[]> {
  const n = await party(ownerId, guests);
  return Object.values(PLANS).map((p) => summary(p, n));
}

export async function getPlan(ownerId: string | null, id: string, guests?: number | null): Promise<PlanDetail> {
  const p = PLANS[id];
  if (!p) throw new AppError("NOT_FOUND");
  return { ...summary(p, await party(ownerId, guests)), plan: p.plan };
}
