"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { toHalalas } from "@/lib/money";
import { detectFileType, isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { addShift, assignPrimary, pingTyping, removeShift, saveAgent, setAgentStatus } from "@/lib/app/desk/agents";
import {
  addNote, approveRefund, askTraveller, blockTraveller, confirmHold, decideModeration, failTicketing, issueTickets, markDone, priceChanged,
  rejectRefund, revealPassport, saveChecklist, sendAgentReply, sendQuote, unblockTraveller,
} from "@/lib/app/desk/adapters";
import { pushPlan } from "@/lib/app/desk/disruptions";
import { escalate, reassign } from "@/lib/app/desk/inbox";
import { appDeskCanned } from "@/db/app-schema-desk";
import { deskAudit } from "@/lib/app/desk/core";

/*
 * Server actions for the desk. Each one checks the signed-in person, hands the work to lib/app/desk (which checks the
 * capability again and writes both audit trails in the same transaction), and refreshes the desk.
 */

const done = (ok: string): ActionState => { revalidatePath("/adminwork/desk", "layout"); return { ok }; };
const uuid = (fd: FormData, k: string) => { const v = str(fd, k); if (!isUuid(v)) throw new DeskError("Not found", "NOT_FOUND"); return v; };
const threadKind = (fd: FormData) => { const k = str(fd, "threadKind"); if (k !== "request" && k !== "support") throw new DeskError("Not found", "NOT_FOUND"); return k; };
const halalas = (fd: FormData, k: string) => { try { return toHalalas(str(fd, k)); } catch { throw new DeskError("Check the amount"); } };

/* ───────────── me and the rota ───────────── */

export async function setMyStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.view");
    const status = z.enum(["online", "away", "offline"]).parse(str(fd, "status"));
    await setAgentStatus(u, uuid(fd, "agentId"), status);
    return done(status === "online" ? "You're online" : status === "away" ? "You're away" : "You're signed off");
  } catch (e) { return toState(e); }
}

export async function saveAgentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    await saveAgent(u, {
      opsUserId: uuid(fd, "opsUserId"), displayName: str(fd, "displayName"), displayNameAr: str(fd, "displayNameAr") || null,
      languages: fd.getAll("languages").map(String), pronoun: str(fd, "pronoun") === "she" ? "she" : "he",
      replyMinutes: Number(str(fd, "replyMinutes") || 2), active: str(fd, "active") !== "no",
    });
    return done("Saved");
  } catch (e) { return toState(e); }
}

/** datetime-local values are Riyadh wall-clock time (UTC+3 all year). */
const riyadh = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new DeskError("Choose a start and end time");
  return new Date(`${v}:00+03:00`);
};

export async function addShiftAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    const cover = str(fd, "coveringForId");
    await addShift(u, { agentId: uuid(fd, "agentId"), startsAt: riyadh(str(fd, "startsAt")), endsAt: riyadh(str(fd, "endsAt")), coveringForId: cover && isUuid(cover) ? cover : null, note: str(fd, "note") || null });
    return done("Shift added");
  } catch (e) { return toState(e); }
}

export async function removeShiftAction(fd: FormData) {
  const u = await requirePerm("desk.admin");
  await removeShift(u, uuid(fd, "id")).catch(() => {});
  revalidatePath("/adminwork/desk", "layout");
}

export async function assignPrimaryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    await assignPrimary(u, uuid(fd, "userId"), uuid(fd, "agentId"));
    return done("Saved");
  } catch (e) { return toState(e); }
}

/* ───────────── any item ───────────── */

export async function reassignAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const to = str(fd, "agentId");
    await reassign(u, str(fd, "kind"), str(fd, "itemId"), to && to !== "rota" ? (isUuid(to) ? to : (() => { throw new DeskError("Choose someone on the desk"); })()) : null);
    return done(to && to !== "rota" ? "Reassigned" : "Back on the rota");
  } catch (e) { return toState(e); }
}

