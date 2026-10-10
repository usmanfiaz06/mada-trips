import { z } from 'zod';
import { t } from '../copy';
import { HalalasAmount, Id, IsoDateTime, PhoneE164 } from './common';
import { Circle, Message } from './social';

/*
 * Circles (M4): circles and their chat, votes and splits, friends and follows, invites, tips and their moderation,
 * saves, Discover, Who's around, reports and blocks. The wire contract for platform/src/app/api/app/v1/{circles,
 * friends,follows,invites,posts,saved,discover,reports,blocks} and the app's mock of it.
 *
 * The second half of this file is shared logic both sides need to agree on: split maths in halalas, what Mada knows
 * about places (for "@Mada" answers when no model is configured), Discover's editorial content, and Mada's plans.
 */

/* ───────────── people ───────────── */

export const Tone = z.enum(['green', 'gold', 'default']);
export type Tone = z.infer<typeof Tone>;

/** Someone on Mada, as other people see them: a name and an initial. Never a phone number. */
export const PersonRef = z.object({
  id: Id,
  /** Full name when we have it ("Abdullah Alqahtani"), else the first name. */
  name: z.string(),
  /** First name ("Abdullah"). */
  short: z.string(),
  initial: z.string().max(2),
  tone: Tone,
});
export type PersonRef = z.infer<typeof PersonRef>;

/** How two people know each other, from the viewer's side. */
export const Relation = z.enum(['you', 'family', 'friend', 'following', 'mada']);
export type Relation = z.infer<typeof Relation>;
export const FriendTag = z.enum(['close', 'family']);
export type FriendTag = z.infer<typeof FriendTag>;

export const FriendView = PersonRef.extend({
  /** The year you became friends, when you are. */
  since: z.string().nullable(),
  /** Cities they have been to with Mada and posted from. */
  places: z.number().int(),
  trips: z.number().int(),
  /** Friends only: where they are going next ("Istanbul · 10–14 Mar"). */
  going: z.string().nullable(),
  mutual: z.number().int(),
  tag: FriendTag.nullable(),
});
export type FriendView = z.infer<typeof FriendView>;

/* ───────────── circles ───────────── */

/** Covers are photos we ship; a circle never stores an uploaded picture. null is plain green. */
export const CoverKey = z.enum(['istanbul', 'alula', 'riyadh']);
export type CoverKey = z.infer<typeof CoverKey>;

export const SysEvent = z.enum([
  'created', 'invited', 'joined', 'joinedByLink', 'left', 'removed', 'renamed', 'admin', 'pinned', 'cancelledInvite',
  'paid', 'markedPaid', 'reminded', 'dm',
]);
export type SysEvent = z.infer<typeof SysEvent>;

export const VoteKind = z.enum(['dates', 'places', 'any']);
export const SplitMode = z.enum(['equal', 'family', 'custom']);
export type SplitMode = z.infer<typeof SplitMode>;

/** A button under a Mada message. Exactly one of the action fields is set. */
export const MadaAction = z.object({
  label: z.string(),
  /** Open Ask with this text. */
  ask: z.string().optional(),
  /** Open one of Mada's plans. */
  plan: z.string().optional(),
  /** Send this as a message (a place name back to Mada). */
  say: z.string().optional(),
  /** Break a tie: the vote option id. */
  pick: z.string().optional(),
  /** "Not now": hide the buttons. */
  dismiss: z.boolean().optional(),
});
export type MadaAction = z.infer<typeof MadaAction>;

export const PostSnapshot = z.object({
  id: z.string(),
  author: PersonRef.nullable(),
  city: z.string(),
  place: z.string(),
  text: z.string(),
  kind: z.enum(['food', 'todo']),
  photoKey: CoverKey.nullable(),
  photoUrl: z.string().nullable(),
});
export type PostSnapshot = z.infer<typeof PostSnapshot>;

export const SharedCard = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), id: z.string() }),
  z.object({ kind: z.literal('place'), post: PostSnapshot }),
]);
export type SharedCard = z.infer<typeof SharedCard>;

export const VoteOption = z.object({ id: z.string(), label: z.string(), votes: z.array(Id) });
export const SplitShare = z.object({
  /** One person, or one family when split by family. */
  key: z.string(),
  ids: z.array(Id).min(1),
  amount: HalalasAmount,
  paid: z.boolean(),
  paidAt: IsoDateTime.nullable(),
});
export type SplitShare = z.infer<typeof SplitShare>;

