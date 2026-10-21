import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatSar, timeLabel, type ChatCard, type ChatPay } from '@mada/shared';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { LinkButton } from '@/components/Button';
import { T } from '@/components/Text';
import { AirlineMark } from './AirlineMark';
import { MadaSays, MeBubble } from './Conversation';
import { StayCard } from './StayCard';
import { PlanCard } from '../esim/look';
import { enter } from './parts';
import type { ChatTurn } from '@/lib/ask-chat';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { DemoFare } from './DemoFare';
import { colors, ff } from '@/theme';

/*
 * Ask as a conversation: what the traveller said, Mada's words as they arrive (with what is being done while a tool
 * runs), then the cards, the same ones the flows draw, each opening the full flow for the same search. The line at the
 * top says plainly that these answers are instant and a person confirms the booking (COPY.md §6.3).
 */

export type ChatOpen =
  | { kind: 'flights' | 'stays' | 'esim' | 'entry' | 'car'; card: ChatCard; turn: ChatTurn }
  | { kind: 'pay'; pay: ChatPay }
  | { kind: 'handoff'; threadId: string }
  | { kind: 'request'; id: string }
  | { kind: 'trip'; id: string };

export function ChatThread({ turns, onOpen, onSay }: { turns: ChatTurn[]; onOpen: (o: ChatOpen) => void; onSay?: (text: string) => void }) {
  if (!turns.length) return null;
  return (
    <View style={{ gap: 16 }} testID="chat-thread">
      <T v="tiny" color={colors.muted} testID="chat-disclosure">{t('chat.disclosure')}</T>
      {turns.map((turn, i) => <Turn key={turn.id} turn={turn} onOpen={onOpen} onSay={i === turns.length - 1 ? onSay : undefined} />)}
    </View>
  );
}

function Turn({ turn, onOpen, onSay }: { turn: ChatTurn; onOpen: (o: ChatOpen) => void; onSay?: (text: string) => void }) {
  const writing = turn.state === 'streaming';
  return (
    <View style={{ gap: 12 }} testID={`chat-turn-${turn.id}`}>
      <MeBubble text={turn.me} testID="chat-me" />
      {turn.text || writing ? (
        <MadaSays small>
          {turn.text ? <T v="body" color={colors.green} testID="chat-text" accessibilityLiveRegion="polite">{turn.text}</T> : null}
          {writing ? <Typing status={turn.status} /> : null}
        </MadaSays>
      ) : null}
      {turn.cards.map((c, i) => <CardFor key={`${c.type}-${i}`} card={c} turn={turn} onOpen={onOpen} />)}
      {turn.pay ? (
        <Animated.View entering={enter(0)}>
          <Card onPress={() => { buzz('tap'); onOpen({ kind: 'pay', pay: turn.pay! }); }} accessibilityLabel={`${t('chat.pay')}, ${turn.pay.title}`}>
            <T v="small" style={{ fontFamily: ff.ui600 }}>{turn.pay.title}</T>
            <T v="small" color={colors.green} testID="chat-pay">{t('chat.pay')}</T>
          </Card>
        </Animated.View>
      ) : null}
      {turn.handoff ? <LinkButton label={t('chat.openThread')} size={14} onPress={() => onOpen({ kind: 'handoff', threadId: turn.handoff!.threadId })} testID="chat-handoff" /> : null}
      {/* The next step, on the latest reply only: every reply ends with one (docs/app/ASSISTANT.md). */}
      {onSay && turn.state === 'done' && turn.next?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }} testID="chat-next">
          {turn.next.map((c) => <Chip key={c} label={c} onPress={() => { buzz('tap'); onSay(c); }} testID="chat-next-chip" />)}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** "Mada is writing", or what is being done right now. Words only: no dots that pretend to be a person. */
function Typing({ status }: { status: string | null }) {
  return <T v="small" color={colors.muted} testID="chat-typing" accessibilityLiveRegion="polite">{status ? `${status}…` : `${t('chat.working')}…`}</T>;
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

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
