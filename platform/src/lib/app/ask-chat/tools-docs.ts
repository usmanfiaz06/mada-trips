import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { endingOf, passportReady } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appTrips } from "@/db/app-schema";
import { appDocuments } from "@/db/app-schema-wallet";
import { attachmentLine, attachmentState } from "./attachments";
import { draftShare, shareCard, sharesFor } from "./doc-shares";
import type { ToolCtx, ToolOut } from "./tools";

/*
 * The document tools (docs/app/ASK-INTEGRATED.md §8, U6). They only read, or show a card: saving a document, using one
 * from a photo, and asking a companion to share all happen on the traveller's tap (POST /ask/attachments/{id}, POST
 * /ask/shares/{id}), never from a tool call. What the model reads is the card's words only: first name, kind, the last
 * two characters, the month it expires, whether it's on file (§6.4). Never a number, a line of the MRZ or a photo.
 */

type Run = (ctx: ToolCtx, input: Record<string, unknown>) => Promise<ToolOut>;
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 12) : []);
const month = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : null);

const nullable = (t: string) => ({ type: [t, "null"] });
const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, properties, required: Object.keys(properties), additionalProperties: false });

export const DOC_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "documents_on_file",
    description: "What passports and documents Mada already holds for these people (household ids, or a companion's user id): kind, the last two characters, the month it expires, and with a trip whether it lasts 6 months past the return. Never asks for or returns numbers.",
    strict: true,
    input_schema: obj({
      traveller_ids: { type: "array", items: { type: "string" }, description: "Household ids (or a companion's user id); empty: the whole household." },
      trip_id: { ...nullable("string"), description: "The trip to check expiry against, or null." },
    }) as Anthropic.Beta.BetaTool["input_schema"],
  },
  {
    name: "use_document",
    description: "Where a passport or document sent in this chat stands (attachment_id from the context). It never saves or uses anything itself: the traveller decides with a tap on its card. Call it to know whether they have tapped.",
    strict: true,
    input_schema: obj({
      attachment_id: { type: "string" },
      person_id: nullable("string"),
      action: { type: "string", enum: ["use", "add", "replace", "this_booking_only"] },
    }) as Anthropic.Beta.BetaTool["input_schema"],
  },
  {
    name: "request_document_share",
    description: "Show a card to ask a companion with their own Mada account to share their passport for this trip. The request is sent only when the traveller taps it (it tells the companion about the trip).",
    strict: true,
    input_schema: obj({
      trip_id: { type: "string" },
      user_id: { type: "string", description: "The companion's user id." },
      kind: { type: "string", enum: ["passport"] },
    }) as Anthropic.Beta.BetaTool["input_schema"],
  },
];

export const DOC_RUN: Record<string, Run> = {
  async documents_on_file(ctx, a) {
    const asked = ids(a.traveller_ids);
    const people = await db.select().from(appPeople).where(and(eq(appPeople.ownerId, ctx.ownerId), isNull(appPeople.deletedAt)));
    const mine = asked.length ? people.filter((p) => asked.includes(p.id)) : people;
    const others = asked.filter((id) => !people.some((p) => p.id === id));
    const tripId = typeof a.trip_id === "string" ? a.trip_id : null;
    const [trip] = tripId ? await db.select({ startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, ctx.ownerId))) : [];
    const docs = mine.length ? await db.select({ personId: appDocuments.personId, kind: appDocuments.kind, validUntil: appDocuments.validUntil }).from(appDocuments)
      .where(and(eq(appDocuments.ownerId, ctx.ownerId), inArray(appDocuments.personId, mine.map((p) => p.id)), isNull(appDocuments.deletedAt))) : [];
    const lines = mine.map((p) => {
      const name = ctx.people.find((x) => x.id === p.id)?.firstName || (p.isSelf ? "the account holder" : "unnamed");
      const extra = [...new Set(docs.filter((d) => d.personId === p.id && d.kind !== "passport").map((d) => `${d.kind}${d.validUntil ? ` to ${month(d.validUntil)}` : ""}`))];
      if (!p.passportNumberMasked || !p.passportExpiry) return `${p.id}: ${name} · passport: none on file${extra.length ? ` · also: ${extra.join(", ")}` : ""}`;
      const r = trip ? passportReady({ passport: { expiry: p.passportExpiry } as never }, { today: ctx.today, travelEnds: trip.endDate ?? trip.startDate }) : null;
      const fit = !r ? "" : r.state === "ready" ? " · fine for this trip (6 months after the return)" : r.state === "expiring" ? (r.reason === "expired" ? " · expired" : ` · too short for this trip: must last until ${r.needUntil}`) : "";
      return `${p.id}: ${name} · passport on file · ending ${endingOf(p.passportNumberMasked)} · valid to ${month(p.passportExpiry)} · ${p.passportNationality ?? "?"}${fit}${extra.length ? ` · also: ${extra.join(", ")}` : ""}`;
    });
    if (others.length) {
      const shared = await sharesFor(ctx.ownerId, tripId, others);
      for (const id of others) {
        const s = shared.get(id);
        lines.push(s
          ? `${id}: ${s.name} (companion) · passport ${s.status === "shared" ? `shared for this trip · ending ${s.ending ?? "?"} · valid to ${month(s.validTo) ?? "?"}` : s.status === "sent" ? "asked, not shared yet" : s.status === "draft" ? "not asked yet" : s.status}`
          : `${id}: not in the household; a companion's passport comes only from them (request_document_share)`);
      }
    }
    return { text: lines.join("\n") || "Nobody saved yet." };
  },

  async use_document(ctx, a) {
    const s = typeof a.attachment_id === "string" ? await attachmentState(ctx.ownerId, a.attachment_id) : null;
    if (!s) return { text: "No such document in this chat.", isError: true };
    const line = attachmentLine(String(a.attachment_id), s.result, s.status);
    if (s.status === "read") return { text: `${line}\nNot done: nothing is saved or used until the traveller taps the card already in the chat. Say so in one line; never ask them to type the number.` };
    return { text: `${line}\nDone on their tap; say it once if it matters to the booking.` };
  },

  async request_document_share(ctx, a) {
    if (typeof a.trip_id !== "string" || typeof a.user_id !== "string") return { text: "Need the trip id and the companion's user id.", isError: true };
    const row = await draftShare(ctx.ownerId, { tripId: a.trip_id, userId: a.user_id, threadId: ctx.threadId ?? null });
    const card = await shareCard(row, ctx.lang);
    const state = { draft: "Card shown. Nothing is sent until the traveller taps it", sent: "Already asked; waiting for them", shared: "Already shared for this trip", declined: "They didn't share it", expired: "That request ended" }[row.status] ?? row.status;
    return { text: `${state} (${card.name}). Say it in one line.`, cards: [card] };
  },
};
