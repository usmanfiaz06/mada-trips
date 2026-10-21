import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { dayLabel, formatSar, nameIn, rangeLabel, timeLabel, type ChatCard, type ChatPay, type CopyKey } from '@mada/shared';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Appear } from '@/components/Appear';
import { WhatsAppMark } from '@/components/BrandMarks';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Pill } from '@/components/Pill';
import { SkeletonFor, useStagedLine } from '@/components/states/Waiting';
import { IconTile } from '@/components/trips/ui';
import { T } from '@/components/Text';
import { AirlineMark } from './AirlineMark';
import { clock } from './Conversation';
import { StayCard } from './StayCard';
import { PlanCard } from '../esim/look';
import { AgentDot, MadaDot, enter } from './parts';
import type { ChatTurn } from '@/lib/ask-chat';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, t } from '@/lib/i18n';
import { DemoFare } from './DemoFare';
import { ChoiceCard } from './ChoiceCard';
import { InviteCard } from './InviteCard';
import { ChangeRequestCard, PayChangeCard } from './ChangeRequestCard';
import { LinkCard, PlanCard as LivingPlanCard, PlanDiffCard } from './PlanCards';
import { DocumentCard, ShareCard } from './DocCards';
import { riseStyle, useReduceMotion } from '@/lib/motion';
import { colors, ff, font, radii } from '@/theme';

/*
 * Ask as a conversation, in bubbles: the traveller's on the end side (green), Mada's on the start side beside her mark
 * (or the name of a person on the desk, only when one wrote it), the dots until her words arrive and stream in the same
 * bubble, what is being done as a small grey line under it, then the cards in line with the bubble, the same ones the flows draw, each opening the full flow for the same search. The line at the
 * top says plainly that these answers are instant and a person confirms the booking (COPY.md §6.3).
 */

export type ChatOpen =
  | { kind: 'flights' | 'stays' | 'esim' | 'entry' | 'car'; card: ChatCard; turn: ChatTurn }
  | { kind: 'pay'; pay: ChatPay }
  | { kind: 'handoff'; threadId: string }
  | { kind: 'request'; id: string }
  | { kind: 'trip'; id: string }
  /** "About your AlUla trip?": into that trip's chat, or a chat of its own (ASK-INTEGRATED.md §2.2). */
  | { kind: 'attach'; choice: 'trip' | 'new'; tripId: string; turn: ChatTurn }
  /** open_in_app: a place in the app (PlanCards.tsx linkHref). */
  | { kind: 'link'; screen: Extract<ChatCard, { type: 'link' }>['screen']; id: string | null }
  /** "Start a chat for Istanbul": a new chat with these words (ASK-INTEGRATED.md §2.2). */
  | { kind: 'newChat'; text: string };

/**
 * foundId: the turn a search landed on (the chats list's search, or find in this chat, ASK-INTEGRATED.md §11 U1+): it
 * is marked, and onFound gets where it sits in the thread so the screen can scroll to it.
 */
export function ChatThread({ turns, onOpen, onSay, foundId, onFound }: { turns: ChatTurn[]; onOpen: (o: ChatOpen) => void; onSay?: (text: string) => void; foundId?: number | null; onFound?: (y: number) => void }) {
  const still = useReduceMotion();
  const top = useRef(0);
  const found = foundId ?? null;
  // Where each turn sits, so moving to another match scrolls to it without waiting for a layout.
  const ys = useRef(new Map<number, number>());
  useEffect(() => {
    const y = found !== null ? ys.current.get(found) : undefined;
    if (y !== undefined) onFound?.(top.current + y);
  }, [found]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!turns.length) return null;
  return (
    <View style={{ gap: 14 }} testID="chat-thread" onLayout={(e) => { top.current = e.nativeEvent.layout.y; }}>
      <T v="tiny" color={colors.muted} testID="chat-disclosure">{t('chat.disclosure')}</T>
      {turns.map((turn, i) => (
        <Turn key={turn.id} turn={turn} stamp={stampFor(turn, turns[i - 1])} still={still} onOpen={onOpen} onSay={i === turns.length - 1 ? onSay : undefined}
          found={turn.id === found} onY={(y) => { ys.current.set(turn.id, y); if (turn.id === found) onFound?.(top.current + y); }} />
      ))}
    </View>
  );
}