/** One-click "Take it" from the inbox. */
export async function takeAction(fd: FormData) {
  const u = await requirePerm("desk.act");
  const agentId = str(fd, "agentId");
  if (!isUuid(agentId)) return;
  await reassign(u, str(fd, "kind"), str(fd, "itemId"), agentId).catch(() => {});
  revalidatePath("/adminwork/desk", "layout");
}

export async function escalateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const on = str(fd, "on") !== "no";
    await escalate(u, str(fd, "kind"), str(fd, "itemId"), str(fd, "note") || null, on);
    return done(on ? "Escalated" : "Escalation cleared");
  } catch (e) { return toState(e); }
}

/* ───────────── orders ───────────── */

export async function holdAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.act"); await confirmHold(u, uuid(fd, "id"), { pnr: str(fd, "pnr") || null }); return done("Held. Tickets next"); } catch (e) { return toState(e); }
}

export async function askAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    await askTraveller(u, uuid(fd, "id"), { question: str(fd, "question"), choices: fd.getAll("choice").map(String) });
    return done("Sent to the traveller");
  } catch (e) { return toState(e); }
}

export async function priceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    await priceChanged(u, uuid(fd, "id"), { total: halalas(fd, "total"), reason: str(fd, "reason") || null });
    return done("New price sent");
  } catch (e) { return toState(e); }
}

export async function issueAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.issue");
    const r = await issueTickets(u, uuid(fd, "id"), { pnr: str(fd, "pnr"), tickets: fd.getAll("ticket").map(String) });
    if (!r.ok) { revalidatePath("/adminwork/desk", "layout"); return { error: "The payment capture didn't go through. The order is under ticketing problems: try again or mark it not issued." }; }
    return done("Issued. The traveller has their tickets");
  } catch (e) { return toState(e); }
}

export async function failAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.act"); await failTicketing(u, uuid(fd, "id"), { reason: str(fd, "reason") }); return done("Card hold released. The traveller was told"); } catch (e) { return toState(e); }
}

/** Returns the number to the browser for this one view; it is never put in the page. */
export async function revealAction(personId: string, requestId: string): Promise<{ number?: string; error?: string }> {
  try {
    const u = await requirePerm("desk.issue");
    if (!isUuid(personId) || !isUuid(requestId)) return { error: "Not found" };
    return { number: await revealPassport(u, personId, { requestId }) };
  } catch (e) { const s = toState(e); return { error: s?.error ?? "Not found" }; }
}

/* ───────────── requests ───────────── */

export async function quoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const labels = fd.getAll("lineLabel").map(String), amounts = fd.getAll("lineAmount").map(String), kinds = fd.getAll("lineKind").map(String);
    const lines = labels.map((label, i) => {
      let amount = 0;
      try { amount = toHalalas(amounts[i] ?? ""); } catch { throw new DeskError("Check each line's amount"); }
      return { label, amount, kind: kinds[i] ?? "other" };
    }).filter((l) => l.label.trim() || l.amount);
    await sendQuote(u, uuid(fd, "id"), { lines, cancellation: str(fd, "cancellation") || null, holdHours: Number(str(fd, "holdHours") || 0) });
    return done("Quote sent");
  } catch (e) { return toState(e); }
}

export async function checklistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const labels = fd.getAll("item").map(String);
    const ticked = new Set(fd.getAll("done").map(String));
    const extra = str(fd, "newItem");
    const items = [...labels.map((label, i) => ({ label, done: ticked.has(String(i)) })), ...(extra ? [{ label: extra, done: false }] : [])];
    await saveChecklist(u, uuid(fd, "id"), items);
    return done("Checklist saved");
  } catch (e) { return toState(e); }
}

export async function doneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.act"); await markDone(u, uuid(fd, "id")); return done("Marked done"); } catch (e) { return toState(e); }
}

/* ───────────── chat ───────────── */

const MAX_FILE = 6 * 1024 * 1024;

