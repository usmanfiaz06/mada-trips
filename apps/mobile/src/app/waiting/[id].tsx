import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import Svg, { G, Line } from 'react-native-svg';
import { useQueryClient } from '@tanstack/react-query';
import { dayLabel, dueLabel, formatSar, ON_IT_MINUTES, todayIn, DESK_PHONE, type OrderView } from '@mada/shared';
import { OutcomeCard } from '@/components/outcome/Outcome';
import { Button } from '@/components/Button';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Screen, useBottomInset, useTopInset } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { Photo, useNow, enter } from '@/components/booking/parts';
import { bookingApi, bookingKeys, finishInBackground, stopWatching, useOrder, usePayDraft } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, listSep, t, tn } from '@/lib/i18n';
import { useUpdateMe } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { colors, font, ff } from '@/theme';
import { askNotifications } from '@/lib/notify-permission';

/*
 * With Mada (Pay.jsx Waiting): live steps while the desk holds the seats, locks the price and issues the tickets, polled
 * from GET /orders/{id}. The person on duty comes from the server. A question, a fare that went, tickets that didn't
 * issue, a slow airline. Close and it finishes in the background. Then the confirmation.
 */

const NUM = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const elapsedLabel = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const FROM: Record<string, string> = { RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam' };

const hotelOf = (o: OrderView) => o.lines.find((l) => l.icon === 'stay')?.text.split(' · ')[0] ?? null;

function rowsOf(o: OrderView): [string, string, string][] {
  const n = Math.max(1, o.travellerIds.length);
  const nWord = (NUM[n] ?? String(n)).toLowerCase();
  const seats = o.seats.join(listSep());
  const price = t('wait.row.priceDetail', { price: formatSar(o.total.amount + o.extra.amount) });
  // The hotel by name, from the order's stay line ("Bereketzade Hotel · Connecting rooms · 6 nights").
  const hotel = hotelOf(o);
  if (o.kind === 'stay') return [[hotel ? t('hn.wait.asking', { hotel }) : t('wait.row.hotel'), hotel ? t('hn.wait.said', { hotel }) : t('wait.row.hotelDone'), hotel ? t('hn.wait.detail', { hotel }) : t('wait.row.hotelDetail')], [t('wait.row.price'), t('wait.row.priceDone'), price], [t('wait.row.rooms'), t('wait.row.roomsDone'), t('wait.row.roomsDetail')]];
  if (o.kind === 'package') return [[t('wait.row.price'), t('wait.row.priceDone'), price], [t('wait.row.rooms'), t('wait.row.roomsDone'), t('wait.row.hotelDetail')], [t('wait.row.tours'), t('wait.row.toursDone'), t('wait.row.toursDetail')]];
  return [
    [tn('wait.row.seats', n, { count: nWord }), tn('wait.row.seatsDone', n, { count: nWord }), `${tn('wait.row.seatsDetail', n, { seats })}${o.cabin && o.cabin !== 'economy' ? `, ${o.cabin}` : ''}`],
    [t('wait.row.price'), t('wait.row.priceDone'), price],
    [tn('wait.row.issue', n, { count: n }), tn('wait.row.issueDone', n, { count: n }), t('wait.row.issueDetail', { flight: o.flightNumber ?? '' })],
  ];
}

export default function Waiting() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useOrder(String(id ?? ''));
  const o = q.data;
  const top = useTopInset();
  const bottom = useBottomInset();
  const now = useNow(1000);
  const qc = useQueryClient();
  const [acting, setActing] = useState(false);
  const [answered, setAnswered] = useState(false);
  const knocked = useRef(false);
  const confirmedBuzz = useRef(false);
  useEffect(() => { if (!knocked.current) { knocked.current = true; buzz('knock'); } }, []);
  useEffect(() => { if (o?.status === 'confirmed' && !confirmedBuzz.current) { confirmedBuzz.current = true; buzz('success'); stopWatching(o.id); usePayDraft.getState().clear(); void qc.invalidateQueries({ queryKey: ['trips'] }); } }, [o?.status, o?.id, qc]);
  useEffect(() => { if (o?.status === 'fare_changed' || o?.status === 'ticketing_failed' || o?.status === 'needs_answer') buzz('warn'); }, [o?.status]);
  // A booking that won't go ahead stays on screen with its outcome (why, the money, what next); an older server sends none.
  useEffect(() => { if (o?.status === 'cancelled' && !o.result) { toast(t('wait.cancelled')); router.replace('/today'); } }, [o?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Never a blank dark screen while the first answer comes: say what's happening at once.
  if (!o) return <WaitingFirst error={q.isError && !q.isFetching} onRetry={() => void q.refetch()} onClose={() => router.replace('/today')} />;
  if (o.status === 'confirmed') return <Confirmed o={o} />;
  if ((o.status === 'cancelled' || o.status === 'declined') && o.result) return <Ended o={o} />;

  const act = async (answer: Parameters<typeof bookingApi.answer>[1]) => {
    setActing(true); buzz('tap');
    try { const r = await bookingApi.answer(o.id, answer); qc.setQueryData(bookingKeys.order(o.id), r.order); if (answer === 'yes') setAnswered(true); }
    catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setActing(false); }
  };
  // Waiting on the traveller (tickets that didn't issue, a new fare, a question): nothing is "finishing" until they
  // answer, so no "we'll tell you" toast. Today and Trips keep the booking with its actions.
  const close = () => { if (!['ticketing_failed', 'fare_changed', 'needs_answer', 'payment_requested'].includes(o.status)) finishInBackground(o.id); router.replace('/today'); };
  const rows = rowsOf(o);
  const agent = o.agent?.name ?? 'Mada';
  const withWhom = o.kind === 'stay' ? t('wait.with.hotel') : o.kind === 'package' ? t('wait.with.guides') : o.airline ?? t('wait.with.airline');
  const live = o.status === 'payment_requested' ? t('mp.status', { name: o.payRequest?.name ?? '' }) : o.status === 'needs_answer' ? t('wait.live.question', { agent }) : o.step >= 3 ? t('wait.live.almost') : t('wait.live.line', { agent, with: withWhom });
  const elapsed = Math.max(0, Math.floor((now - Date.parse(o.createdAt)) / 1000));
  const today = todayIn();
  const sub = o.depart && o.departTime ? t(o.oneway ? 'wait.subOneWay' : 'wait.sub', { day: dayLabel(o.depart, { today }), time: o.departTime, from: FROM[o.from ?? ''] ?? o.from ?? '' })
    : o.lines[0]?.text.split(' · ').slice(1).join(' · ') ?? '';
  const step = o.status === 'pending_agent' ? 0 : o.step;
  const q2 = o.question;
  const pr = o.status === 'payment_requested' ? o.payRequest : null;

  return (
    <Screen background={colors.night}>
      <Photo name={o.photo} />
      <VGradient id="wait-veil" stops={[[0, 'rgba(15,26,22,0.55)'], [0.24, 'rgba(15,26,22,0.05)'], [0.42, 'rgba(15,26,22,0.2)'], [0.66, 'rgba(15,26,22,0.92)'], [1, '#0f1a16']]} />
      <View style={[styles.top, { marginTop: top + 14 }]}>
        <View style={styles.agent}>
          <View>
            <View style={styles.avatar}><T style={[font('h3', colors.sand), { fontSize: 13 }]}>{agent.charAt(0)}</T></View>
            <View style={styles.dot} />
          </View>
          <View>
            <T style={[font('h3', colors.paper), { fontSize: 14 }]}>{t('wait.title')}</T>
            <Animated.View key={live} entering={FadeIn.duration(400)}><T style={{ fontFamily: ff.ui400, fontSize: 13, color: 'rgba(255,253,249,0.75)' }}>{live} ···</T></Animated.View>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={styles.clock} accessibilityLabel={t('wait.a11y.time')}><T style={styles.clockText}>{elapsedLabel(elapsed)}</T></View>
          <Pressable accessibilityRole="button" onPress={close} style={styles.clock} testID="wait-close"><T style={[styles.clockText, { fontFamily: ff.ui600 }]}>{t('wait.close')}</T></Pressable>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={styles.hero}>
        <T style={[font('eyebrow', colors.gold)]}>{t('wait.eyebrow')}</T>
        <T style={[font('displayXL', colors.paper), { fontSize: 52, lineHeight: 50 }]} accessibilityRole="header">{o.place}<T style={[font('displayXL', colors.gold), { fontSize: 52 }]}>.</T></T>
        <T style={{ fontFamily: ff.ui400, fontSize: 15, color: 'rgba(255,253,249,0.82)' }}>{sub}</T>
      </View>
      <View style={[styles.panel, { marginBottom: 24 + bottom }]} accessibilityLiveRegion="polite">
        {pr ? (
          <Animated.View entering={enter(0)} style={styles.q} testID="wait-pay-request">
            <T style={styles.qHead}>{t('mp.waiting.title', { name: pr.name })}</T>
            <T style={styles.qBody}>{t('mp.waiting.body', { name: pr.name })}</T>
            <T style={[styles.qHead, { color: '#e6c88f' }]}>{formatSar(o.total.amount)}</T>
            <View style={styles.btns}>
              <Button size="small" block={false} variant="gold" busy={acting} label={t('mp.remind', { name: pr.name })} onPress={async () => { await act('remind'); toast(t('mp.reminded', { name: pr.name })); }} testID="pay-request-remind" />
              <Button size="small" block={false} variant="glass" label={t('mp.payMyself')} onPress={async () => { await act('cancel'); router.replace('/pay'); }} />
              <Button size="small" block={false} variant="glass" label={t('mp.cancel')} onPress={() => act('cancel')} />
            </View>
          </Animated.View>
        ) : null}
        {rows.map(([doing, doneLabel, detail], i) => {
          const state = i < step ? 'done' : i === step ? 'now' : 'todo';
          return (
            <View key={i} style={[styles.row, state === 'todo' ? { opacity: 0.38 } : null]}>
              <View style={[styles.mark, state === 'done' ? styles.markDone : state === 'now' ? { borderColor: colors.gold } : null]}>
                {state === 'done' ? <Animated.View entering={ZoomIn.duration(300)}><Icon name="check" size={14} color={colors.green} width={2.4} /></Animated.View> : state === 'now' ? <View style={styles.nowDot} /> : null}
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <T style={[font('h3', state === 'now' ? colors.gold : colors.paper), { fontSize: 15 }]}>{state === 'done' ? doneLabel : doing}</T>
                {state === 'done' ? <Animated.View entering={enter(0)}><T style={styles.doneText}>{detail}</T></Animated.View> : null}
              </View>
            </View>
          );
        })}
        {o.status === 'fare_changed' && o.fareChange ? (
          <Animated.View entering={enter(0)} style={styles.q}>
            <T style={styles.qHead}>{t('wait.says', { agent })}</T>
            <T style={styles.qBody}>{t('wait.fare.text', { airline: o.airline ?? '', each: formatSar(o.fareChange.perPerson.amount), total: formatSar(o.fareChange.total.amount) })}</T>
            <View style={styles.btns}>
              <Button size="small" block={false} variant="gold" busy={acting} label={t('wait.fare.accept', { price: formatSar(o.fareChange.newTotal.amount) })} onPress={() => act('accept_fare')} testID="fare-accept" />
              <Button size="small" block={false} variant="glass" label={t('wait.fare.other')} onPress={async () => { await act('stop'); router.replace({ pathname: '/ask', params: { prefill: `Flights to ${o.place}` } }); }} />
              <Button size="small" block={false} variant="glass" label={t('wait.fare.stop')} onPress={() => act('stop')} />
            </View>
          </Animated.View>
        ) : null}
        {o.status === 'ticketing_failed' ? (
          <Animated.View entering={enter(0)} style={styles.q}>
            <T style={styles.qHead}>{o.failure?.cause === 'payment' ? t('wait.ticket.title.payment') : t('wait.ticket.title')}</T>
            <T style={styles.qBody}>{o.failure?.cause === 'payment' ? t('wait.ticket.text.payment') : t('wait.ticket.text', { airline: o.airline ?? '' })}</T>
            <View style={styles.btns}>
              {!o.failure || o.failure.actions.includes('retry_by_phone') ? <Button size="small" block={false} variant="gold" busy={acting} label={t('wait.ticket.phone')} onPress={() => act('retry_by_phone')} testID="ticket-retry" /> : null}
              {!o.failure || o.failure.actions.includes('cancel') ? <Button size="small" block={false} variant="glass" label={t('wait.ticket.cancel')} onPress={() => act('cancel')} /> : null}
            </View>
            <T style={[styles.doneText, { fontSize: 12 }]}>{t('wait.ticket.note')}</T>
          </Animated.View>
        ) : null}
        {o.slow && !q2 ? <Animated.View entering={enter(0)}><T style={{ fontFamily: ff.ui400, fontSize: 13, lineHeight: 18, color: '#e6c88f' }}>{t('wait.slow', { airline: o.airline ?? withWhom })}</T></Animated.View> : null}
        {q2 || answered ? (
          <Animated.View entering={enter(0)} style={styles.q}>
            <T style={styles.qHead}>{t('wait.asks', { agent })}</T>
            {q2 ? <T style={styles.qBody}>{q2.text}</T> : null}
            {q2?.calling ? <T style={[styles.qHead, { color: '#e6c88f' }]}>{t('wait.question.calling', { agent })}</T>
              : !q2 ? <T style={[styles.qHead, { color: '#9fd3b0' }]}>{t('wait.question.thanks')}</T> : (
                <View style={styles.btns}>
                  <Button size="small" block={false} variant="gold" busy={acting} label={t('wait.question.yes')} onPress={() => act('yes')} testID="question-yes" />
                  <Button size="small" block={false} variant="glass" label={t('wait.question.call')} onPress={() => act('call')} />
                </View>
              )}
          </Animated.View>
        ) : null}
        <ByWhen o={o} now={now} />
        <T style={styles.note}>{t('wait.note')}</T>
      </View>
    </Screen>
  );
}

/** Before the order's first answer: the sun, what's happening, and after a while that it's safe to close. */
function WaitingFirst({ error, onRetry, onClose }: { error: boolean; onRetry: () => void; onClose: () => void }) {
  const top = useTopInset();
  const [slow, setSlow] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSlow(true), 6000); return () => clearTimeout(id); }, []);
  return (
    <Screen background={colors.night}>
      <View style={[styles.top, { marginTop: top + 14, justifyContent: 'flex-end' }]}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.clock} testID="wait-close"><T style={[styles.clockText, { fontFamily: ff.ui600 }]}>{t('wait.close')}</T></Pressable>
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 32 }} accessibilityLiveRegion="polite" testID="waiting-first">
        <Sun width={72} color={colors.gold} />
        {error ? (
          <>
            <T style={[font('h3', colors.paper), { textAlign: 'center' }]}>{t('error.timeout')}</T>
            <Button size="small" block={false} variant="gold" label={t('common.tryAgain')} onPress={onRetry} />
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={colors.gold} />
              <T style={[font('h3', colors.paper), { fontSize: 16 }]}>{t('wait.loading')}</T>
            </View>
            {slow ? <T style={{ fontFamily: ff.ui400, fontSize: 13, lineHeight: 18, color: 'rgba(255,253,249,0.75)', textAlign: 'center' }}>{t('wait.loadingSlow')}</T> : null}
          </>
        )}
      </View>
    </Screen>
  );
}

