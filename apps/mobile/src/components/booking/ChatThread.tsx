import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { formatSar, timeLabel, type ChatCard, type ChatPay } from '@mada/shared';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { LinkButton } from '@/components/Button';
import { T } from '@/components/Text';
import { AirlineMark } from './AirlineMark';
import { clock } from './Conversation';
import { StayCard } from './StayCard';
import { PlanCard } from '../esim/look';
import { AgentDot, MadaDot, enter } from './parts';
import type { ChatTurn } from '@/lib/ask-chat';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { DemoFare } from './DemoFare';
import { riseStyle, useReduceMotion } from '@/lib/motion';
import { colors, ff, font } from '@/theme';

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
  | { kind: 'trip'; id: string };

export function ChatThread({ turns, onOpen, onSay }: { turns: ChatTurn[]; onOpen: (o: ChatOpen) => void; onSay?: (text: string) => void }) {
  const still = useReduceMotion();
  if (!turns.length) return null;
  return (
    <View style={{ gap: 14 }} testID="chat-thread">
      <T v="tiny" color={colors.muted} testID="chat-disclosure">{t('chat.disclosure')}</T>
      {turns.map((turn, i) => (
        <Turn key={turn.id} turn={turn} stamp={stampFor(turn, turns[i - 1])} still={still} onOpen={onOpen} onSay={i === turns.length - 1 ? onSay : undefined} />
      ))}
    </View>
  );
}

/** The time, only on the first message and after a quiet gap (more than 10 minutes), as in any messenger. */
const GAP_MS = 10 * 60_000;
function stampFor(turn: ChatTurn, prev?: ChatTurn): string | null {
  if (!turn.at) return null;
  const at = Date.parse(turn.at);
  const before = prev?.at ? Date.parse(prev.at) : NaN;
  if (prev && !(at - before > GAP_MS)) return null;
  return clock(turn.at) || null;
}

/** The thread's gentle arrival: a short rise, nothing at all with Reduce Motion (native entering, web CSS). */
const appear = (still: boolean) => ({ entering: still ? undefined : enter(0), style: still ? null : riseStyle(0) });

