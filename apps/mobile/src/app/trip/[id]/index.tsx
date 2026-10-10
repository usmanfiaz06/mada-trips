import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { dayLabel, formatSar, liveStay, outSegment, backSegment, rangeLabel, rangeLong, stayEnd, timing } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Screen, Scroll, TopBar } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { BannerHost } from '@/components/today/common';
import { MoveNotice, NoStayChoices } from '@/components/trips/MoveNotice';
import { AirlineMark, Box, Display, Divider, Eyebrow, Grow, H3, ListRow, Photo, Row, RouteLine, Shade, Small, Spread, Tag, TextLink, Tiny } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, useOfflineTrips, usePayments, useRefundQuote, useTrip, useTripMutation } from '@/lib/trips';
import { colors } from '@/theme';

/** One trip (prototype TripDetail): flights, stay, pickups, the Manage list and the travellers. */
export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  useOfflineTrips();
  const q = useTrip(id);
  const pays = usePayments(id);
  const quote = useRefundQuote(id);
  const [sheet, setSheet] = useState<'cancel' | 'nostay' | null>(null);
  const cancel = useTripMutation(() => tripsApi.cancelStay(id, newKey()));
  const trip = q.data?.trip;
  if (!trip) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <View style={{ padding: 24 }}>{q.isPending ? <ActivityIndicator color={colors.green} /> : <T v="h2">{t('tm.detail.gone')}</T>}</View>
      </Screen>
    );
  }
  const out = outSegment(trip);
  const back = backSegment(trip);
  const st = trip.stays[0];
  const stLive = liveStay(trip);
  const tm = timing(trip.clock.phase);
  const flightPay = pays.data?.payments.find((p) => p.item === 'flight');
  const flightGone = !!flightPay?.refunded;
  const nextDue = (pays.data?.payments ?? []).flatMap((p) => (p.plan && !p.refunded ? p.plan.filter((i) => !i.paid) : []))[0];
  const stayQ = quote.data?.items.find((i) => i.item === 'stay');
  const arrive = trip.pickups.find((p) => p.direction === 'from_airport' && p.status !== 'cancelled');
  const home = trip.pickups.find((p) => p.direction === 'to_airport' && p.status !== 'cancelled');
  const manage: [string, Parameters<typeof ListRow>[0]['icon'], string, string][] = [
    [`/itinerary/${trip.id}`, 'trips', t('tm.m.itinerary'), t('tm.m.itinerarySub')],
    [`/trip/${trip.id}/payments`, 'card', t('tm.m.payments'), nextDue ? t('tm.m.nextPayment', { amount: formatSar(nextDue.amount.amount), day: dayLabel(nextDue.dueOn, { today: nextDue.dueOn }) }) : t('tm.m.paymentsSub')],
    [`/trip/${trip.id}/change`, 'flight', t('tm.m.change'), tm.within24 ? t('tm.m.changeCall', { agent: trip.agent.name }) : t('tm.m.changeSub')],
    [`/trip/${trip.id}/hotel`, 'stay', t('tm.m.hotel'), stLive ? t('tm.m.hotelSub') : t('tm.m.hotelFind')],
    [`/trip/${trip.id}/special`, 'star', t('tm.m.special'), t('tm.m.specialSub')],
    [`/trip/${trip.id}/refund`, 'refund', t('tm.m.refund'), t('tm.m.refundSub')],
  ];
  return (
    <Screen>
      <Scroll top={0} bottomPad={60} gutter={0}>
        <Photo k={trip.imageUrl} style={{ height: 230, borderRadius: 0 }}>
          <Shade id="trip-top" />
          <View style={{ position: 'absolute', top: 0, start: 0, end: 0, zIndex: 2 }}><TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/trips'))} dark /></View>
          <View style={{ flex: 1, justifyContent: 'flex-end', padding: 16, gap: 4 }}>
            <Display size={40} color={colors.paper}>{trip.city}</Display>
            <T v="small" color="rgba(255,253,249,0.9)">{rangeLong(trip.startDate, trip.endDate)}{trip.bookingRef ? ` · ${t('tm.detail.booking', { ref: trip.bookingRef })}` : ''}</T>
          </View>
        </Photo>
        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 16 }}>
          {trip.openRequests > 0 ? (
            <Pressable testID="open-requests" onPress={() => { buzz('tap'); router.push('/trips?tab=requests' as Href); }} style={styles.strip}>
              <View style={styles.face}><T style={{ color: colors.sand, fontSize: 13 }}>{trip.agent.initial}</T></View>
              <T v="small" color={colors.green} style={{ flex: 1 }}>{t(trip.openRequests === 1 ? 'tm.detail.open.one' : 'tm.detail.open.other', { n: trip.openRequests })}</T>
              <Icon name="chevron" size={18} />
            </Pressable>
          ) : null}
          <MoveNotice trip={trip} />
          {out ? (
            <Box testID="flight-box">
              <Spread>
                <Row gap={10}><AirlineMark code={out.carrier} brand={out.brand} size={32} name={out.carrierName} /><View><H3 size={15}>{back ? t('tm.detail.going') : t('tm.detail.oneWay')} · {dayLabel(out.departLocal.slice(0, 10), { today: out.departLocal.slice(0, 10) })}</H3><Tiny>{out.carrierName} · {out.flightNumber}{out.cabin !== 'economy' ? ` · ${t(`trip.cabin.${out.cabin}`)}` : ''}</Tiny></View></Row>
                {flightGone ? <Tag label={t('tm.detail.refunded')} /> : <TextLink testID="change-link" label={t('tm.detail.change')} onPress={() => router.push(`/trip/${trip.id}/change` as Href)} />}
              </Spread>
              <RouteLine dep={out.departLocal.slice(11, 16)} arr={out.arriveLocal.slice(11, 16)} from={out.from} to={out.to} durationMin={out.durationMin} />
              {back ? (<>
                <Divider />
                <View><H3 size={15}>{t('tm.detail.back')} · {dayLabel(back.departLocal.slice(0, 10), { today: back.departLocal.slice(0, 10) })}</H3><Tiny>{back.carrierName} · {back.flightNumber}</Tiny></View>
                <RouteLine dep={back.departLocal.slice(11, 16)} arr={back.arriveLocal.slice(11, 16)} from={back.from} to={back.to} durationMin={back.durationMin} />
              </>) : <Tiny>{t('tm.detail.noHome', { agent: trip.agent.name })}</Tiny>}
            </Box>
          ) : null}
          {st ? (
            <Box testID="stay-box">
              <Spread>
                <Row style={{ flex: 1 }}><Icon name="stay" /><Grow gap={0}><H3 size={15}>{st.name}</H3><Tiny>{rangeLabel(st.checkIn, stayEnd(st))} · {t('tm.detail.nights', { n: st.nights })}</Tiny></Grow></Row>
                {st.status === 'cancelled' ? <Tag label={t('tm.detail.cancelled')} /> : tm.allUsed ? <Tag tone="ok" label={t('tm.detail.stayed')} /> : <TextLink testID="cancel-stay" label={t('common.cancel')} onPress={() => setSheet('cancel')} />}
              </Spread>
              {st.status === 'cancelled' ? <Small>{t('tm.detail.refundOnWay')}</Small> : null}
            </Box>
          ) : null}
          {!stLive && out ? (
            <Box tone="cream" style={styles.nostay}>
              <Row><Icon name="stay" /><H3 size={15} style={{ flex: 1 }}>{trip.noStay ? t('tm.detail.stayingWith', { label: trip.noStay.label }) : t('as.whereTitle')}</H3></Row>
              <Small>{trip.noStay ? `${trip.noStay.address}${arrive ? `. ${t('tm.detail.takesYou', { driver: arrive.driverName ?? '' })}` : ''}` : arrive ? t('as.driverNeeds', { driver: arrive.driverName ?? '' }) : t('as.soMada')}</Small>
              <Button testID="nostay-tell" label={trip.noStay ? t('tm.detail.change') : t('tm.detail.tellUs')} variant="secondary" size="small" block={false} onPress={() => setSheet('nostay')} />
            </Box>
          ) : null}
          {home || arrive ? (
            <Box style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="car" />
              <Grow gap={0}><H3 size={15}>{home && arrive ? t('tm.detail.pickBoth') : home ? t('tm.detail.pickThere') : t('tm.detail.pickArrival')}</H3><Tiny>{[home ? t('tm.detail.inCity', { driver: home.driverName ?? '', city: home.city ?? '' }) : null, arrive ? t('tm.detail.inCity', { driver: arrive.driverName ?? '', city: arrive.city ?? trip.city }) : null].filter(Boolean).join(' · ')}{!stLive && !trip.noStay ? ` · ${t('tm.detail.needsAddr')}` : ''}</Tiny></Grow>
            </Box>
          ) : null}
          <Eyebrow style={{ marginTop: 8 }}>{t('tm.detail.manage')}</Eyebrow>
          <Box padding={6} gap={0}>
            {manage.map(([href, icon, title, sub], i) => <ListRow key={href} testID={`manage-${i}`} first={i === 0} icon={icon} tone={i === 0 ? 'gold' : undefined} title={title} sub={sub} onPress={() => router.push(href as Href)} />)}
          </Box>
          <Box>
            <H3>{t('tm.detail.travellers')}</H3>
            <Row style={{ flexWrap: 'wrap' }}>{trip.travellers.map((p) => <Tag key={p.id} label={p.isSelf ? t('tm.detail.you', { name: p.firstName }) : p.firstName} />)}</Row>
          </Box>
        </View>
      </Scroll>
      <Sheet visible={sheet === 'cancel'} onClose={() => setSheet(null)} label={t('tm.cancel.title')}>
        <T v="h2">{t('tm.cancel.title')}</T>
        <T v="body">{t('tm.cancel.body', { amount: formatSar(stayQ?.cash.amount ?? st?.price.amount ?? 0) })} {stayQ?.rule ?? ''} {t('tm.cancel.flightsStay')}</T>
        {stayQ?.cancelled ? <Small>{t('tm.cancel.instalments', { provider: stayQ.method === 'tamara' ? 'Tamara' : 'Tabby', n: stayQ.cancelled.count, amount: formatSar(stayQ.cancelled.amount.amount) })}</Small> : null}
        {stayQ && !stayQ.cancelled && stayQ.back.amount < stayQ.paid.amount ? <Small>{t('tm.cancel.paid', { amount: formatSar(stayQ.paid.amount) })} {stayQ.why}</Small> : null}
        <Button testID="cancel-stay-confirm" label={t('tm.cancel.confirm')} variant="secondary" color={colors.badInk} busy={cancel.isPending}
          onPress={() => cancel.mutate(undefined, { onSuccess: () => { buzz('success'); toast(t('tm.cancel.done')); setSheet(out && arrive ? 'nostay' : null); }, onError: (e) => toast(e.message) })} />
        <Button label={t('tm.cancel.keep')} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={sheet === 'nostay'} onClose={() => setSheet(null)} label={t('as.whereTitle')}>
        <T v="h2">{t('as.whereTitle')}</T>
        <Small style={{ marginTop: -8 }}>{arrive && out ? t('tm.nostay.body', { driver: arrive.driverName ?? '', day: dayLabel(out.departLocal.slice(0, 10), { today: out.departLocal.slice(0, 10) }) }) : t('as.soMada')}</Small>
        <NoStayChoices trip={trip} onDone={() => setSheet(null)} />
      </Sheet>
      <BannerHost />
    </Screen>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingStart: 10, paddingEnd: 14, borderRadius: 20, backgroundColor: '#f3ead8', borderWidth: 1, borderColor: 'rgba(185,143,74,0.35)' },
  face: { width: 32, height: 32, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  nostay: { gap: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(125,93,39,0.35)', backgroundColor: '#fbf5ea' },
});
