"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requirePerm } from "@/lib/auth";
import { toHalalas } from "@/lib/money";
import { str, optStr, toState, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { addPortal, updatePortal, recordFund, recordAdjustment } from "@/lib/portals";

export async function addPortalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("portals.manage");
  try {
    await db.transaction((tx) => addPortal(tx, { name: str(fd, "name"), creditLimit: toHalalas(str(fd, "creditLimit") || "0"), notes: optStr(fd, "notes"), createdBy: u.id }));
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: "Portal added" };
}

export async function editPortalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("portals.manage");
  const id = str(fd, "id");
  if (!isUuid(id)) return { error: "Portal not found" };
  try {
    await db.transaction((tx) => updatePortal(tx, id, {
      name: optStr(fd, "name") ?? undefined,
      creditLimit: fd.get("creditLimit") != null ? toHalalas(str(fd, "creditLimit")) : undefined,
      active: fd.get("active") != null ? str(fd, "active") === "on" : undefined,
      notes: optStr(fd, "notes"),
    }, u.id));
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: "Saved" };
}

export async function depositAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("portals.manage");
  const portalId = str(fd, "portalId");
  if (!isUuid(portalId)) return { error: "Choose a portal" };
  const source = str(fd, "source") === "partner" ? "partner" : "bank";
  try {
    await db.transaction((tx) => recordFund(tx, {
      portalId, source, account: optStr(fd, "account"), partnerId: optStr(fd, "partnerId"),
      amount: toHalalas(str(fd, "amount")), reference: optStr(fd, "reference"), note: optStr(fd, "note"), recordedBy: u.id,
    }));
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: "Deposit recorded — sent to the directors to approve" };
}

export async function adjustAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("portals.manage");
  const portalId = str(fd, "portalId");
  if (!isUuid(portalId)) return { error: "Choose a portal" };
  const direction = str(fd, "direction") === "out" ? "out" : "in";
  try {
    await db.transaction((tx) => recordAdjustment(tx, { portalId, direction, amount: toHalalas(str(fd, "amount")), note: str(fd, "note"), recordedBy: u.id }));
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: "Adjustment recorded — sent to the directors to approve" };
}