/** The turns that have the words, oldest first (find in this chat, and a search from the list). */
export function matchesIn(turns: ChatTurn[], words: string | null | undefined): number[] {
  const q = (words ?? '').trim().toLowerCase();
  if (!q) return [];
  return turns.filter((x) => x.me.toLowerCase().includes(q) || x.text.toLowerCase().includes(q)).map((x) => x.id);
}

/**
 * The time, only on the first message and after a quiet gap (more than 10 minutes), as in any messenger; with the day
 * ("Yesterday · 14:05", "Mon 19 Oct · 09:10") when the day changed since the message before (ASK-INTEGRATED.md U1+).
 */
const GAP_MS = 10 * 60_000;
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function dayWord(day: string, today = localDay(new Date().toISOString())): string {
  const yesterday = localDay(new Date(Date.parse(`${today}T12:00:00`) - 86_400_000).toISOString());
  return day === today ? t('chat.list.group.today') : day === yesterday ? t('chat.list.group.yesterday') : dayLabel(day, { locale: getLocale() });
}
function stampFor(turn: ChatTurn, prev?: ChatTurn): string | null {
  if (!turn.at) return null;
  const at = Date.parse(turn.at);
  const before = prev?.at ? Date.parse(prev.at) : NaN;
  const newDay = !prev?.at || localDay(prev.at) !== localDay(turn.at);
  if (prev && !newDay && !(at - before > GAP_MS)) return null;
  const time = clock(turn.at);
  return newDay ? [dayWord(localDay(turn.at)), time].filter(Boolean).join(' · ') : time || null;
}

/** The thread's gentle arrival: a short rise, nothing at all with Reduce Motion (native entering, web CSS). */
const appear = (still: boolean) => ({ entering: still ? undefined : enter(0), style: still ? null : riseStyle(0) });

