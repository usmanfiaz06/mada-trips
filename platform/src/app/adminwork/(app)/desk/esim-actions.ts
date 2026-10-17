"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { agentForOps } from "@/lib/app/desk/agents";
import { deskRefundEsim, deskRetryEsim, resendEsim } from "@/lib/app/esim/service";

/*
 * The desk's eSIM actions (esims/page.tsx): send the install details again, refund one eSIM (its share of the order back
 * to the card, Airalo asked for its money), and order a stuck one again (looked up at Airalo first, never bought twice).
 */

const id = (fd: FormData, k: string) => { const v = str(fd, k); if (!isUuid(v)) throw new Error("Not found"); return v; };
async function actor(perm: "desk.act" | "desk.refund") {
  const u = await requirePerm(perm);
  const me = await agentForOps(u.id);
  return { name: me?.displayName ?? u.name.split(" ")[0]!, opsUserId: u.id };
}
const done = (ok: string): ActionState => { revalidatePath("/adminwork/desk/esims"); return { ok }; };
const REASONS = ["INSTALLATION_FAILURE", "NO_COVERAGE", "TRIP_CANCELLATION", "WRONG_PURCHASE", "INCOMPATIBLE_DEVICE", "OTHERS"] as const;

export async function esimResendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await resendEsim(id(fd, "esimId"), await actor("desk.act")); return done("Sent to the traveller's inbox and phone"); } catch (e) { return toState(e); }
}

export async function esimRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const raw = str(fd, "reason");
    const reason = (REASONS as readonly string[]).includes(raw) ? (raw as (typeof REASONS)[number]) : "OTHERS";
    await deskRefundEsim(id(fd, "esimId"), await actor("desk.refund"), reason);
    return done("Refunded to the traveller. Airalo was asked for its money back");
  } catch (e) { return toState(e); }
}

export async function esimRetryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { await deskRetryEsim(id(fd, "orderId"), await actor("desk.act")); return done("Checked with Airalo and ordered if it wasn't"); } catch (e) { return toState(e); }
}
