import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AcceptInviteResponse, AroundResponse, BlocksResponse, CircleDetail, CircleResponse, CirclesResponse, ContactsMatchResponse, CreateInviteResponse,
  DiscoverResponse, FriendsResponse, InviteLink, InvitePreview, InvitesResponse, MessagesPage, OkResponse, PostResponse, PostsResponse,
  ProfileResponse, SavedItem, SavedResponse, SearchResponse, SentMessages, StampsResponse, formatSar, joinNames, planById,
  type Audience, type CircleMessage, type CircleSummary, type CreateCircleRequest, type CreateInviteRequest, type CreatePostRequest,
  type CreateSplitRequest, type CreateVoteRequest, type MarkPaidRequest, type PersonRef, type PostKind, type ReportRequest, type SaveRequest,
  type SendCircleMessageRequest, type SharedCard, type UpdateCircleRequest,
} from '@mada/shared';
import { request } from './api';
import { API_ORIGIN } from './config';
import { t } from './i18n';
import { useSession } from './session';

/*
 * The Circles client: circles and their chat, votes and splits, friends, invites, tips, saves, Discover and
 * Who's around. JSON through the shared, schema-checked `request`. Server state lives in React Query; an open chat
 * polls every 5 seconds (the API takes ?after= so a stream can replace the poll later without changing screens).
 */

export const ck = {
  all: ['circles'] as const,
  list: ['circles', 'list'] as const,
  circle: (id: string) => ['circles', 'circle', id] as const,
  messages: (id: string) => ['circles', 'messages', id] as const,
  friends: ['circles', 'friends'] as const,
  profile: (id: string) => ['circles', 'profile', id] as const,
  invites: ['circles', 'invites'] as const,
  posts: (city: string | null, kind: PostKind | null) => ['circles', 'posts', city, kind] as const,
  known: ['circles', 'posts', 'known'] as const,
  saved: ['circles', 'saved'] as const,
  discover: (city: string | null) => ['circles', 'discover', city] as const,
  around: ['circles', 'around'] as const,
  stamps: ['circles', 'stamps'] as const,
  search: (q: string) => ['circles', 'search', q] as const,
  preview: (code: string) => ['circles', 'preview', code] as const,
  blocks: ['circles', 'blocks'] as const,
};

const Items = SentMessages;
const LeaveResponse = z.object({ deleted: z.boolean() });
const DmResponse = z.object({ circleId: z.string() });
const FriendStatus = z.object({ status: z.enum(['asked', 'friends']) });
const SavedOne = z.object({ item: SavedItem });
const q = (o: Record<string, string | null | undefined>) => {
  const s = Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
  return s ? `?${s}` : '';
};

