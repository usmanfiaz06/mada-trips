import { useState } from 'react';
import { StaleBadge } from '@/components/states/StaleBadge';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { dayLabel, formatSar, rangeLong, type RefundView, type TripCard, type TripRequestView } from '@mada/shared';
import { ArtPaperPlane } from '@/components/art/Arts';
import { DepartureBoard } from '@/components/art/DepartureBoard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { VGradient } from '@/components/Gradient';
import { Icon } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { TrackedFlights } from '@/components/today/Nothing';
import { RefundTracker } from '@/components/trips/RefundTracker';
import { RequestStatusPill, RequestTracker } from '@/components/trips/Requests';
import { AgentIntro, Box, riseOn, riseStyle, Display, Eyebrow, Grow, H3, Photo, Row, Shade, Small, SmallButton, Spread, Tag, Tiny } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { OUTBOX_ASK, useTripOutbox, useTrips } from '@/lib/trips';
import { colors, font, radii, shadow, ff } from '@/theme';
import Animated from 'react-native-reanimated';

type Tab = 'upcoming' | 'requests' | 'past';
const IDEAS = [
  { img: require('../../../assets/images/istanbul.jpg'), key: 'istanbul', ask: 'Flights to Istanbul' },
  { img: require('../../../assets/images/alula.jpg'), key: 'alula', ask: 'A weekend in AlUla' },
  { img: require('../../../assets/images/riyadh.jpg'), key: 'season', ask: 'Things to do in Riyadh this weekend' },
] as const;

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
        {tab === 'past' && <Past trips={data?.past ?? []} ask={ask} />}
      </Scroll>
    </Screen>
  );
}