export async function replyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const kind = threadKind(fd), id = uuid(fd, "threadId");
    const body = str(fd, "body");
    if (str(fd, "mode") === "note") {
      await addNote(u, kind, id, body);
      return done("Note added");
    }
    let attachment: { id: string; filename: string; mime: string; size: number } | null = null;
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE) throw new DeskError("Files must be under 6 MB");
      const data = Buffer.from(await file.arrayBuffer());
      const mime = detectFileType(data);
      if (!mime) throw new DeskError("Upload a PDF or an image");
      const filename = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200) || "file";
      const [row] = await db.insert(schema.attachments).values({ entityType: "app_thread", entityId: id, filename, mime, size: data.length, data, uploadedBy: u.id }).returning({ id: schema.attachments.id });
      attachment = { id: row!.id, filename, mime, size: data.length };
    }
    await sendAgentReply(u, kind, id, { body, attachment });
    return done("Sent");
  } catch (e) { return toState(e); }
}

export async function typingAction(kind: string, id: string) {
  const u = await requirePerm("desk.act");
  if ((kind !== "request" && kind !== "support") || !isUuid(id)) return;
  await pingTyping(u, kind, id).catch(() => {});
}

export async function addCannedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.admin");
    const title = str(fd, "title"), en = str(fd, "bodyEn"), ar = str(fd, "bodyAr");
    if (title.length < 2 || en.length < 2 || ar.length < 2) throw new DeskError("Fill in the title and both languages");
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(appDeskCanned).values({ title: title.slice(0, 60), bodyEn: en.slice(0, 1000), bodyAr: ar.slice(0, 1000), createdBy: u.id }).returning();
      await deskAudit(tx, u, { action: "desk.canned.added", entityType: "canned", entityId: row!.id, ref: title, summary: `Added the saved reply "${title}"` });
    });
    return done("Saved reply added");
  } catch (e) { return toState(e); }
}

/* ───────────── refunds, disruptions, moderation ───────────── */

export async function approveRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.refund");
    await approveRefund(u, uuid(fd, "id"), { destination: str(fd, "destination") === "credit" ? "credit" : "original", note: str(fd, "note") || null });
    return done("Refund approved");
  } catch (e) { return toState(e); }
}

export async function rejectRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.refund"); await rejectRefund(u, uuid(fd, "id"), { reason: str(fd, "reason") }); return done("Refund declined. The traveller sees why"); } catch (e) { return toState(e); }
}

export async function planAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const labels = fd.getAll("optionLabel").map(String), details = fd.getAll("optionDetail").map(String);
    await pushPlan(u, {
      flightNumber: str(fd, "flightNumber"), date: str(fd, "date"), status: str(fd, "status"), plan: str(fd, "plan"),
      options: labels.map((label, i) => ({ label, detail: details[i] ?? "" })), voucher: str(fd, "voucher") ? halalas(fd, "voucher") : 0,
    });
    return done("Plan sent to the travellers");
  } catch (e) { return toState(e); }
}

export async function moderateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.moderate");
    const decision = z.enum(["approved", "rejected", "removed", "dismissed"]).parse(str(fd, "decision"));
    await decideModeration(u, uuid(fd, "id"), { decision, reason: str(fd, "reason") || null });
    const author = str(fd, "blockAuthor");
    if (str(fd, "block") === "yes" && isUuid(author)) await blockTraveller(u, author, str(fd, "reason") || "Blocked from moderation");
    return done(decision === "approved" ? "Tip approved" : decision === "dismissed" ? "Report dismissed" : "Done");
  } catch (e) { return toState(e); }
}

export async function blockAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.moderate"); await blockTraveller(u, uuid(fd, "userId"), str(fd, "reason")); return done("Account blocked"); } catch (e) { return toState(e); }
}

export async function unblockAction(fd: FormData) {
  const u = await requirePerm("desk.moderate");
  const id = str(fd, "userId");
  if (isUuid(id)) await unblockTraveller(u, id).catch(() => {});
  revalidatePath("/adminwork/desk", "layout");
}

/** The status pill in the desk bar: a plain form post, no message. */
export async function statusPillAction(fd: FormData) {
  const u = await requirePerm("desk.view");
  const status = str(fd, "status");
  if (status !== "online" && status !== "away" && status !== "offline") return;
  await setAgentStatus(u, uuid(fd, "agentId"), status).catch(() => {});
  revalidatePath("/adminwork/desk", "layout");
}
