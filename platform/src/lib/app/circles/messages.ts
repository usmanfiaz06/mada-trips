import "server-only";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import {
  CreateSplitRequest, CreateVoteRequest, bookPrefill, circleDest, madaReply, planById, shareUnits, splitAmounts, t, todayIn, votePhrase,
  type CircleMessage, type MadaAction, type MarkPaidRequest, type MessagesPage, type SendCircleMessageRequest,
} from "@mada/shared";
import { db } from "@/db";
import { appCircleMembers, appCircles, appMessages } from "@/db/app-schema";
import { appCircleDetails, appCircleSplitShares, appCircleVotes } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { supplierMode } from "../config";
import { suppliers } from "../suppliers";
import { addMessage, details, isDm, memberIds, membership, sysMessage, toMessages, type MessageRow } from "./circles";
import { assertUnder, circleTrip, err, graphOf, isBlocked, notify, peopleByIds, sar, type Db } from "./common";

/*
 * A circle's chat: pages of messages (newest page first, oldest-first inside a page), sending, Mada's answers to
 * "@Mada", votes and cost splits. Polled every few seconds by an open chat today; the cursor shape (?after=) is what
 * a websocket or SSE stream would resume from later.
 */

const PAGE = 50;
const encode = (r: { createdAt: Date; id: string }) => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString("base64url");
function decode(c: string | null): { at: Date; id: string } | null {
  if (!c) return null;
  const [at, id] = Buffer.from(c, "base64url").toString().split("|");
  const d = new Date(at ?? "");
  if (!id || Number.isNaN(d.getTime())) throw new AppError("VALIDATION", { fields: { cursor: "Unknown cursor" } });
  return { at: d, id };
}

export async function listMessages(circleId: string, userId: string, q: { before?: string | null; after?: string | null; limit?: number }): Promise<MessagesPage> {
  await membership(circleId, userId);
  const limit = Math.min(Math.max(q.limit ?? PAGE, 1), 100);
  const before = decode(q.before ?? null);
  const after = decode(q.after ?? null);
  const where = and(
    eq(appMessages.threadKind, "circle"), eq(appMessages.threadId, circleId),
    before ? or(lt(appMessages.createdAt, before.at), and(eq(appMessages.createdAt, before.at), lt(appMessages.id, before.id))) : undefined,
    after ? or(gt(appMessages.createdAt, after.at), and(eq(appMessages.createdAt, after.at), gt(appMessages.id, after.id))) : undefined,
  );
  const rows = after
    ? await db.select().from(appMessages).where(where).orderBy(asc(appMessages.createdAt), asc(appMessages.id)).limit(limit)
    : (await db.select().from(appMessages).where(where).orderBy(desc(appMessages.createdAt), desc(appMessages.id)).limit(limit + 1));
  let next: string | null = null;
  let page = rows;
  if (!after) {
    if (rows.length > limit) { page = rows.slice(0, limit); next = encode(page[page.length - 1]!); }
    page = page.reverse();
  }
  const reads = await db.select({ userId: appCircleMembers.userId, at: appCircleMembers.lastReadAt }).from(appCircleMembers).where(eq(appCircleMembers.circleId, circleId));
  return { items: await toMessages(page), next, reads: reads.filter((r) => r.at).map((r) => ({ userId: r.userId, at: r.at!.toISOString() })) };
}

async function readUpTo(tx: Db, circleId: string, userId: string) {
  await tx.update(appCircleMembers).set({ lastReadAt: new Date() }).where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, userId)));
}

async function guardDm(circleId: string, userId: string) {
  if (!(await isDm(circleId))) return;
  const other = (await memberIds(circleId)).find((id) => id !== userId);
  if (other && (await isBlocked(userId, other))) throw err("FORBIDDEN", "circles.err.blocked");
}

async function rateLimit(userId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(appMessages)
    .where(and(eq(appMessages.authorUserId, userId), sql`${appMessages.createdAt} > now() - interval '1 minute'`));
  assertUnder(r?.n ?? 0, 30, 60);
}

