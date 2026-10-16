import { useState } from 'react';
import { StaleBadge } from '@/components/states/StaleBadge';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { dayLabel, formatSar, rangeLong, type RefundView, type TripCard, type TripRequestView } from '@mada/shared';
import { ArtPaperPlane } from '@/components/art/Arts';
import { DepartureBoard } from '@/components/art/DepartureBoard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { TrackedFlights } from '@/components/today/Nothing';
import { RefundTracker } from '@/components/trips/RefundTracker';
import { orderNeedsYou, requestHref, RequestStatusPill, RequestTracker } from '@/components/trips/Requests';
import { useQueryClient } from '@tanstack/react-query';
import { bookingApi } from '@/lib/booking';
import { toast } from '@/lib/toast';
import { AgentIntro, Box, riseOn, riseStyle, Display, Eyebrow, Grow, H3, IdeaTiles, Photo, Row, Shade, Small, SmallButton, Spread, Tag, Tiny, type IdeaKey } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { listSep, t } from '@/lib/i18n';
import { OUTBOX_ASK, useTripOutbox, useTrips } from '@/lib/trips';
import { colors, font, radii, shadow, ff } from '@/theme';
import Animated from 'react-native-reanimated';

type Tab = 'upcoming' | 'requests' | 'past';
const IDEA_KEYS: IdeaKey[] = ['istanbul', 'alula', 'dubai', 'season'];
/** Three places that aren't already on the list: a trip to Istanbul doesn't get Istanbul suggested under it. */
const ideasBeside = (trips: TripCard[]) => IDEA_KEYS.filter((k) => !trips.some((c) => c.city.toLowerCase().includes(k))).slice(0, 3);

/** Trips (prototype Trips.jsx): Upcoming, Requests with live trackers, and Past with "Same again". */
export default function Trips() {
  const router = useRouter();
  const top = useTopInset();
  const params = useLocalSearchParams<{ tab?: string }>();
  const list = useTrips();
  const { data } = list;
  const queued = useTripOutbox();
  const [tab, setTab] = useState<Tab>(params.tab === 'requests' || params.tab === 'past' ? params.tab : 'upcoming');
  const [seenParam, setSeenParam] = useState(params.tab);
  if (seenParam !== params.tab) { setSeenParam(params.tab); if (params.tab === 'requests' || params.tab === 'past' || params.tab === 'upcoming') setTab(params.tab); }
  const open = (data?.requests ?? []).filter((r) => !['done', 'confirmed', 'cancelled'].includes(r.status)).length + queued.length;
  const ask = (prefill?: string) => router.push((prefill ? `/ask?prefill=${encodeURIComponent(prefill)}` : '/ask') as Href);

  return (
    <Screen>
      <Scroll top={top + 10}>
        <Spread>
          <T v="h1" style={{ fontSize: 34, lineHeight: 38 }} accessibilityRole="header">{t('trips.title')}</T>
          <Pressable accessibilityRole="button" accessibilityLabel={t('trips.empty.action')} onPress={() => { buzz('tap'); ask(); }} style={styles.plus}><Icon name="plus" color={colors.mist} /></Pressable>
        </Spread>
        <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
          {(['upcoming', 'requests', 'past'] as const).map((k) => (
            <Pressable key={k} testID={`tab-${k}`} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => { buzz('select'); setTab(k); }} style={[styles.seg, tab === k ? styles.segOn : null]}>
              <T style={font('h3', tab === k ? colors.mist : colors.green)}>{t(`trips.tab.${k}`)}{k === 'requests' && open ? ` · ${open}` : ''}</T>
            </Pressable>
          ))}
        </View>
        {list.isError && data ? <StaleBadge testID="trips-fresh" updatedAt={list.dataUpdatedAt || null} stale /> : null}
        {tab === 'upcoming' && <Upcoming trips={data?.upcoming ?? []} tracked={data?.tracked ?? []} ask={ask} />}
        {tab === 'requests' && <Requests requests={data?.requests ?? []} refunds={data?.refunds ?? []} ask={ask} />}
        {tab === 'past' && <Past trips={data?.past ?? []} refunds={data?.refunds ?? []} ask={ask} />}
      </Scroll>
    </Screen>
  );
}