function Upcoming({ trips, tracked, ask }: { trips: TripCard[]; tracked: Parameters<typeof TrackedFlights>[0]['flights']; ask: (p?: string) => void }) {
  const router = useRouter();
  if (!trips.length) return (<>
    <Animated.View entering={riseOn(0)} style={[riseStyle(0), styles.hero, shadow('card')]}>
      <DepartureBoard onPick={(city) => ask(`Flights to ${city.charAt(0) + city.slice(1).toLowerCase()}`)} />
      <T style={[font('display'), { fontSize: 32, lineHeight: 33 }]}>{t('trips.empty.title')}</T>
      <T v="small">{t('trips.empty.body')}</T>
      <Button label={t('trips.empty.action')} onPress={() => ask()} />
    </Animated.View>
    <T v="eyebrow">{t('trips.ideas.title')}</T>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
      {IDEAS.map((it) => (
        <Pressable key={it.key} onPress={() => { buzz('tap'); ask(it.ask); }} style={styles.idea} accessibilityRole="button" accessibilityLabel={t(`trips.idea.${it.key}.title`)}>
          <Image source={it.img} style={StyleSheet.absoluteFill} contentFit="cover" />
          <VGradient id={`idea-${it.key}`} stops={[[0.4, 'rgba(15,26,22,0)'], [1, 'rgba(15,26,22,0.75)']]} />
          <View style={{ padding: 12, paddingEnd: 10 }}>
            <T v="h3" color={colors.paper} style={{ fontSize: 14, lineHeight: 17 }}>{t(`trips.idea.${it.key}.title`)}</T>
            <T v="tiny" color="rgba(255,253,249,0.8)" style={{ fontSize: 11, lineHeight: 14, fontFamily: ff.ui500 }}>{t(`trips.idea.${it.key}.sub`)}</T>
          </View>
        </Pressable>
      ))}
    </ScrollView>
    {tracked.length ? <TrackedFlights flights={tracked} title={t('tr.tracking')} /> : null}
    <Imports />
  </>);
  return (<>
    {trips.map((c, i) => (
      <Animated.View key={c.id} entering={riseOn(i)} style={[riseStyle(i), styles.card, shadow('card')]}>
        <Pressable testID={`trip-card-${c.city}`} accessibilityRole="button" accessibilityLabel={t('tr.tripA11y', { city: c.city })} onPress={() => { buzz('tap'); router.push(`/trip/${c.id}` as Href); }}>
          <Photo k={c.imageUrl} style={{ height: 210, borderRadius: 0, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card }}>
            <Shade id={`trip-${c.id}`} />
            <View style={{ flex: 1, justifyContent: 'flex-end', padding: 16, gap: 4 }}>
              <Display size={36} color={colors.paper}>{c.city}</Display>
              <T v="small" color="rgba(255,253,249,0.9)">{rangeLong(c.startDate, c.endDate)} · {c.justYou ? t('tr.justYou') : c.travellerNames.join(', ')}</T>
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
  </>);
}

/** Booked somewhere else? Forward it or upload it (the upload sheet lives in the Wallet). */
function Imports() {
  const router = useRouter();
  return (
    <Box tone="well">
      <H3 size={15}>{t('tr.import.title')}</H3>
      <Small>{t('tr.import.body')}</Small>
      <SmallButton tone="paper" label={t('tr.import.upload')} onPress={() => router.push('/wallet')} />
    </Box>
  );
}

function Requests({ requests, refunds, ask }: { requests: TripRequestView[]; refunds: RefundView[]; ask: (p?: string) => void }) {
  const router = useRouter();
  const queued = useTripOutbox();
  const shown = requests.filter((r) => r.area !== 'refund');
  if (!shown.length && !refunds.length && !queued.length) return (
    <EmptyState art={<ArtPaperPlane width={280} height={112} />} title={t('trips.requests.empty.title')} body={t('trips.requests.empty.body')}
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
  const priced = (r.status === 'quoted' || r.status === 'awaiting_payment') && r.quote;
  return (
    <Box testID={`request-${r.kind}`}>
      <Spread align="flex-start"><H3 style={{ flex: 1 }}>{r.title}</H3><RequestStatusPill r={r} /></Spread>
      {r.detail ? <Small>{r.detail}</Small> : null}
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
          <SmallButton testID="pay-quote" tone="primary" label={t('tr.req.pay', { amount: formatSar(r.quote!.amount) })} onPress={() => router.push(`/pay?requestId=${r.id}` as Href)} />
        </Box>
      ) : null}
    </Box>
  );
}

function Past({ trips, ask }: { trips: TripCard[]; ask: (p?: string) => void }) {
  if (!trips.length) return (
    <Animated.View entering={riseOn(0)} style={[riseStyle(0), styles.hero, shadow('card')]}>
      <View style={styles.ppEmpty}>
        <T style={styles.ppTitle}>{t('trips.past.page')}</T>
        {([[18, 22, -12], [62, 16, 8], [28, 60, 6], [70, 58, -6]] as const).map(([x, y, r], k) => (
          <View key={k} style={[styles.slot, { start: `${x}%`, top: `${y}%`, transform: [{ rotate: `${r}deg` }] }, k === 0 ? styles.slotFirst : null]}>
            {k === 0 ? <T style={[font('display', colors.goldInk), { fontSize: 14, lineHeight: 14, textAlign: 'center', textTransform: 'uppercase', width: 52 }]}>{t('trips.past.first')}</T> : null}
          </View>
        ))}
      </View>
      <T style={[font('display'), { fontSize: 32, lineHeight: 33 }]}>{t('trips.past.empty.title')}</T>
      <T v="small">{t('trips.past.empty.body')}</T>
      <Button label={t('trips.past.empty.action')} onPress={() => ask()} />
    </Animated.View>
  );
  return (<>
    {trips.map((p) => (
      <Box key={p.id} testID={`past-${p.city}`}>
        <Spread><H3>{p.city}</H3><Tiny>{rangeLong(p.startDate, p.endDate)}</Tiny></Spread>
        {p.note ? <Small>{p.note}</Small> : <Small>{p.justYou ? t('tr.justYou') : p.travellerNames.join(', ')}</Small>}
        <SmallButton tone="soft" label={t('tr.sameAgain')} onPress={() => ask(t('tr.sameAgainAsk', { city: p.city, when: (p.when ?? t('td.lastTime')).toLowerCase() }))} />
      </Box>
    ))}
  </>);
}

const styles = StyleSheet.create({
  plus: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  seg: { height: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  segOn: { backgroundColor: colors.green },
  hero: { gap: 14, padding: 18, borderRadius: radii.hero, backgroundColor: colors.paper },
  idea: { width: 124, height: 150, borderRadius: 20, overflow: 'hidden', justifyContent: 'flex-end' },
  card: { backgroundColor: colors.paper, borderRadius: radii.card, overflow: 'hidden' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingStart: 16, paddingEnd: 10 },
  ppEmpty: { height: 210, borderRadius: 18, backgroundColor: '#f6ecd8', borderWidth: 1, borderColor: 'rgba(125,93,39,0.15)', overflow: 'hidden' },
  ppTitle: { position: 'absolute', top: 10, start: 14, textTransform: 'uppercase', fontSize: 9, letterSpacing: 1.8, color: colors.goldDeep, fontFamily: ff.ui700 },
  slot: { position: 'absolute', width: 74, height: 74, borderRadius: 999, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(125,93,39,0.3)', alignItems: 'center', justifyContent: 'center' },
  slotFirst: { borderColor: colors.goldDeep },
});

void Eyebrow;
void Grow;
