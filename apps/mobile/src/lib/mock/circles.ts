import {
  CITY_INFO, contactHash, CreateCircleRequest, CreateInviteRequest, CreatePostRequest, CreateSplitRequest, CreateVoteRequest, ERROR_CODES, EVENTS,
  HOME_CITY, PLAN_SUMMARIES, ReportRequest, SaveRequest, SendCircleMessageRequest, UpdateCircleRequest, bookPrefill, checkSaudiMobile,
  circleDest, inviteUrl, madaReply, maskPhone, personRef, planById, shareUnits, splitAmounts, t, votePhrase,
  type AroundResponse, type CircleDetail, type CircleMessage, type CircleSummary, type CopyKey, type ErrorCode, type FriendView,
  type IncomingInvite, type InvitePreview, type MadaAction, type PersonRef, type Post, type SavedItem, type SearchHit, type SentInvite,
  type SocialRelation, type StampsResponse, type SysEvent,
} from '@mada/shared';
import type { Wire, WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';


/*
 * EXPO_PUBLIC_API_MODE=mock: the Circles API in memory, with the server's rules (membership, invites, blocks,
 * moderation, splits to the halala) and the prototype's world: Omar's circles with Hessa, Abdullah and Noor, tips from
 * people who went, and friends who answer, vote and pay after a few seconds the way the prototype plays them.
 * The demo account (+966 50 000 4127) gets that world; a new account starts empty, as it should.
 */

type Card = Record<string, unknown> & { t?: string };
type Msg = { id: string; circleId: string; authorKind: 'user' | 'mada' | 'agent'; userId: string | null; agentName: string | null; body: string; card: Card | null; at: number };
type CircleRow = { id: string; name: string; createdBy: string; cover: string | null; dest: string | null; dm: boolean; dmKey: string | null; trip: string | null; pinned: string | null; pinnedBy: string | null; createdAt: number; updatedAt: number };
type Member = { circleId: string; userId: string; role: 'admin' | 'member'; muted: boolean; lastReadAt: number | null; joinedAt: number };
type Invite = { id: string; kind: 'circle' | 'mada'; circleId: string | null; inviterId: string; inviteeId: string | null; phone: string | null; channel: 'app' | 'link' | 'sms' | 'whatsapp'; lookup: string | null; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; acceptedBy: string | null; remindedAt: number | null; expiresAt: number; at: number };
type Friendship = { a: string; b: string; status: 'pending' | 'accepted'; tagA: string | null; tagB: string | null; at: number; acceptedAt: number | null };
type PostRow = { id: string; authorId: string; city: string; place: string; body: string; kind: 'food' | 'todo'; audience: 'friends' | 'everyone'; photoKey: string | null; photoUrl: string | null; status: 'pending' | 'approved' | 'rejected'; approveAt: number | null; deleted: boolean; at: number };
type Person = { id: string; full: string; short: string; phone: string | null; places: number; trips: number; going: string | null; tone?: 'green' | 'gold' | 'default' };

const now = () => Date.now();
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
const DAY = 86_400_000;
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const rand = (n: number) => Array.from({ length: n }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
const codeOf = (lookup: string) => `${lookup}-${lookup.split('').reverse().join('').slice(0, 6)}`;
const lookupOf = (code: string) => { const m = /^([a-z0-9]{8})-([a-z0-9]{6})$/.exec(code); return m && codeOf(m[1]!) === code ? m[1]! : null; };

function fail(code: ErrorCode, copy?: CopyKey, extra: Record<string, unknown> = {}): WireResponse {
  return { status: ERROR_CODES[code].status, json: { error: { code, message: t(copy ?? ERROR_CODES[code].copy, extra as Record<string, string>), ...extra } } };
}
class Fail extends Error { constructor(readonly r: WireResponse) { super('fail'); } }
const no = (code: ErrorCode, copy?: CopyKey, extra?: Record<string, unknown>) => new Fail(fail(code, copy, extra));
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });

/* ───────────── the world ───────────── */

const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = { abdullah: P(1), noor: P(2), khalid: P(3), faris: P(4), maha: P(5), yousef: P(6), reem: P(7), hessa: P(8), sara: P(9), ahmed: P(10) };
const people = new Map<string, Person>();
const seedPerson = (id: string, full: string, phone: string | null, places = 0, trips = 0, going: string | null = null) => people.set(id, { id, full, short: full.split(' ')[0]!, phone, places, trips, going });
seedPerson(ID.abdullah, 'Abdullah Alqahtani', '+966551000001', 19, 19, 'Istanbul · 10–14 Mar');
seedPerson(ID.noor, 'Noor Alsaud', '+966551000002', 11, 11, 'Istanbul · 10–14 Mar');
seedPerson(ID.khalid, 'Khalid Alotaibi', '+966551000007', 7, 7);
seedPerson(ID.faris, 'Faris Almutairi', '+966551000004', 6, 6, 'London · 4–11 Jun');
seedPerson(ID.maha, 'Maha Alharbi', '+966551000005', 0, 0);
seedPerson(ID.yousef, 'Yousef Alshehri', '+966551000006', 4, 4);
seedPerson(ID.reem, 'Reem Aldosari', '+966551000003', 14, 14);
seedPerson(ID.hessa, 'Hessa Alharbi', '+966551000008', 9, 9);
seedPerson(ID.sara, 'Sara Alharbi', null, 6, 6);
seedPerson(ID.ahmed, 'Ahmed Alharbi', null, 6, 6);
// The prototype's colours for its people.
([[ID.abdullah, 'green'], [ID.noor, 'gold'], [ID.maha, 'gold'], [ID.yousef, 'green'], [ID.khalid, 'default'], [ID.faris, 'default'], [ID.reem, 'default'], [ID.hessa, 'default'], [ID.sara, 'default'], [ID.ahmed, 'default']] as const).forEach(([id, tone]) => { people.get(id)!.tone = tone; });

const circles = new Map<string, CircleRow>();
let members: Member[] = [];
let messages: Msg[] = [];
let votes: { mid: string; userId: string; option: string; at: number }[] = [];
let shares: { mid: string; key: string; ids: string[]; amount: number; paidAt: number | null }[] = [];
let invites: Invite[] = [];
let friendships: Friendship[] = [];
let follows: { from: string; to: string }[] = [];
let blocks: { by: string; who: string }[] = [];
let posts: PostRow[] = [];
let saved: { id: string; userId: string; kind: 'post' | 'plan'; refId: string; city: string; post: unknown; at: number }[] = [];
const presence = new Map<string, { city: string; dates: string | null; audience: 'picked' | 'close' | 'family'; ids: string[]; endsAt: number }>();
let marks: { userId: string; otherId: string; mark: 'hidden' | 'hello' | 'no'; city: string | null }[] = [];
const seeded = new Set<string>();
const queue: { at: number; run: () => void }[] = [];
const later = (ms: number, run: () => void) => queue.push({ at: now() + ms, run });
function playDue() {
  const due = queue.filter((e) => e.at <= now()).sort((a, b) => a.at - b.at);
  for (const e of due) { queue.splice(queue.indexOf(e), 1); try { e.run(); } catch { /* the circle may be gone */ } }
}

let lastAt = 0;
const nextAt = (at?: number) => { lastAt = Math.max(at ?? now(), lastAt + 1); return lastAt; };
function add(circleId: string, m: Omit<Msg, 'id' | 'circleId' | 'at' | 'agentName'> & { at?: number; agentName?: string | null; id?: string }): Msg {
  const msg: Msg = { id: m.id ?? uuid(), circleId, authorKind: m.authorKind, userId: m.userId, agentName: m.agentName ?? null, body: m.body, card: m.card, at: m.at ?? nextAt() };
  messages.push(msg);
  const c = circles.get(circleId);
  if (c) c.updatedAt = Math.max(c.updatedAt, msg.at);
  return msg;
}
const sys = (circleId: string, event: SysEvent, actor: string | null, users: string[] = [], extra: { text?: string; amount?: number; at?: number } = {}) =>
  add(circleId, { authorKind: 'mada', userId: null, body: event, card: { t: 'sys', event, actor, users, text: extra.text ?? null, amount: extra.amount ?? null }, at: extra.at });
const user = (circleId: string, who: string, body: string, at?: number, card: Card | null = null) => add(circleId, { authorKind: 'user', userId: who, body, card, at });

/* Seed posts: tips from people who went, there for everyone. */
const SEED_POSTS: Omit<PostRow, 'id' | 'status' | 'approveAt' | 'deleted' | 'photoUrl'>[] = [
  { authorId: ID.noor, city: 'Istanbul', place: 'Künefe near Galata Tower', body: 'Go before 8pm, it sells out. Ask for it with kaymak. Halal, family seating upstairs.', kind: 'food', audience: 'everyone', photoKey: 'istanbul', at: now() - 2 * DAY },
  { authorId: ID.abdullah, city: 'Riyadh', place: 'Desert camp, Thumamah', body: 'Took the kids last Friday. Book the 5pm slot, you catch sunset and it’s not cold yet.', kind: 'todo', audience: 'everyone', photoKey: 'alula', at: now() - 8 * DAY },
  { authorId: ID.reem, city: 'Istanbul', place: 'Breakfast in Cihangir', body: 'Turkish breakfast for 6 for about SAR 300. Window table if you go before 10.', kind: 'food', audience: 'everyone', photoKey: null, at: now() - 21 * DAY },
  { authorId: ID.faris, city: 'Riyadh', place: 'Bujairi Terrace, Diriyah', body: 'Go at sunset and walk At-Turaif after. Parking fills up after 7.', kind: 'food', audience: 'everyone', photoKey: 'riyadh', at: now() - DAY - 3_600_000 },
  { authorId: ID.abdullah, city: 'AlUla', place: 'Maraya at night', body: 'The concert hall is mirrors outside. Go for the light show, book the 9pm dinner in advance.', kind: 'todo', audience: 'everyone', photoKey: 'alula', at: now() - 35 * DAY },
];
posts = SEED_POSTS.map((p, i) => ({ ...p, id: P(100 + i), status: 'approved', approveAt: null, deleted: false, photoUrl: null }));