function Turn({ turn, stamp, still, onOpen, onSay, found, onY }: { turn: ChatTurn; stamp: string | null; still: boolean; onOpen: (o: ChatOpen) => void; onSay?: (text: string) => void; found?: boolean; onY?: (y: number) => void }) {
  const writing = turn.state === 'streaming';
  const waitKind = SKELETON_FOR[turn.statusTool ?? ''];
  const me = appear(still);
  const mada = appear(still);
  // Long-press a message for its time (U1+).
  const [showAt, setShowAt] = useState(false);
  return (
    <View style={{ gap: 10 }} testID={found ? 'chat-found' : `chat-turn-${turn.id}`} onLayout={onY ? (e) => onY(e.nativeEvent.layout.y) : undefined}>
      {stamp ? <T v="tiny" color={colors.muted} style={s.stamp} testID="chat-time">{stamp}</T> : null}
      {turn.me && turn.from != null ? (
        // Someone else on the trip, in the shared trip chat: on the start side, with their initial and name.
        <Animated.View entering={me.entering} style={[s.madaRow, me.style]} testID="chat-member" accessible accessibilityLabel={`${turn.from}: ${turn.me}`}>
          <View style={s.memberDot}><T v="tiny" color={colors.green} style={{ fontFamily: ff.ui600 }}>{(turn.from[0] ?? '?').toUpperCase()}</T></View>
          <View style={s.madaCol}>
            <T v="tiny" color={colors.ink3} style={{ paddingHorizontal: 4 }} testID="chat-member-name">{turn.from}</T>
            <View style={[s.member, found ? s.found : null]}><T v="body" color={colors.green} style={{ lineHeight: 22 }}>{turn.me}</T></View>
          </View>
        </Animated.View>
      ) : turn.me ? <Animated.View entering={me.entering} style={[s.meWrap, me.style]} testID="chat-me" accessible accessibilityLabel={t('chat.a11y.you', { text: turn.me })}>
        <Pressable onLongPress={turn.at ? () => { buzz('soft'); setShowAt((v) => !v); } : undefined} delayLongPress={350}
          onHoverIn={turn.at ? () => setShowAt(true) : undefined} onHoverOut={turn.at ? () => setShowAt(false) : undefined} style={[s.me, found ? s.found : null]}>
          {turn.attachment ? (
            <View style={s.attached} testID="chat-me-attachment"><Icon name="doc" size={16} color={colors.mist} /><T style={[font('body', colors.mist), { fontSize: 16, lineHeight: 22 }]}>{turn.me}</T></View>
          ) : <T style={[font('body', colors.mist), { fontSize: 16, lineHeight: 22 }]}>{turn.me}</T>}
        </Pressable>
        {showAt && turn.at ? <T v="tiny" color={colors.muted} testID="chat-me-time">{clock(turn.at)}</T> : null}
      </Animated.View> : null}
      {turn.text || writing ? (
        <Animated.View entering={mada.entering} style={[s.madaRow, mada.style]}>
          {turn.by ? <AgentDot name={turn.by} size={AVATAR} /> : <MadaDot size={AVATAR} />}
          <View style={s.madaCol}>
            {turn.by ? <T v="tiny" color={colors.ink3} style={{ paddingHorizontal: 4 }} testID="chat-by">{turn.by}</T> : null}
            <View style={[s.bubble, found && !turn.me ? s.found : null]} accessible
              accessibilityLabel={turn.text ? (turn.by ? t('chat.a11y.agent', { agent: turn.by, text: turn.text }) : t('chat.a11y.mada', { text: turn.text })) : (turn.status ?? t('chat.working'))}>
              {turn.text ? <T v="body" color={colors.green} style={{ lineHeight: 22 }} testID="chat-text" accessibilityLiveRegion="polite">{turn.text}</T> : <Dots still={still} />}
            </View>
            {writing && turn.status ? <StatusLine turn={turn} /> : null}
          </View>
        </Animated.View>
      ) : null}
      {/* What Mada found, under her words and in line with the bubble (not the mark). */}
      <View style={s.under}>
        {turn.cards.map((c, i) => <CardFor key={`${c.type}-${i}`} card={c} turn={turn} onOpen={onOpen} onSay={onSay} />)}
        {turn.pay ? (
          <Box icon="card" title={turn.pay.title} testID="chat-pay-card">
            <View style={s.line}><Icon name="lock" size={16} color={colors.ink3} /><T v="small" color={colors.ink2} style={{ flex: 1 }}>{t('chat.pay.line')}</T></View>
            <CardButton label={t('chat.pay')} onPress={() => { buzz('tap'); onOpen({ kind: 'pay', pay: turn.pay! }); }} testID="chat-pay" />
          </Box>
        ) : null}
        {turn.handoff ? (
          <Animated.View entering={enter(0)} style={s.box} testID="chat-handoff-card">
            <View style={s.row}>
              {turn.handoff.agent ? <AgentDot name={turn.handoff.agent} size={38} /> : <MadaDot size={38} />}
              <T v="h3" style={{ flex: 1, fontSize: 15 }}>{turn.handoff.agent ? t('chat.handoff.cardNamed', { agent: turn.handoff.agent }) : t('chat.handoff.card')}</T>
            </View>
            <CardButton soft label={t('chat.openThread')} onPress={() => onOpen({ kind: 'handoff', threadId: turn.handoff!.threadId })} testID="chat-handoff" />
          </Animated.View>
        ) : null}
        {/* Where the cards will land, while a search runs: their shape, before they come. */}
        {writing && turn.status && waitKind && !turn.cards.some((c) => c.type === waitKind) ? (
          <View style={{ gap: 8 }} testID="chat-skeleton" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[0, 1].map((i) => <SkeletonFor key={i} kind={waitKind} compact />)}
          </View>
        ) : null}
        {/* The next step, on the latest reply only: every reply ends with one (docs/app/ASSISTANT.md). */}
        {onSay && turn.state === 'done' && turn.next?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingVertical: 2 }} testID="chat-next">
            {turn.next.map((c) => <Chip key={c} label={c} onPress={() => { buzz('tap'); onSay(c); }} testID="chat-next-chip" />)}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

