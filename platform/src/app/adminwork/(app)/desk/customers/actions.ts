"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { toHalalas } from "@/lib/money";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { blockCustomer, giveGoodwill, revealCustomerPassport, unblockCustomer } from "@/lib/app/desk/customers";

/*
 * Server actions for the customer page (DESK-PLAN U3). Each checks the signed-in person, then lib/app/desk/customers.ts
 * checks the capability again and writes both audit trails.
 */

const uuid = (fd: FormData, k: string) => { const v = str(fd, k); if (!isUuid(v)) throw new DeskError("Not found", "NOT_FOUND"); return v; };
const done = (id: string, ok: string): ActionState => { revalidatePath(`/adminwork/desk/customers/${id}`); return { ok }; };

export async function goodwillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const id = uuid(fd, "userId");
    let amount = 0;
    try { amount = toHalalas(str(fd, "amount")); } catch { throw new DeskError("Check the amount"); }
    const r = await giveGoodwill(u, id, { amount, note: str(fd, "note") });
    return done(id, r.applied ? "Goodwill credit added" : "Sent to a support lead to approve in Approvals");
  } catch (e) { return toState(e); }
}

export async function blockCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.moderate");
    const id = uuid(fd, "userId");
    await blockCustomer(u, id, str(fd, "reason"));
    return done(id, "Account blocked");
  } catch (e) { return toState(e); }
}

export async function unblockCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.moderate");
    const id = uuid(fd, "userId");
    await unblockCustomer(u, id);
    return done(id, "Block lifted");
  } catch (e) { return toState(e); }
}

/** Bound per person on the page; returns the number for 30 seconds on screen (PassportReveal). */
export async function revealCustomerPassportAction(userId: string, personId: string): Promise<{ number?: string; error?: string }> {
  try {
    const u = await requirePerm("desk.issue");
    if (!isUuid(userId) || !isUuid(personId)) throw new DeskError("Not found", "NOT_FOUND");
    return { number: await revealCustomerPassport(u, userId, personId) };
  } catch (e) { const s = toState(e); return { error: s?.error ?? "Not found" }; }
}
