import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { t as copy } from "@mada/shared";
import { db, schema } from "@/db";
import { appAskThreads } from "@/db/app-schema-ask";
import { appNotifications, appUsers } from "@/db/app-schema";
import { localeOfUser } from "@/lib/app/locale";
import { withCopy } from "@/lib/app/notify-copy";
import { handBackNote, type AskLine } from "../ask-chat/takeover";
import { previewOf } from "../ask-chat/titles";
import { appAgents } from "@/db/app-schema-desk";
import { agentForOps } from "./agents";
import { assertCap, deskAudit, DeskError, has, shortRef, travellerName, type DeskActor } from "./core";
import { askAccess, openItems } from "./customers";
import { createTicket, ticketsFor } from "./tickets";

/*
 * Ask Mada threads on the desk (DESK-PLAN.md U5, §7 default 5). The list shows that a thread exists; its words only
 * come through readAsk, for someone allowed to read it: a lead (desk.admin) reads any; an agent with desk.ask.read reads
 * one handed to the desk (or taken over), or any of a customer with an open ticket or open item. Every read is audited.
 *
 * Take over: the thread's mode becomes "agent", the model stops answering (ask-chat/chat.ts keeps what the traveller
 * writes), the traveller sees "Noura from Mada joined" once and the agent's replies as hers. A ticket is linked (or
 * opened) for it. Hand back restores Mada, with a note on what was said meanwhile for the model's next turn.
 */

const D = "/adminwork/desk";
export const askHref = (id: string) => `${D}/ask/${id}`;
export const ASK_REF = (id: string) => shortRef(id, "A");

const OPEN_TICKET = sql<boolean>`EXISTS (SELECT 1 FROM desk_tickets dt WHERE dt.customer_id = ${appAskThreads.ownerId} AND dt.status IN ('new','open','waiting_customer','waiting_supplier'))`;
/** Handed to the desk: the model passed it on (talk_to_human; the history is read for threads written before 0038), or someone has it now. */
const HANDED = sql<boolean>`(${appAskThreads.handedOffAt} IS NOT NULL OR ${appAskThreads.mode} = 'agent' OR position('talk_to_human' in ${appAskThreads.messages}::text) > 0)`;

/**
 * The title the desk may see: only one made from what was read (a place, a route, the trip). A title made of the first
 * words, or a traveller's rename, is their words, and the list never shows words.
 */
const DESK_TITLE = sql<string | null>`CASE WHEN ${appAskThreads.titledBy} IN ('place', 'route', 'trip') THEN ${appAskThreads.title} END`;

export const ASK_TABS = ["all", "handed", "taken", "ticket"] as const;
export type AskTab = (typeof ASK_TABS)[number];
const TAB_WHERE: Record<AskTab, SQL | undefined> = {
  all: undefined, handed: HANDED, taken: sql`${appAskThreads.mode} = 'agent'`, ticket: OPEN_TICKET,
};

const isLead = (a: DeskActor) => a.permissions.has("desk.admin");
const mayList = (a: DeskActor) => isLead(a) || a.permissions.has("desk.ask.read");

/** The Ask threads list: search (name, phone, email, A-ref), tabs, language, 50 to a page. Never the words. */
/** The plan behind a chat's trip (ASK-INTEGRATED §10): its version and how far along it is, from the items' status cache. */
const PLAN_OF = sql<{ v: number; booked: number; items: number } | null>`(SELECT json_build_object('v', p.version,
  'booked', (SELECT count(*) FROM app_plan_items i WHERE i.plan_id = p.id AND i.deleted_at IS NULL AND i.status IN ('booked','confirmed')),
  'items', (SELECT count(*) FROM app_plan_items i WHERE i.plan_id = p.id AND i.deleted_at IS NULL AND i.status NOT IN ('skipped','cancelled')))
  FROM app_plans p WHERE p.trip_id = ${appAskThreads.tripId})`;
const HAS_PLAN = sql<boolean>`EXISTS (SELECT 1 FROM app_plans p WHERE p.trip_id = ${appAskThreads.tripId})`;

