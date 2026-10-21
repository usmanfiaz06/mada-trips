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
  addNote, approveRefund, askTraveller, blockTraveller, confirmHold, failTicketing, issueTickets, markDone, priceChanged,
  rejectRefund, revealPassport, saveChecklist, sendAgentReply, sendQuote, unblockTraveller,
} from "@/lib/app/desk/adapters";
import { pushPlan } from "@/lib/app/desk/disruptions";
import { linkRequestToItem } from "@/lib/app/desk/plans";
import { confirmContactByCall, sendFlightQuote } from "@/lib/app/desk/flight-quotes";
import { decideModeration } from "@/lib/app/desk/moderation";
import { approveRecovery, declineRecovery } from "@/lib/app/desk/recovery";
import { escalate, reassign } from "@/lib/app/desk/inbox";
import {
  addTicketNote, assignTicket, createTicket, findCustomer, LINK_KINDS, MANUAL_MOVES, mergeTickets, moveTicket, replyOnTicket, setDetails, setPriority, takeTicket,
  ticketHref, ticketsRepliedOnThread, type LinkKind, type ManualMove,
} from "@/lib/app/desk/tickets";
import { redirect } from "next/navigation";
import { appDeskCanned } from "@/db/app-schema-desk";
import { deskAudit } from "@/lib/app/desk/core";
import { setOutcome, setPromise } from "@/lib/app/outcomes";
import { inRequestOwnerLocale } from "@/lib/app/locale";
import { OutcomeKind, OutcomeNext, OutcomeReason, OnItStep, TZ, zonedToInstant } from "@mada/shared";

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

/** One-click "Take it" from the queue: the row's ticket when it has one. */
export async function takeAction(fd: FormData) {
  const u = await requirePerm("desk.act");
  const ticketId = str(fd, "ticketId");
  if (isUuid(ticketId)) await takeTicket(u, ticketId).catch(() => {});
  else {
    const agentId = str(fd, "agentId");
    if (!isUuid(agentId)) return;
    await reassign(u, str(fd, "kind"), str(fd, "itemId"), agentId).catch(() => {});
  }
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
  try {
    const u = await requirePerm("desk.act");
    const why = OutcomeReason.safeParse(str(fd, "why"));
    await failTicketing(u, uuid(fd, "id"), { reason: str(fd, "reason"), why: why.success ? why.data : null });
    return done("Card hold released. The traveller was told");
  } catch (e) { return toState(e); }
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

/** Fares for a flight request from the quote builder (components/desk/flight-quote.tsx): amounts in SAR, the hold in Riyadh time. */
export async function flightQuoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    let raw: { holdUntil?: string; pnr?: string; message?: string; options?: { prices?: { sar?: string; amount?: number }[] }[] };
    try { raw = JSON.parse(str(fd, "payload") || "{}"); } catch { throw new DeskError("Check the fares"); }
    const options = (raw.options ?? []).map((o, i) => ({
      ...o,
      prices: (o.prices ?? []).map((p) => {
        try { return { ...p, amount: toHalalas(String(p.sar ?? "")) }; } catch { throw new DeskError(`Fare ${i + 1}: check each traveller's price`); }
      }),
    }));
    await sendFlightQuote(u, uuid(fd, "id"), { options: options as never, holdUntil: riyadh(String(raw.holdUntil ?? "")).toISOString(), pnr: raw.pnr || null, message: raw.message || null });
    return done(options.length === 1 ? "Fare sent" : "Fares sent");
  } catch (e) { return toState(e); }
}

/** The contact number on an order isn't verified: the agent called it and the traveller confirmed. Audited. */
export async function confirmCallAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.act"); await confirmContactByCall(u, uuid(fd, "id")); return done("Marked confirmed by call"); } catch (e) { return toState(e); }
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

/* ───────────── outcomes and promises (lib/app/outcomes.ts) ───────────── */

const amountOrNull = (fd: FormData) => (str(fd, "amount") ? halalas(fd, "amount") : null);