/* ───────────── who knows whom ───────────── */

const pairOf = (x: string, y: string) => friendships.find((f) => (f.a === x && f.b === y) || (f.a === y && f.b === x));
const isFriend = (x: string, y: string) => pairOf(x, y)?.status === 'accepted';
const isBlocked = (x: string, y: string) => blocks.some((b) => (b.by === x && b.who === y) || (b.by === y && b.who === x));
const tagOf = (me: string, other: string) => { const f = pairOf(me, other); return f ? (f.a === me ? f.tagA : f.tagB) : null; };
const isFamily = (x: string, y: string) => { const f = pairOf(x, y); return f?.status === 'accepted' && (f.tagA === 'family' || f.tagB === 'family'); };
const friendsOf = (me: string) => friendships.filter((f) => f.status === 'accepted' && (f.a === me || f.b === me)).map((f) => (f.a === me ? f.b : f.a)).filter((o) => !isBlocked(me, o));
const following = (me: string) => follows.filter((f) => f.from === me).map((f) => f.to);
function relation(me: string, other: string): SocialRelation {
  if (other === me) return 'you';
  if (isFamily(me, other)) return 'family';
  if (isFriend(me, other)) return 'friend';
  if (following(me).includes(other)) return 'following';
  return 'mada';
}
function ref(id: string): PersonRef {
  const p = people.get(id);
  return personRef(id, p?.full || t('circles.someone'), p?.tone);
}
const mutual = (me: string, other: string) => friendsOf(other).filter((x) => x !== me && friendsOf(me).includes(x)).length;
function friendView(me: string, id: string): FriendView {
  const p = people.get(id);
  const f = pairOf(me, id);
  const friend = f?.status === 'accepted';
  return { ...ref(id), since: friend ? (id === ID.abdullah ? '2024' : id === ID.noor || id === ID.khalid ? '2025' : String(new Date(f!.acceptedAt ?? now()).getUTCFullYear())) : null,
    places: p?.places ?? 0, trips: p?.trips ?? 0, going: friend ? p?.going ?? null : null, mutual: mutual(me, id), tag: isFamily(me, id) ? 'family' : (tagOf(me, id) as FriendView['tag']) };
}
const befriend = (x: string, y: string, tag: { x?: string; y?: string } = {}, at = now()) => {
  const f = pairOf(x, y);
  if (f) { f.status = 'accepted'; f.acceptedAt = f.acceptedAt ?? at; return; }
  friendships.push({ a: x, b: y, status: 'accepted', tagA: tag.x ?? null, tagB: tag.y ?? null, at, acceptedAt: at });
};

/* ───────────── the demo account's world (the prototype's demoAccount) ───────────── */

const DEMO_PHONE = '+966500004127';
const mins = (n: number) => now() - n * 60_000;
function seedDemo(me: string) {
  for (const id of [ID.hessa, ID.sara, ID.ahmed]) befriend(me, id, { x: 'family', y: 'family' }, Date.UTC(2020, 0, 1));
  for (const id of [ID.abdullah, ID.noor, ID.khalid, ID.faris]) befriend(me, id, { x: 'close' }, Date.UTC(2024, 5, 1));
  befriend(ID.abdullah, ID.noor, { x: 'family', y: 'family' });
  for (const id of [ID.faris, ID.maha, ID.yousef, ID.reem]) befriend(ID.abdullah, id);
  befriend(ID.noor, ID.reem);
  friendships.push({ a: ID.reem, b: me, status: 'pending', tagA: null, tagB: null, at: mins(300), acceptedAt: null });
  invites.push({ id: uuid(), kind: 'mada', circleId: null, inviterId: me, inviteeId: null, phone: '+966551000005', channel: 'whatsapp', lookup: rand(8), status: 'pending', acceptedBy: null, remindedAt: null, expiresAt: now() + 12 * DAY, at: now() - 2 * DAY });
  invites.push({ id: uuid(), kind: 'mada', circleId: null, inviterId: me, inviteeId: null, phone: null, channel: 'link', lookup: null, status: 'accepted', acceptedBy: ID.yousef, remindedAt: null, expiresAt: now() + 7 * DAY, at: now() - 8 * DAY });
  befriend(me, ID.yousef, {}, now() - 8 * DAY);
  presence.set(ID.noor, { city: 'Istanbul', dates: '10–14 Mar', audience: 'picked', ids: [me], endsAt: now() + 200 * DAY });

  const eid = uuid();
  circles.set(eid, { id: eid, name: 'Istanbul for Eid', createdBy: me, cover: 'istanbul', dest: 'Istanbul', dm: false, dmKey: null, trip: 'Istanbul · 9–15 Mar', pinned: null, pinnedBy: null, createdAt: mins(9000), updatedAt: 0 });
  [me, ID.hessa, ID.abdullah, ID.noor, ID.sara, ID.ahmed].forEach((u, i) => members.push({ circleId: eid, userId: u, role: i ? 'member' : 'admin', muted: false, lastReadAt: i ? now() : mins(120), joinedAt: mins(9000 - i) }));
  sys(eid, 'created', me, [], { at: mins(9000) });
  add(eid, { authorKind: 'mada', userId: null, body: 'Abdullah and Noor land 40 minutes after you. We’ve put everyone in one van, so it waits for both families.', card: { t: 'mada', kind: 'answer', list: [], foot: null, actions: [], askWhere: false, ref: null, done: false }, at: mins(300) });
  user(eid, ID.hessa, 'Can we all do a Bosphorus dinner cruise one evening?', mins(95));
  const vote = user(eid, ID.hessa, 'Which evening for the cruise?', mins(94), { t: 'vote', q: 'Which evening for the cruise?', kind: 'dates', options: [{ id: 'o0', label: 'Wed 10 Mar' }, { id: 'o1', label: 'Thu 11 Mar' }], closed: false, winner: null });
  [[ID.hessa, 'o0'], [ID.abdullah, 'o0'], [ID.noor, 'o0'], [ID.sara, 'o1']].forEach(([u, o]) => votes.push({ mid: vote.id, userId: u!, option: o!, at: mins(90) }));
  add(eid, { authorKind: 'agent', userId: null, agentName: 'Faisal', body: 'I’m holding 6 seats on the Wednesday cruise at 19:30 until Monday. SAR 1,140 for everyone.', card: null, at: mins(40) });

  const family = uuid();
  circles.set(family, { id: family, name: 'Family', createdBy: me, cover: null, dest: null, dm: false, dmKey: null, trip: null, pinned: null, pinnedBy: null, createdAt: mins(40000), updatedAt: 0 });
  [me, ID.hessa, ID.sara, ID.ahmed].forEach((u, i) => members.push({ circleId: family, userId: u, role: i ? 'member' : 'admin', muted: false, lastReadAt: now(), joinedAt: mins(40000) }));
  sys(family, 'created', me, [], { at: mins(40000) });
  user(family, ID.hessa, 'Sara’s new passport photo is done. I added it in the Wallet.', mins(1500));
  user(family, me, 'Thank you. I’ll book the appointment.', mins(1490));

  const season = uuid();
  circles.set(season, { id: season, name: 'Riyadh Season', createdBy: ID.abdullah, cover: 'riyadh', dest: 'Riyadh', dm: false, dmKey: null, trip: null, pinned: null, pinnedBy: null, createdAt: mins(20000), updatedAt: 0 });
  [ID.abdullah, me, ID.khalid, ID.faris, ID.maha, ID.yousef, ID.noor, ID.reem].forEach((u, i) => members.push({ circleId: season, userId: u, role: i ? 'member' : 'admin', muted: u === me, lastReadAt: now(), joinedAt: mins(20000 - i) }));
  sys(season, 'created', ID.abdullah, [], { at: mins(20000) });
  user(season, ID.abdullah, 'Boulevard World this week. Who’s coming?', mins(700));
  user(season, ID.faris, 'Me. Thursday is better for me.', mins(650));
  const sv = user(season, ID.abdullah, 'Which night?', mins(640), { t: 'vote', q: 'Which night?', kind: 'dates', options: [{ id: 'o0', label: 'Thursday' }, { id: 'o1', label: 'Friday' }], closed: false, winner: null });
  [[ID.abdullah, 'o0'], [ID.faris, 'o0'], [ID.maha, 'o0'], [ID.yousef, 'o1'], [ID.noor, 'o1']].forEach(([u, o]) => votes.push({ mid: sv.id, userId: u!, option: o!, at: mins(600) }));
  user(season, ID.khalid, 'I can’t make either, sorry. Have fun.', mins(300));
  // Someone leaves on their own, later, so the case can be seen.
  later(12_000, () => leave(season, ID.khalid));
  // Omar's demo: his household's own tip, and a saved place.
  saved.push({ id: uuid(), userId: me, kind: 'plan', refId: 'istanbul3', city: 'Istanbul', post: null, at: now() - DAY });
}