function Turn({ turn, stamp, still, onOpen, onSay }: { turn: ChatTurn; stamp: string | null; still: boolean; onOpen: (o: ChatOpen) => void; onSay?: (text: string) => void }) {
  const writing = turn.state === 'streaming';
  const me = appear(still);
  const mada = appear(still);
  return (
    <View style={{ gap: 10 }} testID={`chat-turn-${turn.id}`}>
      {stamp ? <T v="tiny" color={colors.muted} style={s.stamp} testID="chat-time">{stamp}</T> : null}
      {turn.me ? <Animated.View entering={me.entering} style={[s.meWrap, me.style]} testID="chat-me" accessible accessibilityLabel={t('chat.a11y.you', { text: turn.me })}>
        <View style={s.me}><T style={[font('body', colors.mist), { fontSize: 16, lineHeight: 22 }]}>{turn.me}</T></View>
      </Animated.View> : null}
      {turn.text || writing ? (
        <Animated.View entering={mada.entering} style={[s.madaRow, mada.style]}>
          {turn.by ? <AgentDot name={turn.by} size={AVATAR} /> : <MadaDot size={AVATAR} />}
          <View style={s.madaCol}>
            {turn.by ? <T v="tiny" color={colors.ink3} style={{ paddingHorizontal: 4 }} testID="chat-by">{turn.by}</T> : null}
            <View style={s.bubble} accessible
              accessibilityLabel={turn.text ? (turn.by ? t('chat.a11y.agent', { agent: turn.by, text: turn.text }) : t('chat.a11y.mada', { text: turn.text })) : (turn.status ?? t('chat.working'))}>
              {turn.text ? <T v="body" color={colors.green} style={{ lineHeight: 22 }} testID="chat-text" accessibilityLiveRegion="polite">{turn.text}</T> : <Dots still={still} />}
            </View>
            {writing && turn.status ? <T v="tiny" color={colors.muted} style={{ paddingHorizontal: 4 }} testID="chat-status" accessibilityLiveRegion="polite">{`${turn.status}…`}</T> : null}
          </View>
        </Animated.View>
      ) : null}
      {/* What Mada found, under her words and in line with the bubble (not the mark). */}
      <View style={s.under}>
        {turn.cards.map((c, i) => <CardFor key={`${c.type}-${i}`} card={c} turn={turn} onOpen={onOpen} />)}
        {turn.pay ? (
          <Animated.View entering={enter(0)}>
            <Card onPress={() => { buzz('tap'); onOpen({ kind: 'pay', pay: turn.pay! }); }} accessibilityLabel={`${t('chat.pay')}, ${turn.pay.title}`}>
              <T v="small" style={{ fontFamily: ff.ui600 }}>{turn.pay.title}</T>
              <T v="small" color={colors.green} testID="chat-pay">{t('chat.pay')}</T>
            </Card>
          </Animated.View>
        ) : null}
        {turn.handoff ? <View style={s.link}><LinkButton label={t('chat.openThread')} size={14} onPress={() => onOpen({ kind: 'handoff', threadId: turn.handoff!.threadId })} testID="chat-handoff" /></View> : null}
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

function CardFor({ card, turn, onOpen }: { card: ChatCard; turn: ChatTurn; onOpen: (o: ChatOpen) => void }) {
  const open = (kind: 'flights' | 'stays' | 'esim' | 'entry' | 'car') => { buzz('tap'); onOpen({ kind, card, turn }); };
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
          <LinkButton label={t('chat.seeAll')} size={13} onPress={() => open('flights')} testID="chat-flights-all" />
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
        <Card onPress={() => open('entry')} accessibilityLabel={card.entry.countryName}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{card.entry.countryName}</T>
          {card.entry.okText ? <T v="small">{card.entry.okText}</T> : null}
          {card.entry.checks.slice(0, 4).map((c, i) => <T key={i} v="tiny" color={colors.ink2}>{c.name ? `${c.name}: ${c.text}` : c.text}</T>)}
          <T v="small" color={colors.green} testID="chat-entry">{t('chat.entryGo')}</T>
        </Card>
      );
    case 'car':
      return (
        <Card onPress={() => open('car')} accessibilityLabel={t('chat.carGo')}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{[card.from, card.to].filter(Boolean).join(' → ') || card.city || t('now.car.title')}</T>
          <T v="small" color={colors.green} testID="chat-car">{t('chat.carGo')}</T>
        </Card>
      );
    case 'trips':
      return (
        <View style={{ gap: 8 }}>
          {card.trips.map((tr) => (
            <Pressable key={tr.id} accessibilityRole="button" onPress={() => onOpen({ kind: 'trip', id: tr.id })}>
              <Card><T v="small" style={{ fontFamily: ff.ui600 }}>{tr.city}</T><T v="tiny" color={colors.ink2}>{tr.travellerNames.join(', ')}</T></Card>
            </Pressable>
          ))}
        </View>
      );
    case 'request':
      return (
        <Card onPress={() => { buzz('tap'); onOpen({ kind: 'request', id: card.requestId }); }} accessibilityLabel={card.title}>
          <T v="small" style={{ fontFamily: ff.ui600 }}>{card.title}</T>
          {card.detail ? <T v="tiny" color={colors.ink2}>{card.detail}</T> : null}
          {card.promisedBy ? <T v="tiny" color={colors.ink2} testID="chat-request-by">{[t('chat.request.by', { time: timeLabel(card.promisedBy, { locale: getLocale() }) }), card.contact ? t(`chat.request.${card.contact}`) : null].filter(Boolean).join(' · ')}</T> : null}
          <T v="small" color={colors.green} testID="chat-request">{t('chat.request')}</T>
        </Card>
      );
    default:
      return null;
  }
}

const AVATAR = 28;
const AVATAR_GAP = 8;

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stamp: { textAlign: 'center', alignSelf: 'center', paddingTop: 4 },
  meWrap: { alignSelf: 'flex-end', maxWidth: '82%', alignItems: 'flex-end' },
  me: { backgroundColor: colors.green, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22, borderBottomEndRadius: 6 },
  madaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: AVATAR_GAP, maxWidth: '90%' },
  madaCol: { flexShrink: 1, gap: 4, alignItems: 'flex-start' },
  // Warm, not white: mist on the sand, the corner toward the mark kept small.
  bubble: { backgroundColor: colors.mist, borderWidth: 1, borderColor: colors.line, borderRadius: 20, borderTopStartRadius: 6, paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 5, paddingVertical: 6 },
  dot: { width: 7, height: 7, borderRadius: 999, backgroundColor: colors.ink3 },
  under: { marginStart: AVATAR + AVATAR_GAP, gap: 10 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
