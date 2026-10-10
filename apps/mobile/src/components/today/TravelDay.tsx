import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { addMinutes, AIRPORT_NAME, boardsAt, clockIn, formatSar, homePickup, liveStay, outSegment, pickupPlan, seatText, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { AirlineMark, Box, Cells, Dot, Eyebrow, Grow, H3, IconTile, Num, Photo, Rise, Row, RouteLine, Small, SmallButton, Spread, Tag, TalkLine, Tiny, useTicker } from '@/components/trips/ui';
import { VGradient } from '@/components/Gradient';
import { t } from '@/lib/i18n';
import { tripsApi, useOffline } from '@/lib/trips';
import { colors, ff, radii } from '@/theme';
import { useBanner } from './common';

/** "Leave home in 42 min": counts down to the driver at the door (or the time to leave without a car). */
function LeaveCard({ trip, now }: { trip: TripDetail; now: () => number }) {
  useTicker(1000);
  const out = outSegment(trip)!;
  const pk = pickupPlan(trip);
  const home = homePickup(trip);
  const target = home ? Date.parse(home.at) : Date.parse(trip.clock.now) + 42 * 60_000;
  const minutes = Math.max(0, Math.ceil((target - now()) / 60_000));
  const airport = AIRPORT_NAME[out.from] ?? out.from;
  return (
    <Photo k="riyadh-night" style={{ height: 184, borderRadius: radii.card }} focal="50% 35%">
      <VGradient id="leave" stops={[[0, 'rgba(15,26,22,0.86)'], [1, 'rgba(15,26,22,0.3)']]} />
      <View style={styles.leaveOver} testID="leave-card">
        <T style={{ color: 'rgba(255,253,249,0.85)', fontSize: 13, lineHeight: 17, fontFamily: ff.ui500 }}>{t('td.leave.in')}</T>
        <Row align="baseline" gap={10}>
          <Num size={88} color={colors.paper} style={{ lineHeight: 80 }}>{String(minutes)}</Num>
          <T style={{ fontSize: 26, lineHeight: 30, fontFamily: ff.ui600, color: colors.paper }}>{t('td.leave.min')}</T>
        </Row>
        <View style={styles.leavePill}>
          <View style={styles.leaveCar}><Icon name="car" size={16} color={colors.green} /></View>
          <T style={{ color: colors.paper, fontSize: 13, fontFamily: ff.ui500 }} numberOfLines={1}>{pk ? t('td.leave.driver', { driver: pk.driver, time: pk.time }) : t('td.leave.noCar')} · {t('td.leave.drive', { airport })}</T>
        </View>
      </View>
    </Photo>
  );
}

/** The flight, live: gate, boarding, seats, and where the status came from. */
export function FlightCard({ trip, predicted, updatedAt }: { trip: TripDetail; predicted?: boolean; updatedAt: number }) {
  const router = useRouter();
  const offline = useOffline();
  const out = outSegment(trip)!;
  const changed = !!out.bookedGate && !!out.gate && out.gate !== out.bookedGate;
  const late = out.delayMin ?? 0;
  const seats = seatText(out.seats).replace(/–(\d+)/, '–');
  return (
    <Box gap={12} testID="flight-card">
      <Spread>
        <Row gap={10}><AirlineMark code={out.carrier} brand={out.brand} size={32} name={out.carrierName} /><View><H3 size={15}>{out.carrierName}</H3><Tiny>{out.flightNumber} · {out.departLocal.slice(0, 10) === trip.clock.today ? t('td.when.today') : out.departLocal.slice(0, 10)}</Tiny></View></Row>
        {predicted ? <Tag tone="warn" label={t('td.fc.mayBeLate')} /> : late ? <Tag tone="warn" label={t('td.fc.late', { n: late })} /> : <Tag tone="ok" label={t('td.fc.onTime')} />}
      </Spread>
      <RouteLine dep={addMinutes(out.departLocal.slice(11, 16), late)} arr={addMinutes(out.arriveLocal.slice(11, 16), late)} from={out.from} to={out.to} durationMin={out.durationMin} big />
      <Cells items={[{ k: t('td.fc.gate'), v: out.gate ?? '—', flash: changed }, { k: t('td.fc.boards'), v: boardsAt(out) }, { k: out.seats.length > 1 ? t('td.fc.seats') : t('td.fc.seat'), v: seats }]} />
      <Row gap={8}>
        <Dot color={offline ? colors.goldDeep : colors.ok} size={6} />
        <Tiny style={{ flex: 1 }}>{offline ? t('td.fc.offline', { time: clockIn(updatedAt) }) : changed ? t('td.fc.gateChanged', { gate: out.gate ?? '', min: 6 }) : t('td.fc.live')}</Tiny>
      </Row>
      {predicted ? (
        <Row style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}>
          <Grow><H3 size={15}>{t('td.fc.inbound')}</H3><Tiny>{t('td.fc.predicted', { airline: out.carrierName })}</Tiny></Grow>
          <SmallButton testID="see-plan" tone="gold" label={t('td.fc.seePlan')} onPress={() => router.push(`/disruption/${trip.id}?kind=delay` as Href)} />
        </Row>
      ) : null}
    </Box>
  );
}