/** The tools whose cards have a shape to show while they run. */
const SKELETON_FOR: Record<string, 'flights' | 'stays' | 'esim' | undefined> = { search_flights: 'flights', search_stays: 'stays', esim_plans: 'esim' };
const CHAT_STAGES = [0, 3000, 8000, 14000] as const;

/**
 * What is being done, under the bubble: Mada's own line first; if the tool is still running after 3 s it moves on
 * ("Comparing rooms and prices", …, "Still going, a few hotels answer slowly"), timed from the last status event.
 */
function StatusLine({ turn }: { turn: ChatTurn }) {
  const tool = turn.statusTool ?? '';
  const more = tool === 'search_stays' ? ['waiting.stays.1', 'waiting.stays.2', 'waiting.stays.3']
    : tool === 'search_flights' ? ['waiting.flights.1', 'waiting.flights.2', 'waiting.flights.3']
    : ['waiting.chat.1', 'waiting.chat.2', 'waiting.chat.3'];
  const lines = [turn.status ?? '', ...more.map((k) => t(k as CopyKey))];
  const line = useStagedLine(lines, CHAT_STAGES, turn.status ? `${turn.status}|${turn.statusAt ?? 0}` : null, turn.statusAt);
  return (
    <Appear key={line.index} enter="fade" ms={320}>
      <T v="tiny" color={colors.muted} style={{ paddingHorizontal: 4 }} testID="chat-status" accessibilityLiveRegion="polite">{`${line.text}…`}</T>
    </Appear>
  );
}

/** Mada is writing: three dots breathing inside her bubble until the words come (still with Reduce Motion). */
function Dots({ still }: { still: boolean }) {
  return (
    <View style={s.dots} testID="chat-typing">
      {[0, 1, 2].map((i) => <Dot key={i} delay={i * 160} still={still} />)}
    </View>
  );
}

function Dot({ delay, still }: { delay: number; still: boolean }) {
  const o = useSharedValue(still ? 0.6 : 0.3);
  useEffect(() => {
    if (still) { o.set(0.6); return; }
    o.set(withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.3, { duration: 380 })), -1)));
  }, [o, delay, still]);
  const st = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[s.dot, st]} />;
}