export const circlesApi = {
  list: () => request({ method: 'GET', path: '/circles' }, CirclesResponse),
  create: (b: CreateCircleRequest) => request({ method: 'POST', path: '/circles', body: b }, CircleResponse),
  dm: (userId: string) => request({ method: 'POST', path: '/circles/dm', body: { userId } }, DmResponse),
  get: (id: string) => request({ method: 'GET', path: `/circles/${id}` }, CircleResponse),
  update: (id: string, b: UpdateCircleRequest) => request({ method: 'PATCH', path: `/circles/${id}`, body: b }, CircleDetail),
  remove: (id: string) => request({ method: 'DELETE', path: `/circles/${id}` }, OkResponse),
  leave: (id: string) => request({ method: 'POST', path: `/circles/${id}/leave` }, LeaveResponse),
  messages: (id: string, cursor: { before?: string; after?: string } = {}) => request({ method: 'GET', path: `/circles/${id}/messages${q(cursor)}` }, MessagesPage),
  send: (id: string, b: SendCircleMessageRequest) => request({ method: 'POST', path: `/circles/${id}/messages`, body: b }, Items),
  dismiss: (id: string, mid: string) => request({ method: 'PATCH', path: `/circles/${id}/messages/${mid}`, body: { done: true } }, Items),
  vote: (id: string, b: CreateVoteRequest) => request({ method: 'POST', path: `/circles/${id}/votes`, body: b }, Items),
  cast: (id: string, mid: string, option: string) => request({ method: 'POST', path: `/circles/${id}/votes/${mid}`, body: { option } }, Items),
  closeVote: (id: string, mid: string) => request({ method: 'POST', path: `/circles/${id}/votes/${mid}/close` }, Items),
  pick: (id: string, mid: string, option: string) => request({ method: 'POST', path: `/circles/${id}/votes/${mid}/pick`, body: { option } }, Items),
  split: (id: string, b: CreateSplitRequest) => request({ method: 'POST', path: `/circles/${id}/splits`, body: b }, Items),
  paid: (id: string, mid: string, b: MarkPaidRequest) => request({ method: 'POST', path: `/circles/${id}/splits/${mid}/paid`, body: b }, Items),
  remindSplit: (id: string, mid: string) => request({ method: 'POST', path: `/circles/${id}/splits/${mid}/remind` }, Items),
  makeAdmin: (id: string, uid: string) => request({ method: 'PATCH', path: `/circles/${id}/members/${uid}`, body: { role: 'admin' } }, OkResponse),
  removeMember: (id: string, uid: string) => request({ method: 'DELETE', path: `/circles/${id}/members/${uid}` }, OkResponse),
  invite: (id: string, userIds: string[]) => request({ method: 'POST', path: `/circles/${id}/invites`, body: { userIds } }, CircleDetail),
  circleLink: (id: string) => request({ method: 'POST', path: `/circles/${id}/link` }, InviteLink),

  invites: () => request({ method: 'GET', path: '/invites' }, InvitesResponse),
  createInvite: (b: CreateInviteRequest) => request({ method: 'POST', path: '/invites', body: b }, CreateInviteResponse),
  preview: (code: string) => request({ method: 'GET', path: `/invites/${encodeURIComponent(code)}`, auth: !!useSession.getState().tokens }, InvitePreview),
  accept: (ref: string) => request({ method: 'POST', path: `/invites/${encodeURIComponent(ref)}/accept` }, AcceptInviteResponse),
  decline: (id: string) => request({ method: 'POST', path: `/invites/${id}/decline` }, OkResponse),
  remindInvite: (id: string) => request({ method: 'POST', path: `/invites/${id}/remind` }, OkResponse),
  cancelInvite: (id: string) => request({ method: 'DELETE', path: `/invites/${id}` }, OkResponse),

  friends: () => request({ method: 'GET', path: '/friends' }, FriendsResponse),
  addFriend: (userId: string) => request({ method: 'POST', path: '/friends', body: { userId } }, FriendStatus),
  acceptFriend: (id: string) => request({ method: 'POST', path: `/friends/${id}/accept` }, OkResponse),
  removeFriend: (id: string) => request({ method: 'DELETE', path: `/friends/${id}` }, OkResponse),
  profile: (id: string) => request({ method: 'GET', path: `/friends/${id}` }, ProfileResponse),
  search: (term: string) => request({ method: 'GET', path: `/friends/search${q({ q: term })}` }, SearchResponse),
  contacts: (hashes: string[]) => request({ method: 'POST', path: '/friends/contacts', body: { hashes } }, ContactsMatchResponse),
  follow: (id: string) => request({ method: 'POST', path: `/follows/${id}` }, OkResponse),
  unfollow: (id: string) => request({ method: 'DELETE', path: `/follows/${id}` }, OkResponse),

  posts: (city: string | null, kind: PostKind | null) => request({ method: 'GET', path: `/posts${q({ city, kind })}` }, PostsResponse),
  known: () => request({ method: 'GET', path: '/posts?scope=known' }, PostsResponse),
  post: (id: string) => request({ method: 'GET', path: `/posts/${id}` }, PostResponse),
  createPost: (b: CreatePostRequest) => request({ method: 'POST', path: '/posts', body: b }, PostResponse),
  deletePost: (id: string) => request({ method: 'DELETE', path: `/posts/${id}` }, OkResponse),
  thank: (id: string) => request({ method: 'POST', path: `/posts/${id}/thanks` }, OkResponse),

  saved: () => request({ method: 'GET', path: '/saved' }, SavedResponse),
  save: (b: SaveRequest) => request({ method: 'POST', path: '/saved', body: b }, SavedOne),
  unsave: (id: string) => request({ method: 'DELETE', path: `/saved/${id}` }, OkResponse),

  discover: (city: string | null) => request({ method: 'GET', path: `/discover${q({ city })}` }, DiscoverResponse),
  notifyCity: (city: string) => request({ method: 'POST', path: '/discover/notify', body: { city } }, OkResponse),
  around: () => request({ method: 'GET', path: '/discover/around' }, AroundResponse),
  presence: (b: { on: boolean; audience?: Audience }) => request({ method: 'PUT', path: '/discover/around', body: b }, AroundResponse),
  aroundAction: (userId: string, action: 'hello' | 'notNow' | 'hide') => request({ method: 'POST', path: '/discover/around', body: { userId, action } }, AroundResponse),
  stamps: () => request({ method: 'GET', path: '/discover/stamps' }, StampsResponse),

  report: (b: ReportRequest) => request({ method: 'POST', path: '/reports', body: b }, OkResponse),
  block: (userId: string) => request({ method: 'POST', path: '/blocks', body: { userId } }, OkResponse),
  unblock: (userId: string) => request({ method: 'DELETE', path: `/blocks/${userId}` }, OkResponse),
  blocks: () => request({ method: 'GET', path: '/blocks' }, BlocksResponse),
};

/* ───────────── hooks ───────────── */