/** While a delay is only predicted: what we're watching, and what happens next. */
function DelayWatch({ trip }: { trip: TripDetail }) {
  const pk = pickupPlan(trip);
  const n = trip.travellers.length;
  const steps: ['done' | 'now' | 'todo', string, string][] = [
    ['done', t('td.dw.held'), n > 1 ? t('td.dw.heldAll', { n }) : t('td.dw.heldOne')],
    ['now', t('td.dw.watching'), t('td.dw.watchingSub')],
    ...(pk ? [['todo', t('td.dw.driver', { driver: pk.driver }), t('td.dw.driverSub')] as ['todo', string, string]] : []),
  ];
  return (
    <Box gap={12}>
      <Eyebrow>{t('td.dw.title')}</Eyebrow>
      <StepList steps={steps} />
    </Box>
  );
}

/** The arrival-style step list (.td-steps). */
export function StepList({ steps }: { steps: ['done' | 'now' | 'todo', string, string][] }) {
  return (
    <View>
      {steps.map(([st, h, sub], i) => (
        <Row key={h} align="flex-start" gap={12} style={{ paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
          {i < steps.length - 1 ? <View style={styles.stepLine} /> : null}
          <View style={[styles.stepMark, st === 'done' ? { backgroundColor: colors.ok, borderColor: colors.ok } : st === 'now' ? { borderColor: colors.gold } : null]}>
            {st === 'done' ? <Icon name="check" size={13} color={colors.paper} width={2.8} /> : st === 'now' ? <Dot color={colors.gold} /> : null}
          </View>
          <Grow><T style={{ fontSize: 15, lineHeight: 20, fontFamily: st === 'todo' ? ff.ui500 : ff.ui600, color: st === 'todo' ? colors.ink2 : colors.green }}>{h}</T><Tiny>{sub}</Tiny></Grow>
        </Row>
      ))}
    </View>
  );
}

export function TravelDay({ trip, predicted, now, updatedAt }: { trip: TripDetail; predicted?: boolean; now: () => number; updatedAt: number }) {
  const router = useRouter();
  const show = useBanner((s) => s.show);
  const offline = useOffline();
  const out = outSegment(trip)!;
  const pk = pickupPlan(trip);
  const told = useRef(false);
  // A few seconds in, ask the airline again (FlightAware alerts reach us too): the gate may have moved.
  useEffect(() => {
    if (predicted || offline) return;
    const check = async () => {
      try {
        const r = await tripsApi.refresh(trip.id);
        const g = r.changes.find((c) => c.kind === 'gate');
        if (g && !told.current) { told.current = true; show({ title: g.title, body: g.body, href: `/trip/${trip.id}` }); }
      } catch { /* offline: the card says when it last heard */ }
    };
    const first = setTimeout(check, 6000);
    const every = setInterval(check, 60_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [trip.id, predicted, offline, show]);
  const airport = AIRPORT_NAME[out.from] ?? out.from;
  return (
    <>
      <Rise><Row gap={8}><Dot color={predicted ? colors.goldDeep : colors.ok} /><T style={{ fontSize: 15, lineHeight: 20, fontFamily: ff.ui600, color: predicted ? colors.goldInk : colors.ok }}>{predicted ? t('td.tv.oneThing') : trip.rebooked ? t('td.tv.newFlight') : t('td.tv.allSet')}</T></Row></Rise>
      {!predicted ? <Rise step={1}><LeaveCard trip={trip} now={now} /></Rise> : null}
      <Rise step={1}><FlightCard trip={trip} predicted={predicted} updatedAt={updatedAt} /></Rise>
      {!predicted ? (
        <Rise step={2} style={{ flexDirection: 'row', gap: 12 }}>
          {pk ? (
            <Box style={{ flex: 1, height: 96, justifyContent: 'space-between' }}>
              <Row gap={8}><View style={styles.av}><T style={{ color: colors.sand, fontFamily: ff.ui600, fontSize: 13 }}>{pk.driver.charAt(0)}</T></View><H3 size={14}>{pk.driver} · {pk.time}</H3></Row>
              <Tiny>{t('td.tv.driverWaits', { car: pk.car ?? '' })}</Tiny>
            </Box>
          ) : (
            <Box style={{ flex: 1, height: 96, justifyContent: 'space-between' }}>
              <Row gap={8}><Icon name="car" size={18} /><H3 size={14}>{t('td.tv.leaveBy', { time: addMinutes(out.departLocal.slice(11, 16), -155) })}</H3></Row>
              <Tiny>{t('td.tv.driveTo', { airport, terminal: out.terminal ?? '' })}</Tiny>
            </Box>
          )}
          {trip.weather ? (
            <Box style={{ flex: 1, height: 96, justifyContent: 'space-between', backgroundColor: '#e7ecef' }}>
              <H3 size={14}>{trip.city} · {trip.weather.tempC}°</H3>
              <Tiny color={colors.inkSoft}>{trip.weather.tip}</Tiny>
            </Box>
          ) : null}
        </Rise>
      ) : null}
      {!predicted ? <Rise step={3}><Button testID="boarding-passes" label={t('td.tv.passes')} icon={<Icon name="doc" color={colors.mist} size={20} />} onPress={() => router.push('/wallet')} /></Rise> : null}
      {predicted ? <DelayWatch trip={trip} /> : null}
      <TalkLine note={predicted ? t('td.talk.watching', { agent: trip.agent.name }) : t('td.talk.today', { agent: trip.agent.name })} agentInitial={trip.agent.initial} about={trip.city} />
    </>
  );
}

export function Cancelled({ trip }: { trip: TripDetail }) {
  const router = useRouter();
  const out = outSegment(trip)!;
  const n = trip.travellers.length;
  const st = liveStay(trip);
  const home = trip.pickups.find((p) => p.direction === 'to_airport');
  const arrive = trip.pickups.find((p) => p.direction === 'from_airport');
  const rows: [Parameters<typeof IconTile>[0]['name'], string, string][] = [
    ...(st ? [['stay', t('td.cx.hotel'), t(n > 2 ? 'td.cx.hotelRooms' : 'td.cx.hotelRoom', { name: st.name })] as [Parameters<typeof IconTile>[0]['name'], string, string]] : []),
    ...(home || arrive ? [['car', t('td.cx.pickups'), t('td.cx.pickupsSub', { a: home?.driverName ?? '', b: arrive?.driverName ?? '' })] as [Parameters<typeof IconTile>[0]['name'], string, string]] : []),
    ['refund', t('td.cx.money'), t('td.cx.moneySub', { amount: formatSar(trip.prices.flights.amount), what: trip.segments.length > 1 ? t('td.cx.flights') : t('td.cx.flight') })],
  ];
  return (
    <>
      <Rise>
        <Box tone="focal" padding={22} gap={14}>
          <Eyebrow color={colors.gold}>{out.flightNumber} · {out.departLocal.slice(0, 10)}</Eyebrow>
          <T v="h1" color={colors.mist} accessibilityRole="header">{t('td.cx.title', { airline: out.carrierName })}</T>
          <T v="body" color="#d6cfc3">{n > 1 ? t('td.cx.bodyAll', { n }) : t('td.cx.bodyOne')}</T>
          <Button testID="see-options" variant="gold" label={t('td.cx.options')} onPress={() => router.push(`/disruption/${trip.id}?kind=cancel` as Href)} />
        </Box>
      </Rise>
      <Rise step={1}>
        <Box gap={12}>
          <Eyebrow>{t('td.cx.taken')}</Eyebrow>
          {rows.map(([ic, h, sub]) => (
            <Row key={h} align="flex-start" gap={12}><IconTile name={ic} size={34} icon={18} /><Grow gap={1}><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{h}</T><Tiny>{sub}</Tiny></Grow></Row>
          ))}
        </Box>
      </Rise>
      <TalkLine note={t('td.talk.onPhone', { agent: trip.agent.name, airline: out.carrierName })} agentInitial={trip.agent.initial} about={trip.city} />
    </>
  );
}

const styles = StyleSheet.create({
  leaveOver: { flex: 1, justifyContent: 'space-between', paddingTop: 16, paddingBottom: 14, paddingStart: 20, paddingEnd: 16 },
  leavePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingStart: 6, paddingEnd: 14, borderRadius: 999, backgroundColor: 'rgba(255,253,249,0.16)', borderWidth: 1, borderColor: 'rgba(255,253,249,0.18)', maxWidth: '100%' },
  leaveCar: { width: 28, height: 28, borderRadius: 99, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  av: { width: 32, height: 32, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  stepMark: { width: 22, height: 22, borderRadius: 99, borderWidth: 1.5, borderColor: '#d6cec2', backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  stepLine: { position: 'absolute', start: 10, top: 24, bottom: 2, width: 2, backgroundColor: '#ebe4d9' },
});

void Small;