function Upcoming({ trips, tracked, ask }: { trips: TripCard[]; tracked: Parameters<typeof TrackedFlights>[0]['flights']; ask: (p?: string) => void }) {
  const router = useRouter();
  if (!trips.length) return (<>
    <Animated.View entering={riseOn(0)} style={[riseStyle(0), styles.hero]}>
      <DepartureBoard onPick={(city) => ask(`Flights to ${city.charAt(0) + city.slice(1).toLowerCase()}`)} />
      <T style={font('displaySmall')}>{t('trips.empty.title')}</T>
      <Button label={t('trips.empty.action')} onPress={() => ask()} />
    </Animated.View>
    <T v="eyebrow">{t('trips.ideas.title')}</T>
    <IdeaTiles keys={ideasBeside([])} onAsk={ask} />
    {tracked.length ? <TrackedFlights flights={tracked} title={t('tr.tracking')} /> : null}
    <Imports />
  </>);
  return (<>
    {trips.map((c, i) => (
      <Animated.View key={c.id} entering={riseOn(i)} style={[riseStyle(i), styles.card, shadow('card')]}>
        <Pressable testID={`trip-card-${c.city}`} accessibilityRole="button" accessibilityLabel={t('tr.tripA11y', { city: c.city })} onPress={() => { buzz('tap'); router.push(`/trip/${c.id}` as Href); }}>
          <Photo k={c.imageUrl} style={{ height: 248, borderRadius: 0, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card }}>
            <Shade id={`trip-${c.id}`} />
            <View style={{ flex: 1, justifyContent: 'flex-end', padding: 16, gap: 4 }}>
              <Display size={36} color={colors.paper}>{c.city}</Display>
              <T v="small" color="rgba(255,253,249,0.9)">{rangeLong(c.startDate, c.endDate)} · {c.justYou ? t('tr.justYou') : c.travellerNames.join(listSep())}</T>
            </View>
          </Photo>
        </Pressable>
        <View style={styles.foot}>
          <Tiny style={{ flex: 1 }} lines={2}>{c.flight ? `${c.flight.code} · ${dayLabel(c.flight.date, { today: c.flight.date })} · ${c.flight.depart}${c.flight.oneWay ? ` · ${t('trip.oneWay')}` : ''}` : c.stayName ?? t('tr.booked')}</Tiny>
          <SmallButton testID="card-itinerary" tone="soft" icon="trips" label={t('tr.itinerary')} onPress={() => router.push(`/itinerary/${c.id}` as Href)} />
          <SmallButton testID="card-payments" tone="soft" icon="card" label={t('tr.payments')} onPress={() => router.push(`/trip/${c.id}/payments` as Href)} />
        </View>
      </Animated.View>
    ))}
    {tracked.length ? <TrackedFlights flights={tracked} title={t('tr.tracking')} /> : null}
    <Imports />
    {/* Under the trips, the next ones: the same places the empty board offers, minus the one already booked. */}
    <T v="eyebrow">{t('trips.ideas.title')}</T>
    <IdeaTiles keys={ideasBeside(trips)} onAsk={ask} />
  </>);
}

/** Booked somewhere else? Upload the confirmation: the Wallet's upload sheet keeps it with the passports. */
function Imports() {
  const router = useRouter();
  return (
    <Spread style={{ paddingHorizontal: 4 }}>
      <Small>{t('tr.import.title')}</Small>
      <SmallButton tone="paper" label={t('tr.import.upload')} onPress={() => router.push('/wallet?upload=booking' as Href)} testID="import-upload" />
    </Spread>
  );
}

