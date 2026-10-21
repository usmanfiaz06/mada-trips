"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { markDropoff, nudgeDropoff } from "@/lib/app/desk/dropoffs";

/*
 * Drop-off actions (drop-offs/page.tsx): a nudge in the app from a saved reply, and marking one recovered or ignored.
 * lib/app/desk/dropoffs.ts checks the capability again and writes both audit trails.
 */

const done = (ok: string): ActionState => { revalidatePath("/adminwork/desk/drop-offs"); return { ok }; };
const key = (fd: FormData) => { const v = str(fd, "key"); if (!/^(search|sheet|pay|order|quote):/.test(v) || !isUuid(v.split(":")[1] ?? "")) throw new DeskError("Not found", "NOT_FOUND"); return v; };

export async function nudgeDropoffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    await nudgeDropoff(u, key(fd), str(fd, "cannedId"));
    return done("Sent in the app, with a push");
  } catch (e) { return toState(e); }
}

export async function markDropoffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const status = str(fd, "status") === "ignored" ? "ignored" : "recovered";
    await markDropoff(u, key(fd), { status, note: str(fd, "note") });
    return done(status === "recovered" ? "Marked recovered" : "Marked ignored");
  } catch (e) { return toState(e); }
}
