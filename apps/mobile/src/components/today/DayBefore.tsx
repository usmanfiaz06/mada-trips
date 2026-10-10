import { Fragment, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { addMinutes, AIRPORT_NAME, dayLabel, boardsAt, destinationOf, liveStay, outSegment, passportIssue, pickupPlan, PICKUP_OFFSETS, SUGGESTED_OFFSET, seatText, termShort, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { Box, Dot, Eyebrow, Grow, H3, Num, Ring, Rise, Row, Small, Tag, TalkLine, TextLink, Tiny } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { tripsApi, useTripMutation } from '@/lib/trips';
import { colors, ff, radii, shadow } from '@/theme';
import { TripHero } from './common';
import { useTripLocal } from './local';

type PackItem = { id: string; t: string; sub: string; people?: boolean; problem?: { firstName: string; id: string } | null; own?: boolean };
const mins = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return h2! * 60 + m2! - (h1! * 60 + m1!); };

/** What to pack, from the trip: passports checked against the Wallet, the plug, the weather, the kids. */
function packList(trip: TripDetail) {
  const n = Math.max(1, trip.travellers.length);
  const dest = destinationOf(trip);
  const year = new Date(trip.clock.now).getUTCFullYear();
  const kids = trip.travellers.filter((p) => p.birthYear !== null && year - p.birthYear < 13).map((p) => p.firstName);
  const problem = trip.travellers.map((p) => ({ p, issue: passportIssue(trip, p) })).find((x) => x.issue?.blocking);
  const out = outSegment(trip);
  return [
    { id: 'passports', t: n === 1 ? t('td.pack.passport') : t('td.pack.passports', { n }), sub: problem ? t('td.pack.ppFix', { name: problem.p.firstName }) : n === 1 ? t('td.pack.ppOk', { country: dest.country }) : t('td.pack.ppOkAll', { n, country: dest.country }), people: true, problem: problem?.p ?? null },
    { id: 'chargers', t: t('td.pack.chargers'), sub: t('td.pack.chargersSub') },
    ...(dest.plug ? [{ id: 'adapter', t: t('td.pack.adapter', { plug: dest.plug }), sub: t('td.pack.adapterSub', { country: dest.country }) }] : []),
    ...(trip.weather?.rain ? [{ id: 'umbrella', t: t('td.pack.umbrella'), sub: t('td.pack.umbrellaSub') }] : []),
    ...(trip.weather ? [{ id: 'layer', t: n === 1 ? t('td.pack.layer') : t('td.pack.layerEach'), sub: t('td.pack.layerSub', { temp: trip.weather.tempC, city: trip.city }) }] : []),
    { id: 'mat', t: t('td.pack.mat'), sub: liveStay(trip) ? t('td.pack.matHotel') : t('td.pack.matCity', { city: trip.city }) },
    ...(kids.length ? [{ id: 'snacks', t: t('td.pack.snacks', { names: kids.join(` ${t('trip.and')} `) }), sub: t('td.pack.snacksSub', { dur: out ? `${Math.floor(out.durationMin / 60)}h ${out.durationMin % 60}m` : '' }) }] : []),
    { id: 'meds', t: t('td.pack.meds'), sub: t('td.pack.medsSub') },
  ] as PackItem[];
}

function PackingList({ trip }: { trip: TripDetail }) {
  const router = useRouter();
  const [local, update] = useTripLocal(trip.id);
  const [draft, setDraft] = useState('');
  const items: PackItem[] = [...packList(trip), ...local.extra.map((x) => ({ id: x.id, t: x.t, sub: t('td.pack.yours'), own: true }))];
  const packed = local.packed.filter((id) => items.some((i) => i.id === id));
  const all = packed.length === items.length;
  const toggle = (id: string) => {
    const on = packed.includes(id);
    const next = on ? packed.filter((x) => x !== id) : [...packed, id];
    buzz(!on && next.length === items.length ? 'success' : 'select');
    update(() => ({ packed: next }));
  };
  return (
    <Box padding={18} gap={12} testID="packing">
      <Row gap={14}>
        <Ring done={packed.length} total={items.length} size={52} />
        <Grow><H3 size={18}>{all ? t('td.pack.done') : t('td.pack.title')}</H3><Small>{all ? t('td.pack.doneBody') : t('td.pack.count', { n: packed.length, total: items.length })}</Small></Grow>
      </Row>
      <View accessibilityRole="list">
        {items.map((it) => {
          const on = packed.includes(it.id);
          return (
            <View key={it.id} style={styles.packItem}>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={it.t} testID={`pack-${it.id}`} onPress={() => toggle(it.id)} style={styles.packTap}>
                <View style={[styles.check, on ? styles.checkOn : null]}>{on ? <Icon name="check" size={14} color={colors.paper} width={2.8} /> : null}</View>
                <Grow gap={1}>
                  <T style={[styles.packT, on ? { color: colors.ink3, textDecorationLine: 'line-through' } : null]}>{it.t}</T>
                  <Tiny color={it.problem ? colors.badInk : undefined}>{it.sub}</Tiny>
                </Grow>
                {it.people ? <View style={{ flexDirection: 'row' }}>{trip.travellers.slice(0, 4).map((p, i) => <View key={p.id} style={[styles.mini, i ? { marginStart: -8 } : null, it.problem?.id === p.id ? { backgroundColor: '#f3d9cf' } : null]}><T style={{ fontSize: 10, fontFamily: ff.ui600, color: it.problem?.id === p.id ? colors.badInk : colors.green }}>{p.initial}</T></View>)}</View> : null}
                {it.own ? <Pressable accessibilityRole="button" accessibilityLabel={t('td.pack.remove', { what: it.t })} onPress={() => update((l) => ({ extra: l.extra.filter((x) => x.id !== it.id), packed: l.packed.filter((x) => x !== it.id) }))} style={styles.x}><Icon name="close" size={14} color={colors.ink2} /></Pressable> : null}
              </Pressable>
              {it.problem ? <View style={{ marginStart: 38, marginBottom: 8 }}><Button label={t('td.ready.fixPp', { name: it.problem.firstName })} variant="gold" size="small" block={false} onPress={() => router.push('/wallet')} /></View> : null}
            </View>
          );
        })}
      </View>
      <View style={styles.add}>
        <Icon name="plus" size={18} color={colors.ink3} />
        <TextInput testID="pack-add" value={draft} onChangeText={setDraft} placeholder={t('td.pack.add')} placeholderTextColor={colors.ink3} accessibilityLabel={t('td.pack.add')} style={styles.addInput}
          onSubmitEditing={() => { const v = draft.trim(); if (!v) return; buzz('tap'); update((l) => ({ extra: [...l.extra, { id: `x${Date.now()}`, t: v.charAt(0).toUpperCase() + v.slice(1) }] })); setDraft(''); }} />
        {draft.trim() ? <Pressable onPress={() => { const v = draft.trim(); update((l) => ({ extra: [...l.extra, { id: `x${Date.now()}`, t: v.charAt(0).toUpperCase() + v.slice(1) }] })); setDraft(''); }} style={styles.addBtn}><T style={{ color: colors.mist, fontFamily: ff.ui600, fontSize: 14 }}>{t('td.pack.addBtn')}</T></Pressable> : null}
      </View>
    </Box>
  );
}

function PickupSheet({ trip, open, onClose }: { trip: TripDetail; open: boolean; onClose: () => void }) {
  const out = outSegment(trip)!;
  const pk = pickupPlan(trip)!;
  const [pick, setPick] = useState<number>(pk.offsetMin);
  const save = useTripMutation((o: number) => tripsApi.patch(trip.id, { pickupOffsetMin: o as -175 | -155 | -140 | -125 }));
  const dep = out.departLocal.slice(11, 16);
  const timeOf = (o: number) => addMinutes(dep, o);
  const spare = mins(addMinutes(timeOf(pick), 35), pk.bagDrop);
  const airport = AIRPORT_NAME[out.from] ?? out.from;
  return (
    <Sheet visible={open} onClose={onClose} label={t('td.pickup.label')}>
      <T v="h2">{t('td.pickup.when', { driver: pk.driver })}</T>
      <Small style={{ marginTop: -8 }}>{t('td.pickup.body', { airport, code: out.flightNumber, time: pk.bagDrop })}</Small>
      <View style={{ gap: 8 }} accessibilityRole="radiogroup">
        {PICKUP_OFFSETS.map((o) => {
          const tm = timeOf(o);
          const sp = mins(addMinutes(tm, 35), pk.bagDrop);
          const on = pick === o;
          return (
            <Pressable key={o} testID={`pickup-${o}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { buzz('select'); setPick(o); }} style={[styles.time, on ? styles.timeOn : null]}>
              <Num size={20} style={{ width: 60 }}>{tm}</Num>
              <Grow gap={0}><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('td.pickup.atBy', { t: termShort(out.terminal), time: addMinutes(tm, 35) })}</T><Tiny>{sp >= 50 ? t('td.pickup.spare', { n: sp }) : t('td.pickup.tight', { n: sp })}{o === SUGGESTED_OFFSET ? ` · ${t('td.pickup.suggest')}` : ''}</Tiny></Grow>
              {on ? <Icon name="check" size={18} width={2.4} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Tiny>{t('td.pickup.wake', { time: addMinutes(timeOf(pick), -45) })}</Tiny>
      <Button testID="pickup-save" label={pick === pk.offsetMin ? t('td.pickup.stays', { time: timeOf(pick) }) : t('td.pickup.move', { time: timeOf(pick) })} disabled={pick === pk.offsetMin} busy={save.isPending}
        onPress={() => save.mutate(pick, { onSuccess: () => { buzz('success'); toast(t('td.pickup.told', { driver: pk.driver, time: timeOf(pick) })); onClose(); } })} />
      {spare < 50 ? <T v="small" color={colors.badInk}>{t('td.pickup.tightNote')}</T> : null}
    </Sheet>
  );
}

export function DayBefore({ trip, scrollTo }: { trip: TripDetail; scrollTo?: (y: number) => void }) {
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const [local] = useTripLocal(trip.id);
  const packY = useRef(0);
  const out = outSegment(trip)!;
  const pk = pickupPlan(trip);
  const n = trip.travellers.length;
  const items = packList(trip).length + local.extra.length;
  const packed = local.packed.length;
  const allPacked = packed >= items;
  const dep = out.departLocal.slice(11, 16);
  const wake = pk ? pk.wake : addMinutes(dep, -200);
  const airport = AIRPORT_NAME[out.from] ?? out.from;
  const sleepHours = Math.round((mins('22:30', '24:00') + mins('00:00', wake)) / 60);
  const plan: { k: string; time: string; t: string; sub: string; state?: 'done' | 'now'; act?: [string, () => void] }[] = [
    { k: 'tonight', time: t('td.plan.tonight'), t: allPacked ? t('td.plan.packed') : t('td.plan.pack'), sub: allPacked ? t('td.plan.packedSub') : t('td.plan.packSub', { n: packed, total: items }), state: allPacked ? 'done' : 'now', act: allPacked ? undefined : [t('td.plan.seeList'), () => scrollTo?.(packY.current)] },
    { k: 'sleep', time: '22:30', t: t('td.plan.lights'), sub: t('td.plan.lightsSub', { n: sleepHours }) },
    { k: 'wake', time: wake, t: t('td.plan.wake'), sub: t('td.plan.wakeSub') },
    pk ? { k: 'pickup', time: pk.time, t: t('td.plan.atDoor', { driver: pk.driver }), sub: t('td.plan.atDoorSub', { car: pk.car ?? '', waits: pk.waits }), act: [t('td.plan.changePickup'), () => setSheet(true)] }
      : { k: 'pickup', time: addMinutes(dep, -155), t: t('td.plan.leave'), sub: t('td.plan.leaveSub', { airport }) },
    { k: 'airport', time: pk ? pk.airportBy : addMinutes(dep, -120), t: `${airport}, ${out.terminal ?? ''}`, sub: t('td.plan.airportSub', { time: addMinutes(dep, -60) }) },
    { k: 'board', time: boardsAt(out), t: t('td.plan.boarding', { gate: out.gate ?? '—' }), sub: n > 1 ? t('td.plan.seats', { seats: seatText(out.seats) }) : t('td.plan.seat', { seat: seatText(out.seats) }) },
    { k: 'fly', time: dep, t: t('td.plan.fly', { code: out.flightNumber, city: trip.city }), sub: t('td.plan.flySub', { time: out.arriveLocal.slice(11, 16) }) },
  ];
  return (
    <>
      <Rise><Row gap={8}><Dot color={colors.ok} /><T style={{ fontSize: 15, lineHeight: 20, fontFamily: ff.ui600, color: colors.ok }}>{allPacked ? t('td.db.allSet') : t('td.db.oncePacked')}</T></Row></Rise>
      <Rise step={1}>
        <TripHero trip={trip} height={210}>
          <Row gap={6} style={{ marginTop: 6, flexWrap: 'wrap' }}>
            <Tag tone="glass" label={t('td.db.checkedIn')} icon={<Icon name="check" size={13} color={colors.gold} width={2.6} />} />
            <Tag tone="glass" label={`${n > 1 ? t('td.db.seats') : t('td.db.seat')} ${seatText(out.seats)}`} />
            <Tag tone="glass" label={t('td.db.bags', { bags: out.baggage ?? trip.fare?.bags ?? '' })} />
          </Row>
        </TripHero>
      </Rise>
      <Rise step={2}>
        <Box padding={18} gap={12} style={{ paddingBottom: 8 }} testID="the-plan">
          <Eyebrow>{t('td.plan.title')}</Eyebrow>
          <View>
            {plan.map((p, i) => (
              <Fragment key={p.k}>
                {i === 3 ? <T style={styles.daymark}>{t('td.plan.tomorrow', { day: dayLabel(out.departLocal.slice(0, 10), { today: out.departLocal.slice(0, 10) }) })}</T> : null}
                <View style={styles.tl}>
                  <Num size={14} color={p.state ? colors.green : colors.ink2} style={{ width: 54, textAlign: 'right', paddingTop: 1 }}>{p.time}</Num>
                  <View style={styles.rail}>
                    <View style={[styles.railLine, i === 0 ? { top: 8 } : null, i === plan.length - 1 ? { bottom: undefined, height: 8 } : null]} />
                    <View style={[styles.railDot, p.state === 'now' ? { backgroundColor: colors.gold, borderColor: colors.gold } : p.state === 'done' ? { backgroundColor: colors.ok, borderColor: colors.ok } : null]} />
                  </View>
                  <Grow gap={1} style={{ paddingBottom: 16 }}>
                    <T style={{ fontSize: 15, lineHeight: 20, fontFamily: ff.ui600, color: p.state === 'now' ? colors.goldInk : colors.green }}>{p.t}</T>
                    <Tiny>{p.sub}</Tiny>
                    {p.act ? <TextLink testID={`plan-${p.k}`} label={p.act[0]} onPress={p.act[1]} /> : null}
                  </Grow>
                </View>
              </Fragment>
            ))}
          </View>
        </Box>
      </Rise>
      <Rise step={3} style={{ flexDirection: 'row', gap: 12 }}>
        {trip.weather ? (
          <View style={styles.weather} accessibilityLabel={t('td.weather.a11y', { city: trip.city, temp: trip.weather.tempC, summary: trip.weather.summary })}>
            <Tiny color={colors.inkSoft}>{t('td.weather.onLanding', { city: trip.city })}</Tiny>
            <Num size={44} style={{ letterSpacing: -1.8 }}>{`${trip.weather.tempC}°`}</Num>
            <T v="small" color={colors.green} style={{ fontFamily: ff.ui500 }}>{trip.weather.summary}</T>
          </View>
        ) : null}
        <Pressable testID="passes" onPress={() => { buzz('tap'); router.push('/wallet'); }} style={[styles.oncall, shadow('focal')]}>
          <Row gap={8}><Icon name="doc" size={20} color={colors.gold} /><Tiny color={colors.onDark2}>{n === 1 ? t('td.db.pass') : t('td.db.passes', { n })}</Tiny></Row>
          <H3 size={16} color={colors.paper}>{t('td.db.offline')}</H3>
          <TextLink light label={n === 1 ? t('td.db.openPass') : t('td.db.openPasses')} onPress={() => router.push('/wallet')} />
        </Pressable>
      </Rise>
      <View onLayout={(e) => { packY.current = e.nativeEvent.layout.y; }}><PackingList trip={trip} /></View>
      <TalkLine note={t('td.talk.tonight', { agent: trip.agent.name })} agentInitial={trip.agent.initial} about={trip.city} />
      {pk ? <PickupSheet trip={trip} open={sheet} onClose={() => setSheet(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  packItem: { borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 2 },
  packTap: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  check: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: '#c9c1b4', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.green, borderColor: colors.green },
  packT: { fontSize: 15, lineHeight: 20, fontFamily: ff.ui600, color: colors.green },
  mini: { width: 24, height: 24, borderRadius: 99, backgroundColor: '#efe6d6', borderWidth: 2, borderColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  x: { width: 26, height: 26, borderRadius: 99, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingStart: 14, paddingEnd: 6, borderRadius: 16, backgroundColor: colors.mist },
  addInput: { flex: 1, fontSize: 15, color: colors.green, fontFamily: ff.ui400, height: '100%' },
  addBtn: { height: 34, paddingHorizontal: 14, borderRadius: 99, backgroundColor: colors.green, justifyContent: 'center' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.mist },
  timeOn: { backgroundColor: '#f3ead8', borderWidth: 1.5, borderColor: colors.goldDeep },
  tl: { flexDirection: 'row', gap: 10 },
  rail: { width: 18, alignItems: 'center' },
  railLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#ebe4d9' },
  railDot: { marginTop: 4, width: 12, height: 12, borderRadius: 99, backgroundColor: colors.paper, borderWidth: 2, borderColor: '#d6cec2' },
  daymark: { marginStart: 82, marginTop: 2, marginBottom: 12, fontSize: 12, lineHeight: 16, fontFamily: ff.ui600, letterSpacing: 0.96, textTransform: 'uppercase', color: colors.ink3 },
  weather: { flex: 1.15, minHeight: 136, borderRadius: radii.card, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#d6dfe4', justifyContent: 'space-between' },
  oncall: { flex: 1, minHeight: 136, borderRadius: radii.card, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.green, justifyContent: 'space-between' },
});

void ScrollView;