function Requests({ requests, refunds, ask }: { requests: TripRequestView[]; refunds: RefundView[]; ask: (p?: string) => void }) {
  const router = useRouter();
  const queued = useTripOutbox();
  const shown = requests.filter((r) => r.area !== 'refund');
  if (!shown.length && !refunds.length && !queued.length) return (
    <EmptyState art={<ArtPaperPlane width={280} height={112} />} title={t('trips.requests.empty.title')}
      action={<Button label={t('tr.req.send')} onPress={() => ask()} />}
      ideas={(['visa', 'table', 'car', 'umrah'] as const).map((k) => [t(`trips.requests.idea.${k}`), () => ask(t(`trips.requests.idea.${k}`))] as [string, () => void])} />
  );
  const items = [
    ...refunds.map((r) => ({ type: 'refund' as const, at: r.createdAt, r })),
    ...shown.map((r) => ({ type: 'req' as const, at: r.createdAt, r })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (<>
    {queued.map((q) => (
      <Box key={q.id} testID="queued-request">
        <Spread align="flex-start"><H3>{q.kind === OUTBOX_ASK ? q.label : t('tr.req.queuedChoice')}</H3><Tag label={t('rq.queued')} /></Spread>
        <Tiny>{t('tr.req.savedPhone')}</Tiny>
      </Box>
    ))}
    {items.map((it, i) => it.type === 'refund' ? (
      <Animated.View key={it.r.id} entering={riseOn(i)} style={riseStyle(i)}>
        <Box testID="refund-card">
          <Spread><H3>{t('tr.refund', { amount: formatSar(it.r.amount.amount) })}</H3><Tag label={refundPill(it.r)} tone={it.r.stage === 'rejected' ? 'warn' : it.r.stage === 'sent' ? 'ok' : 'default'} /></Spread>
          <Small>{it.r.title}</Small>
          <RefundTracker r={it.r} onTalk={() => router.push('/support?topic=refund' as Href)} />
        </Box>
      </Animated.View>
    ) : (
      <Animated.View key={it.r.id} entering={riseOn(i)} style={riseStyle(i)}>
        <RequestCard r={it.r} />
      </Animated.View>
    ))}
  </>);
}

const refundPill = (r: RefundView) => (r.stage === 'rejected' ? t('tr.ref.notApproved') : r.anyway ? t('tr.ref.withMada') : r.destination === 'credit' ? t('tr.ref.inCredit') : r.stage === 'sent' ? t('tr.ref.sent') : t('tr.ref.onWay'));

function RequestCard({ r }: { r: TripRequestView }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [acting, setActing] = useState(false);
  const priced = (r.status === 'quoted' || r.status === 'awaiting_payment') && r.quote;
  const stuck = orderNeedsYou(r);
  const answer = async (a: 'retry_by_phone' | 'cancel') => {
    if (!stuck) return;
    setActing(true); buzz('tap');
    try { await bookingApi.answer(stuck.id, a); await qc.invalidateQueries({ queryKey: ['trips'] }); }
    catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setActing(false); }
  };
  return (
    <Box testID={`request-${r.kind}`}>
      <Spread align="flex-start">
        {/* Every request opens: a booking's order, the thread for an Ask request, the trip for a trip's own ask. */}
        <Pressable style={{ flex: 1 }} accessibilityRole="link" onPress={() => router.push(requestHref(r) as Href)} testID={r.kind === 'flight' ? 'open-flight-request' : `open-request-${r.kind}`}><H3>{r.title}</H3></Pressable>
        <RequestStatusPill r={r} />
      </Spread>
      {r.detail ? <Small>{r.detail}</Small> : null}
      {stuck ? (
        <Box tone="well" gap={8} testID="request-order-stuck">
          <AgentIntro />
          <Small color={colors.green}>{stuck.status === 'ticketing_failed' ? (stuck.failure === 'payment' ? t('rq.order.failedPayment') : t('rq.order.failedBody')) : t('rq.order.answerBody')}</Small>
          {stuck.status === 'ticketing_failed' ? (
            <Row gap={8} style={{ flexWrap: 'wrap' }}>
              <SmallButton testID="order-retry-phone" tone="primary" busy={acting} label={t('wait.ticket.phone')} onPress={() => void answer('retry_by_phone')} />
              <SmallButton testID="order-cancel" tone="paper" disabled={acting} label={t('wait.ticket.cancel')} onPress={() => void answer('cancel')} />
            </Row>
          ) : <SmallButton testID="order-open" tone="primary" label={t('rq.order.open')} onPress={() => router.push(requestHref(r) as Href)} />}
        </Box>
      ) : null}
      <RequestTracker r={r} />
      {r.outcome === 'yes' && (r.status === 'confirmed' || r.status === 'done') ? <Row gap={6}><Icon name="check" size={14} color={colors.ok} width={2.4} /><Tiny>{r.yesText ?? t('tr.req.confirmedToday')}</Tiny></Row> : null}
      {r.outcome === 'no' ? (
        <Box tone="well" gap={8}>
          <AgentIntro />
          <Small color={colors.green}>{r.alt ?? t('tr.req.cantDefault')}</Small>
          <SmallButton tone="primary" label={t('action.talk')} onPress={() => router.push('/support' as Href)} />
        </Box>
      ) : null}
      {priced ? (
        <Box tone="well" gap={8}>
          <AgentIntro />
          {r.quoteText ? <Small color={colors.green}>{r.quoteText}</Small> : null}
          {r.kind === 'flight'
            // Flights by request: several fares to choose from, so the request opens with them.
            ? <SmallButton testID="see-fares" tone="primary" label={t('beta.fq.see')} onPress={() => router.push(`/ask/request/${r.id}` as Href)} />
            : <SmallButton testID="pay-quote" tone="primary" label={t('tr.req.pay', { amount: formatSar(r.quote!.amount) })} onPress={() => router.push(`/pay?requestId=${r.id}` as Href)} />}
        </Box>
      ) : null}
    </Box>
  );
}

function Past({ trips, refunds, ask }: { trips: TripCard[]; refunds: RefundView[]; ask: (p?: string) => void }) {
  const router = useRouter();
  const [only, setOnly] = useState<'all' | 'cancelled'>('all');
  const cancelled = trips.filter((p) => p.status === 'cancelled');
  const shown = only === 'cancelled' ? cancelled : trips;
  if (!trips.length) return (
    <Animated.View entering={riseOn(0)} style={[riseStyle(0), styles.hero]}>
      <View style={styles.ppEmpty}>
        <T style={styles.ppTitle}>{t('trips.past.page')}</T>
        {([[18, 22, -12], [62, 16, 8], [28, 60, 6], [70, 58, -6]] as const).map(([x, y, r], k) => (
          <View key={k} style={[styles.slot, { start: `${x}%`, top: `${y}%`, transform: [{ rotate: `${r}deg` }] }, k === 0 ? styles.slotFirst : null]}>
            {k === 0 ? <T style={[font('display', colors.goldInk), { fontSize: 14, lineHeight: 14, textAlign: 'center', textTransform: 'uppercase', width: 52 }]}>{t('trips.past.first')}</T> : null}
          </View>
        ))}
      </View>
      <T style={font('displaySmall')}>{t('trips.past.empty.title')}</T>
      <Button label={t('trips.past.empty.action')} onPress={() => ask()} />
    </Animated.View>
  );
  return (<>
    {/* A trip you paid for never disappears: cancelled ones sit here with their refund, and a chip to see just those. */}
    {cancelled.length ? (
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
        {(['all', 'cancelled'] as const).map((k) => (
          <Pressable key={k} testID={`past-chip-${k}`} accessibilityRole="tab" accessibilityState={{ selected: only === k }} onPress={() => { buzz('select'); setOnly(k); }} style={[styles.chip, only === k ? styles.chipOn : null]}>
            <T style={font('small', only === k ? colors.mist : colors.green)}>{k === 'all' ? t('tr.past.all') : t('tr.past.cancelled')}{k === 'cancelled' ? ` · ${cancelled.length}` : ''}</T>
          </Pressable>
        ))}
      </View>
    ) : null}
    {shown.map((p) => {
      const gone = p.status === 'cancelled';
      const refund = gone ? refunds.filter((r) => r.tripId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null : null;
      return (
        <Box key={p.id} testID={`past-${p.city}`}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('tr.tripA11y', { city: p.city })} onPress={() => { buzz('tap'); router.push(`/trip/${p.id}` as Href); }} testID={gone ? `past-open-${p.city}` : undefined}>
            <Spread><Row gap={8}><H3>{p.city}</H3>{gone ? <Tag tone="warn" label={t('tr.past.cancelled')} /> : null}</Row><Tiny>{rangeLong(p.startDate, p.endDate)}</Tiny></Spread>
            {p.note ? <Small>{p.note}</Small> : <Small>{p.justYou ? t('tr.justYou') : p.travellerNames.join(listSep())}</Small>}
          </Pressable>
          {gone ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} testID="past-refund-line">
              <Small style={{ flex: 1 }} color={colors.green}>{refund ? t('tr.past.refund', { amount: formatSar(refund.amount.amount), status: refundPill(refund).toLowerCase() }) : t('tr.past.noRefund')}</Small>
              {refund ? <SmallButton tone="soft" icon="refund" label={t('tr.past.seeRefund')} onPress={() => router.push('/trips?tab=requests' as Href)} testID="past-see-refund" />
                : <SmallButton tone="soft" label={t('action.talk')} onPress={() => router.push('/support?topic=refund' as Href)} />}
              <SmallButton tone="paper" icon="card" label={t('tr.payments')} onPress={() => router.push(`/trip/${p.id}/payments` as Href)} />
            </View>
          ) : <SmallButton tone="soft" label={t('tr.sameAgain')} onPress={() => ask(t('tr.sameAgainAsk', { city: p.city, when: (p.when ?? t('td.lastTime')).toLowerCase() }))} />}
        </Box>
      );
    })}
  </>);
}

const styles = StyleSheet.create({
  plus: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  seg: { height: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  segOn: { backgroundColor: colors.green },
  chip: { height: 34, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.paper, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.green },
  hero: { gap: 16, paddingTop: 4 },
  card: { backgroundColor: colors.paper, borderRadius: radii.card, overflow: 'hidden' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingStart: 16, paddingEnd: 10 },
  ppEmpty: { height: 210, borderRadius: 18, backgroundColor: '#f6ecd8', borderWidth: 1, borderColor: 'rgba(125,93,39,0.15)', overflow: 'hidden' },
  ppTitle: { position: 'absolute', top: 10, start: 14, textTransform: 'uppercase', fontSize: 9, letterSpacing: 1.8, color: colors.goldDeep, fontFamily: ff.ui700 },
  slot: { position: 'absolute', width: 74, height: 74, borderRadius: 999, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(125,93,39,0.3)', alignItems: 'center', justifyContent: 'center' },
  slotFirst: { borderColor: colors.goldDeep },
});

void Eyebrow;
void Grow;