function ensure(u: MockUser) {
  if (!people.has(u.id)) people.set(u.id, { id: u.id, full: u.name || t('circles.someone'), short: u.name || t('circles.someone'), phone: u.phone, places: 0, trips: 0, going: null });
  else { const p = people.get(u.id)!; if (u.name) { p.full = p.full.includes(' ') && p.full.startsWith(u.name) ? p.full : u.name; p.short = u.name; } p.phone = u.phone; }
  if (u.phone === DEMO_PHONE && !seeded.has(u.id)) {
    seeded.add(u.id);
    people.get(u.id)!.full = 'Omar Alharbi';
    people.get(u.id)!.places = 23; people.get(u.id)!.trips = 14;
    seedDemo(u.id);
  }
}
const isDemo = (id: string) => seeded.has(id);

/* ───────────── circles ───────────── */

const membersOf = (cid: string) => members.filter((m) => m.circleId === cid).sort((a, b) => a.joinedAt - b.joinedAt);
const memberIds = (cid: string) => membersOf(cid).map((m) => m.userId);
function membership(cid: string, me: string) {
  const m = members.find((x) => x.circleId === cid && x.userId === me);
  if (!m || !circles.has(cid)) throw no('NOT_FOUND', 'circles.err.notMember');
  return m;
}
const pendingInvites = (cid: string) => invites.filter((i) => i.circleId === cid && i.channel === 'app' && i.status === 'pending' && i.expiresAt > now());

function toMessage(m: Msg): CircleMessage {
  const c = (m.card ?? {}) as Card;
  const kind = (['sys', 'vote', 'split', 'card', 'mada'].includes(String(c.t)) ? c.t : m.authorKind === 'mada' ? 'mada' : 'text') as CircleMessage['kind'];
  const author: CircleMessage['author'] = m.authorKind === 'user' && m.userId ? { kind: 'user', id: m.userId, name: ref(m.userId).short } : m.authorKind === 'agent' ? { kind: 'agent', id: 'faisal', name: m.agentName ?? '', photoUrl: null } : { kind: 'mada' };
  const out: CircleMessage = { id: m.id, circleId: m.circleId, author, body: m.body, createdAt: new Date(m.at).toISOString(), kind, sys: null, vote: null, split: null, card: null, mada: null };
  if (kind === 'sys') out.sys = { event: c.event as SysEvent, actor: (c.actor as string) ?? null, users: (c.users as string[]) ?? [], text: (c.text as string) ?? null, amount: (c.amount as number) ?? null };
  if (kind === 'vote') out.vote = { q: String(c.q), kind: c.kind as 'dates', closed: !!c.closed, winner: (c.winner as string) ?? null, options: (c.options as { id: string; label: string }[]).map((o) => ({ ...o, votes: votes.filter((v) => v.mid === m.id && v.option === o.id).sort((a, b) => a.at - b.at).map((v) => v.userId) })) };
  if (kind === 'split') {
    const sh = shares.filter((s) => s.mid === m.id);
    out.split = { what: String(c.what), total: Number(c.total), paidBy: String(c.paidBy), mode: c.mode as 'equal', reminded: !!c.remindedAt && now() - Number(c.remindedAt) < 20 * 3_600_000, settled: sh.every((s) => s.paidAt), shares: sh.map((s) => ({ key: s.key, ids: s.ids, amount: s.amount, paid: !!s.paidAt, paidAt: s.paidAt ? new Date(s.paidAt).toISOString() : null })) };
  }
  if (kind === 'card') out.card = c.card as CircleMessage['card'];
  if (kind === 'mada') out.mada = { kind: (c.kind as 'answer') ?? 'answer', list: (c.list as string[]) ?? [], foot: (c.foot as string) ?? null, actions: (c.actions as MadaAction[]) ?? [], askWhere: !!c.askWhere, ref: (c.ref as string) ?? null, done: !!c.done };
  return out;
}

function summary(c: CircleRow, me: string): CircleSummary {
  const ms = membersOf(c.id);
  const mine = ms.find((m) => m.userId === me)!;
  const thread = messages.filter((m) => m.circleId === c.id).sort((a, b) => a.at - b.at);
  const last = [...thread].reverse().find((m) => !(m.card?.t === 'mada' && m.card.kind === 'welcome')) ?? null;
  const since = mine.lastReadAt ?? mine.joinedAt;
  const unread = thread.filter((m) => m.at > since && m.userId !== me && m.card?.t !== 'sys' && m.card?.kind !== 'welcome').length;
  const other = ms.find((m) => m.userId !== me);
  return {
    id: c.id, name: c.dm && other ? ref(other.userId).short : c.name, imageUrl: null, tripId: null, role: mine.role, memberCount: ms.length, muted: mine.muted, unread,
    createdAt: new Date(c.createdAt).toISOString(), cover: (c.cover as CircleSummary['cover']) ?? null, dest: c.dest, dm: c.dm, trip: c.trip,
    adminId: ms.find((m) => m.role === 'admin')?.userId ?? null, preview: ms.slice(0, 3).map((m) => ref(m.userId)), invitedCount: pendingInvites(c.id).length,
    last: last ? toMessage(last) : null, fresh: !mine.lastReadAt && c.createdBy !== me && !c.dm,
  };
}

function incoming(me: string): IncomingInvite[] {
  return invites.filter((i) => i.inviteeId === me && i.status === 'pending' && i.expiresAt > now() && i.circleId && circles.has(i.circleId) && !isBlocked(me, i.inviterId))
    .map((i) => { const c = circles.get(i.circleId!)!; return { inviteId: i.id, from: ref(i.inviterId), circle: { id: c.id, name: c.name, cover: (c.cover as IncomingInvite['circle']['cover']) ?? null, memberCount: memberIds(c.id).length }, sentAt: new Date(i.at).toISOString() }; });
}

function detail(cid: string, me: string): CircleDetail {
  membership(cid, me);
  const c = circles.get(cid)!;
  return {
    circle: summary(c, me),
    members: membersOf(cid).map((m) => ({ ...ref(m.userId), role: m.role, relation: relation(me, m.userId), joinedAt: new Date(m.joinedAt).toISOString(), family: familyKey(memberIds(cid))(m.userId) })),
    invited: pendingInvites(cid).filter((i) => i.inviteeId).map((i) => ({ inviteId: i.id, person: ref(i.inviteeId!), sentAt: new Date(i.at).toISOString(), remindedAt: i.remindedAt ? new Date(i.remindedAt).toISOString() : null })),
    pinned: c.pinned && planById(c.pinned) ? { kind: 'plan', id: c.pinned, by: c.pinnedBy } : null,
    reads: membersOf(cid).filter((m) => m.lastReadAt).map((m) => ({ userId: m.userId, at: new Date(m.lastReadAt!).toISOString() })),
  };
}

function join(cid: string, who: string, viaLink: string | null = null) {
  if (!circles.has(cid) || memberIds(cid).includes(who)) return;
  members.push({ circleId: cid, userId: who, role: 'member', muted: false, lastReadAt: null, joinedAt: now() });
  invites.filter((i) => i.circleId === cid && i.inviteeId === who && i.status === 'pending').forEach((i) => { i.status = 'accepted'; i.acceptedBy = who; });
  sys(cid, viaLink ? 'joinedByLink' : 'joined', who, viaLink ? [viaLink] : []);
}
function leave(cid: string, who: string) {
  const m = members.find((x) => x.circleId === cid && x.userId === who);
  if (!m) return { deleted: false };
  const others = memberIds(cid).filter((u) => u !== who);
  if (!others.length) { drop(cid); return { deleted: true }; }
  members = members.filter((x) => x !== m);
  sys(cid, 'left', who);
  if (m.role === 'admin') { members.find((x) => x.circleId === cid && x.userId === others[0])!.role = 'admin'; sys(cid, 'admin', null, [others[0]!]); }
  return { deleted: false };
}
function drop(cid: string) {
  circles.delete(cid);
  members = members.filter((m) => m.circleId !== cid);
  const ids = new Set(messages.filter((m) => m.circleId === cid).map((m) => m.id));
  messages = messages.filter((m) => m.circleId !== cid);
  votes = votes.filter((v) => !ids.has(v.mid));
  shares = shares.filter((s) => !ids.has(s.mid));
  invites = invites.filter((i) => i.circleId !== cid);
}
const readUpTo = (cid: string, who: string) => { const m = members.find((x) => x.circleId === cid && x.userId === who); if (m) m.lastReadAt = now(); };