/** One line in a circle's chat. Reuses the M0 Message (author, body, time) and adds what a circle can hold. */
export const CircleMessage = Message.omit({ card: true, readAt: true, thread: true }).extend({
  circleId: Id,
  kind: z.enum(['text', 'sys', 'vote', 'split', 'card', 'mada']),
  sys: z.object({ event: SysEvent, actor: Id.nullable(), users: z.array(Id), text: z.string().nullable(), amount: HalalasAmount.nullable() }).nullable(),
  vote: z.object({ q: z.string(), kind: VoteKind, options: z.array(VoteOption), closed: z.boolean(), winner: z.string().nullable() }).nullable(),
  split: z.object({
    what: z.string(), total: HalalasAmount, paidBy: Id, mode: SplitMode, reminded: z.boolean(), settled: z.boolean(), shares: z.array(SplitShare),
  }).nullable(),
  card: SharedCard.nullable(),
  mada: z.object({
    kind: z.enum(['welcome', 'answer', 'result', 'tie']),
    list: z.array(z.string()),
    foot: z.string().nullable(),
    actions: z.array(MadaAction),
    askWhere: z.boolean(),
    ref: Id.nullable(),
    done: z.boolean(),
  }).nullable(),
});
export type CircleMessage = z.infer<typeof CircleMessage>;

export const CircleSummary = Circle.extend({
  cover: CoverKey.nullable(),
  /** Where the circle is going, when someone said so. Never a guess. */
  dest: z.string().nullable(),
  /** A conversation between two friends, not a circle. */
  dm: z.boolean(),
  /** Trip line under the name ("Istanbul · 9–15 Mar"). */
  trip: z.string().nullable(),
  adminId: Id.nullable(),
  preview: z.array(PersonRef),
  invitedCount: z.number().int(),
  last: CircleMessage.nullable(),
  /** Joined from an invite and not opened yet: the chat opens at the top. */
  fresh: z.boolean(),
});
export type CircleSummary = z.infer<typeof CircleSummary>;

export const CircleMemberView = PersonRef.extend({ role: z.enum(['admin', 'member']), relation: Relation, joinedAt: IsoDateTime });
export type CircleMemberView = z.infer<typeof CircleMemberView>;
export const InvitedView = z.object({ inviteId: Id, person: PersonRef, sentAt: IsoDateTime, remindedAt: IsoDateTime.nullable() });
export type InvitedView = z.infer<typeof InvitedView>;

export const CircleDetail = z.object({
  circle: CircleSummary,
  members: z.array(CircleMemberView),
  invited: z.array(InvitedView),
  pinned: z.object({ kind: z.literal('plan'), id: z.string(), by: Id.nullable() }).nullable(),
  /** For each member, when they last read the chat (read receipts). */
  reads: z.array(z.object({ userId: Id, at: IsoDateTime })),
});
export type CircleDetail = z.infer<typeof CircleDetail>;

export const IncomingInvite = z.object({ inviteId: Id, from: PersonRef, circle: z.object({ id: Id, name: z.string(), cover: CoverKey.nullable(), memberCount: z.number().int() }), sentAt: IsoDateTime });
export type IncomingInvite = z.infer<typeof IncomingInvite>;
export const CirclesResponse = z.object({ circles: z.array(CircleSummary), incoming: z.array(IncomingInvite) });
export type CirclesResponse = z.infer<typeof CirclesResponse>;
export const CircleResponse = CircleDetail;

export const CreateCircleRequest = z.object({
  name: z.string().trim().min(2).max(40),
  cover: CoverKey.nullable().default(null),
  dest: z.string().trim().max(40).nullable().optional(),
  invite: z.array(Id).max(30).default([]),
});
export type CreateCircleRequest = z.input<typeof CreateCircleRequest>;

export const UpdateCircleRequest = z.object({
  name: z.string().trim().min(2).max(40),
  muted: z.boolean(),
  cover: CoverKey.nullable(),
  dest: z.string().trim().min(1).max(40),
  pin: z.object({ kind: z.literal('plan'), id: z.string().max(40) }).nullable(),
  /** Mark the chat as read, up to now. */
  read: z.literal(true),
}).partial().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type UpdateCircleRequest = z.infer<typeof UpdateCircleRequest>;

export const MessagesPage = z.object({
  items: z.array(CircleMessage),
  /** Pass as ?before= for older messages. */
  next: z.string().nullable(),
  reads: z.array(z.object({ userId: Id, at: IsoDateTime })),
});
export type MessagesPage = z.infer<typeof MessagesPage>;