export async function outcomeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const id = uuid(fd, "id");
    const kind = OutcomeKind.exclude(["withdrawn"]).safeParse(str(fd, "kind"));
    const reason = OutcomeReason.safeParse(str(fd, "reason"));
    const money = z.enum(["none", "refund", "credit", "kept", "charged"]).safeParse(str(fd, "money"));
    if (!kind.success || !reason.success || !money.success) throw new DeskError("Pick the outcome, the reason and the money");
    const next = fd.getAll("next").map(String).filter((x) => OutcomeNext.safeParse(x).success) as OutcomeNext[];
    const by = str(fd, "by");
    await inRequestOwnerLocale(id, () => setOutcome(u, {
      requestId: id, kind: kind.data, reason: reason.data, with: str(fd, "with") || null, note: str(fd, "note") || null, money: money.data,
      amount: amountOrNull(fd), by: /^\d{4}-\d{2}-\d{2}$/.test(by) ? by : null, next: [...new Set(next)].slice(0, 3),
      what: str(fd, "what") || null, appealBy: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "appealBy")) ? str(fd, "appealBy") : null,
    }));
    return done("Closed. The traveller has the outcome");
  } catch (e) { return toState(e); }
}

export async function promiseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const id = uuid(fd, "id");
    const step = OnItStep.safeParse(str(fd, "step"));
    const cost = z.enum(["free", "quoted", "later", "paid"]).safeParse(str(fd, "cost"));
    if (!step.success || !cost.success) throw new DeskError("Pick what we're doing and the cost");
    let due: Date;
    try { due = zonedToInstant(str(fd, "due"), TZ); } catch { throw new DeskError("Pick the time we'll answer by"); }
    await inRequestOwnerLocale(id, () => setPromise(u, { requestId: id, step: step.data, with: str(fd, "with") || null, dueAt: due.toISOString(), cost: cost.data, amount: amountOrNull(fd) }));
    return done("The traveller sees what we're doing and when");
  } catch (e) { return toState(e); }
}

export async function doneAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.act"); await markDone(u, uuid(fd, "id")); return done("Marked done"); } catch (e) { return toState(e); }
}

/** "Link to plan item" on a request page (ASK-INTEGRATED.md §10): the request fulfils that item of the customer's plan. */
export async function linkPlanItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.act"); await linkRequestToItem(u, uuid(fd, "id"), uuid(fd, "itemId")); return done("Linked to the plan"); } catch (e) { return toState(e); }
}

/* ───────────── chat ───────────── */

const MAX_FILE = 6 * 1024 * 1024;

export async function replyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    // The ticket page's composer posts threadKind "ticket": its reply goes to the ticket's thread.
    if (str(fd, "threadKind") === "ticket") return ticketReply(u, fd);
    const kind = threadKind(fd), id = uuid(fd, "threadId");
    const body = str(fd, "body");
    if (str(fd, "mode") === "note") {
      await addNote(u, kind, id, body);
      return done("Note added");
    }
    await sendAgentReply(u, kind, id, { body, attachment: await attachmentOf(u, fd, id) });
    await ticketsRepliedOnThread(u, kind, id).catch(() => 0);
    return done("Sent");
  } catch (e) { return toState(e); }
}

async function attachmentOf(u: { id: string }, fd: FormData, entityId: string) {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_FILE) throw new DeskError("Files must be under 6 MB");
  const data = Buffer.from(await file.arrayBuffer());
  const mime = detectFileType(data);
  if (!mime) throw new DeskError("Upload a PDF or an image");
  const filename = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200) || "file";
  const [row] = await db.insert(schema.attachments).values({ entityType: "app_thread", entityId, filename, mime, size: data.length, data, uploadedBy: u.id }).returning({ id: schema.attachments.id });
  return { id: row!.id, filename, mime, size: data.length };
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
    const source = str(fd, "source") === "post" ? "post" : str(fd, "source") === "report" ? "report" : str(fd, "source") === "cover" ? "cover" : "desk";
    // An edit before approving (a phone number taken out): the words the desk corrected, when they changed.
    const editBody = str(fd, "editText"), editPlace = str(fd, "editPlace");
    const edit = decision === "approved" && ((editBody && editBody !== str(fd, "origText")) || (editPlace && editPlace !== str(fd, "origPlace"))) ? { body: editBody || undefined, place: editPlace || undefined } : null;
    await decideModeration(u, uuid(fd, "id"), { decision, reason: str(fd, "reason") || null, edit }, source);
    const author = str(fd, "blockAuthor");
    if (str(fd, "block") === "yes" && isUuid(author)) await blockTraveller(u, author, str(fd, "reason") || "Blocked from moderation");
    return done(decision === "approved" ? (edit ? "Edited and approved" : "Approved") : decision === "dismissed" ? "Report dismissed; the reporter is thanked" : decision === "removed" ? "Removed; the reporter is told" : "Done; the author is told why");
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

