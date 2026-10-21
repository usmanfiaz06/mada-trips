import "server-only";
import { rangeLabel, t, type ChatCard, type PlanOp } from "@mada/shared";
import { AppError } from "../http";
import { ownTrip } from "../plans/plans";
import { addTraveller, findMatches, removeTraveller, roleOf, sharedTrip, sharedTrips, tripName } from "../trips/travellers";
import { changeCard, decideChange, requestChange } from "../trips/change-requests";
import type { ToolCtx, ToolOut } from "./tools";

/*
 * Companions in the chat (ASK-INTEGRATED.md §5, §8, U5): add_traveller, remove_traveller, shared_trip, request_change,
 * decide_change, run as the signed-in traveller through the same functions as the Travellers screen and the cards.
 * A name never picks a person by itself: one household match is added (free, reversible); anything else comes back as
 * a card the traveller taps (which Abdullah, or the invite, which shares the trip and so only goes on a tap). What the
 * model reads is first names and how each is known, never contacts, numbers or documents.
 */

type Run = (ctx: ToolCtx, input: Record<string, unknown>) => Promise<ToolOut>;
const str = (v: unknown, max = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);

/** The model's simple op ({op, item_id, day, nights, title, kind}) as a plan op; null when it doesn't make one. */
export function planOpOf(o: Record<string, unknown>): PlanOp | null {
  const id = str(o.item_id, 40);
  const day = int(o.day);
  const nights = int(o.nights);
  const title = str(o.title, 120);
  switch (o.op) {
    case "add": {
      if (!title) return null;
      const kind = (["stay", "activity", "meal", "note", "leg", "car"] as const).find((k) => k === o.kind) ?? "activity";
      return { op: "add", day: day != null && day >= 0 ? day : null, item: { kind, title, ...(nights ? { nights } : {}) } };
    }
    case "update":
      if (!id || (nights == null && !title)) return null;
      return { op: "update", itemId: id, item: { ...(nights != null ? { nights } : {}), ...(title ? { title } : {}) } };
    case "move": return id ? { op: "move", itemId: id, day: day != null && day >= 0 ? day : null } : null;
    case "remove": case "skip": return id ? { op: o.op, itemId: id } : null;
    default: return null;
  }
}