/** By when, always: Mada's usual time for a booking; once it passes, said plainly, with a call. */
function ByWhen({ o, now }: { o: OrderView; now: number }) {
  if (!['pending_agent', 'held', 'price_locked', 'issuing'].includes(o.status)) return null;
  const due = new Date(Date.parse(o.createdAt) + ON_IT_MINUTES.order * 60_000).toISOString();
  const time = dueLabel(due, { locale: getLocale() });
  if (now <= Date.parse(due)) return <T style={styles.doneText} testID="wait-by">{t('oi.by.usual', { time })}</T>;
  return (
    <View style={{ gap: 8 }} testID="wait-late">
      <T style={[styles.doneText, { color: '#e6c88f' }]}>{t('oi.late', { time })}</T>
      <View style={styles.btns}><Button size="small" block={false} variant="glass" label={t('oi.call')} onPress={() => { void Linking.openURL(`tel:${DESK_PHONE.replace(/\s/g, '')}`).catch(() => {}); }} /></View>
    </View>
  );
}

/** A booking that won't go ahead: what happened, the money, and the way on. Never a toast and a jump to Today. */
function Ended({ o }: { o: OrderView }) {
  const router = useRouter();
  const top = useTopInset();
  const bottom = useBottomInset();
  return (
    <Screen background={colors.sand}>
      <View style={{ paddingTop: top + 56, paddingHorizontal: 24, gap: 18, flex: 1 }} testID="wait-ended">
        <T style={[font('eyebrow', colors.goldDeep)]}>{o.place}</T>
        <OutcomeCard result={o.result!} tripId={o.tripId} again={o.place ? t(o.kind === 'stay' ? 'oc.again.stay' : 'oc.again.flight', { place: o.place }) : null} testID="order-outcome" />
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 28 + bottom }}>
        <Button variant="ghost" label={t('done.done')} onPress={() => router.replace('/today')} testID="wait-ended-close" />
      </View>
    </Screen>
  );
}

