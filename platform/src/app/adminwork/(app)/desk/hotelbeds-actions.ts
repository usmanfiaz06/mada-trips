"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { agentForOps } from "@/lib/app/desk/agents";
import { bookStayOnHotelbeds, bookTransferOnHotelbeds, cancelSupplierBooking } from "@/lib/app/suppliers/hotelbeds/bookings";

/*
 * The desk's Hotelbeds actions (components/desk/hotelbeds.tsx): book a stay or a pickup from the rate the traveller
 * picked, and cancel (simulate first, then for real). lib/app/suppliers/hotelbeds/bookings.ts does the work and writes the audit.
 */

const id = (fd: FormData, k: string) => { const v = str(fd, k); if (!isUuid(v)) throw new Error("Not found"); return v; };
async function actor() {
  const u = await requirePerm("desk.act");
  const me = await agentForOps(u.id);
  return { name: me?.displayName ?? u.name.split(" ")[0]!, opsUserId: u.id };
}
const done = (ok: string): ActionState => { revalidatePath("/adminwork/desk", "layout"); return { ok }; };
const outcome = (status: string, ref: string | null, problem: string | null) =>
  status === "confirmed" ? done(`Booked on Hotelbeds: ${ref}`) : status === "unknown"
    ? { error: `No answer from Hotelbeds. Check their extranet for our reference before trying again. ${problem ?? ""}`.trim() }
    : { error: `Hotelbeds said no: ${problem ?? "no reason given"}` };

export async function hbBookStayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const r = await bookStayOnHotelbeds(id(fd, "orderId"), await actor()); revalidatePath("/adminwork/desk", "layout"); return outcome(r.status, r.supplierRef, r.problem); } catch (e) { return toState(e); }
}

export async function hbBookTransferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const r = await bookTransferOnHotelbeds(id(fd, "requestId"), await actor()); revalidatePath("/adminwork/desk", "layout"); return outcome(r.status, r.supplierRef, r.problem); } catch (e) { return toState(e); }
}

export async function hbCancelAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const confirm = str(fd, "confirm") === "yes";
    const r = await cancelSupplierBooking(id(fd, "bookingId"), await actor(), { confirm });
    if (r.simulated) return { ok: r.amount > 0 ? `Cancelling now costs ${r.amount} ${r.currency ?? ""} (Hotelbeds' simulation). Confirm to cancel.` : "Cancelling now is free (Hotelbeds' simulation). Confirm to cancel." };
    return done(`Cancelled on Hotelbeds${r.amount > 0 ? `, fee ${r.amount} ${r.currency ?? ""}` : ", no fee"}`);
  } catch (e) { return toState(e); }
}