/** Mada's answer: the configured model in live mode (about this circle's place), the rules otherwise. */
async function madaAnswer(circleId: string, text: string, prevAskedWhere: boolean) {
  const [c] = await db.select({ name: appCircles.name, tripId: appCircles.tripId }).from(appCircles).where(eq(appCircles.id, circleId));
  const d = await details(circleId);
  const members = (await memberIds(circleId)).length;
  const dest = circleDest({ dest: d.dest, name: c?.name ?? "", trip: await circleTrip(c?.tripId ?? null) });
  const rules = madaReply({ members, dest, text, prevAskedWhere });
  if (supplierMode("ai") !== "live" || rules.askWhere) return rules;
  try {
    const answer = await suppliers.ai().answer(text.replace(/@mada\b/gi, "").trim(), { today: todayIn(), city: rules.dest });
    return { ...rules, text: answer, list: [], foot: null, actions: rules.actions.filter((a) => a.ask) };
  } catch {
    return rules;
  }
}

export async function sendMessage(circleId: string, userId: string, input: SendCircleMessageRequest): Promise<CircleMessage[]> {
  await membership(circleId, userId);
  await guardDm(circleId, userId);
  await rateLimit(userId);
  if ("card" in input) {
    if (input.card.kind === "plan" && !planById(input.card.id)) throw new AppError("VALIDATION", { fields: { card: "Unknown plan" } });
    const rows = await db.transaction(async (tx) => {
      const out: MessageRow[] = [await addMessage(tx, circleId, { author: "user", userId, body: input.card.kind === "plan" ? planById(input.card.id)!.title : input.card.post.place, card: { t: "card", card: input.card } })];
      if (input.pin && input.card.kind === "plan" && !(await isDm(circleId, tx))) {
        await tx.insert(appCircleDetails).values({ circleId, pinnedPlan: input.card.id, pinnedBy: userId }).onConflictDoUpdate({ target: appCircleDetails.circleId, set: { pinnedPlan: input.card.id, pinnedBy: userId } });
        out.push(await sysMessage(tx, circleId, "pinned", userId, [], { text: planById(input.card.id)!.title }));
      }
      await readUpTo(tx, circleId, userId);
      return out;
    });
    return toMessages(rows);
  }
  const text = input.body;
  const [prev] = await db.select().from(appMessages)
    .where(and(eq(appMessages.threadKind, "circle"), eq(appMessages.threadId, circleId), sql`coalesce(${appMessages.card}->>'t', '') <> 'sys'`))
    .orderBy(desc(appMessages.createdAt)).limit(1);
  const prevCard = (prev?.card ?? {}) as { t?: string; askWhere?: boolean };
  const d = await details(circleId);
  const toMada = /@mada\b/i.test(text) || (prevCard.t === "mada" && !!prevCard.askWhere && !d.dest && !d.dm);
  const mine = await db.transaction(async (tx) => {
    const row = await addMessage(tx, circleId, { author: "user", userId, body: text });
    await readUpTo(tx, circleId, userId);
    return row;
  });
  const out: MessageRow[] = [mine];
  if (toMada && !d.dm) {
    const r = await madaAnswer(circleId, text, !!prevCard.askWhere);
    out.push(await db.transaction(async (tx) => {
      if (r.dest && !d.dest) await tx.insert(appCircleDetails).values({ circleId, dest: r.dest }).onConflictDoUpdate({ target: appCircleDetails.circleId, set: { dest: r.dest } });
      return addMessage(tx, circleId, { author: "mada", body: r.text, card: { t: "mada", kind: "answer", list: r.list, foot: r.foot, actions: r.actions, askWhere: r.askWhere, ref: null, done: false } });
    }));
  }
  return toMessages(out);
}

/** Hide the buttons under a Mada message ("Not now"). */
export async function dismissMada(circleId: string, userId: string, messageId: string) {
  await membership(circleId, userId);
  const [m] = await db.select().from(appMessages).where(and(eq(appMessages.id, messageId), eq(appMessages.threadId, circleId), eq(appMessages.threadKind, "circle")));
  const c = (m?.card ?? null) as Record<string, unknown> | null;
  if (!m || c?.t !== "mada") throw new AppError("NOT_FOUND");
  await db.update(appMessages).set({ card: { ...c, done: true } }).where(eq(appMessages.id, messageId));
  return (await toMessages([{ ...m, card: { ...c, done: true } }]))[0]!;
}

/* ───────────── votes ───────────── */

