import { useState } from 'react';
import { StaleBadge } from '@/components/states/StaleBadge';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { AIRPORT_CITY, addDays, dayLabel, formatSar, liveStay, nameIn, outSegment, backSegment, rangeLabel, rangeLong, stayEnd, timing } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Screen, Scroll, TopBar } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { BannerHost } from '@/components/today/common';
import { MoveNotice, NoStayChoices } from '@/components/trips/MoveNotice';
import { AirlineMark, Box, Divider, Eyebrow, Grow, H3, ListRow, Row, RouteLine, Small, Spread, Tag, TextLink, Tiny, TripHero } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, usePayments, useRefundQuote, useTrip, useTripMutation } from '@/lib/trips';
import { colors } from '@/theme';
import { TripPartnerBookings } from '@/components/trips/PartnerBookings';
import { EsimTripRow } from '@/components/esim/parts';
import { ThingsView } from '@/components/things/ThingsView';
import { ErrorState, GoneState } from '@/components/states';
import { describeError } from '@/lib/net/describe';
import { Initial } from '@/components/booking/PeopleFrame';
import { routeTitle } from '@/components/booking/PlanCards';
import { ItemRow } from '@/components/plan/PlanParts';
import { mapsLinks } from '@/components/trips/AddressSheet';
import { useTripVouchers } from '@/lib/transfers';
import { usePlan, useSetTripChat, useTripChat } from '@/lib/plans';

const tripDays = (from: string, to: string | null) => { const out: string[] = []; for (let d = from, i = 0; d <= (to ?? from) && i < 30; d = addDays(d, 1), i++) out.push(d); return out; };

