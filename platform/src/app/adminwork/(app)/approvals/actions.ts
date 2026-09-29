"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { cancelApproval, decide } from "@/lib/approvals";
import { flash, optStr, str, toState, type ActionState } from "@/lib/actions";
import { isUuid, safeNext } from "@/lib/security";

export async function vote(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  const decision = str(fd, "decision") === "reject" ? "reject" : "approve";
  if (!isUuid(id)) return { error: "Request not found" };
  if ((optStr(fd, "remark")?.length ?? 0) > 1000) return { error: "Keep the remark under 1,000 characters" };
  try {
    const outcome = await db.transaction((tx) => decide(tx, id, u.id, decision, optStr(fd, "remark")));
    await flash(outcome === "approved" ? "Approved. The request is now complete" : outcome === "rejected" ? "Request rejected" : decision === "approve" ? "Your approval is recorded. Waiting on other directors" : "Your rejection is recorded");
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(safeNext(str(fd, "next"), `/adminwork/approvals/${id}`));
}

export async function withdraw(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  if (!isUuid(id)) redirect("/adminwork/approvals");
  await db.transaction((tx) => cancelApproval(tx, id, u.id));
  await flash("Request withdrawn");
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/approvals/${id}`);
}