export async function listAskThreads(actor: DeskActor, o: { tab?: string; q?: string; lang?: string; plan?: boolean; limit?: number; offset?: number } = {}) {
  if (!mayList(actor)) throw new DeskError("You don't have access to Ask conversations", "FORBIDDEN");
  const tab: AskTab = (ASK_TABS as readonly string[]).includes(o.tab ?? "") ? (o.tab as AskTab) : "all";
  const q = (o.q ?? "").trim();
  const digits = q.replace(/\D/g, "").replace(/^0+/, "");
  const ref = /^a-?([0-9a-f]{6})$/i.exec(q)?.[1]?.toLowerCase();
  const search = !q ? undefined : ref ? sql`replace(${appAskThreads.id}::text, '-', '') LIKE ${`${ref}%`}`
    : sql`(${appUsers.name} ILIKE ${`%${q}%`} OR ${DESK_TITLE} ILIKE ${`%${q}%`} OR lower(${appUsers.email}) LIKE ${`%${q.toLowerCase()}%`}${digits.length >= 5 ? sql` OR regexp_replace(${appUsers.phone}, '[^0-9]', '', 'g') LIKE ${`%${digits}%`}` : sql``})`;
  const lang = o.lang === "en" || o.lang === "ar" ? eq(appAskThreads.lang, o.lang) : undefined;
  const base = and(search, lang, o.plan ? HAS_PLAN : undefined);
  const where = and(base, TAB_WHERE[tab]);
  const [rows, [tot], [counts]] = await Promise.all([
    db.select({
      id: appAskThreads.id, ownerId: appAskThreads.ownerId, lang: appAskThreads.lang, turns: appAskThreads.turns, mode: appAskThreads.mode,
      // The chat's title (ASK-INTEGRATED.md §2.3, §10): what it's about, never the words inside.
      title: DESK_TITLE, tripId: appAskThreads.tripId, plan: PLAN_OF,
      createdAt: appAskThreads.createdAt, updatedAt: appAskThreads.updatedAt, handedOffAt: appAskThreads.handedOffAt,
      handed: HANDED, openTicket: OPEN_TICKET, customer: appUsers.name,
      // The first name travellers see, else the Ops login's name.
      takenByName: sql<string | null>`coalesce(${appAgents.displayName}, ${schema.users.name})`,
      lines: sql<number>`jsonb_array_length(${appAskThreads.transcript})`,
    }).from(appAskThreads).innerJoin(appUsers, eq(appUsers.id, appAskThreads.ownerId)).leftJoin(schema.users, eq(schema.users.id, appAskThreads.takenBy))
      .leftJoin(appAgents, eq(appAgents.opsUserId, appAskThreads.takenBy)).where(where).orderBy(desc(appAskThreads.updatedAt)).limit(o.limit ?? 50).offset(o.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(appAskThreads).innerJoin(appUsers, eq(appUsers.id, appAskThreads.ownerId)).where(where),
    db.select({
      all: sql<number>`count(*)::int`, handed: sql<number>`count(*) FILTER (WHERE ${HANDED})::int`,
      taken: sql<number>`count(*) FILTER (WHERE ${appAskThreads.mode} = 'agent')::int`, ticket: sql<number>`count(*) FILTER (WHERE ${OPEN_TICKET})::int`,
    }).from(appAskThreads).innerJoin(appUsers, eq(appUsers.id, appAskThreads.ownerId)).where(base),
  ]);
  return {
    tab, total: tot?.n ?? 0, counts: (counts ?? { all: 0, handed: 0, taken: 0, ticket: 0 }) as Record<AskTab, number>,
    rows: rows.map((r) => ({
      ...r, customer: travellerName(r.customer),
      // What the list can tell cheaply; the thread page decides with the full rule (open items too).
      open: !!askAccess(actor.permissions, { handedOff: !!r.handed, customerHasOpen: !!r.openTicket }),
    })),
  };
}

/** A transcript line as the desk shows it: words and card names only (redaction already happened before storing). */
export type DeskAskLine = { who: "me" | "mada" | "agent" | "system"; text: string; cards: string[]; held: string | null; by: string | null; event: string | null; at: string | null };
export function deskLines(transcript: unknown[]): DeskAskLine[] {
  const out: DeskAskLine[] = [];
  for (const raw of transcript as AskLine[]) {
    if (!raw || typeof raw !== "object" || !["me", "mada", "agent", "system"].includes(raw.who)) continue;
    const l = raw as AskLine & { cards?: unknown; held?: unknown; by?: unknown; event?: unknown; at?: unknown; text?: unknown };
    out.push({
      who: l.who, text: typeof l.text === "string" ? l.text : "",
      cards: Array.isArray(l.cards) ? l.cards.filter((c): c is string => typeof c === "string").slice(0, 6) : [],
      held: typeof l.held === "string" ? l.held : null, by: typeof l.by === "string" ? l.by : null,
      event: typeof l.event === "string" ? l.event : null, at: typeof l.at === "string" ? l.at : null,
    });
  }
  return out;
}

async function loadAsk(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [th] = await db.select({ th: appAskThreads, handed: HANDED, openTicket: OPEN_TICKET }).from(appAskThreads).where(eq(appAskThreads.id, id));
  return th ?? null;
}

/** Why this person may read it, or a refusal. */
async function accessTo(actor: DeskActor, th: NonNullable<Awaited<ReturnType<typeof loadAsk>>>) {
  if (th.th.takenBy === actor.id) return "handoff" as const;
  const quick = askAccess(actor.permissions, { handedOff: !!th.handed, customerHasOpen: !!th.openTicket });
  if (quick) return quick;
  const items = actor.permissions.has("desk.ask.read") ? await openItems(th.th.ownerId) : [];
  return askAccess(actor.permissions, { handedOff: false, customerHasOpen: items.length > 0 });
}
const REFUSED = "Ask conversations open to the desk once they're handed over, or while the customer has something open with us";

/** One thread, read-only, for someone allowed to read it. Every read lands in both audit trails. */
export async function readAsk(actor: DeskActor, id: string) {
  assertCap(actor, "desk.view");
  const th = await loadAsk(id);
  if (!th) throw new DeskError("Not found", "NOT_FOUND");
  const why = await accessTo(actor, th);
  if (!why) throw new DeskError(REFUSED, "FORBIDDEN");
  const t = th.th;
  const [[user], [taker], tickets, me] = await Promise.all([
    db.select({ id: appUsers.id, name: appUsers.name, phone: appUsers.phone, locale: appUsers.locale }).from(appUsers).where(eq(appUsers.id, t.ownerId)),
    t.takenBy ? db.select({ name: sql<string>`coalesce(${appAgents.displayName}, ${schema.users.name})` }).from(schema.users).leftJoin(appAgents, eq(appAgents.opsUserId, schema.users.id)).where(eq(schema.users.id, t.takenBy))
      : Promise.resolve([] as { name: string }[]),
    ticketsFor("ask_thread", t.id),
    agentForOps(actor.id),
  ]);
  await db.transaction((tx) => deskAudit(tx, actor, {
    action: "desk.ask.read", entityType: "ask_thread", entityId: t.id, ref: ASK_REF(t.id),
    summary: `Read an Ask Mada conversation (${t.turns} turns${why === "lead" ? ", as lead" : why === "handoff" ? ", handed to the desk" : ", customer has something open"})`,
    data: { userId: t.ownerId, why },
  }));
  return {
    id: t.id, ref: ASK_REF(t.id), ownerId: t.ownerId, lang: t.lang, turns: t.turns, mode: t.mode as "ai" | "agent", takenBy: t.takenBy, takenAt: t.takenAt,
    takenByName: taker?.name ?? null, handedOffAt: t.handedOffAt, handed: !!th.handed, summary: t.summary, createdAt: t.createdAt, updatedAt: t.updatedAt,
    costMicros: t.costMicros, why, lines: deskLines(t.transcript), user: user ?? null, tickets, me,
    mine: t.mode === "agent" && t.takenBy === actor.id,
  };
}
export type AskFull = Awaited<ReturnType<typeof readAsk>>;

/**
 * Take the thread over: Mada stops answering it, the traveller sees "<name> from Mada joined" once, and a ticket is
 * linked (an open one already on the thread, or a new one). Needs desk.act, read access, and a named agent profile.
 */
export async function takeOverAsk(actor: DeskActor, id: string, now = new Date()) {
  assertCap(actor, "desk.act");
  const agent = await agentForOps(actor.id);
  // The traveller only ever sees a real, named person join (§7 default 5).
  if (!agent || !agent.active) throw new DeskError("Set up your agent profile (the first name travellers see) in Team before taking a conversation over", "FORBIDDEN");
  const th = await loadAsk(id);
  if (!th) throw new DeskError("Not found", "NOT_FOUND");
  if (!(await accessTo(actor, th))) throw new DeskError(REFUSED, "FORBIDDEN");
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(appAskThreads).where(eq(appAskThreads.id, id)).for("update");
    if (!row) throw new DeskError("Not found", "NOT_FOUND");
    if (row.mode === "agent" && row.takenBy !== actor.id) throw new DeskError("Someone else on the desk has this conversation", "CONFLICT");
    if (row.mode === "agent") return;
    const joined: AskLine = { who: "system", event: "joined", by: agent.displayName, byAr: agent.displayNameAr, pronoun: agent.pronoun, at: now.toISOString() };
    await tx.update(appAskThreads).set({
      mode: "agent", takenBy: actor.id, takenAt: now, updatedAt: now,
      transcript: sql`${appAskThreads.transcript} || ${JSON.stringify([joined])}::jsonb`,
    }).where(eq(appAskThreads.id, id));
    await deskAudit(tx, actor, {
      action: "desk.ask.taken_over", entityType: "ask_thread", entityId: id, ref: ASK_REF(id),
      summary: `Took over an Ask Mada conversation as ${agent.displayName}`, data: { userId: row.ownerId, agentId: agent.id },
    });
  });
  const open = await ticketsFor("ask_thread", id);
  const ticket = open[0] ?? await createTicket(actor, {
    subject: "Ask Mada conversation taken over", customerId: th.th.ownerId, about: { kind: "ask_thread", id },
    note: "Taken over from Ask Mada: Mada stops answering until it's handed back.",
  }, now);
  return { ticket };
}