export const PEOPLE_RUN: Record<string, Run> = {
  async add_traveller(ctx, a) {
    const tripId = String(a.trip_id ?? "");
    const name = str(a.name, 40);
    if (!name) return { text: "Not added: say who (a first name).", isError: true };
    const trip = await ownTrip(ctx.ownerId, tripId);
    const title = await tripName(trip);
    const matches = await findMatches(ctx.ownerId, name, { tripId, lang: ctx.lang });
    const household = matches.filter((m) => m.ref.kind === "person");
    if (matches.length === 1 && household.length === 1) {
      const r = await addTraveller(ctx.ownerId, tripId, { personId: household[0]!.ref.id }, "ask");
      return { text: r.already ? `${r.traveller.name} is already on ${title}.` : `Added ${r.traveller.name} (${household[0]!.how}) to ${title}. Say it in one line ("${t("people.added", { name: r.traveller.name }, ctx.lang)}").` };
    }
    if (matches.length) {
      const card: ChatCard = { type: "people", tripId, name, options: matches };
      const several = matches.length > 1;
      return {
        text: `${several ? `${matches.length} people match "${name}"` : `One friend on Mada matches "${name}"`}: ${matches.map((m) => `${m.name} (${m.how})`).join("; ")}. ${several ? "Never pick one yourself: ask" : "He hears about the trip only once the traveller taps, so ask"} in one short line, exactly "${t("people.which", { name }, ctx.lang)}". The card lists them; the tap adds the one picked.`,
        cards: [card],
      };
    }
    return {
      text: `Nobody called ${name} in the household or circle. Say in one line that ${name} isn't in their circle yet and ask whether to invite them. The card sends the invite only when they tap it (it shares the trip's name and dates); never say it was sent.`,
      cards: [{ type: "invite", tripId, name, tripTitle: title, when: rangeLabel(trip.startDate, trip.endDate, ctx.lang) }],
    };
  },

  async remove_traveller(ctx, a) {
    const tripId = String(a.trip_id ?? "");
    await removeTraveller(ctx.ownerId, tripId, String(a.traveller_id ?? ""));
    return { text: "Taken off the trip. Their booked tickets, if any, stay until the booking is changed." };
  },

  async shared_trip(ctx, a) {
    const id = str(a.trip_id, 40);
    if (!id) {
      const list = await sharedTrips(ctx.ownerId);
      if (!list.length) return { text: "No trips shared with them." };
      return { text: list.map((x) => `trip_id=${x.tripId} · ${x.title} · ${x.startDate}${x.endDate ? ` to ${x.endDate}` : ""} · from ${x.ownerName} · role ${x.role} · ${x.status}`).join("\n") };
    }
    const v = await sharedTrip(ctx.ownerId, id);
    const items = v.items.map((i) => `item_id=${i.id} · ${i.day == null ? "whole trip" : `day ${i.day + 1}`} · ${i.kind}${i.mode ? `/${i.mode}` : ""} · ${i.title}${i.place ? ` · ${i.place}` : ""}${i.at ? ` · ${i.at}` : ""}${i.nights ? ` · ${i.nights} nights` : ""}${i.booked ? " · booked" : ""}`);
    return { text: `${v.title} (${v.startDate}${v.endDate ? ` to ${v.endDate}` : ""}), organised by ${v.ownerName}, who books and pays; no prices here. Their role: ${v.role} (view: questions only; suggest: changes go to ${v.ownerName} to approve; edit: ideas change at once, bookings still go to ${v.ownerName}). Travelling: ${v.people.map((p) => p.name).join(", ")}.\n${items.join("\n") || "Nothing planned yet."}` };
  },

  async request_change(ctx, a) {
    const tripId = String(a.trip_id ?? "");
    const ops = (Array.isArray(a.ops) ? a.ops : []).map((o) => (o && typeof o === "object" ? planOpOf(o as Record<string, unknown>) : null)).filter((o): o is PlanOp => !!o);
    if (!ops.length) return { text: "Not asked: each change needs an op with the item_id from shared_trip (or a title for add).", isError: true };
    const who = await roleOf(ctx.ownerId, tripId);
    if (!who) return { text: "Not their trip: they aren't on it, or haven't joined yet.", isError: true };
    if (who.role === "owner") return { text: "This is their own trip: change the plan directly with the plan tools, no approval needed.", isError: true };
    if (who.role === "view") return { text: "They can view this trip, not ask for changes. Say the organiser decides what changes, and offer to answer questions about it.", isError: true };
    try {
      const r = await requestChange(ctx.ownerId, tripId, { summary: String(a.summary ?? ""), ops }, { threadId: ctx.threadId ?? null });
      if (r.applied) return { text: `${r.text} They can edit ideas, so it's done; say what changed in one line.` };
      const owner = r.change!.ownerName;
      return {
        text: `${r.text} Say exactly "${t("people.line.waiting", { owner }, ctx.lang)}"${r.change!.costs ? ` and that ${owner} books and pays for anything it needs` : ""}. The card shows it waiting; nothing changes until ${owner} approves.`,
        cards: [changeCard(r.change!)],
      };
    } catch (e) {
      if (e instanceof AppError && e.extra.details?.booked) return { text: "That part is booked, so only the organiser can change it, through the booking. Say so in one line and offer to suggest something else.", isError: true };
      throw e;
    }
  },

  async decide_change(ctx, a) {
    const tripId = String(a.trip_id ?? "");
    const decision = a.decision === "approve" ? "approve" : a.decision === "decline" ? "decline" : null;
    if (!decision) return { text: "Say approve or decline.", isError: true };
    const c = await decideChange(ctx.ownerId, tripId, String(a.change_id ?? ""), { decision, reason: str(a.reason, 140) });
    return {
      text: c.status === "approved" ? `Approved: ${c.lines.map((l) => l.text).join("; ")}. ${c.byName}'s chat says so.${c.costs ? " It needs booking: offer to price it." : ""}`
        : c.status === "declined" ? `Declined; the plan stays as it is. ${c.byName}'s chat says so.` : `It is ${c.status}; nothing changed.`,
      cards: [changeCard(c)],
    };
  },
};

/** The status line while a people tool runs, in the traveller's language. */
export function peopleStatus(name: string, input: Record<string, unknown>, lang: "en" | "ar"): string | null {
  if (name === "add_traveller") return t("people.status.find", { name: str(input.name, 40) ?? "" }, lang);
  if (name === "request_change") return t("people.status.suggest", undefined, lang);
  if (name === "shared_trip") return t("people.status.trip", undefined, lang);
  if (name === "decide_change" || name === "remove_traveller") return t("people.status.update", undefined, lang);
  return null;
}
