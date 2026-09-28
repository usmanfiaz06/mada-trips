"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { cancelApproval, decide } from "@/lib/approvals";
import { flash, optStr, str, toState, type ActionState } from "@/lib/actions";

export async function vote(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  const decision = str(fd, "decision") === "reject" ? "reject" : "approve";
  try {
    const outcome = await db.transaction((tx) => decide(tx, id, u.id, decision, optStr(fd, "remark")));
    await flash(outcome === "approved" ? "Approved. The request is now complete" : outcome === "rejected" ? "Request rejected" : decision === "approve" ? "Your approval is recorded. Waiting on other directors" : "Your rejection is recorded");
  } catch (e) { return toState(e); }
  revalidatePath("/", "layout");
  redirect(str(fd, "next") || `/approvals/${id}`);
}

export async function withdraw(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await db.transaction((tx) => cancelApproval(tx, id, u.id));
  await flash("Request withdrawn");
  revalidatePath("/", "layout");
  redirect(`/approvals/${id}`);
}
