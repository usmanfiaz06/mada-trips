import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { destinationOf, formatSar, liveStay, outSegment, passportIssue, seatText, ESIM_PRICE, type TripDetail, type TripRequestView } from '@mada/shared';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { MoveNotice } from '@/components/trips/MoveNotice';
import { Box, Grow, H3, Photo, Ring, Rise, Row, Small, SmallButton, Spread, Tag, Tiny, Veil } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { dirSign, listSep, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, useTrips, useTripMutation, useOffline } from '@/lib/trips';
import { colors, ff, radii } from '@/theme';
import { RequestsCard, TripHero } from './common';

type Item = { id: string; ok: boolean; k: string; v: string; fix?: string; act?: 'flight' | 'stay' | 'passport' | 'esim' | 'car'; urgent?: boolean };

/** The six things that make a trip ready, from the trip itself (SCOPE.md: readiness ring). */
export function readinessItems(trip: TripDetail, esim: TripRequestView | null): Item[] {
  const out = outSegment(trip);
  const back = trip.segments.find((s) => s.direction === 'back');
  const st = liveStay(trip);
  const n = trip.travellers.length;
  const dest = destinationOf(trip);
  const problem = trip.travellers.map((p) => ({ p, issue: passportIssue(trip, p) })).find((x) => x.issue?.blocking);
  const missing = trip.travellers.filter((p) => !p.passportExpiry);
  const home = trip.pickups.find((p) => p.direction === 'to_airport' && p.status !== 'cancelled');
  const arrive = trip.pickups.find((p) => p.direction === 'from_airport' && p.status !== 'cancelled');
  return [
    out
      ? { id: 'flight', ok: true, k: t(back ? 'td.ready.flights' : 'td.ready.flight'), v: `${out.flightNumber} · ${n > 1 ? t('td.ready.seatsTogether', { seats: seatText(out.seats) }) : t('td.ready.seat', { seat: seatText(out.seats) })}${back ? '' : ` · ${t('trip.oneWay')}`}` }
      : { id: 'flight', ok: false, k: t('td.ready.noFlights'), v: t('td.ready.noFlightsBody'), fix: t('td.ready.findFlights'), act: 'flight' },
    trip.stays.some((s) => s.status === 'cancelled') && !st && !trip.noStay
      ? { id: 'stay', ok: false, k: t('td.ready.noStay'), v: t('td.ready.staysCancelled'), fix: t('td.ready.findStay'), act: 'stay' }
      : !st
        ? (trip.noStay ? { id: 'stay', ok: true, k: t('td.ready.whereStaying'), v: trip.noStay.address } : { id: 'stay', ok: false, k: t('td.ready.noStay'), v: t('td.ready.noStayBody'), fix: t('td.ready.findStay'), act: 'stay' })
        : { id: 'stay', ok: true, k: t('td.ready.stay'), v: t('td.ready.stayV', { name: st.name, nights: st.nights }) },
    problem
      ? { id: 'pass', ok: false, k: t('td.ready.ppOf', { name: problem.p.firstName }), v: problem.issue!.text, fix: t('td.ready.fixPp', { name: problem.p.firstName }), act: 'passport', urgent: true }
      : missing.length
        ? { id: 'pass', ok: false, k: t(n === 1 ? 'td.ready.passport' : 'td.ready.passports'), v: t('td.ready.ppMissing', { names: missing.map((p) => p.firstName).join(listSep()) }), fix: t('td.ready.addPp'), act: 'passport' }
        : { id: 'pass', ok: true, k: t(n === 1 ? 'td.ready.passport' : 'td.ready.passports'), v: n === 1 ? t('td.ready.ppValid', { country: dest.country }) : t('td.ready.ppValidAll', { n, country: dest.country }) },
    { id: 'entry', ok: true, k: t('td.ready.entry'), v: n === 1 ? t('td.ready.entryV') : t('td.ready.entryAll', { n }) },
    esim
      ? { id: 'data', ok: esim.status === 'done' || esim.status === 'confirmed', k: t('td.ready.data'), v: esim.status === 'done' || esim.status === 'confirmed' ? t('td.ready.esimDone', { n: esim.short?.match(/\d+/)?.[0] ?? n }) : t('td.ready.esimWaiting'), fix: esim.status === 'done' || esim.status === 'confirmed' ? undefined : t('td.ready.esimPay'), act: 'esim' }
      : { id: 'data', ok: false, k: t('td.ready.data'), v: n === 1 ? t('td.ready.dataOne', { price: formatSar(ESIM_PRICE) }) : t('td.ready.dataMany', { price: formatSar(ESIM_PRICE) }), fix: t('td.ready.setUp'), act: 'esim' },
    home || arrive
      ? { id: 'pickup', ok: true, k: t('td.ready.pickups'), v: t(home && arrive ? 'td.ready.bothWays' : 'td.ready.oneWay', { wait: arrive?.waits ?? '60 min' }) }
      : { id: 'pickup', ok: false, k: t('td.ready.noPickup'), v: t('td.ready.noPickupBody'), fix: t('td.ready.addPickup'), act: 'car' },
  ];
}

