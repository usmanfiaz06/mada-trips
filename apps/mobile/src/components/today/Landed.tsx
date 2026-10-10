import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { addMinutes, arrivalPickup, destinationOf, liveStay, outSegment, sameTimeAsHome, signName, type TripDetail } from '@mada/shared';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AddressSheet } from '@/components/trips/AddressSheet';
import { Box, Display, Dot, Grow, H3, Num, Photo, Rise, Row, Small, SmallButton, Spread, Tag, TalkLine, TextLink, Tiny, Veil } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { tripsApi, useTripMutation } from '@/lib/trips';
import { colors, ff, radii, shadow } from '@/theme';
import { useTripLocal } from './local';

type Step = { id: string; t: string; sub: string; bag?: boolean; address?: boolean };

function arrivalSteps(trip: TripDetail): Step[] {
  const arrive = arrivalPickup(trip);
  const n = trip.travellers.length;
  const st = liveStay(trip);
  const own = trip.noStay?.address;
  const dest = destinationOf(trip);
  const year = new Date(trip.clock.now).getUTCFullYear();
  const kids = trip.travellers.some((p) => p.birthYear !== null && year - p.birthYear < 13);
  const bag = trip.bagReport;
  return [
    { id: 'phone', t: t('td.arr.phone'), sub: t('td.arr.phoneSub') },
    { id: 'passport', t: t('td.arr.passport'), sub: n > 1 ? `${t('td.arr.passportMany', { n })}${kids ? ` ${t('td.arr.kids')}` : ''}` : t('td.arr.passportOne') },
    { id: 'bags', t: bag ? t('td.arr.bagMissing') : t('td.arr.bags', { carousel: dest.carousel ?? t('td.arr.theCarousel') }), sub: bag ? t('td.arr.bagRef', { ref: bag, agent: trip.agent.name, airline: outSegment(trip)?.carrierName ?? t('trip.theAirline') }) : t('td.arr.bagsSub'), bag: !bag },
    { id: 'money', t: t('td.arr.money'), sub: dest.atm ? t('td.arr.moneySub', { atm: dest.atm }) : t('td.arr.moneyGeneric') },
    { id: 'driver', t: arrive ? t('td.arr.driverAt', { driver: arrive.driverName ?? '', door: arrive.meetingPoint ?? '' }) : st ? t('td.arr.toHotel') : t('td.arr.gettingThere'), sub: arrive ? `${t('td.arr.sign', { name: signName(trip), waits: arrive.waits ?? '60 min' })}${!st && !own ? ` ${t('td.arr.tellUs')}` : ''}` : t('td.arr.noCar'), address: true },
    st ? { id: 'hotel', t: t(n > 2 ? 'td.arr.rooms' : 'td.arr.room'), sub: t('td.arr.roomSub', { name: st.name, drive: st.fromAirport ?? '45 min' }) }
      : { id: 'hotel', t: own ? t('td.arr.toYours') : t('td.land.where'), sub: own ?? t('td.arr.noHotel') },
  ];
}