export const SendCircleMessageRequest = z.union([
  z.object({ body: z.string().trim().min(1).max(2000) }),
  z.object({ card: SharedCard, pin: z.boolean().optional() }),
]);
export type SendCircleMessageRequest = z.infer<typeof SendCircleMessageRequest>;
/** What a send returns: your message, and anything it set off (Mada's answer). */
export const SentMessages = z.object({ items: z.array(CircleMessage) });

export const PatchMessageRequest = z.object({ done: z.literal(true) });

export const CreateVoteRequest = z.object({
  q: z.string().trim().min(3).max(60),
  kind: VoteKind,
  options: z.array(z.string().trim().min(1).max(30)).min(2).max(4)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, { message: 'Two choices are the same' }),
});
export type CreateVoteRequest = z.infer<typeof CreateVoteRequest>;
export const CastVoteRequest = z.object({ option: z.string().max(8) });
export const PickRequest = z.object({ option: z.string().max(8) });

export const CreateSplitRequest = z.object({
  what: z.string().trim().min(2).max(40),
  total: HalalasAmount.refine((n) => n > 0, { message: 'Add the total' }),
  paidBy: Id,
  mode: SplitMode,
  between: z.array(Id).min(2).max(30),
  /** Custom mode: halalas per share key (a user id). Must add up to the total. */
  custom: z.record(z.string(), HalalasAmount).optional(),
});
export type CreateSplitRequest = z.infer<typeof CreateSplitRequest>;
export const MarkPaidRequest = z.object({ key: z.string().max(64), via: z.enum(['cash', 'card']).default('cash'), paymentId: Id.optional() });
export type MarkPaidRequest = z.input<typeof MarkPaidRequest>;

export const InviteToCircleRequest = z.object({ userIds: z.array(Id).min(1).max(30) });
export const MemberPatchRequest = z.object({ role: z.literal('admin') });

/* ───────────── invites ───────────── */

export const InviteLink = z.object({ code: z.string(), url: z.string(), expiresAt: IsoDateTime });
export type InviteLink = z.infer<typeof InviteLink>;


export const SentInvite = z.object({
  id: Id,
  /** A name when they joined, else the number we sent it to, masked. */
  label: z.string(),
  channel: z.enum(['link', 'sms', 'whatsapp']),
  status: z.enum(['pending', 'joined', 'expired']),
  sentAt: IsoDateTime,
  remindedAt: IsoDateTime.nullable(),
  joined: PersonRef.nullable(),
});
export type SentInvite = z.infer<typeof SentInvite>;
export const InvitesResponse = z.object({ sent: z.array(SentInvite), incoming: z.array(IncomingInvite), link: InviteLink.nullable() });
export type InvitesResponse = z.infer<typeof InvitesResponse>;

export const CreateInviteRequest = z.union([
  z.object({ phone: PhoneE164, channel: z.enum(['sms', 'whatsapp']).default('sms') }),
  z.object({ link: z.literal(true) }),
]);
export type CreateInviteRequest = z.input<typeof CreateInviteRequest>;
export const CreateInviteResponse = z.object({ invite: SentInvite.nullable(), link: InviteLink.nullable(), onMada: PersonRef.nullable() });