function CardFor({ card, turn, onOpen, onSay }: { card: ChatCard; turn: ChatTurn; onOpen: (o: ChatOpen) => void; onSay?: (text: string) => void }) {
  const open = (kind: 'flights' | 'stays' | 'esim' | 'entry' | 'car') => { buzz('tap'); onOpen({ kind, card, turn }); };
  const locale = getLocale();
  switch (card.type) {
    case 'flights':
      return (
        <View style={{ gap: 8 }} testID="chat-flights">
          {card.options.map((f) => (
            <Card key={f.id} onPress={() => open('flights')} accessibilityLabel={`${f.airline}, ${formatSar(f.total.amount)}`}>
              <View style={s.row}>
                <AirlineMark carrier={f.carrier} brand={f.brand} size={32} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="small" style={{ fontFamily: ff.ui600 }}>{`${f.out.dep} → ${f.out.arr} · ${f.airline}`}</T>
                  <T v="tiny" color={colors.ink2}>{f.stop ?? f.reason}</T>
                  {f.demo ? <DemoFare testID={`chat-demo-fare-${f.out.flightNumber}`} /> : null}
                </View>
                <T v="small" style={{ fontFamily: ff.ui600 }} testID={`chat-flight-${f.out.flightNumber}`}>{formatSar(f.total.amount)}</T>
              </View>
            </Card>
          ))}
          <CardButton soft label={t('chat.seeAll')} onPress={() => open('flights')} testID="chat-flights-all" />
        </View>
      );
    case 'stays':
      return (
        <View style={{ gap: 8 }} testID="chat-stays">
          {card.options.map((h, i) => <StayCard key={h.id} h={h} i={i} on={false} guests={card.search.travellerIds.length} compact onPress={() => open('stays')} />)}
        </View>
      );
    case 'esim': {
      const max = Math.max(1, ...card.plans.map((p) => (p.gb ?? 0) * (p.daily ? p.days : 1)));
      return (
        <View style={{ gap: 8 }} testID="chat-esim">
          {card.plans.map((p, i) => <PlanCard key={p.id} p={p} on={false} best={i === 0} max={max} days={card.days} onPress={() => open('esim')} testID={`chat-esim-${p.size}`} />)}
        </View>
      );
    }
    case 'entry':
      return (
        <Box icon="visa" title={card.entry.countryName} sub={card.entry.okText ?? null} testID="chat-entry-card">
          {card.entry.checks.length ? (
            <View style={{ gap: 8 }}>
              {card.entry.checks.slice(0, 4).map((c, i) => (
                <View key={i} style={s.line}>
                  <Icon name={c.done ? 'check' : c.blocking ? 'doc' : 'check'} size={16} color={c.done ? colors.ok : c.blocking ? colors.goldInk : colors.ink3} width={c.done ? 2.4 : 1.8} />
                  <T v="small" color={c.blocking && !c.done ? colors.green : colors.ink2} style={{ flex: 1 }}>{c.name ? `${c.name}: ${c.text}` : c.text}</T>
                </View>
              ))}
            </View>
          ) : null}
          <CardButton soft label={t('chat.entryGo')} onPress={() => open('entry')} testID="chat-entry" />
        </Box>
      );
    case 'car': {
      const route = [card.from, card.to].filter(Boolean).join(' → ');
      return (
        <Box icon="car" title={route || card.city || t('now.car.title')} sub={route && card.city ? card.city : null} testID="chat-car-card">
          <View style={s.line}><Icon name="pin" size={16} color={colors.ink3} /><T v="small" color={colors.ink2} style={{ flex: 1 }}>{t('chat.car.line')}</T></View>
          <CardButton label={t('chat.carGo')} onPress={() => open('car')} testID="chat-car" />
        </Box>
      );
    }
    case 'trips':
      return (
        <View style={{ gap: 8 }} testID="chat-trips">
          {card.trips.map((tr) => (
            <Card key={tr.id} onPress={() => onOpen({ kind: 'trip', id: tr.id })} accessibilityLabel={`${t('chat.trip.open')}, ${nameIn(tr.city, locale)}`}>
              <View style={s.row}>
                <IconTile name="trips" />
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="h3" style={{ fontSize: 15 }} numberOfLines={1}>{nameIn(tr.city, locale)}</T>
                  <T v="tiny" color={colors.ink2} numberOfLines={1}>{[rangeLabel(tr.startDate, tr.endDate, locale), tr.justYou ? t('chat.who.justYou') : tr.travellerNames.join(locale === 'ar' ? '، ' : ', ')].filter(Boolean).join(' · ')}</T>
                </View>
                <View style={s.go}><Icon name="arrow" size={16} color={colors.green} /></View>
              </View>
            </Card>
          ))}
        </View>
      );
    case 'request':
      return <RequestCard card={card} onOpen={() => { buzz('tap'); onOpen({ kind: 'request', id: card.requestId }); }} />;
    case 'attach':
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="chat-attach">
          <CardButton label={t('chat.attach.yes')} onPress={() => onOpen({ kind: 'attach', choice: 'trip', tripId: card.tripId, turn })} testID="chat-attach-trip" />
          <CardButton soft label={t('chat.attach.new')} onPress={() => onOpen({ kind: 'attach', choice: 'new', tripId: card.tripId, turn })} testID="chat-attach-new" />
        </View>
      );
    // Companions (ASK-INTEGRATED.md §5): which one, the invite, a change asked by a companion.
    case 'people':
      return <ChoiceCard card={card} />;
    case 'invite':
      return <InviteCard card={card} />;
    case 'change':
      return <ChangeRequestCard card={card} />;
    case 'pay_change':
      return <PayChangeCard card={card} />;
    // The living plan (PlanCards.tsx): Review the plan opens the plan screen (app/trip/[id]/plan.tsx).
    case 'plan':
      return <LivingPlanCard card={card} onReview={() => onOpen({ kind: 'link', screen: 'plan', id: card.tripId })} onSay={onSay} />;
    case 'plan_diff':
      return <PlanDiffCard card={card} onReview={() => onOpen({ kind: 'link', screen: 'plan', id: card.tripId })} />;
    case 'new_chat':
      return (
        <View style={{ gap: 6 }} testID="chat-new-chat">
          <CardButton soft label={t('chat.newChat.offer', { place: card.place })} onPress={() => onOpen({ kind: 'newChat', text: card.text })} testID="chat-new-chat-go" />
        </View>
      );
    case 'link':
      return <LinkCard card={card} onOpen={() => onOpen({ kind: 'link', screen: card.screen, id: card.id })} />;
    // A passport, visa or ID sent in the chat, and asking a companion for theirs (ASK-INTEGRATED.md §6, §5.4).
    case 'document':
      return <DocumentCard card={card} turnId={turn.id} />;
    case 'doc_share':
      return <ShareCard card={card} turnId={turn.id} />;
    default:
      return null;
  }
}