function Readiness({ trip }: { trip: TripDetail }) {
  const router = useRouter();
  const { data } = useTrips();
  const [esim, setEsim] = useState(false);
  const [open, setOpen] = useState(false);
  const esimReq = (data?.requests ?? []).find((r) => r.tripId === trip.id && r.kind === 'esim') ?? null;
  const items = readinessItems(trip, esimReq);
  const todo = items.filter((i) => !i.ok).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  const done = items.filter((i) => i.ok);
  const next = todo[0];
  const act = (it: Item) => {
    buzz('tap');
    if (it.act === 'passport') router.push('/wallet');
    else if (it.act === 'esim') { if (esimReq) router.push('/trips?tab=requests' as Href); else setEsim(true); }
    else router.push(`/ask?intent=${it.act}` as Href);
  };
  return (
    <Box padding={18} gap={12} testID="readiness">
      <Row gap={14}>
        <Ring done={done.length} total={items.length} />
        <Grow>
          <H3 size={18}>{next ? t('td.ready.count', { done: done.length, total: items.length }) : t('td.ready.allSet')}</H3>
          <Small>{next ? (todo.length === 1 ? t('td.ready.last', { k: next.k }) : t('td.ready.left', { n: todo.length })) : t('td.ready.nothing')}</Small>
        </Grow>
      </Row>
      {todo.map((it, i) => (
        <View key={it.id} style={[styles.todo, it.urgent ? { flexWrap: 'wrap' } : null]}>
          <View style={styles.todoMark}><T style={{ fontFamily: ff.ui700, fontSize: 13, color: colors.goldInk }}>{it.urgent ? '!' : ''}</T></View>
          <Grow style={it.urgent ? { flexBasis: '80%' } : undefined}><H3 size={15}>{it.k}</H3><Tiny>{it.v}</Tiny></Grow>
          {it.fix ? <View style={it.urgent ? { marginStart: 34 } : undefined}><SmallButton testID={`ready-${it.id}`} label={it.fix} tone={i === 0 ? 'gold' : 'soft'} onPress={() => act(it)} /></View> : null}
        </View>
      ))}
      <Pressable testID="ready-done" accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { buzz('tap'); setOpen(!open); }} style={styles.doneToggle}>
        <View style={{ flexDirection: 'row' }}>{done.map((it, i) => <View key={it.id} style={[styles.tick, i ? { marginStart: -6 } : null]}><Icon name="check" size={11} color={colors.paper} width={3} /></View>)}</View>
        <T numberOfLines={1} style={{ flex: 1, fontSize: 13, lineHeight: 17, color: colors.ink2, fontFamily: ff.ui500 }}>{t('td.ready.doneList', { n: done.length, list: done.map((i) => i.k.toLowerCase()).join(listSep()) })}</T>
        <View style={{ transform: [{ rotate: open ? `${90 * dirSign()}deg` : '0deg' }] }}><Icon name="chevron" size={16} /></View>
      </Pressable>
      {open ? (
        <View style={{ gap: 10, paddingHorizontal: 4 }}>
          {done.map((it) => <Row key={it.id} align="flex-start"><Icon name="check" size={18} color={colors.ok} width={2.4} /><Grow gap={0}><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{it.k}</T><Tiny>{it.v}</Tiny></Grow></Row>)}
        </View>
      ) : null}
      <EsimSheet trip={trip} open={esim} onClose={() => setEsim(false)} />
    </Box>
  );
}