function Confirmed({ o }: { o: OrderView }) {
  const router = useRouter();
  const top = useTopInset();
  const bottom = useBottomInset();
  const user = useSession((s) => s.user);
  const updateMe = useUpdateMe();
  const agent = o.confirmedBy?.name ?? o.agent?.name ?? 'Mada';
  const hotel = hotelOf(o);
  const title = o.kind === 'stay' ? (hotel ? t('hn.done.rooms', { hotel }) : t('done.rooms')) : t('done.going', { city: o.place });
  const pills = [
    o.kind !== 'stay' ? t('done.tickets') : null,
    o.bundle || o.kind === 'stay' ? t('done.roomsBooked') : null,
    o.plan === 'tabby' ? t('done.tabby') : o.plan === 'tamara' ? t('done.tamara') : t('done.paidWith', { card: o.paymentLabel }),
    o.creditUsed.amount > 0 ? t('done.credit', { price: formatSar(o.creditUsed.amount) }) : null,
    t('done.invoice'),
    o.kind === 'trip' ? t('done.watching') : null,
  ].filter((x): x is string => !!x);
  const [alerts, setAlerts] = useState(user?.notifications ?? 'unknown');
  return (
    <Screen background={colors.sand}>
      <View style={[StyleSheet.absoluteFill]} pointerEvents="none">
        <VGradient id="done-glow" stops={[[0, 'rgba(217,183,122,0.38)'], [0.55, 'rgba(233,226,216,0)']]} />
      </View>
      <View style={{ height: 300, alignItems: 'center', justifyContent: 'center', marginTop: 40 + top }}>
        <Animated.View entering={ZoomIn.duration(900)} style={{ position: 'absolute' }}>
          <Svg width={260} height={260} viewBox="-130 -130 260 260">
            <G stroke={colors.gold} strokeWidth={5} strokeLinecap="round">
              {Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return <Line key={i} x1={Math.cos(a) * 62} y1={Math.sin(a) * 62} x2={Math.cos(a) * 112} y2={Math.sin(a) * 112} />; })}
            </G>
          </Svg>
        </Animated.View>
        <Animated.View entering={ZoomIn.duration(700).delay(150)}><Sun width={120} color={colors.goldDeep} /></Animated.View>
      </View>
      <View style={{ paddingHorizontal: 32, gap: 14 }}>
        <Animated.View entering={FadeInDown.duration(500).delay(100)}><T style={[font('display'), { fontSize: 46, lineHeight: 48 }]} accessibilityRole="header">{title}</T></Animated.View>
        <Animated.View entering={FadeInDown.duration(500).delay(160)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.avatar, { width: 32, height: 32 }]}><T style={[font('h3', colors.sand), { fontSize: 13 }]}>{agent.charAt(0)}</T></View>
          <T v="small" style={{ flex: 1 }}>{t('actor.confirmed', { agent })}{o.flightNumber ? ` · ${o.flightNumber}` : ''} · <T v="small" color={colors.green} style={{ fontFamily: ff.ui700, letterSpacing: 0.6 }} selectable>{o.ref}</T></T>
        </Animated.View>
        <Animated.View entering={FadeInDown.duration(500).delay(220)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {pills.map((p) => <View key={p} style={styles.pill}><T v="caption" color={colors.green} style={{ fontFamily: ff.ui600 }}>{p}</T></View>)}
        </Animated.View>
        {alerts === 'unknown' && o.kind !== 'stay' ? (
          <View style={styles.card}>
            <T v="h3" style={{ fontSize: 15 }}>{t('done.alerts.title')}</T>
            <T v="small">{t('done.alerts.body')}</T>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button size="small" block={false} label={t('done.alerts.allow')} onPress={async () => { const choice = await askNotifications().catch(() => 'declined' as const); setAlerts(choice); if (choice === 'allowed') buzz('success'); updateMe.mutate({ notifications: choice }); }} />
              <Button size="small" block={false} variant="ghost" label={t('common.notNow')} onPress={() => { setAlerts('declined'); updateMe.mutate({ notifications: 'declined' }); }} />
            </View>
          </View>
        ) : alerts === 'allowed' ? <T v="small" color={colors.ok} style={{ fontFamily: ff.ui600 }}>{t('done.alerts.on')}</T> : null}
      </View>
      <View style={{ position: 'absolute', start: 20, end: 20, bottom: 28 + bottom }}>
        <Button label={o.kind === 'trip' || o.kind === 'stay' ? t('done.seeTrip') : t('done.done')} testID="see-trip"
          onPress={() => (o.tripId ? router.replace({ pathname: '/trip/[id]', params: { id: o.tripId } }) : router.replace(o.kind === 'package' || o.kind === 'trip' || o.kind === 'stay' ? '/trips' : '/today'))} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { marginHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 },
  agent: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingStart: 6, paddingEnd: 14, borderRadius: 999, backgroundColor: 'rgba(15,26,22,0.5)', borderWidth: 1, borderColor: 'rgba(255,253,249,0.16)' },
  avatar: { width: 30, height: 30, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', end: -2, bottom: -2, width: 11, height: 11, borderRadius: 99, backgroundColor: colors.live, borderWidth: 2, borderColor: colors.green },
  clock: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(15,26,22,0.5)', borderWidth: 1, borderColor: 'rgba(255,253,249,0.16)' },
  clockText: { fontFamily: ff.ui500, fontSize: 13, color: colors.paper, fontVariant: ['tabular-nums'] },
  hero: { paddingHorizontal: 24, paddingBottom: 18, gap: 6 },
  panel: { marginHorizontal: 16, padding: 18, borderRadius: 26, backgroundColor: 'rgba(255,253,249,0.08)', borderWidth: 1, borderColor: 'rgba(255,253,249,0.12)', gap: 14 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  mark: { width: 22, height: 22, borderRadius: 99, borderWidth: 1.5, borderColor: 'rgba(255,253,249,0.35)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  markDone: { backgroundColor: colors.gold, borderColor: colors.gold },
  nowDot: { width: 8, height: 8, borderRadius: 9, backgroundColor: colors.gold },
  doneText: { fontFamily: ff.ui400, fontSize: 13, color: 'rgba(255,253,249,0.7)' },
  q: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: 'rgba(15,26,22,0.55)', borderWidth: 1, borderColor: 'rgba(217,183,122,0.4)' },
  qHead: { fontFamily: ff.ui600, fontSize: 13, color: colors.gold },
  qBody: { fontFamily: ff.ui400, fontSize: 16, lineHeight: 23, color: colors.paper },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { fontFamily: ff.ui400, fontSize: 12, lineHeight: 16, color: 'rgba(255,253,249,0.55)', borderTopWidth: 1, borderColor: 'rgba(255,253,249,0.1)', paddingTop: 12 },
  pill: { height: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.paper, justifyContent: 'center' },
  card: { gap: 10, padding: 16, borderRadius: 24, backgroundColor: colors.paper },
});