const signedIn = () => useSession.getState().status === 'signedIn';
export function useMeId(): string {
  return useSession((s) => s.user?.id ?? '');
}

export const useCircles = () => useQuery({ queryKey: ck.list, queryFn: circlesApi.list, enabled: signedIn(), refetchInterval: 15_000 });
export const useCircle = (id: string) => useQuery({ queryKey: ck.circle(id), queryFn: () => circlesApi.get(id), enabled: !!id && signedIn(), refetchInterval: 15_000, retry: false });
/** An open chat polls every 5 seconds. */
export const useMessages = (id: string, poll = true) => useQuery({ queryKey: ck.messages(id), queryFn: () => circlesApi.messages(id), enabled: !!id && signedIn(), refetchInterval: poll ? 5_000 : false, retry: false });
export const useFriends = () => useQuery({ queryKey: ck.friends, queryFn: circlesApi.friends, enabled: signedIn() });
export const useProfile = (id: string) => useQuery({ queryKey: ck.profile(id), queryFn: () => circlesApi.profile(id), enabled: !!id && signedIn(), retry: false });
export const useInvites = () => useQuery({ queryKey: ck.invites, queryFn: circlesApi.invites, enabled: signedIn() });
export const usePosts = (city: string | null, kind: PostKind | null) => useQuery({ queryKey: ck.posts(city, kind), queryFn: () => circlesApi.posts(city, kind), enabled: !!city && signedIn(), refetchInterval: 20_000 });
export const useKnownPosts = () => useQuery({ queryKey: ck.known, queryFn: circlesApi.known, enabled: signedIn(), refetchInterval: 20_000 });
export const useSaved = () => useQuery({ queryKey: ck.saved, queryFn: circlesApi.saved, enabled: signedIn() });
export const useDiscover = (city: string | null) => useQuery({ queryKey: ck.discover(city), queryFn: () => circlesApi.discover(city), enabled: signedIn(), placeholderData: (p) => p });
export const useAround = () => useQuery({ queryKey: ck.around, queryFn: circlesApi.around, enabled: signedIn() });
export const useStamps = () => useQuery({ queryKey: ck.stamps, queryFn: circlesApi.stamps, enabled: signedIn() });
export const useSearch = (term: string) => useQuery({ queryKey: ck.search(term), queryFn: () => circlesApi.search(term), enabled: term.trim().length > 0 && signedIn(), placeholderData: (p) => p });
export const usePreview = (code: string) => useQuery({ queryKey: ck.preview(code), queryFn: () => circlesApi.preview(code), retry: false });

/** A mutation that refreshes what it touched. */
export function useAct<A, R>(fn: (a: A) => Promise<R>, touched: (a: A, r: R) => QueryKey[] = () => [ck.all]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (r, a) => { for (const k of touched(a, r)) qc.invalidateQueries({ queryKey: k }); } });
}