const KIND_ICON: Record<string, IconName> = { visa: 'visa', umrah: 'umrah', car: 'car', food: 'food', todo: 'list', flight: 'flight', stay: 'stay' };

/** "Just you", "You and Hessa", "Hessa and Sara": the travellers said once, the account holder as "you". */
export function whoLine(who: { name: string; self: boolean }[]): string | null {
  if (!who.length) return null;
  const others = who.filter((w) => !w.self).map((w) => nameIn(w.name, getLocale()));
  const me = who.some((w) => w.self);
  if (me && !others.length) return t('chat.who.justYou');
  return me ? t('chat.who.youAnd', { names: joinAnd(others) }) : joinAnd(others);
}

/** Each part of the detail once ("You · You" → "You"), for a card from a server that sends only the detail. */
const dedupe = (detail: string | undefined) => [...new Set((detail ?? '').split(' · ').map((x) => x.trim()).filter(Boolean))].join(' · ');

type RequestChatCard = Extract<ChatCard, { type: 'request' }>;

/** Something the team arranges by hand: what, where, when and who written out, where it stands, how they'll reach you. */
function RequestCard({ card, onOpen }: { card: RequestChatCard; onOpen: () => void }) {
  const locale = getLocale();
  const who = whoLine(card.who ?? []);
  const when = card.depart ? rangeLabel(card.depart, card.return ?? null, locale) : null;
  const what = dedupe(card.detail);
  const rows: { icon: IconName; label: string; text: string; testID: string }[] = [
    what && what !== card.title ? { icon: 'doc' as const, label: t('chat.request.what'), text: what, testID: 'chat-request-what' } : null,
    card.where ? { icon: 'pin' as const, label: t('chat.request.where'), text: nameIn(card.where, locale), testID: 'chat-request-where' } : null,
    when ? { icon: 'calendar' as const, label: t('chat.request.when'), text: when, testID: 'chat-request-when' } : null,
    who ? { icon: 'user' as const, label: t('chat.request.who'), text: who, testID: 'chat-request-who' } : null,
  ].filter((r): r is NonNullable<typeof r> => !!r);
  const status = card.promisedBy ? t('chat.request.status', { time: timeLabel(card.promisedBy, { locale }) }) : t('chat.request.statusOpen');
  return (
    <Box icon={KIND_ICON[card.kind] ?? 'doc'} title={card.title} testID="chat-request-card"
      pill={<Pill label={status} variant="gold" icon={<View style={s.liveDot} />} style={{ marginTop: 2 }} />} pillTestID="chat-request-by">
      {rows.length ? (
        <View style={s.facts}>
          {rows.map((r) => (
            <View key={r.testID} style={s.line} accessible accessibilityLabel={`${r.label}: ${r.text}`} testID={r.testID}>
              <Icon name={r.icon} size={16} color={colors.ink3} />
              <T v="small" color={colors.green} style={{ flex: 1 }}>{r.text}</T>
            </View>
          ))}
        </View>
      ) : null}
      {card.contact ? (
        <View style={s.line} testID="chat-request-contact">
          {card.contact === 'whatsapp' ? <WhatsAppMark size={16} /> : <Icon name={card.contact === 'call' ? 'phone' : 'bell'} size={16} color={colors.ink3} />}
          <T v="small" color={colors.ink2} style={{ flex: 1 }}>{t(`chat.request.${card.contact}`)}</T>
        </View>
      ) : null}
      <CardButton label={t('chat.request')} onPress={onOpen} testID="chat-request" />
    </Box>
  );
}

