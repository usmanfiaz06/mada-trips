"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { supplierFlight } from "@/lib/app/desk/adapters";

/*
 * The desk's TBO buttons on a flight order (components/desk/flight-supplier.tsx): hold with TBO, ticket now (issuing
 * rights), check with TBO. lib/app/desk checks the capability again and writes the audit trail.
 */

const STEPS = ["hold", "ticket", "check"] as const;

export async function supplierFlightAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const step = str(fd, "step") as (typeof STEPS)[number];
    if (!STEPS.includes(step)) throw new DeskError("Not found", "NOT_FOUND");
    const id = str(fd, "id");
    if (!isUuid(id)) throw new DeskError("Not found", "NOT_FOUND");
    const u = await requirePerm(step === "ticket" ? "desk.issue" : "desk.act");
    const r = await supplierFlight(u, id, { step });
    revalidatePath("/adminwork/desk", "layout");
    return r.outcome === "held" || r.outcome === "ticket_now" || r.outcome === "ticketed" ? { ok: r.message } : { error: r.message };
  } catch (e) { return toState(e); }
}