/* What other people do next, in the demo world (the prototype's planResponses): read it, answer questions, vote, pay. */
const SIMULATED = new Set(Object.values(ID));
const ACK = /^(ok|okay|k|kk|sure|yes|yeah|yep|no|nope|fine|done|cool|great|good|noted|alright|perfect)[.! ]*$/i;
const GREET = /^(salam|assalam|as-salam|assalamu|hi|hello|hey|marhaba|السلام)/i;
const THANKS = /thank|shukran|thx|jazak/i;
const QUESTION = /\?\s*$|^(who|what|when|where|why|how|can|could|should|shall|are|is|do|does|did|will|would|which|any|anyone)\b/i;
const PREF = [ID.hessa, ID.abdullah, ID.noor, ID.faris, ID.khalid, ID.maha, ID.yousef, ID.reem];
const rank = (ids: string[]) => [...ids].sort((a, b) => (PREF.indexOf(a) + 1 || 99) - (PREF.indexOf(b) + 1 || 99));
function answerFor(text: string, c: CircleRow) {
  const s = text.toLowerCase();
  const dest = circleDest(c);
  if (/who.*\b(in|coming|joining|free)\b|anyone|are you in|you in/.test(s)) return 'I’m in.';
  if (/vote/.test(s)) return 'Yes, start a vote. Easier.';
  if (/how much|cost|price|budget|afford/.test(s)) return 'Under SAR 5,000 a family would be good.';
  if (/flight|fly|plane/.test(s)) return 'Morning flights, please. The kids sleep better.';
  if (/hotel|stay|room|villa/.test(s)) return 'Somewhere we can walk to dinner.';
  if (/food|eat|dinner|lunch|restaurant|breakfast/.test(s)) return 'Anywhere halal with family seating.';
  if (/where/.test(s)) return dest ? `${dest} still sounds good to me.` : 'Somewhere cooler than Riyadh. Georgia?';
  if (/when|date|day|week|month|june|july|eid/.test(s)) return 'After the 10th works for us.';
  return 'Not sure yet. Can we vote on it?';
}
function othersReact(c: CircleRow, me: string, text: string, toMada: boolean) {
  const others = rank(memberIds(c.id).filter((u) => u !== me && SIMULATED.has(u)));
  if (!others.length) return;
  (c.dm ? others : others.slice(0, 3)).forEach((w, i) => later(1100 + i * 900, () => readUpTo(c.id, w)));
  if (toMada) return;
  const turn = messages.filter((m) => m.circleId === c.id && m.userId === me).length;
  const responder = c.dm ? others[0]! : others[turn % Math.min(others.length, 3)]!;
  const plain = text.trim();
  let reply: string | null = null;
  if (ACK.test(plain) || THANKS.test(plain)) reply = null;
  else if (GREET.test(plain)) reply = 'Wa alaikum assalam.';
  else if (QUESTION.test(plain)) reply = answerFor(plain, c);
  else if (/\b(booked|paid)\b/i.test(plain)) reply = 'Thank you.';
  if (reply) later(3000, () => { if (memberIds(c.id).includes(responder)) user(c.id, responder, reply!); });
  const second = others.find((r) => r !== responder);
  if (reply === 'I’m in.' && !c.dm && second) later(4800, () => { if (memberIds(c.id).includes(second)) user(c.id, second, 'Me too, if it’s after the 10th.'); });
}

/* ───────────── posts ───────────── */

const BLOCKLIST = [/\b(?:\+?966|0)?5\d{8}\b/, /[\w.+-]+@[\w-]+\.[\w.]+/, /\bhttps?:\/\/|www\./i, /\b(?:fuck|shit|bitch|scam|nude)\w*/i];
function settle() { for (const p of posts) if (p.status === 'pending' && p.approveAt && p.approveAt <= now()) p.status = 'approved'; }
function visiblePost(me: string, p: PostRow) {
  if (p.deleted || isBlocked(me, p.authorId)) return false;
  if (p.authorId === me) return true;
  return p.status === 'approved' && (p.audience === 'everyone' || isFriend(me, p.authorId));
}
function toPost(me: string, p: PostRow): Post {
  return {
    id: p.id, author: ref(p.authorId), relation: relation(me, p.authorId), authorTrips: people.get(p.authorId)?.trips ?? 0, city: p.city, place: p.place, text: p.body, kind: p.kind,
    audience: p.audience, photoKey: (p.photoKey as Post['photoKey']) ?? null, photoUrl: p.photoUrl, saves: (p.id.startsWith('00000000') ? [24, 11, 52, 38, 19][Number(p.id.slice(-1))] ?? 0 : 0) + saved.filter((s) => s.kind === 'post' && s.refId === p.id).length,
    saved: saved.some((s) => s.userId === me && s.kind === 'post' && s.refId === p.id), status: p.status, createdAt: new Date(p.at).toISOString(),
  };
}

/* ───────────── trips (the demo's, for Discover and Who's around) ───────────── */

const tripOf = (me: string) => (isDemo(me) ? { city: 'Istanbul', dates: '9–15 Mar' } : null);
const STAMPS = [{ city: 'Baku', month: 'APR 26' }, { city: 'AlUla', month: 'JAN 26' }, { city: 'Abha', month: 'AUG 25' }, { city: 'London', month: 'JUL 25' }];

/* ───────────── routing ───────────── */

type Ctx = { me: string; body: Record<string, unknown>; q: URLSearchParams };
type Route = [RegExp, string, (c: Ctx, ...p: string[]) => WireResponse | Promise<WireResponse>];
const parse = <T,>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, v: unknown): T => {
  const r = schema.safeParse(v);
  if (!r.success) throw no('VALIDATION', undefined, { fields: Object.fromEntries(r.error.issues.map((i) => [i.path.join('.') || '_', i.message])) });
  return r.data;
};
const msgOf = (cid: string, mid: string, kind: string) => {
  const m = messages.find((x) => x.id === mid && x.circleId === cid);
  if (!m || m.card?.t !== kind) throw no('NOT_FOUND');
  return m;
};
const items = (...ms: Msg[]) => ok({ items: ms.map(toMessage) });

function resultMsg(cid: string, vote: Msg, w: { id: string; label: string }) {
  const c = circles.get(cid)!;
  const actions: MadaAction[] = [{ label: t('circles.mada.bookIt'), ask: bookPrefill({ q: String(vote.card!.q), kind: String(vote.card!.kind) }, w.label, memberIds(cid).length, circleDest(c)) }, { label: t('circles.mada.notNow'), dismiss: true }];
  return add(cid, { authorKind: 'mada', userId: null, body: t('circles.mada.result', { phrase: votePhrase(w.label) }), card: { t: 'mada', kind: 'result', ref: vote.id, list: [], foot: null, actions, askWhere: false, done: false } });
}

function familyKey(ids: string[]) {
  return (id: string) => ids.find((x) => x === id || isFamily(x, id)) ?? id;
}

function sentInvite(i: Invite): SentInvite {
  return { id: i.id, label: i.acceptedBy ? ref(i.acceptedBy).short : i.phone ? (i.phone === '+966551000005' ? 'Maha' : maskPhone(i.phone)) : t('circles.someone'), channel: i.channel === 'whatsapp' ? 'whatsapp' : i.channel === 'sms' ? 'sms' : 'link',
    status: i.status === 'accepted' ? 'joined' : i.expiresAt < now() ? 'expired' : 'pending', sentAt: new Date(i.at).toISOString(), remindedAt: i.remindedAt ? new Date(i.remindedAt).toISOString() : null, joined: i.acceptedBy ? ref(i.acceptedBy) : null };
}
function linkFor(me: string, cid: string | null) {
  let i = invites.find((x) => x.inviterId === me && x.channel === 'link' && x.status === 'pending' && x.lookup && x.circleId === cid && x.expiresAt > now() + DAY);
  if (!i) { i = { id: uuid(), kind: cid ? 'circle' : 'mada', circleId: cid, inviterId: me, inviteeId: null, phone: null, channel: 'link', lookup: rand(8), status: 'pending', acceptedBy: null, remindedAt: null, expiresAt: now() + 14 * DAY, at: now() }; invites.push(i); }
  return { code: codeOf(i.lookup!), url: inviteUrl(codeOf(i.lookup!)), expiresAt: new Date(i.expiresAt).toISOString() };
}

// The prototype's sample links: one for the Eid circle, one long expired.
const SAMPLE = { live: 'ist8k2qa', expired: 'old4q1ba' };
function sampleInvites() {
  if (invites.some((i) => i.lookup === SAMPLE.live)) return;
  const cid = uuid();
  circles.set(cid, { id: cid, name: 'Istanbul for Eid', createdBy: ID.abdullah, cover: 'istanbul', dest: 'Istanbul', dm: false, dmKey: null, trip: 'Istanbul · 9–15 Mar', pinned: 'istanbul3', pinnedBy: ID.abdullah, createdAt: mins(4300), updatedAt: 0 });
  [ID.abdullah, ID.noor, ID.khalid].forEach((u, i) => members.push({ circleId: cid, userId: u, role: i ? 'member' : 'admin', muted: false, lastReadAt: now(), joinedAt: mins(4300 - i) }));
  sys(cid, 'created', ID.abdullah, [], { at: mins(4300) });
  user(cid, ID.abdullah, 'Booked. We’re on SV263, Tue 9 Mar. Galata rooms for the six of us.', mins(2900));
  user(cid, ID.noor, 'Same flight for us. The kids want the ferry and the islands.', mins(2860));
  user(cid, ID.abdullah, 'Three easy days in Istanbul with kids', mins(2800), { t: 'card', card: { kind: 'plan', id: 'istanbul3' } });
  user(cid, ID.abdullah, 'This is the plan Mada made us. Pinned it.', mins(2799));
  user(cid, ID.khalid, 'I’ll book this week, in sha Allah.', mins(600));
  invites.push({ id: uuid(), kind: 'circle', circleId: cid, inviterId: ID.abdullah, inviteeId: null, phone: null, channel: 'link', lookup: SAMPLE.live, status: 'pending', acceptedBy: null, remindedAt: null, expiresAt: now() + 10 * DAY, at: mins(4300) });
  invites.push({ id: uuid(), kind: 'circle', circleId: null, inviterId: ID.abdullah, inviteeId: null, phone: null, channel: 'link', lookup: SAMPLE.expired, status: 'pending', acceptedBy: null, remindedAt: null, expiresAt: now() - 30 * DAY, at: now() - 44 * DAY });
}
/** The prototype's links, for the demo: madatrips.sa/join/<code>. */
export const MOCK_INVITE_CODES = { live: codeOf(SAMPLE.live), expired: codeOf(SAMPLE.expired) };