/** Merge messages a write returned into the open chat at once, so nothing waits for the next poll. */
export function useMergeMessages(circleId: string) {
  const qc = useQueryClient();
  return (items: CircleMessage[]) => {
    qc.setQueryData<z.infer<typeof MessagesPage>>(ck.messages(circleId), (old) => {
      if (!old) return old;
      const byId = new Map(old.items.map((m) => [m.id, m]));
      for (const m of items) byId.set(m.id, m);
      return { ...old, items: [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
    });
    qc.invalidateQueries({ queryKey: ck.list });
  };
}

/* ───────────── words ───────────── */

export const money = (halalas: number) => formatSar(halalas);

/** "You" for the viewer, the first name for anyone else. */
export function nameOf(id: string | null | undefined, me: string, people: Map<string, PersonRef>): string {
  if (!id) return t('circles.someone');
  if (id === me) return t('circles.you');
  return people.get(id)?.short ?? t('circles.someone');
}
export const namesOf = (ids: string[], me: string, people: Map<string, PersonRef>) => joinNames(ids.map((id) => nameOf(id, me, people)));

/** A system line, in the reader's words: "You joined" to the one who joined, "Abdullah joined" to everyone else. */
export function sysText(m: CircleMessage, me: string, people: Map<string, PersonRef>): string {
  const s = m.sys!;
  const actorIsMe = s.actor === me;
  const name = nameOf(s.actor, me, people);
  const names = namesOf(s.users, me, people);
  const amount = s.amount != null ? money(s.amount) : '';
  const v = { name, names, text: s.text ?? '', amount };
  switch (s.event) {
    case 'created': return t(actorIsMe ? 'circles.sys.created.you' : 'circles.sys.created', v);
    case 'invited': return t(actorIsMe ? 'circles.sys.invited.you' : 'circles.sys.invited', v);
    case 'joined': return t(actorIsMe ? 'circles.sys.joined.you' : 'circles.sys.joined', v);
    case 'joinedByLink': return actorIsMe ? t('circles.sys.joinedByLink.you', { name: nameOf(s.users[0], me, people) }) : t('circles.sys.joinedByLink', v);
    case 'left': return t(actorIsMe ? 'circles.sys.left.you' : 'circles.sys.left', v);
    case 'removed': return t(actorIsMe ? 'circles.sys.removed.you' : 'circles.sys.removed', v);
    case 'renamed': return t(actorIsMe ? 'circles.sys.renamed.you' : 'circles.sys.renamed', v);
    case 'admin': return s.users[0] === me ? t('circles.sys.admin.you') : t('circles.sys.admin', v);
    case 'pinned': return t(actorIsMe ? 'circles.sys.pinned.you' : 'circles.sys.pinned', v);
    case 'cancelledInvite': return t(actorIsMe ? 'circles.sys.cancelledInvite.you' : 'circles.sys.cancelledInvite', v);
    case 'paid': return t(actorIsMe ? 'circles.sys.paid.you' : 'circles.sys.paid', v);
    case 'markedPaid': {
      const own = s.users.length === 1 && s.users[0] === s.actor;
      if (own) return actorIsMe ? t('circles.sys.markedPaid.self', v) : t('circles.sys.markedPaid.theirs', v);
      return t(actorIsMe ? 'circles.sys.markedPaid.you' : 'circles.sys.markedPaid', v);
    }
    case 'reminded': return t(actorIsMe ? 'circles.sys.reminded.you' : 'circles.sys.reminded', v);
    case 'dm': return t('circles.sys.dm', { name: namesOf(s.users.filter((u) => u !== me), me, people) });
    default: return m.body;
  }
}

/** The one line under a circle's name: the last thing that happened in it. */
export function lastLine(c: CircleSummary, me: string, people: Map<string, PersonRef>): string {
  const m = c.last;
  if (!m) return c.invitedCount ? t('circles.chat.invited', { count: c.invitedCount }) : t('circles.last.nothing');
  const who = m.author.kind === 'user' ? (m.author.id === me ? t('circles.you') : m.author.name) : m.author.kind === 'agent' ? m.author.name : t('circles.mada');
  if (m.kind === 'sys') return sysText(m, me, people);
  if (m.kind === 'vote') return t(m.vote!.closed ? 'circles.last.voteClosed' : 'circles.last.vote', { q: m.vote!.q });
  if (m.kind === 'split') return t(m.split!.settled ? 'circles.last.settled' : 'circles.last.split', { what: m.split!.what });
  if (m.kind === 'card') return t('circles.last.shared', { who, what: cardTitle(m.card) });
  return t('circles.last.line', { who, text: m.body });
}
export const cardTitle = (c: SharedCard | null) => (!c ? '' : c.kind === 'plan' ? planById(c.id)?.title ?? '' : c.post.place);

/** Where a tip's or a plan's picture comes from: a photo we ship, or an uploaded one (sent with the session). */
export const COVERS = {
  istanbul: require('../../assets/images/istanbul.jpg'),
  alula: require('../../assets/images/alula.jpg'),
  riyadh: require('../../assets/images/riyadh.jpg'),
} as const;
export function photoSource(p: { photoKey?: keyof typeof COVERS | null; photoUrl?: string | null }) {
  if (p.photoUrl) {
    if (/^(data:|https?:)/.test(p.photoUrl)) return { uri: p.photoUrl };
    const token = useSession.getState().tokens?.accessToken;
    return { uri: `${API_ORIGIN}${p.photoUrl}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
  }
  return p.photoKey ? COVERS[p.photoKey] : null;
}
export const cityCover = (city: string) => COVERS[(city.toLowerCase() === 'alula' ? 'alula' : city.toLowerCase() === 'riyadh' ? 'riyadh' : 'istanbul')];

/** "2 days ago", "Last week": when a tip was posted. */
export function whenLabel(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (days < 1) return Date.now() - Date.parse(iso) < 3_600_000 ? t('circles.post.justNow') : t('circles.when.today');
  if (days === 1) return t('circles.when.yesterday');
  if (days < 7) return t('circles.when.days', { n: days });
  if (days < 14) return t('circles.when.lastWeek');
  if (days < 30) return t('circles.when.weeks', { n: Math.floor(days / 7) });
  if (days < 60) return t('circles.when.lastMonth');
  return t('circles.when.months', { n: Math.floor(days / 30) });
}
/** "3 min ago" for invites. */
export function agoLabel(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 1) return t('circles.ago.now');
  if (m < 60) return t('circles.ago.min', { n: m });
  if (m < 1440) return t('circles.ago.hours', { n: Math.round(m / 60) });
  const d = Math.round(m / 1440);
  return t(d === 1 ? 'circles.ago.days.one' : 'circles.ago.days.other', { count: d });
}