function BagSheet({ trip, open, onClose, onDone }: { trip: TripDetail; open: boolean; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const save = useTripMutation((bagReport: string) => tripsApi.patch(trip.id, { bagReport }));
  const out = outSegment(trip);
  const airline = out?.carrierName ?? t('trip.theAirline');
  const dest = destinationOf(trip);
  const ok = /^[A-Z]{5}\d{5}$/.test(ref);
  return (
    <Sheet visible={open} onClose={onClose} label={t('td.bag.label')}>
      <T v="h2">{t('td.bag.title')}</T>
      {[t('td.bag.s1', { airline, carousel: dest.carousel ?? t('td.arr.theCarousel') }), t('td.bag.s2'), t('td.bag.s3')].map((line, i) => (
        <Row key={line} align="flex-start"><Avatar initial={String(i + 1)} size={32} /><T v="body" style={{ flex: 1 }}>{line}</T></Row>
      ))}
      <T style={styles.label}>{t('td.bag.ref')}</T>
      <TextInput testID="bag-ref" value={ref} onChangeText={(v) => setRef(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="ISTSV12345" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="characters" />
      {ref.length > 0 && !ok ? <T v="small" color={colors.bad}>{t('td.bag.err')}</T> : null}
      <Button testID="bag-send" label={t('td.bag.chase')} disabled={!ok} busy={save.isPending} onPress={() => save.mutate(ref, { onSuccess: () => { buzz('success'); toast(t('td.bag.toast', { agent: trip.agent.name, airline })); onDone(); } })} />
      <Tiny>{t('td.bag.foot', { airline })}</Tiny>
    </Sheet>
  );
}

export function Landed({ trip }: { trip: TripDetail }) {
  const [local, update] = useTripLocal(trip.id);
  const [sheet, setSheet] = useState<'address' | 'bag' | null>(null);
  const out = outSegment(trip);
  const st = liveStay(trip);
  const steps = arrivalSteps(trip);
  const done = local.arrival;
  const cur = steps.find((s) => !done.includes(s.id));
  const count = steps.filter((s) => done.includes(s.id)).length;
  const tick = (id: string) => { buzz('select'); update((l) => ({ arrival: [...new Set([...l.arrival, id])] })); };
  const picks = trip.picks.length;
  useEffect(() => { const h = setTimeout(() => buzz('soft'), 300); return () => clearTimeout(h); }, []);
  const addressLabel = !st && !trip.noStay ? t('td.land.where') : arrivalPickup(trip) ? (st ? t('td.arr.hotelAddress') : t('td.arr.theAddress')) : t('td.land.gettingThere');
  return (
    <>
      <Rise>
        <Photo k={trip.imageUrl} style={[{ height: 236, borderRadius: radii.card }, shadow('focal')]}>
          <Veil id="landed" />
          <View style={styles.top}>
            <Tag tone="glass" label={t('td.arr.landed', { time: out ? addMinutes(out.arriveLocal.slice(11, 16), -3 + (out.delayMin ?? 0)) : '', to: out?.to ?? '' })} icon={<Dot color={colors.live} />} />
            {out && sameTimeAsHome(out) ? <Tag tone="glass" label={t('td.arr.sameTime')} /> : null}
          </View>
          <View style={{ flex: 1, justifyContent: 'flex-end', padding: 18, gap: 2 }}>
            <Display size={42} color={colors.paper}>{t('td.arr.welcome', { city: trip.city })}</Display>
            {trip.weather ? <T style={{ fontSize: 14, lineHeight: 19, color: 'rgba(255,253,249,0.9)', fontFamily: ff.ui400 }}>{t('td.arr.weather', { temp: trip.weather.tempC, summary: trip.weather.summary.split('.')[0]!.toLowerCase() })}</T> : null}
          </View>
        </Photo>
      </Rise>
      {picks > 0 ? (
        <Rise step={1}><Box style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}><Icon name="star" size={18} color={colors.goldDeep} /><Grow><H3>{t(picks === 1 ? 'td.arr.booking.one' : 'td.arr.booking.other', { n: picks })}</H3><Small>{t('td.arr.bookingSub')}</Small></Grow></Box></Rise>
      ) : null}
      <Rise step={1}>
        <Box padding={18} gap={14} testID="arrival">
          <Spread><H3 size={18}>{cur ? t('td.arr.now') : t('td.arr.through')}</H3><Num size={12} color={colors.ink3} weight={500}>{t('td.arr.count', { n: count, total: steps.length })}</Num></Spread>
          <View>
            {steps.map((s, i) => {
              const isDone = done.includes(s.id);
              const isNow = cur?.id === s.id;
              return (
                <Row key={s.id} align="flex-start" gap={12} style={{ paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
                  {i < steps.length - 1 ? <View style={styles.line} /> : null}
                  <View style={[styles.mark, isDone ? { backgroundColor: colors.ok, borderColor: colors.ok } : isNow ? { borderColor: colors.gold } : null]}>
                    {isDone ? <Icon name="check" size={13} color={colors.paper} width={2.8} /> : isNow ? <Dot color={colors.gold} /> : null}
                  </View>
                  <Grow gap={3}>
                    <T style={{ fontSize: 15, lineHeight: 20, fontFamily: isDone || isNow ? ff.ui600 : ff.ui500, color: isDone ? colors.ink3 : isNow ? colors.green : colors.ink2 }}>{s.t}</T>
                    {isNow || (s.id === 'bags' && trip.bagReport) ? <Small>{s.sub}</Small> : null}
                    {isNow ? (
                      <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 6 }}>
                        {s.address ? <SmallButton testID="arr-address" tone="gold" label={addressLabel} onPress={() => setSheet('address')} /> : null}
                        {s.bag ? <SmallButton testID="arr-bags" tone="primary" label={t('td.arr.gotBags')} onPress={() => tick(s.id)} /> : null}
                        {s.bag ? <SmallButton testID="arr-missing" tone="soft" label={t('td.arr.bagDidnt')} onPress={() => setSheet('bag')} /> : null}
                        {!s.bag ? <SmallButton testID={`arr-${s.id}`} tone={s.address ? 'soft' : 'primary'} label={s.id === 'driver' ? t('td.arr.withDriver') : s.id === 'hotel' ? (st ? t('td.arr.atHotel') : t('td.arr.there')) : t('td.arr.done')} onPress={() => tick(s.id)} /> : null}
                      </Row>
                    ) : null}
                  </Grow>
                </Row>
              );
            })}
          </View>
          {!cur ? (
            <View style={{ gap: 8 }}>
              <Small>{picks ? t('td.arr.restPicks') : t('td.arr.rest')}</Small>
              <SmallButton tone="soft" label={st ? t('td.arr.hotelAddress') : t('td.arr.theAddress')} onPress={() => setSheet('address')} />
              <TextLink label={t('td.arr.again')} onPress={() => update(() => ({ arrival: [] }))} />
            </View>
          ) : null}
        </Box>
      </Rise>
      <TalkLine note={t('td.talk.arrival', { agent: trip.agent.name })} agentInitial={trip.agent.initial} about={trip.city} />
      <AddressSheet trip={trip} open={sheet === 'address'} onClose={() => setSheet(null)} />
      <BagSheet trip={trip} open={sheet === 'bag'} onClose={() => setSheet(null)} onDone={() => { setSheet(null); tick('bags'); }} />
    </>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 14, start: 14, end: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, zIndex: 1 },
  mark: { width: 22, height: 22, borderRadius: 99, borderWidth: 1.5, borderColor: '#d6cec2', backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', start: 10, top: 24, bottom: 2, width: 2, backgroundColor: '#ebe4d9' },
  label: { fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.ink2 },
  input: { height: 52, borderRadius: 16, backgroundColor: colors.mist, paddingHorizontal: 16, fontSize: 17, fontFamily: ff.ui500, color: colors.green, letterSpacing: 1 },
});