/** One trip (prototype TripDetail): flights, stay, pickups, the Manage list and the travellers. */
export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useTrip(id);
  const pays = usePayments(id);
  const quote = useRefundQuote(id);
  const [sheet, setSheet] = useState<'cancel' | 'nostay' | 'manage' | null>(null);
  const vouchers = useTripVouchers(id).data?.vouchers ?? [];
  const cancel = useTripMutation(() => tripsApi.cancelStay(id, newKey()));
  const planQ = usePlan(id);
  const chatQ = useTripChat(id);
  const setChat = useSetTripChat(id);
  const trip = q.data?.trip;
  if (!trip) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        {/* A trip that isn't there is "this link doesn't go anywhere"; one that can't load right now says why, with Try again. */}
        {q.isPending ? <View style={{ padding: 24 }}><ActivityIndicator color={colors.green} /></View>
          : q.error && describeError(q.error).kind !== 'gone' ? <ErrorState error={q.error} onRetry={() => void q.refetch()} variant="card" />
          : q.error ? <GoneState variant="card" /> : <View style={{ padding: 24 }}><T v="h2">{t('tm.detail.gone')}</T></View>}
      </Screen>
    );
  }
  const out = outSegment(trip);
  const back = backSegment(trip);
  const plan = planQ.data?.plan ?? null;
  // "Riyadh → AlUla" (§9.4): the plan's route, or the flight's start and the trip's city; the city alone otherwise.
  const from = out ? AIRPORT_CITY[out.from] ?? null : null;
  const title = plan ? routeTitle(plan.title) : from && from !== trip.city ? routeTitle(`${from} → ${trip.city}`) : nameIn(trip.city, getLocale());
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
    [`/trip/${trip.id}/money`, 'wallet', t('tm.m.money'), t('tm.m.moneySub')],
    [`/trip/${trip.id}/payments`, 'card', t('tm.m.payments'), nextDue ? t('tm.m.nextPayment', { amount: formatSar(nextDue.amount.amount), day: dayLabel(nextDue.dueOn, { today: nextDue.dueOn }) }) : t('tm.m.paymentsSub')],
    [`/trip/${trip.id}/change`, 'flight', t('tm.m.change'), tm.within24 ? t('tm.m.changeCall', { agent: trip.agent.name }) : t('tm.m.changeSub')],
    [`/trip/${trip.id}/hotel`, 'stay', t('tm.m.hotel'), stLive ? t('tm.m.hotelSub') : t('tm.m.hotelFind')],
    [`/trip/${trip.id}/special`, 'star', t('tm.m.special'), t('tm.m.specialSub')],
    [`/trip/${trip.id}/refund`, 'refund', t('tm.m.refund'), t('tm.m.refundSub')],
  ];
  return (
    <Screen>
      <Scroll top={0} bottomPad={60} gutter={0}>
        <TripHero photo={trip.imageUrl} title={title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/trips'))}
          sub={`${rangeLong(trip.startDate, trip.endDate)}${trip.bookingRef ? ` · ${t('tm.detail.booking', { ref: trip.bookingRef })}` : ''}`} />
        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 16 }}>
          {trip.openRequests > 0 ? (
            <Pressable testID="open-requests" onPress={() => { buzz('tap'); router.push('/trips?tab=requests' as Href); }} style={styles.strip}>
              <View style={styles.face}><T style={{ color: colors.sand, fontSize: 13 }}>{trip.agent.initial}</T></View>
              <T v="small" color={colors.green} style={{ flex: 1 }}>{t(trip.openRequests === 1 ? 'tm.detail.open.one' : 'tm.detail.open.other', { n: trip.openRequests })}</T>
              <Icon name="chevron" size={18} />
            </Pressable>
          ) : null}
          <MoveNotice trip={trip} />
          {/* This trip's own chat (ASK-INTEGRATED.md §2.2): opens it, or starts one about the trip. */}
          <Button testID="ask-about-trip" label={t('chat.askTrip')} variant="secondary" size="small" block={false} onPress={() => { buzz('tap'); router.push({ pathname: '/ask', params: { tripId: trip.id } }); }} />
          {/* The plan (§9.4): a summary, what's left to do, the first items, and Open the plan. */}
          {plan ? (() => {
            const live = plan.items.filter((i) => i.status !== 'skipped' && i.status !== 'cancelled');
            const booked = live.filter((i) => ['held', 'booked', 'confirmed'].includes(i.status)).length;
            const todo = plan.checks.filter((c) => c.state === 'todo' || c.state === 'warn').length;
            const next = live.filter((i) => i.day != null).sort((a, b) => (a.day! - b.day!) || a.sort - b.sort).slice(0, 3);
            return (
              <Box testID="trip-plan" onPress={() => router.push(`/trip/${trip.id}/plan` as Href)} label={t('trip.plan.open')}>
                <Spread><H3>{t('trip.plan.title')}</H3><Tag tone={todo ? 'gold' : 'ok'} label={todo ? t('trip.plan.todo', { n: todo }) : t('plan.screen.allSet')} /></Spread>
                <Tiny>{[t('trip.plan.days', { n: plan.days }), t('trip.plan.booked', { booked, total: live.length })].join(' · ')}</Tiny>
                {/* A flight not booked yet: "See options" asks Mada for that leg's flights (find_for_item). */}
                {next.map((i) => <ItemRow key={i.id} item={i} prices={planQ.data?.access?.prices ?? true}
                  act={i.kind === 'leg' && i.mode === 'flight' && i.status === 'idea' ? { label: t('plan.row.seeOptions'), testID: 'trip-plan-options', onPress: () => router.push({ pathname: '/ask', params: { tripId: trip.id, prefill: t('plan.row.searchSay', { title: routeTitle(`${i.from?.name ?? ''} → ${i.to?.name ?? ''}`) }) } }) } : undefined} />)}
                <TextLink testID="trip-plan-open" label={t('trip.plan.open')} onPress={() => router.push(`/trip/${trip.id}/plan` as Href)} />
              </Box>
            );
          })() : planQ.isError && trip.status !== 'cancelled' ? (
            <TextLink testID="trip-plan-make" label={t('trip.plan.make')} onPress={() => router.push({ pathname: '/ask', params: { tripId: trip.id, prefill: t('trip.plan.makeSay') } })} />
          ) : null}
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
                {/* The name opens the hotel's own page (photos, map, what it has) with the room and dates as booked. */}
                <Pressable style={{ flex: 1 }} accessibilityRole="link" accessibilityLabel={t('hotel.booked.openA11y', { name: st.name })} onPress={() => { buzz('tap'); router.push(`/hotel/${st.hotelCode ?? 'stay'}?trip=${trip.id}&stay=${st.id}&city=${encodeURIComponent(trip.city)}` as Href); }} testID="stay-open">
                  <Row><Icon name="stay" /><Grow gap={0}><H3 size={15}>{st.name}</H3><Tiny>{rangeLabel(st.checkIn, stayEnd(st))} · {t('tm.detail.nights', { n: st.nights })} · {t('hotel.booked.open')}</Tiny></Grow></Row>
                </Pressable>
                {st.status === 'cancelled' ? <Tag label={t('tm.detail.cancelled')} /> : tm.allUsed ? <Tag tone="ok" label={t('tm.detail.stayed')} /> : <TextLink testID="stay-manage" label={t('trip.stay.manage')} onPress={() => setSheet('manage')} />}
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
          <TripPartnerBookings trip={trip} hasArrivalPickup={!!arrive} />
          {trip.status !== 'cancelled' ? <EsimTripRow tripId={trip.id} /> : null}
          {q.isError ? <StaleBadge testID="trip-fresh" updatedAt={q.dataUpdatedAt || null} stale /> : null}
          <Eyebrow style={{ marginTop: 8 }}>{t('tm.detail.manage')}</Eyebrow>
          <Box padding={6} gap={0}>
            {manage.map(([href, icon, title, sub], i) => <ListRow key={href} testID={`manage-${i}`} first={i === 0} icon={icon} tone={i === 0 ? 'gold' : undefined} title={title} sub={sub} onPress={() => router.push(href as Href)} />)}
          </Box>
          <ThingsView mode="section" placeId={trip.city} city={trip.city} tripId={trip.id} days={tripDays(trip.startDate, trip.endDate)} />
          {/* The shared trip chat (§5.5): the owner turns it on; everyone on the trip and Mada in one chat. */}
          {chatQ.data && (chatQ.data.on || chatQ.data.canManage) ? (
            <Box testID="trip-chat">
              <Spread>
                <H3>{t('tripChat.title')}</H3>
                <Row gap={4}>{chatQ.data.members.slice(0, 5).map((m, i) => <Initial key={i} letter={m.initial} size={26} gold={m.owner} />)}</Row>
              </Spread>
              <Tiny>{chatQ.data.on ? t('tripChat.members', { names: chatQ.data.members.map((m) => m.name).join(getLocale() === 'ar' ? '، ' : ', ') }) : t('tripChat.sub')}</Tiny>
              {chatQ.data.on && chatQ.data.threadId ? (
                <Row gap={8} style={{ flexWrap: 'wrap' }}>
                  <Button testID="trip-chat-open" size="small" block={false} label={t('tripChat.open')} onPress={() => { buzz('tap'); router.push({ pathname: '/ask/[threadId]', params: { threadId: chatQ.data!.threadId! } }); }} />
                  {chatQ.data.canManage ? <TextLink testID="trip-chat-off" label={t('tripChat.off')} onPress={() => setChat.mutate(false, { onSuccess: () => toast(t('tripChat.offDone')) })} /> : null}
                </Row>
              ) : (
                <Button testID="trip-chat-on" size="small" variant="secondary" block={false} busy={setChat.isPending} label={t('tripChat.on')}
                  onPress={() => setChat.mutate(true, { onSuccess: (r) => { buzz('success'); if (r.threadId) router.push({ pathname: '/ask/[threadId]', params: { threadId: r.threadId } }); } })} />
              )}
            </Box>
          ) : null}
          <Box onPress={() => router.push(`/trip/${trip.id}/travellers` as Href)} label={t('people.screen.open')} testID="trip-travellers">
            <H3>{t('tm.detail.travellers')}</H3>
            <Row style={{ flexWrap: 'wrap' }}>{trip.travellers.map((p) => <Tag key={p.id} label={p.isSelf ? t('tm.detail.you', { name: p.firstName }) : p.firstName} />)}</Row>
            <Tiny>{t('people.screen.open')}</Tiny>
          </Box>
          {trip.travellers.some((p) => p.ticketNumber) ? (
            <Box testID="tickets-box">
              <H3>{t('beta.trip.tickets')}</H3>
              {out?.pnr ? <Tiny>{t('beta.trip.pnr', { ref: out.pnr })}</Tiny> : null}
              {trip.travellers.filter((p) => p.ticketNumber).map((p) => (
                <Spread key={p.id}><T v="small">{p.isSelf ? t('tm.detail.you', { name: p.firstName }) : p.firstName}</T><T v="small" color={colors.green} selectable style={{ fontVariant: ['tabular-nums'] }}>{t('beta.trip.ticket', { number: p.ticketNumber! })}</T></Spread>
              ))}
            </Box>
          ) : null}
        </View>
      </Scroll>
      {/* The hotel's Manage: its voucher, directions, and Cancel (through the confirmation below). */}
      <Sheet visible={sheet === 'manage'} onClose={() => setSheet(null)} label={t('trip.stay.manage')}>
        <T v="h2">{st?.name ?? t('trip.stay.manage')}</T>
        <Box padding={6} gap={0} testID="stay-manage-sheet">
          {(() => {
            const v = vouchers.find((x) => x.kind === 'stay');
            const rows: [string, Parameters<typeof ListRow>[0]['icon'], string, string | undefined, () => void][] = [];
            if (v) rows.push(['stay-manage-voucher', 'doc', t('trip.stay.voucher'), v.status === 'cancelled' ? t('voucher.cancelled') : t('voucher.openSub', { ref: v.reference }), () => { setSheet(null); router.push(`/voucher/${v.id}` as Href); }]);
            if (st) rows.push(['stay-manage-directions', 'pin', t('trip.stay.directions'), st.address ?? undefined, () => { buzz('tap'); void Linking.openURL(mapsLinks([st.name, st.address ?? trip.city].join(', ')).google).catch(() => toast(t('as.cantOpen'))); }]);
            rows.push(['cancel-stay', 'close', t('common.cancel'), undefined, () => setSheet('cancel')]);
            return rows.map(([testID, icon, title, sub, onPress], i) => <ListRow key={testID} testID={testID} first={i === 0} icon={icon} title={title} sub={sub} onPress={onPress} />);
          })()}
        </Box>
      </Sheet>
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