/** Data on landing: pick who needs it. Mada confirms the eSIMs and the price lands in Requests. */
function EsimSheet({ trip, open, onClose }: { trip: TripDetail; open: boolean; onClose: () => void }) {
  const [who, setWho] = useState(trip.travellers.map((p) => p.id));
  const offline = useOffline();
  const ask = useTripMutation(() => tripsApi.ask(trip.id, { area: 'other', kind: 'esim', count: who.length, travellerIds: who, clientKey: newKey() }));
  const dest = destinationOf(trip);
  return (
    <Sheet visible={open} onClose={onClose} label={t('td.esim.sheetTitle', { country: dest.country })}>
      <T v="h2">{t('td.esim.sheetTitle', { country: dest.country })}</T>
      <Small style={{ marginTop: -8 }}>{t('td.esim.sheetBody')}</Small>
      <View style={{ gap: 8 }}>
        {trip.travellers.map((p) => {
          const on = who.includes(p.id);
          return (
            <Pressable key={p.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => { buzz('select'); setWho(on ? who.filter((x) => x !== p.id) : [...who, p.id]); }} style={[styles.person, on ? { backgroundColor: '#f3ead8' } : null]}>
              <Avatar initial={p.initial} size={32} />
              <Grow gap={0}><H3 size={15}>{p.firstName}</H3><Tiny>{t(`td.rel.${p.relation}` as never)}</Tiny></Grow>
              <View style={[styles.tickbox, on ? { backgroundColor: colors.green, borderColor: colors.green } : null]}>{on ? <Icon name="check" size={14} color={colors.paper} width={2.6} /> : null}</View>
            </Pressable>
          );
        })}
      </View>
      {offline ? <Box tone="warn"><H3>{t('td.offline.title')}</H3><Small>{t('td.esim.offline')}</Small></Box> : null}
      <Button testID="esim-send" label={t('td.esim.send', { price: formatSar(ESIM_PRICE * who.length) })} disabled={!who.length || offline} busy={ask.isPending}
        onPress={() => ask.mutate(undefined, { onSuccess: () => { buzz('success'); toast(t('td.esim.sent')); onClose(); }, onError: () => toast(t('error.offline')) })} />
    </Sheet>
  );
}

/** Ideas for the trip: only where they fit who's going. Each one opens Ask. */
function nextUp(trip: TripDetail) {
  const n = trip.travellers.length;
  const kids = trip.travellers.some((p) => p.birthYear !== null && p.birthYear > new Date(trip.clock.now).getUTCFullYear() - 13);
  return [
    { id: 'cruise', title: t('td.next.cruise'), note: n > 1 ? t('td.next.cruiseMany', { n }) : t('td.next.cruiseOne'), photo: 'istanbul-bosphorus', tag: t('td.next.anyEvening'), ask: t('td.next.cruise') },
    kids ? { id: 'kids', title: t('td.next.kids'), note: t('td.next.kidsNote'), photo: 'istanbul-sultanahmet', tag: t('td.next.plan'), ask: t('td.next.kids') }
      : { id: 'walk', title: t('td.next.walk'), note: t('td.next.walkNote'), photo: 'istanbul-galata', tag: t('td.next.half'), ask: t('td.next.walkAsk') },
    { id: 'table', title: t('td.next.table'), note: n > 2 ? t('td.next.tableFamily') : t('td.next.tableHalal'), photo: 'turkish-breakfast', tag: t('td.next.anyNight'), ask: t('td.next.table') },
  ];
}

export function Booked({ trip }: { trip: TripDetail }) {
  const router = useRouter();
  const istanbul = /istanbul/i.test(trip.city);
  return (
    <>
      <MoveNotice trip={trip} />
      <Rise><TripHero trip={trip} /></Rise>
      <Rise step={1}><Readiness trip={trip} /></Rise>
      <RequestsCard />
      {istanbul ? (<>
        <T v="h2" style={{ fontSize: 22, lineHeight: 27, marginTop: 6 }}>{t('td.next.title', { city: trip.city })}</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 20, paddingBottom: 6 }}>
          {nextUp(trip).map((c) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => { buzz('tap'); router.push(`/ask?prefill=${encodeURIComponent(c.ask)}` as Href); }}>
              <Photo k={c.photo} style={{ width: 232, height: 200, borderRadius: radii.card }}>
                <Veil id={`next-${c.id}`} />
                <Tag label={c.tag} tone="glass" style={{ position: 'absolute', top: 12, start: 12 }} />
                <View style={{ flex: 1, justifyContent: 'flex-end', padding: 14, gap: 2 }}>
                  <H3 size={17} color={colors.paper}>{c.title}</H3>
                  <T style={{ fontSize: 13, lineHeight: 17, color: 'rgba(255,253,249,0.9)', fontFamily: ff.ui400 }}>{c.note}</T>
                </View>
              </Photo>
            </Pressable>
          ))}
        </ScrollView>
      </>) : null}
      <Rise step={3}>
        <Box onPress={() => router.push('/circles')} label={t('td.circleTips')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.circleIc}><Icon name="circles" size={16} /></View>
          <Grow><H3 size={15}>{t('td.circleTips')}</H3><Tiny>{t('td.circleTipsBody', { city: trip.city })}</Tiny></Grow>
          <Icon name="chevron" />
        </Box>
      </Rise>
    </>
  );
}

const styles = StyleSheet.create({
  todo: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  todoMark: { width: 22, height: 22, borderRadius: 99, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.goldDeep, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', marginTop: 2 },
  doneToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.mist, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12 },
  tick: { width: 18, height: 18, borderRadius: 99, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.mist },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, backgroundColor: colors.mist },
  tickbox: { width: 24, height: 24, borderRadius: 99, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center' },
  circleIc: { width: 32, height: 32, borderRadius: 99, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
});

void Spread;
