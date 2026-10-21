import "server-only";
import { desc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { appOrders } from "@/db/app-schema-booking";
import { appPayments, appQuotes, appRequests, appUsers } from "@/db/app-schema";
import { appDeskCanned } from "@/db/app-schema-desk";
import { appDropoffMarks, appSearchLog } from "@/db/app-schema-dropoffs";
import { pushToUser } from "@/lib/app/push";
import { openThread } from "@/lib/app/support/threads";
import { PAGE_SIZE, sendAgentReply } from "./adapters";
import { assertCap, deskAudit, DeskError, sarText, shortRef, travellerName, type DeskActor } from "./core";

/*
 * Drop-offs (DESK-PLAN.md §4.2.4): people who left halfway, worked out live from what they left behind.
 *   search   a booking search (app_search_log) with nothing after it for 30 minutes: no pay sheet, payment or order
 *   sheet    a pay sheet opened (POST /orders/preview) with no payment or order 15 minutes later
 *   payment  a declined card, or a bank check (3-D Secure) left pending for 15 minutes, with no order since
 *   held     a price held for them and not paid: a friend's share still unpaid after an hour, a quote after two
 * One row per person per kind (their latest), over the last 14 days. A later order takes them off the list by itself;
 * the desk can also mark one recovered or ignored (app_dropoff_marks, audited).
 *
 * Outreach follows DESK-PLAN.md §7 default 4: a nudge goes in the app (their Mada conversation and a push), from a
 * saved reply, within 48 hours of the drop-off; WhatsApp or a call only for someone who gave a contact on a request.
 */

export const DROPOFF_TABS = ["open", "search", "sheet", "payment", "held", "closed"] as const;
export type DropoffTab = (typeof DROPOFF_TABS)[number];
export type DropoffKind = Exclude<DropoffTab, "open" | "closed">;
export const NUDGE_HOURS = 48;
const WINDOW = sql`now() - interval '14 days'`;

/** Nothing that counts as booking after `at` by this person: an order (other than a declined one) or a payment. */
const NOTHING_AFTER = (user: SQL, at: SQL, opts: { sheet?: boolean; payment?: boolean } = {}) => sql`
  NOT EXISTS (SELECT 1 FROM ${appOrders} x WHERE x.owner_id = ${user} AND x.created_at > ${at} AND x.status NOT IN ('declined', 'requires_action'))
  ${opts.payment !== false ? sql`AND NOT EXISTS (SELECT 1 FROM ${appPayments} y WHERE y.owner_id = ${user} AND y.created_at > ${at})` : sql``}
  ${opts.sheet ? sql`AND NOT EXISTS (SELECT 1 FROM ${appSearchLog} z WHERE z.user_id = ${user} AND z.kind = 'pay_sheet' AND z.at > ${at})` : sql``}`;

const DROPOFFS = sql`
  SELECT 'search' AS kind, 'search:' || l.id AS key, l.user_id, l.at, coalesce(l.value, 0)::bigint AS value, l.summary AS what, 'searched' AS step,
    (SELECT count(*)::int FROM ${appSearchLog} c WHERE c.user_id = l.user_id AND c.kind IN ('flight', 'stay') AND c.at > ${WINDOW}) AS attempts
  FROM (SELECT DISTINCT ON (user_id) * FROM ${appSearchLog} WHERE kind IN ('flight', 'stay') AND at > ${WINDOW} ORDER BY user_id, at DESC) l
  WHERE l.at < now() - interval '30 minutes' AND ${NOTHING_AFTER(sql`l.user_id`, sql`l.at`, { sheet: true })}
  UNION ALL
  SELECT 'sheet', 'sheet:' || l.id, l.user_id, l.at, coalesce(l.value, 0)::bigint, l.summary, 'pay_sheet',
    (SELECT count(*)::int FROM ${appSearchLog} c WHERE c.user_id = l.user_id AND c.kind = 'pay_sheet' AND c.at > ${WINDOW})
  FROM (SELECT DISTINCT ON (user_id) * FROM ${appSearchLog} WHERE kind = 'pay_sheet' AND at > ${WINDOW} ORDER BY user_id, at DESC) l
  WHERE l.at < now() - interval '15 minutes' AND ${NOTHING_AFTER(sql`l.user_id`, sql`l.at`)}
  UNION ALL
  SELECT 'payment', 'pay:' || p.id, p.owner_id, p.updated_at, p.amount::bigint,
    coalesce((SELECT snapshot->>'title' FROM ${appOrders} WHERE payment_id = p.id LIMIT 1),
      (SELECT summary FROM ${appSearchLog} s WHERE s.user_id = p.owner_id AND s.kind = 'pay_sheet' AND s.at <= p.created_at + interval '1 minute' ORDER BY s.at DESC LIMIT 1),
      coalesce(p.label, 'Payment')),
    CASE WHEN p.status = 'declined' THEN 'declined' ELSE 'bank_check' END,
    (SELECT count(*)::int FROM ${appPayments} c WHERE c.owner_id = p.owner_id AND c.status IN ('declined', 'requires_action') AND c.created_at > ${WINDOW})
  FROM (SELECT DISTINCT ON (owner_id) * FROM ${appPayments}
    WHERE created_at > ${WINDOW} AND (status = 'declined' OR (status = 'requires_action' AND updated_at < now() - interval '15 minutes'))
    ORDER BY owner_id, created_at DESC) p
  WHERE ${NOTHING_AFTER(sql`p.owner_id`, sql`p.created_at`, { payment: false })}
  UNION ALL
  SELECT 'held', 'order:' || o.id, o.owner_id, o.created_at, o.total::bigint, coalesce(o.snapshot->>'title', o.kind), 'friend_to_pay', 1
  FROM ${appOrders} o WHERE o.status = 'payment_requested' AND o.created_at > ${WINDOW} AND o.created_at < now() - interval '1 hour'
  UNION ALL
  SELECT 'held', 'quote:' || r.id, r.owner_id, r.updated_at, coalesce(q.total, 0)::bigint, r.summary, 'quote_sent', 1
  FROM ${appRequests} r
  LEFT JOIN LATERAL (SELECT total FROM ${appQuotes} WHERE request_id = r.id AND status <> 'withdrawn' ORDER BY created_at DESC LIMIT 1) q ON true
  WHERE r.status IN ('quoted', 'awaiting_payment') AND r.updated_at > ${WINDOW} AND r.updated_at < now() - interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM ${appOrders} x WHERE x.request_id = r.id)`;

/** Each drop-off with its latest mark, the person, and whether they gave a phone contact on a request. */
const WITH_MARKS = sql`
  SELECT d.*, m.status AS mark, m.at AS mark_at, m.note AS mark_note, mu.name AS mark_by,
    (SELECT max(at) FROM ${appDropoffMarks} n WHERE n.key = d.key AND n.status = 'nudged') AS nudged_at,
    u.name AS user_name, u.phone, u.locale,
    (SELECT coalesce(rq.details->>'contactPhone', u.phone) FROM ${appRequests} rq WHERE rq.owner_id = d.user_id
      AND (rq.details ? 'contactPhone' OR rq.details->>'contact' IN ('call', 'whatsapp')) ORDER BY rq.created_at DESC LIMIT 1) AS contact_phone
  FROM (${DROPOFFS}) d
  JOIN ${appUsers} u ON u.id = d.user_id
  LEFT JOIN LATERAL (SELECT status, at, note, by_ops_user_id FROM ${appDropoffMarks} WHERE key = d.key AND status <> 'nudged' ORDER BY at DESC LIMIT 1) m ON true
  LEFT JOIN ${schema.users} mu ON mu.id = m.by_ops_user_id`;

export type DropoffRow = {
  kind: DropoffKind; key: string; userId: string; at: Date; value: number; what: string; step: string; attempts: number;
  mark: "recovered" | "ignored" | null; markAt: Date | null; markNote: string | null; markBy: string | null; nudgedAt: Date | null;
  userName: string; phone: string | null; locale: string; contactPhone: string | null;
};

function toRow(r: Record<string, unknown>): DropoffRow {
  const at = (v: unknown) => (v ? new Date(String(v)) : null);
  return {
    kind: r.kind as DropoffKind, key: String(r.key), userId: String(r.user_id), at: at(r.at)!, value: Number(r.value ?? 0), what: String(r.what ?? ""),
    step: String(r.step), attempts: Number(r.attempts ?? 1), mark: (r.mark as DropoffRow["mark"]) ?? null, markAt: at(r.mark_at), markNote: (r.mark_note as string | null) ?? null,
    markBy: (r.mark_by as string | null) ?? null, nudgedAt: at(r.nudged_at), userName: travellerName(r.user_name as string | null), phone: (r.phone as string | null) ?? null,
    locale: String(r.locale ?? "en"), contactPhone: (r.contact_phone as string | null) ?? null,
  };
}

/** Whether a nudge may still go: in the app, within 48 hours of the drop-off, once. */
export const canNudge = (r: Pick<DropoffRow, "at" | "nudgedAt" | "mark">, now = new Date()) =>
  !r.mark && !r.nudgedAt && now.getTime() - r.at.getTime() <= NUDGE_HOURS * 3_600_000;

/** A Riyadh day (YYYY-MM-DD) as a filter on when they dropped off, or nothing. */
export const dropoffDay = (day?: string | null) => (day && /^\d{4}-\d{2}-\d{2}$/.test(day)
  ? sql`AND at >= (${day}::date)::timestamp AT TIME ZONE 'Asia/Riyadh' AND at < ((${day}::date + 1)::timestamp AT TIME ZONE 'Asia/Riyadh')` : sql``);

/** One tab of drop-offs, searched, 50 at a time, with the count and value behind every tab. `day` keeps one Riyadh day. */
export async function pageDropoffs(opts: { tab?: string; q?: string; day?: string; limit?: number; offset?: number } = {}) {
  const tab: DropoffTab = (DROPOFF_TABS as readonly string[]).includes(opts.tab ?? "") ? (opts.tab as DropoffTab) : "open";
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = (opts.q ?? "").trim().slice(0, 80);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const search = q ? sql`AND (what ILIKE ${like} OR user_name ILIKE ${like} OR phone ILIKE ${like})` : sql``;
  const want = tab === "open" ? sql`mark IS NULL` : tab === "closed" ? sql`mark IS NOT NULL` : sql`mark IS NULL AND kind = ${tab}`;
  const res = await db.execute(sql`
    WITH a AS (SELECT * FROM (${WITH_MARKS}) w WHERE true ${search} ${dropoffDay(opts.day)}), shown AS (SELECT * FROM a WHERE ${want})
    SELECT 'c' AS t, CASE WHEN mark IS NULL THEN kind ELSE 'closed' END AS k, count(*)::int AS n, coalesce(sum(value), 0)::bigint AS v, NULL::json AS row FROM a GROUP BY 2
    UNION ALL SELECT 's', '', count(*)::int, coalesce(sum(value), 0)::bigint, NULL FROM shown
    UNION ALL (SELECT 'r', '', 0, 0, row_to_json(shown) FROM shown ORDER BY at DESC LIMIT ${limit} OFFSET ${offset})`);
  const all = res as unknown as { t: string; k: string; n: number; v: string | number; row: Record<string, unknown> | null }[];
  const counts = Object.fromEntries(DROPOFF_TABS.map((k) => [k, 0])) as Record<DropoffTab, number>;
  const values = { ...counts };
  for (const c of all.filter((x) => x.t === "c")) { counts[c.k as DropoffTab] = c.n; values[c.k as DropoffTab] = Number(c.v); }
  counts.open = counts.search + counts.sheet + counts.payment + counts.held;
  values.open = values.search + values.sheet + values.payment + values.held;
  const sum = all.find((x) => x.t === "s");
  return { tab, rows: all.filter((x) => x.t === "r").map((x) => toRow(x.row!)), total: sum?.n ?? 0, value: Number(sum?.v ?? 0), counts, values };
}

/** One drop-off by its key, as the list shows it (null once it no longer is one: they booked). */
export async function getDropoff(key: string): Promise<DropoffRow | null> {
  if (!/^(search|sheet|pay|order|quote):[0-9a-f-]{36}$/i.test(key)) return null;
  const res = await db.execute(sql`SELECT * FROM (${WITH_MARKS}) w WHERE key = ${key} LIMIT 1`);
  const r = (res as unknown as Record<string, unknown>[])[0];
  return r ? toRow(r) : null;
}

/** Open drop-offs, for the sidebar (no rows read). */
export async function openDropoffCount(): Promise<number> {
  const res = await db.execute(sql`SELECT count(*)::int AS n FROM (${WITH_MARKS}) w WHERE mark IS NULL`);
  return (res as unknown as { n: number }[])[0]?.n ?? 0;
}

/** Drop-offs (open or marked) in the last hour against the hourly average of the 7 days before it, for the desk's spike alert. */
export async function dropoffRate(): Promise<{ lastHour: number; perHour: number }> {
  const res = await db.execute(sql`SELECT count(*) FILTER (WHERE at >= now() - interval '1 hour')::int AS h,
    count(*) FILTER (WHERE at < now() - interval '1 hour' AND at >= now() - interval '169 hours')::int AS w FROM (${DROPOFFS}) d`);
  const r = (res as unknown as { h: number; w: number }[])[0];
  return { lastHour: r?.h ?? 0, perHour: (r?.w ?? 0) / 168 };
}

/** The record a drop-off points at, for the desk's activity log. */
const refOf = (key: string) => {
  const [kind, id] = key.split(":") as [string, string];
  return kind === "quote" ? shortRef(id) : kind === "order" ? shortRef(id, "O") : kind === "pay" ? shortRef(id, "P") : shortRef(id, "S");
};

/** Recovered (they came back, or the desk sorted it another way) or ignored (not worth following). Audited. */
export async function markDropoff(actor: DeskActor, key: string, v: { status: "recovered" | "ignored"; note?: string | null }) {
  assertCap(actor, "desk.act");
  if (v.status !== "recovered" && v.status !== "ignored") throw new DeskError("Choose recovered or ignored");
  const d = await getDropoff(key);
  if (!d) throw new DeskError("This drop-off isn't open any more: they may have booked", "NOT_FOUND");
  if (d.mark) throw new DeskError(d.mark === "recovered" ? "Already marked recovered" : "Already marked ignored", "CONFLICT");
  const note = v.note?.trim().slice(0, 300) || null;
  await db.transaction(async (tx) => {
    await tx.insert(appDropoffMarks).values({ key, userId: d.userId, status: v.status, note, byOpsUserId: actor.id });
    await deskAudit(tx, actor, {
      action: `desk.dropoff.${v.status}`, entityType: "app_user", entityId: d.userId, ref: refOf(key),
      summary: `Drop-off marked ${v.status}: ${d.what} (${sarText(d.value)})${note ? ` · ${note}` : ""}`, data: { key, kind: d.kind, step: d.step },
    });
  });
}

/**
 * A nudge in the app from a saved reply: it lands in the traveller's Mada conversation (as the agent, with the in-app
 * notification) and as a push. Once per drop-off, within 48 hours of it, in the traveller's language. Audited.
 */
export async function nudgeDropoff(actor: DeskActor, key: string, cannedId: string) {
  assertCap(actor, "desk.act");
  const d = await getDropoff(key);
  if (!d) throw new DeskError("This drop-off isn't open any more: they may have booked", "NOT_FOUND");
  if (!canNudge(d)) throw new DeskError(d.nudgedAt ? "Already nudged" : d.mark ? "This drop-off is already closed" : "Nudges go within 48 hours of the drop-off", "CONFLICT");
  const [c] = /^[0-9a-f-]{36}$/i.test(cannedId) ? await db.select().from(appDeskCanned).where(eq(appDeskCanned.id, cannedId)) : [];
  if (!c) throw new DeskError("Choose a saved reply");
  const body = d.locale === "ar" ? c.bodyAr : c.bodyEn;
  const th = await openThread(d.userId);
  await sendAgentReply(actor, "support", th.id, { body });
  await pushToUser(d.userId, { title: d.locale === "ar" ? "مادا" : "Mada", body: body.length > 120 ? `${body.slice(0, 119)}…` : body, data: { href: `/support/${th.id}` }, channel: "messages" });
  await db.transaction(async (tx) => {
    await tx.insert(appDropoffMarks).values({ key, userId: d.userId, status: "nudged", note: c.title, byOpsUserId: actor.id });
    await deskAudit(tx, actor, {
      action: "desk.dropoff.nudged", entityType: "app_user", entityId: d.userId, ref: refOf(key),
      summary: `Nudged in the app with "${c.title}": ${d.what}`, data: { key, kind: d.kind, cannedId: c.id, threadId: th.id },
    });
  });
  return { threadId: th.id };
}

/** The saved replies a nudge can use. */
export const savedReplies = () => db.select().from(appDeskCanned).orderBy(appDeskCanned.sort, desc(appDeskCanned.createdAt));