/** A reply from the person who has the thread: the traveller reads it in Ask as theirs, and gets a notification. */
export async function replyOnAsk(actor: DeskActor, id: string, body: string, now = new Date()) {
  assertCap(actor, "desk.act");
  const text = body.trim();
  if (!text) throw new DeskError("Write a reply first");
  if (text.length > 2000) throw new DeskError("Keep a reply under 2,000 characters");
  const agent = await agentForOps(actor.id);
  if (!agent) throw new DeskError("Set up your agent profile in Team first", "FORBIDDEN");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(appAskThreads).where(eq(appAskThreads.id, id)).for("update");
    if (!row) throw new DeskError("Not found", "NOT_FOUND");
    if (row.mode !== "agent" || row.takenBy !== actor.id) throw new DeskError("Take the conversation over before replying", "CONFLICT");
    const line: AskLine = { who: "agent", text, by: agent.displayName, byAr: agent.displayNameAr, agentId: agent.id, opsUserId: actor.id, at: now.toISOString() };
    // The traveller's list shows the reply as the chat's last line (ASK-INTEGRATED.md §2.4).
    await tx.update(appAskThreads).set({ transcript: sql`${appAskThreads.transcript} || ${JSON.stringify([line])}::jsonb`, updatedAt: now, lastAt: now, preview: previewOf(line.text) }).where(eq(appAskThreads.id, id));
    const locale = await localeOfUser(row.ownerId, tx);
    const name = locale === "ar" && agent.displayNameAr ? agent.displayNameAr : agent.displayName;
    const vars = { agent: name, text };
    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
    await tx.insert(appNotifications).values({
      userId: row.ownerId, kind: "agent_reply", level: "active", href: "/ask",
      title: clip(copy("notify.desk.reply.title", vars, locale), 32), body: clip(copy("notify.desk.reply.body", vars, locale), 90),
      data: withCopy({ threadId: id }, { title: ["notify.desk.reply.title", vars], body: ["notify.desk.reply.body", vars] }),
    });
    await deskAudit(tx, actor, {
      action: "desk.ask.replied", entityType: "ask_thread", entityId: id, ref: ASK_REF(id),
      summary: `Replied in an Ask Mada conversation as ${agent.displayName}`, data: { userId: row.ownerId, chars: text.length },
    });
  });
}