const routes: Route[] = [
  [/^\/circles$/, 'GET', ({ me }) => ok({ circles: [...circles.values()].filter((c) => memberIds(c.id).includes(me)).map((c) => summary(c, me)).sort((a, b) => (circles.get(b.id)!.updatedAt - circles.get(a.id)!.updatedAt)), incoming: incoming(me) })],
  [/^\/circles$/, 'POST', ({ me, body }) => {
    const b = parse(CreateCircleRequest, body);
    if ([...circles.values()].some((c) => !c.dm && memberIds(c.id).includes(me) && c.name.toLowerCase() === b.name.toLowerCase())) throw no('VALIDATION', 'circles.err.dupeName', { fields: { name: t('circles.err.dupeName') } });
    const invite = [...new Set(b.invite)];
    if (invite.some((u) => u === me || !people.has(u) || isBlocked(me, u))) throw no('NOT_FOUND');
    const id = uuid();
    circles.set(id, { id, name: b.name, createdBy: me, cover: b.cover ?? null, dest: b.dest ?? null, dm: false, dmKey: null, trip: null, pinned: null, pinnedBy: null, createdAt: now(), updatedAt: now() });
    members.push({ circleId: id, userId: me, role: 'admin', muted: false, lastReadAt: now(), joinedAt: now() });
    sys(id, 'created', me);
    if (invite.length) {
      invite.forEach((u) => invites.push({ id: uuid(), kind: 'circle', circleId: id, inviterId: me, inviteeId: u, phone: null, channel: 'app', lookup: null, status: 'pending', acceptedBy: null, remindedAt: null, expiresAt: now() + 14 * DAY, at: now() }));
      sys(id, 'invited', me, invite);
      // One invitee says yes after a few seconds; the others haven't answered yet.
      if (SIMULATED.has(invite[0]!)) later(2500, () => { if (invites.some((i) => i.circleId === id && i.inviteeId === invite[0] && i.status === 'pending')) join(id, invite[0]!); });
    }
    add(id, { authorKind: 'mada', userId: null, body: 'welcome', card: { t: 'mada', kind: 'welcome' } });
    return ok(detail(id, me), 201);
  }],
  [/^\/circles\/dm$/, 'POST', ({ me, body }) => {
    const other = String(body.userId ?? '');
    if (!people.has(other) || isBlocked(me, other)) throw no('NOT_FOUND');
    if (!isFriend(me, other)) throw no('FORBIDDEN', 'circles.err.blocked');
    const key = [me, other].sort().join(':');
    const found = [...circles.values()].find((c) => c.dmKey === key);
    if (found) return ok({ circleId: found.id });
    const id = uuid();
    circles.set(id, { id, name: `${ref(me).short} and ${ref(other).short}`, createdBy: me, cover: null, dest: null, dm: true, dmKey: key, trip: null, pinned: null, pinnedBy: null, createdAt: now(), updatedAt: now() });
    members.push({ circleId: id, userId: me, role: 'admin', muted: false, lastReadAt: now(), joinedAt: now() }, { circleId: id, userId: other, role: 'admin', muted: false, lastReadAt: now(), joinedAt: now() });
    sys(id, 'dm', null, [me, other]);
    return ok({ circleId: id });
  }],
  [/^\/circles\/([\w-]+)$/, 'GET', ({ me }, id) => ok(detail(id!, me))],
  [/^\/circles\/([\w-]+)$/, 'PATCH', ({ me, body }, id) => {
    const m = membership(id!, me);
    const p = parse(UpdateCircleRequest, body);
    const c = circles.get(id!)!;
    if ((p.name !== undefined || p.cover !== undefined) && m.role !== 'admin') throw no('FORBIDDEN', 'circles.err.adminOnly');
    if (p.name !== undefined && p.name !== c.name) { c.name = p.name; sys(c.id, 'renamed', me, [], { text: p.name }); }
    if (p.cover !== undefined) c.cover = p.cover;
    if (p.dest !== undefined) c.dest = p.dest;
    if (p.pin !== undefined) { if (p.pin && p.pin.id !== c.pinned) sys(c.id, 'pinned', me, [], { text: planById(p.pin.id)?.title ?? '' }); c.pinned = p.pin?.id ?? null; c.pinnedBy = p.pin ? me : null; }
    if (p.muted !== undefined) m.muted = p.muted;
    if (p.read) m.lastReadAt = now();
    return ok(detail(id!, me));
  }],
  [/^\/circles\/([\w-]+)$/, 'DELETE', ({ me }, id) => { if (membership(id!, me).role !== 'admin') throw no('FORBIDDEN', 'circles.err.adminOnly'); drop(id!); return ok({ ok: true }); }],
  [/^\/circles\/([\w-]+)\/leave$/, 'POST', ({ me }, id) => { membership(id!, me); return ok(leave(id!, me)); }],
  [/^\/circles\/([\w-]+)\/messages$/, 'GET', ({ me, q }, id) => {
    membership(id!, me);
    const all = messages.filter((m) => m.circleId === id).sort((a, b) => a.at - b.at);
    const before = q.get('before');
    const end = before ? all.findIndex((m) => m.id === before) : all.length;
    const page = all.slice(Math.max(0, end - 50), end);
    return ok({ items: page.map(toMessage), next: end - 50 > 0 ? page[0]!.id : null, reads: membersOf(id!).filter((m) => m.lastReadAt).map((m) => ({ userId: m.userId, at: new Date(m.lastReadAt!).toISOString() })) });
  }],
  [/^\/circles\/([\w-]+)\/messages$/, 'POST', async ({ me, body }, id) => {
    membership(id!, me);
    const c = circles.get(id!)!;
    if (c.dm && memberIds(c.id).some((u) => u !== me && isBlocked(me, u))) throw no('FORBIDDEN', 'circles.err.blocked');
    const input = parse(SendCircleMessageRequest, body);
    readUpTo(c.id, me);
    if ('card' in input) {
      const out = [user(c.id, me, input.card.kind === 'plan' ? planById(input.card.id)?.title ?? '' : input.card.post.place, undefined, { t: 'card', card: input.card })];
      if (input.pin && input.card.kind === 'plan' && !c.dm) { c.pinned = input.card.id; c.pinnedBy = me; out.push(sys(c.id, 'pinned', me, [], { text: planById(input.card.id)!.title })); }
      return items(...out);
    }
    const prev = messages.filter((m) => m.circleId === c.id && m.card?.t !== 'sys').sort((a, b) => b.at - a.at)[0];
    const toMada = !c.dm && (/@mada\b/i.test(input.body) || (prev?.card?.t === 'mada' && !!prev.card.askWhere && !c.dest));
    const mine = user(c.id, me, input.body);
    othersReact(c, me, input.body, toMada);
    if (!toMada) return items(mine);
    await new Promise((r) => setTimeout(r, 900));
    const r = madaReply({ members: memberIds(c.id).length, dest: circleDest(c), text: input.body, prevAskedWhere: !!prev?.card?.askWhere });
    if (r.dest && !c.dest) c.dest = r.dest;
    return items(mine, add(c.id, { authorKind: 'mada', userId: null, body: r.text, card: { t: 'mada', kind: 'answer', list: r.list, foot: r.foot, actions: r.actions, askWhere: r.askWhere, ref: null, done: false } }));
  }],
  [/^\/circles\/([\w-]+)\/messages\/([\w-]+)$/, 'PATCH', ({ me }, id, mid) => { membership(id!, me); const m = msgOf(id!, mid!, 'mada'); m.card = { ...m.card, done: true }; return items(m); }],
  [/^\/circles\/([\w-]+)\/votes$/, 'POST', ({ me, body }, id) => {
    membership(id!, me);
    const v = parse(CreateVoteRequest, body);
    const q = v.q.replace(/([^?])$/, '$1?');
    const m = user(id!, me, q, undefined, { t: 'vote', q, kind: v.kind, options: v.options.map((label, i) => ({ id: `o${i}`, label })), closed: false, winner: null });
    // Others vote over a few seconds, most for the first choice.
    rank(memberIds(id!).filter((u) => u !== me && SIMULATED.has(u))).slice(0, 4).forEach((who, i) => later(1800 + i * 1400, () => {
      if (!m.card!.closed && !votes.some((x) => x.mid === m.id && x.userId === who)) votes.push({ mid: m.id, userId: who, option: `o${[0, 0, 1, 0][i]! % v.options.length}`, at: now() });
    }));
    return ok({ items: [toMessage(m)] }, 201);
  }],
  [/^\/circles\/([\w-]+)\/votes\/([\w-]+)$/, 'POST', ({ me, body }, id, mid) => {
    membership(id!, me);
    const m = msgOf(id!, mid!, 'vote');
    if (m.card!.closed) throw no('VALIDATION', 'circles.err.voteClosed');
    const option = String(body.option ?? '');
    const cur = votes.find((v) => v.mid === m.id && v.userId === me);
    votes = votes.filter((v) => !(v.mid === m.id && v.userId === me));
    if (cur?.option !== option) votes.push({ mid: m.id, userId: me, option, at: now() });
    return items(m);
  }],
  [/^\/circles\/([\w-]+)\/votes\/([\w-]+)\/close$/, 'POST', ({ me }, id, mid) => {
    const mem = membership(id!, me);
    const m = msgOf(id!, mid!, 'vote');
    if (m.userId !== me && mem.role !== 'admin') throw no('FORBIDDEN', 'circles.err.adminOnly');
    const vs = votes.filter((v) => v.mid === m.id);
    if (!vs.length || m.card!.closed) throw no('VALIDATION');
    const opts = m.card!.options as { id: string; label: string }[];
    const count = (o: string) => vs.filter((v) => v.option === o).length;
    const max = Math.max(...opts.map((o) => count(o.id)));
    const top = opts.filter((o) => count(o.id) === max);
    m.card = { ...m.card, closed: true, winner: top.length === 1 ? top[0]!.id : null };
    const follow = top.length === 1 ? resultMsg(id!, m, top[0]!)
      : add(id!, { authorKind: 'mada', userId: null, body: t('circles.mada.tie', { options: top.map((o) => o.label).join(` ${t('circles.and')} `) }), card: { t: 'mada', kind: 'tie', ref: m.id, list: [], foot: null, actions: top.map((o) => ({ label: o.label, pick: o.id })), askWhere: false, done: false } });
    return items(m, follow);
  }],
  [/^\/circles\/([\w-]+)\/votes\/([\w-]+)\/pick$/, 'POST', ({ me, body }, id, mid) => {
    membership(id!, me);
    const m = msgOf(id!, mid!, 'vote');
    const w = (m.card!.options as { id: string; label: string }[]).find((o) => o.id === body.option);
    if (!w || !m.card!.closed || m.card!.winner) throw no('VALIDATION');
    m.card = { ...m.card, winner: w.id };
    messages.filter((x) => x.circleId === id && x.card?.kind === 'tie' && x.card.ref === m.id).forEach((x) => { x.card = { ...x.card, done: true }; });
    return items(m, resultMsg(id!, m, w));
  }],
  [/^\/circles\/([\w-]+)\/splits$/, 'POST', ({ me, body }, id) => {
    membership(id!, me);
    const s = parse(CreateSplitRequest, body);
    const between = memberIds(id!).filter((u) => s.between.includes(u));
    if (between.length !== new Set(s.between).size || !between.includes(s.paidBy)) throw no('VALIDATION');
    const units = shareUnits(s.mode === 'custom' ? 'equal' : s.mode, between, familyKey(between));
    const amounts = s.mode === 'custom' ? units.map((u) => s.custom?.[u.key] ?? 0) : splitAmounts(s.total, units.length);
    if (s.mode === 'custom' && amounts.reduce((a, b) => a + b, 0) !== s.total) throw no('VALIDATION', 'circles.err.splitSum', { fields: { custom: t('circles.err.splitSum') } });
    const m = user(id!, me, s.what, undefined, { t: 'split', what: s.what, total: s.total, paidBy: s.paidBy, mode: s.mode });
    units.forEach((u, i) => shares.push({ mid: m.id, key: u.key, ids: u.ids, amount: amounts[i]!, paidAt: u.ids.includes(s.paidBy) ? now() : null }));
    const owing = shares.find((x) => x.mid === m.id && !x.paidAt && x.ids.every((u) => SIMULATED.has(u)));
    if (s.paidBy === me && owing) later(6000, () => payShare(id!, m.id, owing.key));
    return ok({ items: [toMessage(m)] }, 201);
  }],
  [/^\/circles\/([\w-]+)\/splits\/([\w-]+)\/paid$/, 'POST', ({ me, body }, id, mid) => {
    membership(id!, me);
    const m = msgOf(id!, mid!, 'split');
    const sh = shares.find((x) => x.mid === m.id && x.key === body.key);
    if (!sh) throw no('NOT_FOUND');
    const mine = sh.ids.includes(me);
    if (!mine && m.card!.paidBy !== me) throw no('FORBIDDEN');
    if (sh.paidAt) return items(m);
    sh.paidAt = now();
    const line = mine ? sys(id!, body.via === 'card' ? 'paid' : 'markedPaid', me, [me], { amount: sh.amount }) : sys(id!, 'markedPaid', me, sh.ids, { amount: sh.amount });
    return items(m, line);
  }],
  [/^\/circles\/([\w-]+)\/splits\/([\w-]+)\/remind$/, 'POST', ({ me }, id, mid) => {
    membership(id!, me);
    const m = msgOf(id!, mid!, 'split');
    if (m.card!.paidBy !== me) throw no('FORBIDDEN');
    if (m.card!.remindedAt && now() - Number(m.card!.remindedAt) < 20 * 3_600_000) throw no('VALIDATION', 'circles.err.alreadyReminded');
    const owing = shares.filter((x) => x.mid === m.id && !x.paidAt && !x.ids.includes(me));
    m.card = { ...m.card, remindedAt: now() };
    const line = sys(id!, 'reminded', me, owing.flatMap((x) => x.ids));
    if (owing[0] && owing[0].ids.every((u) => SIMULATED.has(u))) later(4000, () => payShare(id!, m.id, owing[0]!.key));
    return items(m, line);
  }],
  [/^\/circles\/([\w-]+)\/members\/([\w-]+)$/, 'PATCH', ({ me }, id, uid) => {
    if (membership(id!, me).role !== 'admin') throw no('FORBIDDEN', 'circles.err.adminOnly');
    const target = membership(id!, uid!);
    membersOf(id!).forEach((m) => { m.role = 'member'; });
    target.role = 'admin';
    sys(id!, 'admin', me, [uid!]);
    return ok({ ok: true });
  }],
  [/^\/circles\/([\w-]+)\/members\/([\w-]+)$/, 'DELETE', ({ me }, id, uid) => {
    if (membership(id!, me).role !== 'admin') throw no('FORBIDDEN', 'circles.err.adminOnly');
    membership(id!, uid!);
    members = members.filter((m) => !(m.circleId === id && m.userId === uid));
    sys(id!, 'removed', me, [uid!]);
    return ok({ ok: true });
  }],
  [/^\/circles\/([\w-]+)\/invites$/, 'POST', ({ me, body }, id) => {
    if (membership(id!, me).role !== 'admin') throw no('FORBIDDEN', 'circles.err.adminOnly');
    const ids = [...new Set((body.userIds as string[]) ?? [])].filter((u) => !memberIds(id!).includes(u) && !pendingInvites(id!).some((i) => i.inviteeId === u) && people.has(u) && !isBlocked(me, u));
    if (ids.length) {
      ids.forEach((u) => invites.push({ id: uuid(), kind: 'circle', circleId: id!, inviterId: me, inviteeId: u, phone: null, channel: 'app', lookup: null, status: 'pending', acceptedBy: null, remindedAt: null, expiresAt: now() + 14 * DAY, at: now() }));
      sys(id!, 'invited', me, ids);
      if (SIMULATED.has(ids[0]!)) later(3000, () => { if (pendingInvites(id!).some((i) => i.inviteeId === ids[0])) join(id!, ids[0]!); });
    }
    return ok(detail(id!, me));
  }],
  [/^\/circles\/([\w-]+)\/link$/, 'POST', ({ me }, id) => { membership(id!, me); return ok(linkFor(me, id!)); }],

  [/^\/invites$/, 'GET', ({ me }) => {
    const own = invites.find((i) => i.inviterId === me && i.kind === 'mada' && i.channel === 'link' && i.status === 'pending' && i.lookup && i.expiresAt > now());
    return ok({ sent: invites.filter((i) => i.inviterId === me && i.kind === 'mada' && i.status !== 'cancelled' && (i.channel !== 'link' || i.status === 'accepted')).sort((a, b) => b.at - a.at).map(sentInvite), incoming: incoming(me), link: own ? { code: codeOf(own.lookup!), url: inviteUrl(codeOf(own.lookup!)), expiresAt: new Date(own.expiresAt).toISOString() } : null });
  }],
  [/^\/invites$/, 'POST', ({ me, body }) => {
    const b = parse(CreateInviteRequest, body);
    if ('link' in b) return ok({ invite: null, link: linkFor(me, null), onMada: null });
    const found = [...people.values()].find((p) => p.phone === b.phone);
    if (found) { if (found.id === me) throw no('VALIDATION', 'circles.err.self'); return ok({ invite: null, link: null, onMada: isBlocked(me, found.id) ? null : ref(found.id) }); }
    const i: Invite = { id: uuid(), kind: 'mada', circleId: null, inviterId: me, inviteeId: null, phone: b.phone, channel: b.channel ?? 'sms', lookup: rand(8), status: 'pending', acceptedBy: null, remindedAt: null, expiresAt: now() + 14 * DAY, at: now() };
    invites.push(i);
    console.info(`[mock sms] ${b.phone}: ${t('sms.circles.invite', { name: ref(me).short, url: inviteUrl(codeOf(i.lookup!)) })}`);
    return ok({ invite: sentInvite(i), link: null, onMada: null }, 201);
  }],
  [/^\/invites\/([\w-]+)$/, 'GET', ({ me }, code) => {
    const lookup = lookupOf(code!);
    const i = lookup ? invites.find((x) => x.lookup === lookup) : null;
    if (!i || (me && isBlocked(me, i.inviterId))) throw no('NOT_FOUND', 'circles.join.notFound');
    const c = i.circleId ? circles.get(i.circleId) : null;
    const ids = c ? memberIds(c.id) : [];
    const preview: InvitePreview = { code: code!, status: i.status === 'cancelled' ? 'cancelled' : i.expiresAt < now() ? 'expired' : 'open', kind: i.kind, from: ref(i.inviterId),
      circle: c ? { name: c.name, cover: (c.cover as 'istanbul') ?? null, members: ids.slice(0, 4).map(ref), memberCount: ids.length, trip: c.trip } : i.kind === 'circle' ? { name: 'Summer in Baku', cover: null, members: [], memberCount: 0, trip: null } : null };
    return ok(preview);
  }],
  [/^\/invites\/([\w-]+)$/, 'DELETE', ({ me }, id) => {
    const i = invites.find((x) => x.id === id);
    if (!i || (i.inviterId !== me && !(i.circleId && membersOf(i.circleId).some((m) => m.userId === me && m.role === 'admin')))) throw no('NOT_FOUND');
    if (i.status === 'pending' && i.circleId && i.inviteeId) sys(i.circleId, 'cancelledInvite', me, [i.inviteeId]);
    i.status = 'cancelled';
    return ok({ ok: true });
  }],
  [/^\/invites\/([\w-]+)\/accept$/, 'POST', ({ me }, ref0) => {
    const i = invites.find((x) => (x.id === ref0 && x.inviteeId === me) || (x.lookup && x.lookup === lookupOf(ref0!)));
    if (!i || isBlocked(me, i.inviterId)) throw no('NOT_FOUND', 'circles.join.notFound');
    if (i.status === 'cancelled' || i.status === 'declined' || i.expiresAt < now() || (i.channel === 'app' && i.status !== 'pending')) throw no('NOT_FOUND', 'circles.err.inviteExpired');
    if (i.circleId) {
      if (!circles.has(i.circleId)) throw no('NOT_FOUND', 'circles.err.inviteExpired');
      if (memberIds(i.circleId).includes(me)) return ok({ circleId: i.circleId, friendId: null, already: true });
      join(i.circleId, me, i.channel === 'link' ? i.inviterId : null);
      return ok({ circleId: i.circleId, friendId: null, already: false });
    }
    if (i.inviterId === me) throw no('VALIDATION', 'circles.err.self');
    const already = isFriend(me, i.inviterId);
    befriend(i.inviterId, me);
    if (i.channel === 'link') invites.push({ ...i, id: uuid(), lookup: null, status: 'accepted', acceptedBy: me, at: now() });
    else { i.status = 'accepted'; i.acceptedBy = me; }
    return ok({ circleId: null, friendId: i.inviterId, already });
  }],
  [/^\/invites\/([\w-]+)\/decline$/, 'POST', ({ me }, id) => {
    const i = invites.find((x) => x.id === id && x.inviteeId === me && x.status === 'pending');
    if (!i) throw no('NOT_FOUND');
    i.status = 'declined';
    return ok({ ok: true });
  }],
  [/^\/invites\/([\w-]+)\/remind$/, 'POST', ({ me }, id) => {
    const i = invites.find((x) => x.id === id && (x.inviterId === me || (x.circleId && membersOf(x.circleId).some((m) => m.userId === me && m.role === 'admin'))));
    if (!i) throw no('NOT_FOUND');
    if (i.remindedAt && now() - i.remindedAt < 20 * 3_600_000) throw no('VALIDATION', 'circles.err.alreadyReminded');
    i.remindedAt = now();
    return ok({ ok: true });
  }],

  [/^\/friends$/, 'GET', ({ me }) => {
    const fr = friendsOf(me);
    const asked = friendships.filter((f) => f.status === 'pending' && f.a === me).map((f) => f.b);
    const req = friendships.filter((f) => f.status === 'pending' && f.b === me && !isBlocked(me, f.a)).map((f) => f.a);
    const byName = (a: FriendView, b: FriendView) => a.name.localeCompare(b.name);
    const order = (ids: string[]) => ids.map((id) => friendView(me, id)).sort(byName);
    return ok({ friends: order(fr), following: order(following(me).filter((x) => !isBlocked(me, x))), requests: req.map((id) => friendView(me, id)), asked });
  }],
  [/^\/friends$/, 'POST', ({ me, body }) => {
    const other = String(body.userId ?? '');
    if (other === me) throw no('VALIDATION', 'circles.err.self');
    if (!people.has(other) || isBlocked(me, other)) throw no('NOT_FOUND');
    const f = pairOf(me, other);
    if (f?.status === 'accepted') return ok({ status: 'friends' });
    if (f && f.a === other) { f.status = 'accepted'; f.acceptedAt = now(); return ok({ status: 'friends' }); }
    if (!f) friendships.push({ a: me, b: other, status: 'pending', tagA: null, tagB: null, at: now(), acceptedAt: null });
    return ok({ status: 'asked' });
  }],
  [/^\/friends\/search$/, 'GET', ({ me, q }) => {
    const term = (q.get('q') ?? '').trim();
    const digits = term.replace(/[\s()-]/g, '');
    let ids: string[];
    let byPhone = false;
    if (/^\+?\d{9,14}$/.test(digits)) {
      byPhone = true;
      const p = checkSaudiMobile(digits);
      // The demo answers a number ending in 7 with Khalid, as the prototype does.
      ids = p.ok ? [...people.values()].filter((x) => x.phone === p.e164 || (p.e164.endsWith('7') && x.id === ID.khalid)).map((x) => x.id) : [];
    } else ids = [...people.values()].filter((x) => x.full.toLowerCase().includes(term.toLowerCase())).map((x) => x.id);
    const hits: SearchHit[] = ids.filter((id) => id !== me && !isBlocked(me, id)).map((id) => ({ ...ref(id), relation: relation(me, id), mutual: mutual(me, id) }));
    const rank0 = (h: SearchHit) => ['family', 'friend', 'following', 'mada', 'you'].indexOf(h.relation);
    return ok({ people: hits.sort((a, b) => rank0(a) - rank0(b) || b.mutual - a.mutual).slice(0, 20), byPhone });
  }],
  [/^\/friends\/contacts$/, 'POST', ({ me, body }) => {
    const hashes = new Set((body.hashes as string[]) ?? []);
    const ids = [...people.values()].filter((p) => p.phone && hashes.has(contactHash(p.phone))).map((p) => p.id).filter((id) => id !== me && !isBlocked(me, id));
    return ok({ people: ids.map((id) => ({ ...ref(id), relation: relation(me, id), mutual: mutual(me, id) })) });
  }],
  [/^\/friends\/([\w-]+)$/, 'GET', ({ me }, id) => {
    if (!people.has(id!) || isBlocked(me, id!)) throw no('NOT_FOUND');
    settle();
    const shared = [...circles.values()].filter((c) => !c.dm && memberIds(c.id).includes(me) && memberIds(c.id).includes(id!));
    return ok({
      person: friendView(me, id!), isFriend: isFriend(me, id!), following: following(me).includes(id!),
      asked: friendships.some((f) => f.status === 'pending' && f.a === me && f.b === id), askedMe: friendships.some((f) => f.status === 'pending' && f.a === id && f.b === me),
      followers: 120 + (people.get(id!)?.places ?? 0) * 7 + follows.filter((f) => f.to === id).length,
      circles: shared.map((c) => ({ id: c.id, name: c.name, memberCount: memberIds(c.id).length })),
      posts: posts.filter((p) => p.authorId === id && p.status === 'approved' && visiblePost(me, p)).sort((a, b) => b.at - a.at).map((p) => toPost(me, p)),
    });
  }],
  [/^\/friends\/([\w-]+)$/, 'PATCH', ({ me, body }, id) => {
    const f = pairOf(me, id!);
    if (!f || f.status !== 'accepted') throw no('NOT_FOUND');
    if (f.a === me) f.tagA = (body.tag as string) ?? null; else f.tagB = (body.tag as string) ?? null;
    return ok({ ok: true });
  }],
  [/^\/friends\/([\w-]+)$/, 'DELETE', ({ me }, id) => {
    const f = pairOf(me, id!);
    if (!f) throw no('NOT_FOUND');
    friendships = friendships.filter((x) => x !== f);
    return ok({ ok: true });
  }],
  [/^\/friends\/([\w-]+)\/accept$/, 'POST', ({ me }, id) => {
    const f = pairOf(me, id!);
    if (!f || f.status !== 'pending' || f.b !== me) throw no('NOT_FOUND');
    f.status = 'accepted'; f.acceptedAt = now();
    return ok({ ok: true });
  }],
  [/^\/follows\/([\w-]+)$/, 'POST', ({ me }, id) => { if (!people.has(id!) || isBlocked(me, id!)) throw no('NOT_FOUND'); if (!follows.some((f) => f.from === me && f.to === id)) follows.push({ from: me, to: id! }); return ok({ ok: true }); }],
  [/^\/follows\/([\w-]+)$/, 'DELETE', ({ me }, id) => { follows = follows.filter((f) => !(f.from === me && f.to === id)); return ok({ ok: true }); }],

  [/^\/posts$/, 'GET', ({ me, q }) => {
    settle();
    const city = q.get('city');
    const kind = q.get('kind');
    const known = q.get('scope') === 'known';
    const circle = new Set([me, ...friendsOf(me), ...following(me)]);
    let list = posts.filter((p) => visiblePost(me, p) && (known ? circle.has(p.authorId) : !city || p.city.toLowerCase() === city.toLowerCase()) && (!kind || p.kind === kind) && (p.status !== 'rejected' || p.authorId === me));
    const r0 = (p: PostRow) => { const r = relation(me, p.authorId); return r === 'family' || r === 'friend' ? 0 : r === 'you' ? 1 : r === 'following' ? 2 : 3; };
    list = list.sort((a, b) => (known ? 0 : r0(a) - r0(b)) || b.at - a.at);
    return ok({ posts: list.map((p) => toPost(me, p)) });
  }],
  [/^\/posts$/, 'POST', ({ me, body }) => {
    const b = parse(CreatePostRequest, body);
    if (posts.filter((p) => p.authorId === me && p.at > now() - 3_600_000).length >= 5) throw no('RATE_LIMITED', undefined, { retryAfter: 3600, seconds: 3600 });
    const flagged = BLOCKLIST.some((re) => re.test(`${b.place}\n${b.text}`));
    const p: PostRow = { id: uuid(), authorId: me, city: b.city, place: b.place, body: b.text, kind: b.kind, audience: b.audience, photoKey: null, photoUrl: b.photo ?? null, status: 'pending', approveAt: flagged ? null : now() + 8000, deleted: false, at: now() };
    posts.push(p);
    return ok({ post: toPost(me, p) }, 201);
  }],
  [/^\/posts\/([\w-]+)$/, 'GET', ({ me }, id) => { settle(); const p = posts.find((x) => x.id === id); if (!p || !visiblePost(me, p)) throw no('NOT_FOUND'); return ok({ post: toPost(me, p) }); }],
  [/^\/posts\/([\w-]+)$/, 'DELETE', ({ me }, id) => { const p = posts.find((x) => x.id === id && x.authorId === me && !x.deleted); if (!p) throw no('NOT_FOUND'); p.deleted = true; return ok({ ok: true }); }],
  [/^\/posts\/([\w-]+)\/thanks$/, 'POST', ({ me }, id) => { const p = posts.find((x) => x.id === id); if (!p || !visiblePost(me, p)) throw no('NOT_FOUND'); if (p.authorId === me) throw no('VALIDATION', 'circles.err.self'); return ok({ ok: true }); }],

  [/^\/saved$/, 'GET', ({ me }) => ok({ saved: saved.filter((s) => s.userId === me).sort((a, b) => b.at - a.at).map((s): SavedItem => ({ id: s.id, kind: s.kind, refId: s.refId, city: s.city, post: s.post as SavedItem['post'], savedAt: new Date(s.at).toISOString() })) })],
  [/^\/saved$/, 'POST', ({ me, body }) => {
    const b = parse(SaveRequest, body);
    let city: string;
    let post: unknown = null;
    if (b.kind === 'plan') { const pl = planById(b.refId); if (!pl) throw no('NOT_FOUND'); city = pl.city; } else {
      const p = posts.find((x) => x.id === b.refId);
      if (!p || !visiblePost(me, p)) throw no('NOT_FOUND');
      city = p.city;
      const v = toPost(me, p);
      post = { id: v.id, author: v.author, city: v.city, place: v.place, text: v.text, kind: v.kind, photoKey: v.photoKey, photoUrl: v.photoUrl };
    }
    let s = saved.find((x) => x.userId === me && x.kind === b.kind && x.refId === b.refId);
    if (!s) { s = { id: uuid(), userId: me, kind: b.kind, refId: b.refId, city, post, at: now() }; saved.push(s); }
    return ok({ item: { id: s.id, kind: s.kind, refId: s.refId, city: s.city, post: s.post, savedAt: new Date(s.at).toISOString() } }, 201);
  }],
  [/^\/saved\/([\w-]+)$/, 'DELETE', ({ me }, id) => { const s = saved.find((x) => x.id === id && x.userId === me); if (!s) throw no('NOT_FOUND'); saved = saved.filter((x) => x !== s); return ok({ ok: true }); }],

  [/^\/discover$/, 'GET', ({ me, q }) => {
    const trip = tripOf(me);
    const asked = q.get('city');
    const covered = (c: string) => Object.keys(CITY_INFO).find((k) => k.toLowerCase() === c.toLowerCase()) ?? null;
    if (asked && !covered(asked)) throw no('NOT_FOUND');
    const city = (asked && covered(asked)) || trip?.city || HOME_CITY;
    const sheet = [{ title: 'here' as const, rows: [{ city: HOME_CITY, note: 'here' }] }, ...(trip ? [{ title: 'trips' as const, rows: [{ city: trip.city, note: trip.dates }] }] : []),
      { title: 'worth' as const, rows: [{ city: 'AlUla', note: 'planned' }, ...(trip ? [] : [{ city: 'Istanbul', note: 'popular' }])] }];
    return ok({ city, tripDates: trip && trip.city === city ? trip.dates : null, events: EVENTS[city] ?? [], plans: PLAN_SUMMARIES, sheet, covered: Object.entries(CITY_INFO).map(([c, i]) => ({ city: c, country: i.country })) });
  }],
  [/^\/discover\/notify$/, 'POST', () => ok({ ok: true })],
  [/^\/discover\/around$/, 'GET', ({ me }) => ok(around(me))],
  [/^\/discover\/around$/, 'PUT', ({ me, body }) => {
    if (!body.on) { presence.delete(me); return ok(around(me)); }
    const a = around(me);
    const audience = (body.audience as 'picked' | 'close' | 'family') ?? 'picked';
    presence.set(me, { city: a.city, dates: a.dates, audience, ids: a.options[audience].map((p) => p.id), endsAt: now() + (tripOf(me) ? 160 * DAY : 3 * DAY) });
    return ok(around(me));
  }],
  [/^\/discover\/around$/, 'POST', ({ me, body }) => {
    const other = String(body.userId ?? '');
    if (!isFriend(me, other)) throw no('NOT_FOUND');
    marks = marks.filter((m) => !(m.userId === me && m.otherId === other));
    marks.push({ userId: me, otherId: other, mark: body.action === 'hide' ? 'hidden' : body.action === 'hello' ? 'hello' : 'no', city: presence.get(other)?.city ?? null });
    return ok(around(me));
  }],
  [/^\/discover\/stamps$/, 'GET', ({ me }) => {
    const demo = isDemo(me);
    const res: StampsResponse = demo
      ? { stamps: [{ city: 'Istanbul', month: 'MAR 27', upcoming: true }, ...STAMPS.map((s) => ({ ...s, upcoming: false }))], countries: 14, places: 9, next: 'Istanbul', rank: { position: 2, leader: ref(ID.abdullah), leaderPlaces: 19, faces: [ref(ID.abdullah), ref(ID.noor), ref(me)] } }
      : { stamps: [], countries: 0, places: 0, next: tripOf(me)?.city ?? null, rank: null };
    return ok(res);
  }],

  [/^\/reports$/, 'POST', ({ me, body }) => {
    const r = parse(ReportRequest, body);
    if (r.targetKind === 'user' && (r.targetId === me || !people.has(r.targetId))) throw no('NOT_FOUND');
    if (r.block && r.targetKind === 'user') blockUser(me, r.targetId);
    return ok({ ok: true }, 201);
  }],
  [/^\/blocks$/, 'GET', ({ me }) => ok({ blocked: blocks.filter((b) => b.by === me).map((b) => ref(b.who)) })],
  [/^\/blocks$/, 'POST', ({ me, body }) => { const other = String(body.userId ?? ''); if (!people.has(other) || other === me) throw no('NOT_FOUND'); blockUser(me, other); return ok({ ok: true }); }],
  [/^\/blocks\/([\w-]+)$/, 'DELETE', ({ me }, id) => { blocks = blocks.filter((b) => !(b.by === me && b.who === id)); return ok({ ok: true }); }],
];