/** The presence switch in the header pill (on every Ops page): a plain form post, no message. */
export async function statusPillAction(fd: FormData) {
  const u = await requirePerm("desk.view");
  const status = str(fd, "status");
  if (status !== "online" && status !== "away" && status !== "offline") return;
  await setAgentStatus(u, uuid(fd, "agentId"), status).catch(() => {});
  revalidatePath("/adminwork", "layout");
}

/* ───────────── account recovery ───────────── */

export async function recoveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const decision = z.enum(["approve", "decline"]).parse(str(fd, "decision"));
    const id = uuid(fd, "id");
    if (decision === "approve") { await approveRecovery(u, id, str(fd, "note")); return done("Account moved. We've told them on the new contact."); }
    await declineRecovery(u, id, str(fd, "note"));
    return done("Declined. We've told them on the new contact.");
  } catch (e) { return toState(e); }
}

/* ───────────── tickets (lib/app/desk/tickets.ts) ───────────── */

async function ticketReply(u: Awaited<ReturnType<typeof requirePerm>>, fd: FormData): Promise<ActionState> {
  const id = uuid(fd, "threadId");
  const body = str(fd, "body");
  if (str(fd, "mode") === "note") { await addTicketNote(u, id, body); return done("Note added"); }
  await replyOnTicket(u, id, { body, attachment: await attachmentOf(u, fd, id) });
  return done("Sent");
}

/** "Create ticket" from an order, a request, a chat, a customer, or blank (/desk/tickets/new). Opens the new ticket. */
export async function createTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let href: string;
  try {
    const u = await requirePerm("desk.act");
    const kind = str(fd, "aboutKind"), aboutId = str(fd, "aboutId");
    const about = kind && aboutId ? (LINK_KINDS.includes(kind as LinkKind) && aboutId.length <= 120 ? { kind: kind as LinkKind, id: aboutId } : (() => { throw new DeskError("Unknown item", "NOT_FOUND"); })()) : null;
    const id = str(fd, "customerId"), contact = str(fd, "customer");
    const customerId = isUuid(id) ? id : contact ? await findCustomer(contact) : null;
    if (contact && !customerId) throw new DeskError("No traveller with that phone or email");
    const t = await createTicket(u, { subject: str(fd, "subject"), note: str(fd, "note") || null, priority: str(fd, "priority"), category: str(fd, "category") || null, customerId, about });
    href = ticketHref(t);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/desk", "layout");
  redirect(href);
}

export async function assignTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const to = str(fd, "agentId");
    await assignTicket(u, uuid(fd, "id"), to && to !== "rota" ? (isUuid(to) ? to : (() => { throw new DeskError("Choose someone on the desk"); })()) : null);
    return done(to && to !== "rota" ? "Reassigned" : "Back on the rota");
  } catch (e) { return toState(e); }
}

export async function takeTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.act"); await takeTicket(u, uuid(fd, "id")); return done("It's yours"); } catch (e) { return toState(e); }
}

export async function ticketPropsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const id = uuid(fd, "id");
    const priority = str(fd, "priority");
    if (priority) await setPriority(u, id, priority);
    await setDetails(u, id, { category: str(fd, "category"), tags: str(fd, "tags").split(","), ...(fd.has("subject") ? { subject: str(fd, "subject") } : {}) });
    return done("Saved");
  } catch (e) { return toState(e); }
}

export async function moveTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const m = str(fd, "move");
    if (!MANUAL_MOVES.includes(m as ManualMove)) throw new DeskError("That can't be done to this ticket now");
    await moveTicket(u, uuid(fd, "id"), m as ManualMove, str(fd, "note") || null);
    const said: Record<ManualMove, string> = { wait_customer: "Waiting on the customer. The clock is paused", wait_supplier: "Waiting on the supplier. The clock is paused", supplier_answered: "Back with us. The clock runs again", customer_replied: "Back with us. The clock runs again", resolve: "Resolved", reopen: "Reopened", close: "Closed" };
    return done(said[m as ManualMove]);
  } catch (e) { return toState(e); }
}

export async function mergeTicketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let href: string;
  try {
    const u = await requirePerm("desk.tickets.manage");
    const into = await mergeTickets(u, uuid(fd, "id"), str(fd, "into"));
    href = ticketHref(into);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/desk", "layout");
  redirect(href);
}