/** Back to Mada: the AI answers again, and its next turn reads what was said while a person had it. */
export async function handBackAsk(actor: DeskActor, id: string, now = new Date()) {
  assertCap(actor, "desk.act");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(appAskThreads).where(eq(appAskThreads.id, id)).for("update");
    if (!row) throw new DeskError("Not found", "NOT_FOUND");
    if (row.mode !== "agent") return;
    if (row.takenBy !== actor.id && !has(actor, "desk.tickets.manage") && !isLead(actor)) throw new DeskError("Only the person who has it, or a lead, can hand it back", "FORBIDDEN");
    const lines = row.transcript as AskLine[];
    const joined = [...lines].reverse().find((l) => l?.who === "system" && l.event === "joined") as { by?: string } | undefined;
    const name = joined?.by ?? "A person on the team";
    const back: AskLine = { who: "system", event: "handed_back", by: name, at: now.toISOString() };
    await tx.update(appAskThreads).set({
      mode: "ai", takenBy: null, takenAt: null, updatedAt: now,
      deskNote: handBackNote(lines, row.takenAt, name),
      transcript: sql`${appAskThreads.transcript} || ${JSON.stringify([back])}::jsonb`,
    }).where(eq(appAskThreads.id, id));
    await deskAudit(tx, actor, {
      action: "desk.ask.handed_back", entityType: "ask_thread", entityId: id, ref: ASK_REF(id),
      summary: "Handed an Ask Mada conversation back to Mada", data: { userId: row.ownerId },
    });
  });
}