function blockUser(me: string, other: string) {
  if (!blocks.some((b) => b.by === me && b.who === other)) blocks.push({ by: me, who: other });
  friendships = friendships.filter((f) => f !== pairOf(me, other));
  follows = follows.filter((f) => !((f.from === me && f.to === other) || (f.from === other && f.to === me)));
  invites.filter((i) => i.status === 'pending' && ((i.inviterId === me && i.inviteeId === other) || (i.inviterId === other && i.inviteeId === me))).forEach((i) => { i.status = 'cancelled'; });
}
function payShare(cid: string, mid: string, key: string) {
  const sh = shares.find((s) => s.mid === mid && s.key === key);
  if (!sh || sh.paidAt || !circles.has(cid)) return;
  sh.paidAt = now();
  sys(cid, 'paid', sh.ids[0]!, sh.ids, { amount: sh.amount });
}
function around(me: string): AroundResponse {
  const trip = tripOf(me);
  const city = trip?.city ?? HOME_CITY;
  const friends = friendsOf(me);
  const hidden = new Set(marks.filter((m) => m.userId === me && m.mark === 'hidden').map((m) => m.otherId));
  const fam = friends.filter((f) => isFamily(me, f));
  const going = friends.filter((f) => !fam.includes(f) && people.get(f)?.going?.startsWith(city));
  const mine = presence.get(me);
  return {
    city, dates: trip?.dates ?? null, on: !!mine && mine.endsAt > now(), audience: mine?.audience ?? 'picked', endsAt: mine ? new Date(mine.endsAt).toISOString() : null,
    options: { picked: (going.length ? going : friends.filter((f) => !fam.includes(f))).map(ref), close: friends.filter((f) => tagOf(me, f) === 'close').map(ref), family: fam.map(ref) },
    people: friends.filter((f) => !hidden.has(f)).map((f) => ({ f, p: presence.get(f) })).filter(({ p }) => p && p.endsAt > now() && p.city === city && p.ids.includes(me))
      .map(({ f, p }) => { const m = marks.find((x) => x.userId === me && x.otherId === f); return { person: ref(f), city: p!.city, dates: p!.dates, hello: m?.mark === 'hello' ? 'sent' : m?.mark === 'no' ? 'no' : null }; }),
  };
}

/** Registered in mock-api.ts: answers the Circles paths, null for anything else. */
export const circlesMock: AreaMock = async (w: Wire, ctx) => {
  const url = new URL(w.path, 'http://mock');
  const match = routes.map(([re, method, fn]) => ({ m: re.exec(url.pathname), method, fn })).find((r) => r.m && r.method === w.method);
  if (!match) {
    // Paths this area owns but with the wrong method.
    return /^\/(circles|friends|follows|invites|posts|saved|discover|reports|blocks)(\/|$)/.test(url.pathname) ? fail('NOT_FOUND') : null;
  }
  sampleInvites();
  playDue();
  const isPreview = w.method === 'GET' && /^\/invites\/[\w-]+$/.test(url.pathname);
  if (!ctx.user && !isPreview) return fail('UNAUTHORIZED');
  if (ctx.user) ensure(ctx.user);
  try {
    return await match.fn({ me: ctx.user?.id ?? '', body: (w.body ?? {}) as Record<string, unknown>, q: url.searchParams }, ...match.m!.slice(1));
  } catch (e) {
    if (e instanceof Fail) return e.r;
    console.warn('[mock circles]', e);
    return fail('INTERNAL');
  }
};
