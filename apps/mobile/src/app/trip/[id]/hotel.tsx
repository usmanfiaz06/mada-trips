import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ROOM_OPTIONS, addDays, addMinutes, dayLabel, formatSar, freeUntil, liveStay, nightPrice, outSegment, backSegment, rangeLabel, stayEnd, timing, type CreateTripAskRequest, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { RequestStatusPill } from '@/components/trips/Requests';
import { Box, H3, IconTile, ListRow, PickCard, Rise, Row, Small, Spread, TextLink, Tiny, TripScreen } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, useTrip, useTripMutation, useTripRequests } from '@/lib/trips';

type Kind = 'room' | 'nights' | 'times' | 'bed' | 'connecting';
const dl = (d: string) => dayLabel(d, { today: d });
const sar = (h: number) => formatSar(Math.abs(h), { bare: true });

/** Hotel options (prototype HotelOptions): room, nights, early or late, a cot, connecting rooms. Each is a request with a status. */
export default function HotelOptions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const trip = useTrip(id).data?.trip;
  const reqs = useTripRequests(id);
  const [sheet, setSheet] = useState<Kind | null>(null);
  if (!trip) return <TripScreen title={t('ho.title')}>{null}</TripScreen>;
  const st = liveStay(trip);
  if (!st) {
    return (
      <TripScreen title={t('ho.title')}>
        <Box tone="well"><H3>{trip.stays.length ? t('ho.cancelled') : t('ho.none')}</H3><Small>{trip.noStay ? t('ho.ownPlace', { address: trip.noStay.address }) : t('ho.sameDates')}</Small>
          <Button label={t('td.ready.findStay')} size="small" block={false} onPress={() => router.push('/ask?intent=stay' as Href)} /></Box>
      </TripScreen>
    );
  }
  const last = stayEnd(st);
  const n = trip.travellers.length;
  const mine = (reqs.data?.requests ?? []).filter((r) => r.area === 'hotel');
  const connecting = (st.roomType ?? (n > 2 ? 'Connecting' : '')).startsWith('Connecting');
  return (
    <TripScreen title={t('ho.title')}>
      <Rise><Box>
        <Row><IconTile name="stay" /><View style={{ flex: 1 }}><H3 size={15}>{st.name}</H3><Tiny>{st.roomType ?? t(n > 2 ? 'trip.connectingRooms' : 'trip.aRoom')} · {rangeLabel(st.checkIn, last)} · {t('tm.detail.nights', { n: st.nights })}</Tiny></View></Row>
        <Tiny>{t('ho.free', { day: freeUntil(st.checkIn) })}</Tiny>
      </Box></Rise>
      <Rise step={1}><Box padding={6} gap={0}>
        <ListRow first testID="ho-room" icon="stay" title={t('ho.r.room')} sub={t('ho.r.roomSub')} onPress={() => setSheet('room')} />
        <ListRow testID="ho-nights" icon="plus" title={t('ho.r.nights')} sub={t('ho.r.nightsSub', { n: st.nights, day: dl(last) })} onPress={() => setSheet('nights')} />
        <ListRow testID="ho-times" icon="bell" title={t('ho.r.times')} sub={t('ho.r.timesSub')} onPress={() => setSheet('times')} />
        <ListRow testID="ho-bed" icon="user" title={t('ho.r.bed')} sub={t('ho.r.bedSub')} onPress={() => setSheet('bed')} />
        {n > 1 ? <ListRow testID="ho-connecting" icon="link" title={t('ho.connecting')} sub={connecting ? t('ho.r.inBooking') : t('ho.r.askHotel')} onPress={() => setSheet('connecting')} /> : null}
        <ListRow icon="globe" title={t('ho.r.switch')} sub={t('ho.r.switchSub')} onPress={() => router.push(`/ask?intent=stay&prefill=${encodeURIComponent(t('ho.switchAsk', { city: trip.city, dates: rangeLabel(st.checkIn, last) }))}` as Href)} />
      </Box></Rise>
      {mine.length ? (
        <Box testID="ho-asked">
          <H3>{t('sr.asked')}</H3>
          {mine.map((r) => <Spread key={r.id}><Small style={{ flex: 1 }}>{r.title}</Small><RequestStatusPill r={r} /></Spread>)}
          <TextLink label={t('action.talk')} onPress={() => router.push('/support?topic=change' as Href)} />
        </Box>
      ) : null}
      {sheet ? <HotelSheet trip={trip} kind={sheet} onClose={() => setSheet(null)} /> : null}
    </TripScreen>
  );
}