/** Every chat card's frame: the kind's icon and a clear title, an optional status pill, the body, the button. */
function Box({ icon, title, sub, pill, pillTestID, children, testID }: { icon: IconName; title: string; sub?: string | null; pill?: ReactNode; pillTestID?: string; children?: ReactNode; testID?: string }) {
  return (
    <Animated.View entering={enter(0)} style={s.box} testID={testID}>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <IconTile name={icon} />
        <View style={{ flex: 1, gap: 6 }}>
          <T v="h3" style={{ fontSize: 16, lineHeight: 22 }} accessibilityRole="header">{title}</T>
          {sub ? <T v="small" color={colors.ink2}>{sub}</T> : null}
          {pill ? <View testID={pillTestID}>{pill}</View> : null}
        </View>
      </View>
      {children}
    </Animated.View>
  );
}

/** A card's action: a real button, 44 high. `soft` is the quieter one (mist on paper). */
function CardButton({ label, onPress, soft, testID }: { label: string; onPress: () => void; soft?: boolean; testID?: string }) {
  return <Button size="small" variant={soft ? 'secondary' : 'primary'} label={label} onPress={onPress} style={[s.button, soft ? s.soft : null]} testID={testID} />;
}

const AVATAR = 28;
const AVATAR_GAP = 8;

const s = StyleSheet.create({
  found: { borderWidth: 2, borderColor: colors.gold },
  attached: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stamp: { textAlign: 'center', alignSelf: 'center', paddingTop: 4 },
  meWrap: { alignSelf: 'flex-end', maxWidth: '82%', alignItems: 'flex-end' },
  me: { backgroundColor: colors.green, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22, borderBottomEndRadius: 6 },
  madaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: AVATAR_GAP, maxWidth: '90%' },
  madaCol: { flexShrink: 1, gap: 4, alignItems: 'flex-start' },
  memberDot: { width: AVATAR, height: AVATAR, borderRadius: 99, backgroundColor: colors.goldWash, alignItems: 'center', justifyContent: 'center' },
  member: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 20, borderTopStartRadius: 6, paddingVertical: 10, paddingHorizontal: 14 },
  // Warm, not white: mist on the sand, the corner toward the mark kept small.
  bubble: { backgroundColor: colors.mist, borderWidth: 1, borderColor: colors.line, borderRadius: 20, borderTopStartRadius: 6, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 5, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: colors.ink3 },
  under: { marginStart: AVATAR + AVATAR_GAP, gap: 10 },
  box: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16, gap: 14 },
  facts: { gap: 8, paddingTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.green },
  go: { width: 32, height: 32, borderRadius: 99, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  button: { height: 44, alignSelf: 'stretch' },
  soft: { backgroundColor: colors.mist },
});