/** What anyone with the link sees, signed in or not. */
export const InvitePreview = z.object({
  code: z.string(),
  status: z.enum(['open', 'expired', 'cancelled']),
  kind: z.enum(['circle', 'mada']),
  from: PersonRef,
  circle: z.object({ name: z.string(), cover: CoverKey.nullable(), members: z.array(PersonRef), memberCount: z.number().int(), trip: z.string().nullable() }).nullable(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;
export const AcceptInviteResponse = z.object({ circleId: Id.nullable(), friendId: Id.nullable(), already: z.boolean() });
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponse>;

/* ───────────── tips ───────────── */

export const PostKind = z.enum(['food', 'todo']);
export type PostKind = z.infer<typeof PostKind>;
export const Post = z.object({
  id: Id,
  author: PersonRef,
  relation: Relation,
  /** Trips the author has taken with Mada, for "Mada traveller · 14 trips". */
  authorTrips: z.number().int(),
  city: z.string(),
  place: z.string(),
  text: z.string(),
  kind: PostKind,
  audience: z.enum(['friends', 'everyone']),
  photoKey: CoverKey.nullable(),
  photoUrl: z.string().nullable(),
  saves: z.number().int(),
  saved: z.boolean(),
  status: z.enum(['pending', 'approved', 'rejected']),
  createdAt: IsoDateTime,
});
export type Post = z.infer<typeof Post>;
/* ───────────── friends and follows ───────────── */

export const FriendsResponse = z.object({
  friends: z.array(FriendView),
  following: z.array(FriendView),
  requests: z.array(FriendView),
  /** People you asked, still waiting. */
  asked: z.array(Id),
});
export type FriendsResponse = z.infer<typeof FriendsResponse>;

export const ProfileResponse = z.object({
  person: FriendView,
  isFriend: z.boolean(),
  following: z.boolean(),
  asked: z.boolean(),
  askedMe: z.boolean(),
  followers: z.number().int(),
  circles: z.array(z.object({ id: Id, name: z.string(), memberCount: z.number().int() })),
  posts: z.array(Post),
});
export type ProfileResponse = z.infer<typeof ProfileResponse>;

export const SearchHit = PersonRef.extend({ relation: Relation, mutual: z.number().int() });
export type SearchHit = z.infer<typeof SearchHit>;
export const SearchResponse = z.object({ people: z.array(SearchHit), byPhone: z.boolean() });
export type SearchResponse = z.infer<typeof SearchResponse>;

/** Contact numbers are hashed on the phone (contactHash) and only the hashes are sent. Nothing is stored. */
export const ContactsMatchRequest = z.object({ hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(2000) });
export const ContactsMatchResponse = z.object({ people: z.array(SearchHit) });
export const FriendPatchRequest = z.object({ tag: FriendTag.nullable() });

export const PostsResponse = z.object({ posts: z.array(Post) });
export const PostResponse = z.object({ post: Post });

export const CreatePostRequest = z.object({
  city: z.string().trim().min(2).max(40),
  place: z.string().trim().min(3).max(80),
  text: z.string().trim().min(11).max(600),
  kind: PostKind,
  audience: z.enum(['friends', 'everyone']),
  /** A JPEG or PNG as a data URL, at most about 2 MB. */
  photo: z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).max(2_800_000).nullable().optional(),
  /** Everyone in the photo agreed to it being shared. Required with a photo. */
  photoConsent: z.boolean().optional(),
}).refine((p) => !p.photo || p.photoConsent === true, { message: 'Confirm everyone in the photo agreed', path: ['photoConsent'] });
export type CreatePostRequest = z.input<typeof CreatePostRequest>;

/* ───────────── saved ───────────── */

export const SavedItem = z.object({
  id: Id,
  kind: z.enum(['post', 'plan']),
  refId: z.string(),
  city: z.string(),
  /** A copy of the tip, so it stays even if the post goes. */
  post: PostSnapshot.nullable(),
  savedAt: IsoDateTime,
});
export type SavedItem = z.infer<typeof SavedItem>;
export const SavedResponse = z.object({ saved: z.array(SavedItem) });
export const SaveRequest = z.object({ kind: z.enum(['post', 'plan']), refId: z.string().min(1).max(64) });
export type SaveRequest = z.infer<typeof SaveRequest>;

/* ───────────── Discover, Who's around, stamps ───────────── */

export const DiscoverEvent = z.object({ id: z.string(), title: z.string(), when: z.string(), where: z.string(), tag: z.string(), photoKey: CoverKey });
export type DiscoverEvent = z.infer<typeof DiscoverEvent>;
export const PlanSummary = z.object({ id: z.string(), title: z.string(), sub: z.string(), city: z.string(), days: z.number().int(), photoKey: CoverKey });
export type PlanSummary = z.infer<typeof PlanSummary>;
export const CityRow = z.object({ city: z.string(), note: z.string() });
export const DiscoverResponse = z.object({
  city: z.string(),
  /** "While you're there, 9–15 Mar" when this is your trip's city. */
  tripDates: z.string().nullable(),
  events: z.array(DiscoverEvent),
  plans: z.array(PlanSummary),
  sheet: z.array(z.object({ title: z.enum(['here', 'trips', 'worth']), rows: z.array(CityRow) })),
  covered: z.array(z.object({ city: z.string(), country: z.string() })),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponse>;

export const Audience = z.enum(['picked', 'close', 'family']);
export type Audience = z.infer<typeof Audience>;
export const AroundResponse = z.object({
  city: z.string(),
  /** Your trip's dates, when the city is a trip. */
  dates: z.string().nullable(),
  on: z.boolean(),
  audience: Audience,
  endsAt: IsoDateTime.nullable(),
  /** Who each choice would show you to. */
  options: z.object({ picked: z.array(PersonRef), close: z.array(PersonRef), family: z.array(PersonRef) }),
  people: z.array(z.object({ person: PersonRef, city: z.string(), dates: z.string().nullable(), hello: z.enum(['sent', 'no']).nullable() })),
});
export type AroundResponse = z.infer<typeof AroundResponse>;
export const PresenceRequest = z.object({ on: z.boolean(), audience: Audience.optional(), picked: z.array(Id).max(100).optional() });
export const AroundActionRequest = z.object({ userId: Id, action: z.enum(['hello', 'notNow', 'hide']) });

export const Stamp = z.object({ city: z.string(), month: z.string(), upcoming: z.boolean() });
export const StampsResponse = z.object({
  stamps: z.array(Stamp),
  countries: z.number().int(),
  places: z.number().int(),
  /** Your next trip, for the empty passport ("lands when you're home from Istanbul"). */
  next: z.string().nullable(),
  /** Your rank among friends on places explored, when you have friends with trips. */
  rank: z.object({ position: z.number().int(), leader: PersonRef, leaderPlaces: z.number().int(), faces: z.array(PersonRef) }).nullable(),
});
export type StampsResponse = z.infer<typeof StampsResponse>;
export const NotifyCityRequest = z.object({ city: z.string().trim().min(2).max(40) });

/* ───────────── safety ───────────── */

export const ReportReason = z.enum(['unwanted', 'impostor', 'unsafe', 'other']);
export const ReportRequest = z.object({
  targetKind: z.enum(['user', 'post', 'circle', 'message']),
  targetId: Id,
  reason: ReportReason,
  note: z.string().trim().max(500).optional(),
  /** Report and block in one go (people only). */
  block: z.boolean().optional(),
});
export type ReportRequest = z.input<typeof ReportRequest>;
export const BlockRequest = z.object({ userId: Id });
export const BlocksResponse = z.object({ blocked: z.array(PersonRef) });

export const OkResponse = z.object({ ok: z.literal(true) });

/* ═════════════ shared logic ═════════════ */

/** Invite links last 14 days (COPY: "It lasts 14 days"). */
export const INVITE_TTL_DAYS = 14;
export const INVITE_HOST = 'madatrips.sa';
export const inviteUrl = (code: string) => `https://${INVITE_HOST}/join/${code}`;
/** Limits per person per hour. */
export const LIMITS = { invitesPerHour: 30, postsPerHour: 5, messagesPerMinute: 30, searchesPerMinute: 30 } as const;

/** A deterministic face colour per person, the same everywhere. */
export function toneFor(id: string): Tone {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (['green', 'gold', 'default'] as const)[h % 3]!;
}

/** A person from a name. */
export function personRef(id: string, fullName: string, tone?: Tone): PersonRef {
  const name = fullName.trim() || 'Someone';
  const short = name.split(/\s+/)[0]!;
  return { id, name, short, initial: short.charAt(0).toUpperCase(), tone: tone ?? toneFor(id) };
}

/** Exactly `total` halalas over `k` shares; the first shares carry the odd halalas. Never loses or invents one. */
export function equalAmounts(total: number, k: number): number[] {
  if (k <= 0) return [];
  const base = Math.floor(total / k);
  const rest = total - base * k;
  return Array.from({ length: k }, (_, i) => base + (i < rest ? 1 : 0));
}
/**
 * Equal shares in whole riyals when the total is whole riyals (SAR 1,140 over 3 is 380 each, not 380.00/380.00/379.99
 * scattered), the remainder in halalas only when the total itself has halalas.
 */
export function splitAmounts(total: number, k: number): number[] {
  if (total % 100 === 0) return equalAmounts(total / 100, k).map((r) => r * 100);
  return equalAmounts(total, k);
}

/** Family units for a split: people linked as family travel as one. `familyOf` maps a person to their unit's key. */
export function shareUnits(mode: SplitMode, ids: string[], familyOf: (id: string) => string): { key: string; ids: string[] }[] {
  if (mode !== 'family') return ids.map((id) => ({ key: id, ids: [id] }));
  const units = new Map<string, string[]>();
  for (const id of ids) {
    const k = familyOf(id);
    units.set(k, [...(units.get(k) ?? []), id]);
  }
  return [...units.entries()].map(([key, list]) => ({ key, ids: list }));
}

/** Join first names: "Hessa", "Hessa and Abdullah", "Hessa, Abdullah and 2 others". */
export function joinNames(names: string[], max = 3): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} ${t('circles.and')} ${names[names.length - 1]}`;
  return `${names.slice(0, max - 1).join(', ')} ${t('circles.and')} ${t('circles.others', { count: names.length - max + 1 })}`;
}

/* ───────────── editorial content: cities, events, plans ───────────── */

export const CITY_INFO: Record<string, { country: string; photoKey: CoverKey }> = {
  Riyadh: { country: 'Saudi Arabia', photoKey: 'riyadh' },
  Istanbul: { country: 'Türkiye', photoKey: 'istanbul' },
  AlUla: { country: 'Saudi Arabia', photoKey: 'alula' },
};
export const HOME_CITY = 'Riyadh';

export const EVENTS: Record<string, DiscoverEvent[]> = {
  Riyadh: [
    { id: 'e1', title: 'Boulevard World at night', when: 'Every evening · 16:00–01:00', where: 'Riyadh Season', tag: 'Family', photoKey: 'riyadh' },
    { id: 'e2', title: 'Desert dinner under the stars', when: 'Thu and Fri · 19:30', where: 'Outside Riyadh, 45 min', tag: 'Friends', photoKey: 'alula' },
    { id: 'e3', title: 'Weekend in AlUla', when: 'Flights from SAR 690', where: '1h 20m away', tag: 'Weekend', photoKey: 'alula' },
  ],
  Istanbul: [
    { id: 'e4', title: 'Bosphorus dinner cruise', when: 'Nightly · 19:30', where: 'From Kabataş pier', tag: 'Family', photoKey: 'istanbul' },
    { id: 'e5', title: 'Kadıköy food walk', when: 'Daily · 11:00', where: 'Asian side, 20 min by ferry', tag: 'Food', photoKey: 'istanbul' },
    { id: 'e6', title: 'Topkapı Palace, skip the line', when: 'Closed Tuesdays', where: 'Sultanahmet', tag: 'Culture', photoKey: 'istanbul' },
  ],
  AlUla: [
    { id: 'e7', title: 'Hegra at golden hour', when: 'Daily · 15:30', where: 'Hegra, 25 min from Old Town', tag: 'Culture', photoKey: 'alula' },
    { id: 'e8', title: 'Stargazing at Gharameel', when: 'Thu–Sat · 20:00', where: 'Gharameel, 40 min', tag: 'Family', photoKey: 'alula' },
  ],
};

/** Mada's own plans (the full day-by-day plan lives with the booking screens at /plan/[id]). */
export const PLAN_SUMMARIES: PlanSummary[] = [
  { id: 'alula2', title: 'Two days in AlUla', sub: 'Old Town, Hegra and a desert sunset', city: 'AlUla', days: 2, photoKey: 'alula' },
  { id: 'istanbul3', title: 'Three easy days in Istanbul with kids', sub: 'Palaces, ferries and the best künefe', city: 'Istanbul', days: 3, photoKey: 'istanbul' },
];
export const planById = (id: string) => PLAN_SUMMARIES.find((p) => p.id === id) ?? null;

/* ───────────── what Mada knows about places, for "@Mada" in a circle ───────────── */

type PlaceFacts = { fly: string | null; from: number; nightly: number; plan?: string; ideas: string[]; spots: string[]; when: string; visa: string; stay: string };
export const PLACES: Record<string, PlaceFacts> = {
  Istanbul: { fly: '4h 15m direct from Riyadh', from: 1745, nightly: 980, plan: 'istanbul3', ideas: ['A Bosphorus dinner cruise from Kabataş, 19:30', 'Topkapı Palace in the morning. Closed Tuesdays', 'The ferry to Kadıköy for the food walk'], spots: ['Bosphorus cruise', 'Topkapı Palace', 'Kadıköy', 'Princes’ Islands'], when: 'April to June is mild, about 18–24°C. Eid in March is cool, so bring jackets.', visa: 'Saudi passports get an e-visa online in about 10 minutes.', stay: 'Galata or Sultanahmet. Both are walkable with kids.' },
  Georgia: { fly: '3h 30m direct to Tbilisi', from: 1290, nightly: 620, ideas: ['Old Tbilisi and the cable car up to Narikala', 'A day in Kazbegi, under the mountains', 'Lake Bazaleti for a quiet afternoon by the water'], spots: ['Tbilisi', 'Kazbegi', 'Batumi', 'Gudauri'], when: 'May to October is green and warm. Gudauri has snow from December to March.', visa: 'Saudi passports need no visa for stays up to a year.', stay: 'Old Tbilisi to walk everywhere, then a mountain lodge in Kazbegi.' },
  Baku: { fly: '3h direct', from: 1150, nightly: 700, ideas: ['The Old City walls at dusk', 'The Flame Towers light show from the Boulevard', 'A day in Gabala: cable cars and lakes'], spots: ['Old City', 'Boulevard', 'Gabala', 'Shahdag'], when: 'April to June, and September to October.', visa: 'Saudi passports get an e-visa in about 3 days.', stay: 'The Old City, or a seafront hotel on the Boulevard.' },
  AlUla: { fly: '1h 20m direct', from: 690, nightly: 1650, plan: 'alula2', ideas: ['Hegra at golden hour', 'Old Town lanes after 16:00', 'Stargazing at Gharameel'], spots: ['Hegra', 'Old Town', 'Elephant Rock', 'Maraya'], when: 'October to March. Warm days, cool nights.', visa: 'No visa needed.', stay: 'A desert resort with family villas.' },
  London: { fly: '6h 50m direct', from: 3150, nightly: 1900, ideas: ['Hyde Park and the Diana playground', 'The Natural History Museum. Free, book a slot', 'A Thames boat down to Greenwich'], spots: ['Hyde Park', 'Natural History Museum', 'Greenwich', 'Harrods'], when: 'June to September. Long days, about 20°C.', visa: 'Saudi passports need an electronic travel authorisation. About 3 days.', stay: 'Kensington or Marylebone, near the parks.' },
  Dubai: { fly: '2h direct', from: 820, nightly: 1100, ideas: ['Dubai Frame and Zabeel Park', 'A day at Aquaventure', 'A desert dinner at sunset'], spots: ['Downtown', 'The Palm', 'Dubai Frame', 'Desert camp'], when: 'November to March.', visa: 'No visa needed.', stay: 'Downtown for the fountains, or the Palm for the beach.' },
  Riyadh: { fly: null, from: 0, nightly: 800, ideas: ['Boulevard World in the evening', 'Sunset at Bujairi Terrace, Diriyah', 'A desert camp in Thumamah'], spots: ['Boulevard World', 'Diriyah', 'Thumamah', 'Kingdom Centre'], when: 'October to March. Evenings are best.', visa: 'No visa needed.', stay: 'Close to the Boulevard if you’re staying over.' },
  Abha: { fly: '1h 35m direct', from: 540, nightly: 650, ideas: ['The Al Soudah cable car', 'Rijal Almaa, the stone village', 'Evenings at 20°C in August'], spots: ['Al Soudah', 'Rijal Almaa', 'Abha Dam', 'Art Street'], when: 'June to September, when Riyadh is hot.', visa: 'No visa needed.', stay: 'Al Soudah, up in the clouds.' },
};
const ALIASES: [string, string][] = [['tbilisi', 'Georgia'], ['georgia', 'Georgia'], ['batumi', 'Georgia'], ['istanbul', 'Istanbul'], ['türkiye', 'Istanbul'], ['turkiye', 'Istanbul'], ['turkey', 'Istanbul'], ['baku', 'Baku'], ['azerbaijan', 'Baku'], ['alula', 'AlUla'], ['al ula', 'AlUla'], ['london', 'London'], ['dubai', 'Dubai'], ['riyadh', 'Riyadh'], ['abha', 'Abha']];

export function findPlace(text = ''): string | null {
  const s = ` ${String(text).toLowerCase()} `;
  const hit = ALIASES.find(([k]) => new RegExp(`[^a-z]${k}[^a-z]`).test(s));
  return hit ? hit[1] : null;
}

/** Where a circle is going: what it was told, or its name. Never a guess. */
export function circleDest(c: { dest: string | null; name: string; trip?: string | null }): string | null {
  if (c.dest) return findPlace(c.dest) ?? c.dest;
  const trip = c.trip ? c.trip.split(' · ')[0] ?? '' : '';
  return findPlace(trip) ?? findPlace(c.name) ?? (trip || null);
}

const sar = (n: number) => `SAR ${Math.round(n).toLocaleString('en-US')}`;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export type MadaReply = { text: string; list: string[]; foot: string | null; actions: MadaAction[]; askWhere: boolean; dest: string | null };

/**
 * Mada's answer to "@Mada …" in a circle, by rules: about this circle's place, or a question back.
 * Used when no model is configured (mock mode, and the fallback when the live answer can't be used).
 */
export function madaReply(input: { members: number; dest: string | null; text: string; prevAskedWhere: boolean }): MadaReply {
  const n = input.members;
  const q = input.text.replace(/@mada\b/gi, '').trim();
  const lower = q.toLowerCase();
  let dest = findPlace(q) ?? input.dest;
  if (!dest && input.prevAskedWhere && q && q.split(/\s+/).length <= 3 && !/[\d@?!.,;:]/.test(q)) dest = q.replace(/\b\w/g, (c) => c.toUpperCase());
  const base = { list: [] as string[], foot: null as string | null, askWhere: false };
  if (!dest) {
    return { ...base, dest: null, askWhere: true, text: t(n === 1 ? 'circles.mada.where.one' : 'circles.mada.where', { n }), actions: ['Georgia', 'Baku', 'AlUla'].map((p) => ({ label: p, say: p })) };
  }
  const P = PLACES[dest];
  const who = n === 1 ? t('circles.mada.you') : t('circles.mada.all', { n });
  const planIt: MadaAction = { label: t('circles.mada.planIt'), ask: t('circles.mada.planAsk', { dest, n }) };
  if (!P) return { ...base, dest, text: t('circles.mada.unknown', { dest, who }), actions: [planIt] };
  if (/visa|passport/.test(lower)) return { ...base, dest, text: `${P.visa} ${t('circles.mada.visaCheck')}`, actions: [planIt] };
  if (/flight|fly|plane|ticket/.test(lower)) {
    return P.fly
      ? { ...base, dest, text: t('circles.mada.flights', { dest, fly: P.fly, from: sar(P.from), who }), actions: [{ label: t('circles.mada.findFlights'), ask: t('circles.mada.flightsAsk', { dest, n }) }] }
      : { ...base, dest, text: t('circles.mada.home', { dest }), actions: [planIt] };
  }
  if (/hotel|stay|room|villa|sleep/.test(lower)) return { ...base, dest, text: t('circles.mada.stay', { dest, stay: P.stay }), actions: [{ label: t('circles.mada.seeStays'), ask: t('circles.mada.staysAsk', { dest, n }) }] };
  if (/when|weather|season|best time|cold|hot|warm/.test(lower)) return { ...base, dest, text: t('circles.mada.when', { dest, when: P.when }), actions: [planIt] };
  if (/cost|price|budget|how much|expensive|cheap/.test(lower)) {
    const lo = Math.max(500, roundTo(P.from * n + P.nightly * 4 * Math.ceil(n / 4), 500));
    const people = n === 1 ? t('circles.mada.onePerson') : t('circles.mada.people', { n });
    return { ...base, dest, text: t('circles.mada.cost', { people, dest, lo: sar(lo), hi: Math.round(roundTo(lo * 1.25, 500)).toLocaleString('en-US') }), actions: [planIt] };
  }
  return {
    ...base, dest, text: t('circles.mada.ideas', { dest, who }), list: P.ideas,
    foot: P.fly ? t('circles.mada.ideasFoot', { fly: P.fly, from: sar(P.from) }) : null,
    actions: [planIt, ...(P.plan ? [{ label: t('circles.mada.seePlan'), plan: P.plan }] : [])],
  };
}

/** The phrase a vote result reads with: "Wednesday it is." for "Wed 10 Mar". */
export function votePhrase(label: string): string {
  const days: Record<string, string> = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(label) ? days[label.slice(0, 3)]! : label;
}

/** The Ask text a vote result's "Book it" opens with. */
export function bookPrefill(v: { q: string; kind: string }, winner: string, members: number, dest: string | null): string {
  return v.kind === 'places' ? t('circles.mada.planAsk', { dest: winner, n: members }) : `${v.q.replace(/\?$/, '')}: ${winner}${dest ? ` · ${dest}` : ''}`;
}

/* ───────────── contacts, matched by hash ───────────── */

/** The salt every phone and the server use to hash numbers for contact matching. Public by design: it only stops
 *  a list of hashes from matching other apps' lists. */
export const CONTACT_SALT = 'mada-contacts-v1';
export const contactKey = (e164: string) => `${CONTACT_SALT}:${e164}`;