function HotelSheet({ trip, kind, onClose }: { trip: TripDetail; kind: Kind; onClose: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const ask = useTripMutation((b: Omit<CreateTripAskRequest, 'clientKey' | 'area'>) => tripsApi.ask(trip.id, { area: 'hotel', ...b, clientKey: newKey() }));
  const st = liveStay(trip)!;
  const tm = timing(trip.clock.phase);
  const night = nightPrice(st);
  const out = outSegment(trip);
  const back = backSegment(trip);
  const done = (msg?: string | null) => { buzz('success'); toast(msg ?? t('sr.sentToast')); onClose(); };
  const go = (b: Omit<CreateTripAskRequest, 'clientKey' | 'area'>) => ask.mutate(b, { onSuccess: (r) => done(r.say), onError: (e) => toast(e.message) });
  let title = '';
  let body: React.ReactNode = null;
  if (kind === 'room') {
    title = t('ho.r.room');
    const cur = ROOM_OPTIONS.find((r) => r.id === pick);
    const diff = cur ? cur.perNight * st.nights : 0;
    body = (<>
      {ROOM_OPTIONS.map((r) => <PickCard inSheet radio key={r.id} testID={`room-${r.id}`} on={pick === r.id} onPress={() => setPick(r.id)} title={t(`ho.room.${r.id}`)} sub={`${t(`ho.room.${r.id}Sub`)} · ${r.perNight > 0 ? '+' : '−'}SAR ${sar(r.perNight)} ${t('ho.aNight')}`} right={`${r.perNight > 0 ? '+' : '−'}${sar(r.perNight * st.nights)}`} />)}
      {cur ? <Small>{diff > 0 ? t('ho.room.more', { amount: formatSar(diff), n: st.nights }) : t('ho.room.less', { amount: formatSar(-diff) })}</Small> : null}
      <Button testID="room-ask" label={cur ? (diff > 0 ? t('ho.askPrice', { amount: sar(diff) }) : t('ho.ask')) : t('ho.pickRoom')} disabled={!cur} busy={ask.isPending} onPress={() => go({ kind: 'room', option: cur!.id })} />
    </>);
  } else if (kind === 'nights') {
    title = t('ho.r.nights');
    const last = stayEnd(st);
    const backAmt = tm.early ? night : 0;
    body = (<>
      <PickCard inSheet radio testID="nights-add" on={pick === 'add'} onPress={() => setPick('add')} title={t('ho.n.until', { day: dl(addDays(last, 1)) })} sub={t('ho.n.oneMore', { amount: formatSar(night) })} right={`+${sar(night)}`} />
      <PickCard inSheet radio testID="nights-cut" on={pick === 'cut'} disabled={st.nights <= 1 || (tm.outUsed && st.nights <= 2)} onPress={() => setPick('cut')} title={t('ho.n.leave', { day: dl(addDays(last, -1)) })} sub={tm.early ? t('ho.n.lessFree', { day: freeUntil(st.checkIn) }) : t('ho.n.lessKept', { day: freeUntil(st.checkIn) })} right={backAmt ? `−${sar(backAmt)}` : t('mv.nothingBack')} />
      {pick === 'add' && back && back.departLocal.slice(0, 10) <= last ? <Box tone="warn"><Small>{t('ho.n.flightStill', { day: dl(back.departLocal.slice(0, 10)) })}</Small></Box> : null}
      {pick === 'cut' && back && back.departLocal.slice(0, 10) >= last ? <Box tone="warn"><Small>{t('ho.n.needPlace', { day: dl(back.departLocal.slice(0, 10)) })}</Small></Box> : null}
      <Button testID="nights-ask" label={pick === 'add' ? t('ho.askPrice', { amount: sar(night) }) : pick === 'cut' ? t('ho.n.cutBtn') : t('ho.pickOne')} disabled={!pick} busy={ask.isPending} onPress={() => go({ kind: 'nights', option: pick! })} />
    </>);
  } else if (kind === 'times') {
    title = t('ho.r.times');
    const half = Math.round(night / 2);
    const reach = out ? addMinutes(out.arriveLocal.slice(11, 16), 105) : null;
    const opts = [['early-free', t('ho.times.earlyFree'), t('ho.t.earlyFreeSub'), t('ho.t.free')], ['early-paid', t('ho.times.earlyPaid'), t('ho.t.half', { amount: formatSar(half) }), `+${sar(half)}`], ['late-free', t('ho.times.lateFree'), t('ho.t.lateFreeSub'), t('ho.t.free')], ['late-paid', t('ho.times.latePaid'), t('ho.t.half', { amount: formatSar(half) }), `+${sar(half)}`]] as const;
    const cur = opts.find((o) => o[0] === pick);
    body = (<>
      {out && reach ? <Small style={{ marginTop: -6 }}>{t('ho.t.intro', { arr: out.arriveLocal.slice(11, 16), reach })}{reach >= '14:00' ? ` ${t('ho.t.mayNot')}` : ''}</Small> : null}
      {opts.map(([oid, ttl, sub, right]) => <PickCard inSheet radio key={oid} testID={`times-${oid}`} on={pick === oid} onPress={() => setPick(oid)} title={ttl} sub={sub} right={right} />)}
      <Tiny>{t('ho.t.foot')}</Tiny>
      <Button testID="times-ask" label={cur ? (cur[0].endsWith('paid') ? t('ho.askPrice', { amount: sar(half) }) : t('ho.ask')) : t('ho.pickOne')} disabled={!cur} busy={ask.isPending} onPress={() => go({ kind: 'times', option: pick! })} />
    </>);
  } else if (kind === 'bed') {
    title = t('ho.r.bed');
    const year = new Date(trip.clock.now).getUTCFullYear();
    const baby = trip.travellers.some((p) => p.birthYear !== null && p.birthYear >= year - 2);
    const bed = 15000 * st.nights;
    body = (<>
      <PickCard inSheet radio on={pick === 'cot'} disabled={!baby} onPress={() => setPick('cot')} title={t('ho.bed.cot')} sub={baby ? t('ho.b.cotSub') : t('ho.bed.noBaby')} right={t('ho.t.free')} />
      <PickCard inSheet radio testID="bed-extra" on={pick === 'bed'} onPress={() => setPick('bed')} title={t('ho.bed.extra')} sub={t('ho.b.bedSub', { n: st.nights })} right={`+${sar(bed)}`} />
      <Button testID="bed-ask" label={pick === 'bed' ? t('ho.askPrice', { amount: sar(bed) }) : t('ho.ask')} disabled={!pick} busy={ask.isPending} onPress={() => go({ kind: 'bed', option: pick! })} />
    </>);
  } else {
    title = t('ho.connecting');
    const n = trip.travellers.length;
    const has = (st.roomType ?? (n > 2 ? 'Connecting' : '')).startsWith('Connecting');
    body = (<>
      <T v="body" style={{ marginTop: -8 }}>{has ? t('ho.c.has') : t('ho.c.not')}</T>
      {has ? <Button label={t('ho.c.good')} onPress={onClose} /> : <Button testID="connect-ask" label={t('ho.ask')} busy={ask.isPending} onPress={() => go({ kind: 'connecting' })} />}
    </>);
  }
  return (
    <Sheet visible onClose={onClose} label={title}>
      <T v="h2">{title}</T>
      {body}
    </Sheet>
  );
}
