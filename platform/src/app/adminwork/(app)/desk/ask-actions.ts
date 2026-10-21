"use server";
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { handBackAsk, replyOnAsk, takeOverAsk } from "@/lib/app/desk/ask";

/*
 * Ask thread actions (ask/[id]/page.tsx): take over, reply as yourself, hand back to Mada. lib/app/desk/ask.ts checks
 * access again and writes both audit trails.
 */

const id = (fd: FormData) => { const v = str(fd, "id"); if (!isUuid(v)) throw new DeskError("Not found", "NOT_FOUND"); return v; };
const done = (thread: string, ok: string): ActionState => { revalidatePath(`/adminwork/desk/ask/${thread}`); revalidatePath("/adminwork/desk/ask"); return { ok }; };

export async function takeOverAskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const t = id(fd);
    await takeOverAsk(u, t);
    return done(t, "You have the conversation. Mada stops answering until you hand it back.");
  } catch (e) { return toState(e); }
}

export async function replyAskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const t = id(fd);
    await replyOnAsk(u, t, str(fd, "body"));
    return done(t, "Sent");
  } catch (e) { return toState(e); }
}

export async function handBackAskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const t = id(fd);
    await handBackAsk(u, t);
    return done(t, "Handed back. Mada answers again, knowing what was said.");
  } catch (e) { return toState(e); }
}