async function lockMessage(tx: Db, circleId: string, messageId: string, kind: "vote" | "split" | "mada") {
  const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM app_messages WHERE id = ${messageId} AND thread_kind = 'circle' AND thread_id = ${circleId} FOR UPDATE`);
  if (!rows.length) throw new AppError("NOT_FOUND");
  const [m] = await tx.select().from(appMessages).where(eq(appMessages.id, messageId));
  const c = (m!.card ?? {}) as Record<string, unknown>;
  if (c.t !== kind) throw new AppError("NOT_FOUND");
  return { m: m!, c };
}

export async function createVote(circleId: string, userId: string, raw: unknown) {
  const v = CreateVoteRequest.parse(raw);
  await membership(circleId, userId);
  await rateLimit(userId);
  const q = v.q.replace(/([^?])$/, "$1?");
  const row = await db.transaction(async (tx) => {
    const r = await addMessage(tx, circleId, { author: "user", userId, body: q, card: { t: "vote", q, kind: v.kind, options: v.options.map((label, i) => ({ id: `o${i}`, label })), closed: false, winner: null } });
    await readUpTo(tx, circleId, userId);
    return r;
  });
  return (await toMessages([row]))[0]!;
}

/** One vote each. Tapping your choice again takes it back; tapping another moves it. */
export async function castVote(circleId: string, userId: string, messageId: string, option: string) {
  await membership(circleId, userId);
  await db.transaction(async (tx) => {
    const { c } = await lockMessage(tx, circleId, messageId, "vote");
    if (c.closed) throw err("VALIDATION", "circles.err.voteClosed");
    if (!(c.options as { id: string }[]).some((o) => o.id === option)) throw new AppError("VALIDATION", { fields: { option: "Unknown choice" } });
    const [cur] = await tx.select().from(appCircleVotes).where(and(eq(appCircleVotes.messageId, messageId), eq(appCircleVotes.userId, userId)));
    if (cur?.optionId === option) await tx.delete(appCircleVotes).where(and(eq(appCircleVotes.messageId, messageId), eq(appCircleVotes.userId, userId)));
    else await tx.insert(appCircleVotes).values({ messageId, userId, optionId: option }).onConflictDoUpdate({ target: [appCircleVotes.messageId, appCircleVotes.userId], set: { optionId: option, createdAt: new Date() } });
  });
  const [m] = await db.select().from(appMessages).where(eq(appMessages.id, messageId));
  return (await toMessages([m!]))[0]!;
}

async function resultMessage(tx: Db, circleId: string, voteId: string, c: Record<string, unknown>, winner: { id: string; label: string }) {
  const [circle] = await tx.select({ name: appCircles.name, tripId: appCircles.tripId }).from(appCircles).where(eq(appCircles.id, circleId));
  const d = await details(circleId, tx);
  const n = (await memberIds(circleId, tx)).length;
  const dest = circleDest({ dest: d.dest, name: circle?.name ?? "", trip: await circleTrip(circle?.tripId ?? null, tx) });
  const actions: MadaAction[] = [
    { label: t("circles.mada.bookIt"), ask: bookPrefill({ q: String(c.q), kind: String(c.kind) }, winner.label, n, dest) },
    { label: t("circles.mada.notNow"), dismiss: true },
  ];
  return addMessage(tx, circleId, { author: "mada", body: t("circles.mada.result", { phrase: votePhrase(winner.label) }), card: { t: "mada", kind: "result", ref: voteId, list: [], foot: null, actions, askWhere: false, done: false } });
}

/** Close a vote (whoever started it, or the admin). A clear winner gets "Want us to book it?"; a tie asks to pick. */
export async function closeVote(circleId: string, userId: string, messageId: string) {
  const me = await membership(circleId, userId);
  const rows = await db.transaction(async (tx) => {
    const { m, c } = await lockMessage(tx, circleId, messageId, "vote");
    if (m.authorUserId !== userId && me.role !== "admin") throw err("FORBIDDEN", "circles.err.adminOnly");
    if (c.closed) throw err("VALIDATION", "circles.err.voteClosed");
    const votes = await tx.select().from(appCircleVotes).where(eq(appCircleVotes.messageId, messageId));
    if (!votes.length) throw new AppError("VALIDATION", { fields: { vote: "Nobody has voted yet" } });
    const opts = c.options as { id: string; label: string }[];
    const count = (id: string) => votes.filter((v) => v.optionId === id).length;
    const max = Math.max(...opts.map((o) => count(o.id)));
    const top = opts.filter((o) => count(o.id) === max);
    const winner = top.length === 1 ? top[0]! : null;
    await tx.update(appMessages).set({ card: { ...c, closed: true, winner: winner?.id ?? null } }).where(eq(appMessages.id, messageId));
    const follow = winner
      ? await resultMessage(tx, circleId, messageId, c, winner)
      : await addMessage(tx, circleId, { author: "mada", body: t("circles.mada.tie", { options: top.map((o) => o.label).join(` ${t("circles.and")} `) }), card: { t: "mada", kind: "tie", ref: messageId, list: [], foot: null, actions: top.map((o) => ({ label: o.label, pick: o.id })), askWhere: false, done: false } });
    const [updated] = await tx.select().from(appMessages).where(eq(appMessages.id, messageId));
    return [updated!, follow];
  });
  return toMessages(rows);
}

/** Break a tie: pick one of the tied choices. */
export async function pickWinner(circleId: string, userId: string, messageId: string, option: string) {
  await membership(circleId, userId);
  const rows = await db.transaction(async (tx) => {
    const { c } = await lockMessage(tx, circleId, messageId, "vote");
    if (!c.closed || c.winner) throw new AppError("VALIDATION", { fields: { vote: "This vote has a result" } });
    const w = (c.options as { id: string; label: string }[]).find((o) => o.id === option);
    if (!w) throw new AppError("VALIDATION", { fields: { option: "Unknown choice" } });
    await tx.update(appMessages).set({ card: { ...c, winner: w.id } }).where(eq(appMessages.id, messageId));
    const ties = await tx.select().from(appMessages).where(and(eq(appMessages.threadId, circleId), sql`${appMessages.card}->>'kind' = 'tie'`, sql`${appMessages.card}->>'ref' = ${messageId}`));
    for (const tie of ties) await tx.update(appMessages).set({ card: { ...(tie.card as object), done: true } }).where(eq(appMessages.id, tie.id));
    const [updated] = await tx.select().from(appMessages).where(eq(appMessages.id, messageId));
    return [updated!, await resultMessage(tx, circleId, messageId, c, w)];
  });
  return toMessages(rows);
}

/* ───────────── splits, in halalas ───────────── */

/** Families for "split by family": people tagged as family travel as one. The unit is keyed by its first member. */
async function familyOfFn(members: string[]) {
  const parent = new Map(members.map((m) => [m, m]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const m of members) {
    const g = await graphOf(m);
    for (const o of g.family) if (parent.has(o)) { const a = find(m); const b = find(o); if (a !== b) parent.set(members.indexOf(a) < members.indexOf(b) ? b : a, members.indexOf(a) < members.indexOf(b) ? a : b); }
  }
  return find;
}

export async function createSplit(circleId: string, userId: string, raw: unknown, ipHash: string | null) {
  const s = CreateSplitRequest.parse(raw);
  await membership(circleId, userId);
  const members = await memberIds(circleId);
  const between = members.filter((m) => s.between.includes(m));
  if (between.length !== new Set(s.between).size || !between.includes(s.paidBy)) throw new AppError("VALIDATION", { fields: { between: "Pick people in this circle" } });
  const fam = await familyOfFn(between);
  const units = shareUnits(s.mode === "custom" ? "equal" : s.mode, between, fam);
  let amounts: number[];
  if (s.mode === "custom") {
    amounts = units.map((u) => s.custom?.[u.key] ?? 0);
    if (amounts.some((a) => a < 0) || amounts.reduce((a, b) => a + b, 0) !== s.total) throw err("VALIDATION", "circles.err.splitSum", { custom: t("circles.err.splitSum") });
  } else amounts = splitAmounts(s.total, units.length);
  const row = await db.transaction(async (tx) => {
    const r = await addMessage(tx, circleId, { author: "user", userId, body: s.what, card: { t: "split", what: s.what, total: s.total, paidBy: s.paidBy, mode: s.mode, reminded: false, order: units.map((u) => u.key) } });
    await tx.insert(appCircleSplitShares).values(units.map((u, i) => ({
      messageId: r.id, key: u.key, userIds: u.ids, amount: amounts[i]!, paidAt: u.ids.includes(s.paidBy) ? new Date() : null, paidVia: u.ids.includes(s.paidBy) ? "bill" : null,
    })));
    await readUpTo(tx, circleId, userId);
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "circle.split_created", entityType: "circle_message", entityId: r.id, summary: `Split ${sar(s.total)} ${s.mode} between ${between.length}`, data: { circleId, total: s.total, mode: s.mode, shares: amounts }, ipHash });
    return r;
  });
  return (await toMessages([row]))[0]!;
}

/** Mark a share paid: your own (cash, or after paying it by card), or someone else's when you paid the bill. */
export async function markPaid(circleId: string, userId: string, messageId: string, input: MarkPaidRequest, ipHash: string | null) {
  await membership(circleId, userId);
  const rows = await db.transaction(async (tx) => {
    const { c } = await lockMessage(tx, circleId, messageId, "split");
    const [share] = await tx.select().from(appCircleSplitShares).where(and(eq(appCircleSplitShares.messageId, messageId), eq(appCircleSplitShares.key, input.key)));
    if (!share) throw new AppError("NOT_FOUND");
    const mine = share.userIds.includes(userId);
    if (!mine && c.paidBy !== userId) throw new AppError("FORBIDDEN");
    if (share.paidAt) return [];
    const via = input.via ?? "cash";
    await tx.update(appCircleSplitShares).set({ paidAt: new Date(), paidVia: via, markedBy: userId, paymentId: input.paymentId ?? null }).where(and(eq(appCircleSplitShares.messageId, messageId), eq(appCircleSplitShares.key, input.key)));
    const line = mine
      ? await sysMessage(tx, circleId, via === "card" ? "paid" : "markedPaid", userId, [userId], { amount: Number(share.amount) })
      : await sysMessage(tx, circleId, "markedPaid", userId, share.userIds, { amount: Number(share.amount) });
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "circle.share_paid", entityType: "circle_message", entityId: messageId, summary: `Share of ${sar(Number(share.amount))} marked paid (${via})`, data: { circleId, key: input.key, via, paymentId: input.paymentId ?? null }, ipHash });
    const [updated] = await tx.select().from(appMessages).where(eq(appMessages.id, messageId));
    return [updated!, line];
  });
  if (!rows.length) {
    const [m] = await db.select().from(appMessages).where(eq(appMessages.id, messageId));
    return toMessages([m!]);
  }
  return toMessages(rows);
}

/** The person who paid reminds everyone still owing, once a day. They get a quiet notification. */
export async function remindSplit(circleId: string, userId: string, messageId: string) {
  await membership(circleId, userId);
  const rows = await db.transaction(async (tx) => {
    const { c } = await lockMessage(tx, circleId, messageId, "split");
    if (c.paidBy !== userId) throw new AppError("FORBIDDEN");
    const last = c.remindedAt ? Date.parse(String(c.remindedAt)) : 0;
    if (Date.now() - last < 20 * 3600_000) throw err("VALIDATION", "circles.err.alreadyReminded");
    const owing = (await tx.select().from(appCircleSplitShares).where(eq(appCircleSplitShares.messageId, messageId))).filter((s) => !s.paidAt && !s.userIds.includes(userId));
    if (!owing.length) return [];
    await tx.update(appMessages).set({ card: { ...c, reminded: true, remindedAt: new Date().toISOString() } }).where(eq(appMessages.id, messageId));
    const me = (await peopleByIds([userId], tx)).get(userId)!;
    for (const s of owing) for (const u of s.userIds) {
      await notify(tx, u, "circle.share_reminder", ["notify.circles.share.title"], ["notify.circles.share.body", { name: me.short, what: String(c.what), amount: sar(Number(s.amount)) }], `/circle/${circleId}`, { circleId, messageId });
    }
    const line = await sysMessage(tx, circleId, "reminded", userId, owing.flatMap((s) => s.userIds));
    const [updated] = await tx.select().from(appMessages).where(eq(appMessages.id, messageId));
    return [updated!, line];
  });
  return toMessages(rows);
}
