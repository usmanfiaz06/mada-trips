import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import Svg, { Circle, Defs, Path, Text as SvgText, TextPath } from 'react-native-svg';
import { backSegment, daysBetween, dayOfMonth, destinationOf, formatNumber, formatSar, localizeDigits, liveStay, monthOf, outSegment, type RefundView, type TripDetail, type TripRating } from '@mada/shared';
import { Icon } from '@/components/Icon';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { AgentFace, Box, Display, Eyebrow, Grow, H3, Num, Photo, Rise, Row, Small, SmallButton, Spread, Tag, TextLink, Tiny, Veil } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { tripsApi, useTripMutation, useTrips } from '@/lib/trips';
import { colors, ff, radii, shadow } from '@/theme';
import { useTripLocal } from './local';

/** The passport stamp for this trip, landing with a thunk. */
function Stamp({ day, label, code }: { day: string; label: string; code: string }) {
  useEffect(() => { const h = setTimeout(() => buzz('thunk'), 520); return () => clearTimeout(h); }, []);
  return (
    <View style={styles.stamp} accessibilityLabel={t('td.home.stampA11y', { label, day })}>
      <Svg viewBox="0 0 120 120" width={104} height={104}>
        <Defs><Path id="arc" d="M60 60 m-41 0 a41 41 0 1 1 82 0 a41 41 0 1 1 -82 0" /></Defs>
        <Circle cx={60} cy={60} r={55} fill="rgba(255,253,249,.12)" stroke="#e8cf9c" strokeWidth={3} />
        <Circle cx={60} cy={60} r={33} fill="none" stroke="#e8cf9c" strokeWidth={1.5} />
        <SvgText fontFamily={ff.ui700} fontSize={10.5} letterSpacing={2.2} fill="#e8cf9c"><TextPath href="#arc">{label}</TextPath></SvgText>
        <SvgText x={60} y={56} textAnchor="middle" fontFamily={ff.ui700} fontSize={13} fill={colors.paper}>{`${String(dayOfMonth(day)).padStart(2, '0')} ${monthOf(day).toUpperCase()}`}</SvgText>
        <SvgText x={60} y={72} textAnchor="middle" fontFamily={ff.ui600} fontSize={10} fill="#e8cf9c">{`${day.slice(0, 4)} · ${code}`}</SvgText>
      </Svg>
    </View>
  );
}

const QS = [
  { id: 'hotel' as const, needs: 'stay', opts: [['yes', 'td.rate.yes'], ['no', 'td.rate.no']] },
  { id: 'driver' as const, needs: 'pickup', opts: [['great', 'td.rate.great'], ['fine', 'td.rate.fine'], ['poor', 'td.rate.poor']] },
  { id: 'agent' as const, needs: null, opts: [['great', 'td.rate.great'], ['fine', 'td.rate.fine'], ['poor', 'td.rate.poor']] },
];

/** Same hotel next time? How were the drivers? And the agent? Then a note. Sent to the agent, who reads every one. */
function RateTrip({ trip }: { trip: TripDetail }) {
  const [r, setR] = useState<Partial<TripRating>>(trip.rating ?? {});
  const [note, setNote] = useState(trip.rating?.note ?? '');
  const save = useTripMutation((b: { send?: boolean; rating: Partial<TripRating> }) => tripsApi.patch(trip.id, { rating: { hotel: b.rating.hotel ?? null, driver: b.rating.driver ?? null, agent: b.rating.agent ?? null, note: b.rating.note ?? null, send: b.send } }));
  const st = trip.stays[0];
  const home = trip.pickups.find((p) => p.direction === 'to_airport');
  const arrive = trip.pickups.find((p) => p.direction === 'from_airport');
  const qs = QS.filter((q) => !q.needs || (q.needs === 'stay' ? !!st : trip.pickups.length > 0));
  const step = qs.find((q) => !r[q.id]);
  const answered = qs.filter((q) => r[q.id]).length;
  const who = (id: string) => (id === 'hotel' ? st?.name ?? '' : id === 'driver' ? t('td.rate.drivers', { a: home?.driverName ?? '', b: arrive?.driverName ?? '', city: trip.city }) : t('td.rate.agentWho'));
  const reply = r.hotel === 'yes' ? t('td.rate.hotelYes') : r.hotel === 'no' ? t('td.rate.hotelNo') : '';
  if (trip.rating?.sentAt && r.sentAt !== null) {
    return (
      <Box padding={18} gap={12} testID="rate-sent">
        <Row gap={10}><AgentFace initial={trip.agent.initial} online={false} /><H3 size={16}>{t('td.rate.thanks', { agent: trip.agent.name })}</H3></Row>
        <Small>{reply} {trip.rating.note ? t('td.rate.noteWent') : ''}</Small>
        <TextLink label={t('td.rate.change')} onPress={() => { setR({ sentAt: null }); }} />
      </Box>
    );
  }
  const answer = (id: 'hotel' | 'driver' | 'agent', v: string) => { buzz('select'); const next = { ...r, [id]: v }; setR(next); save.mutate({ rating: next }); };
  return (
    <Box padding={18} gap={12} testID="rate">
      <Spread>
        <Eyebrow>{t('td.rate.how')}</Eyebrow>
        <Row gap={6}>{qs.map((q) => <View key={q.id} style={[styles.dot, r[q.id] ? { backgroundColor: colors.ok } : step?.id === q.id ? { backgroundColor: colors.gold, width: 26 } : null]} />)}</Row>
      </Spread>
      {step ? (
        <View style={{ gap: 12 }} key={step.id}>
          <View style={{ gap: 2 }}><Display size={28}>{t(`td.rate.q.${step.id}` as never, { agent: trip.agent.name })}</Display><Small>{who(step.id)}</Small></View>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>{step.opts.map(([v, k], i) => <SmallButton key={v} testID={`rate-${step.id}-${v}`} tone={i === 0 ? 'primary' : 'soft'} label={t(k as never)} onPress={() => answer(step.id, v!)} />)}</Row>
          {answered > 0 && reply ? <Tiny>{reply}</Tiny> : null}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Display size={28}>{t('td.rate.anything', { agent: trip.agent.name })}</Display>
          <TextInput testID="rate-note" value={note} onChangeText={setNote} multiline placeholder={t('td.rate.notePh')} placeholderTextColor={colors.muted} style={styles.note} accessibilityLabel={t('td.rate.noteA11y', { agent: trip.agent.name })} />
          <Row gap={8}>
            <SmallButton testID="rate-send" tone="primary" label={t('action.send')} onPress={() => save.mutate({ send: true, rating: { ...r, note: note.trim() || null } }, { onSuccess: () => { buzz('success'); toast(t('td.rate.sent')); } })} />
            <SmallButton tone="soft" label={t('common.back')} onPress={() => { const last = qs[qs.length - 1]!.id; setR({ ...r, [last]: null }); }} />
          </Row>
        </View>
      )}
    </Box>
  );
}

/** Three favourite photos on the trip card. Kept on this phone. */
function Memories({ trip }: { trip: TripDetail }) {
  const [local, update] = useTripLocal(trip.id);
  const photos = local.photos;
  const n = trip.travellers.length;
  const add = async () => {
    try {
      const IP = await import('expo-image-picker');
      const r = await IP.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 3 - photos.length, quality: 0.6 });
      if (r.canceled) return;
      const uris = r.assets.map((a) => a.uri).slice(0, 3 - photos.length);
      update((l) => ({ photos: [...l.photos, ...uris].slice(0, 3) }));
      buzz('success');
      if (photos.length + uris.length >= 3) toast(t('td.mem.added', { city: trip.city }));
    } catch { toast(t('td.mem.cant')); }
  };
  return (
    <Box padding={18} gap={16}>
      <View style={{ gap: 2 }}>
        <H3 size={17}>{photos.length >= 3 ? t('td.mem.three') : t('td.mem.add')}</H3>
        <Small>{n > 1 ? (photos.length >= 3 ? t('td.mem.onTripMany', { you: t('trip.ofYou.many', { n: ['', 'one', 'two', 'three', 'four', 'five'][n] ?? n }) }) : t('td.mem.goMany', { you: t('trip.ofYou.many', { n: ['', 'one', 'two', 'three', 'four', 'five'][n] ?? n }) })) : photos.length >= 3 ? t('td.mem.onTrip') : t('td.mem.go')}</Small>
      </View>
      <Row gap={12} style={{ paddingHorizontal: 4 }}>
        {[0, 1, 2].map((i) => photos[i] ? (
          <View key={i} style={[styles.pola, { transform: [{ rotate: `${[-4, 2, 5][i]}deg` }] }]}>
            <Image source={{ uri: photos[i] }} style={{ flex: 1, borderRadius: 6 }} contentFit="cover" />
            <Pressable accessibilityLabel={t('td.mem.remove', { n: i + 1 })} onPress={() => update((l) => ({ photos: l.photos.filter((_, k) => k !== i) }))} style={styles.polaX}><Icon name="close" size={12} color={colors.mist} /></Pressable>
          </View>
        ) : (
          <Pressable key={i} testID={`mem-add-${i}`} accessibilityRole="button" accessibilityLabel={t('td.mem.addOne')} onPress={() => void add()} style={[styles.pola, styles.polaEmpty, { transform: [{ rotate: `${[-4, 2, 5][i]}deg` }] }]}><Icon name="plus" size={22} color={colors.goldInk} /></Pressable>
        ))}
      </Row>
    </Box>
  );
}

const season = (m: number) => (m >= 9 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : 'summer');
function ideasFor(when: string, n: number, baku: boolean) {
  const us = n > 1 ? t('td.ideas.forUs', { n }) : t('td.ideas.forMe');
  const I = {
    winter: [['alula', 'alula-elephant-rock', 'td.ideas.alula', 'td.ideas.alulaWinter', t('td.ideas.alulaAsk')], ['season', 'riyadh-kingdom-centre', 'td.ideas.season', 'td.ideas.seasonNote', t('td.ideas.seasonAsk', { us })], ['snow', 'inflight-wing', 'td.ideas.snow', 'td.ideas.snowNote', t('td.ideas.snowAsk', { us })]],
    spring: [['alula', 'alula-elephant-rock', 'td.ideas.alula', 'td.ideas.alulaSpring', t('td.ideas.alulaAsk')], ['abha', 'abha-mountains', 'td.ideas.abha', 'td.ideas.abhaSpring', t('td.ideas.abhaAsk')], ['riyadh', 'riyadh-night', 'td.ideas.riyadh', 'td.ideas.riyadhNote', t('td.ideas.riyadhAsk')]],
    summer: [['abha', 'abha-mountains', 'td.ideas.abha', 'td.ideas.abhaSummer', t('td.ideas.abhaAsk')], baku ? ['baku', 'baku-old-city', 'td.ideas.baku', 'td.ideas.bakuNote', t('td.ideas.bakuAsk', { us })] : ['tbilisi', 'tbilisi-old-town', 'td.ideas.tbilisi', 'td.ideas.tbilisiNote', t('td.ideas.tbilisiAsk', { us })], ['alula', 'alula-elephant-rock', 'td.ideas.alulaOct', 'td.ideas.alulaOctNote', t('td.ideas.alulaAsk')]],
  } as Record<string, string[][]>;
  return I[when]!.map(([id, photo, title, note, ask]) => ({ id: id!, photo: photo!, title: t(title as never), note: t(note as never), ask: ask! }));
}

export function Home({ trip }: { trip: TripDetail }) {
  const router = useRouter();
  const { data } = useTrips();
  const [local] = useTripLocal(trip.id);
  const out = outSegment(trip);
  const back = backSegment(trip);
  const st = trip.stays[0];
  const start = out ? out.departLocal.slice(0, 10) : st?.checkIn ?? trip.startDate;
  const nights = back ? daysBetween(start, back.departLocal.slice(0, 10)) : liveStay(trip)?.nights ?? 0;
  const n = trip.travellers.length;
  const stamps = data?.stamps ?? 0;
  const dest = destinationOf(trip);
  const refunds: RefundView[] = (data?.refunds ?? []).filter((r) => r.tripId === trip.id && (r.stage === 'requested' || r.stage === 'approved'));
  const credit = data?.credit.amount ?? 0;
  const month = new Date(trip.clock.now).getUTCMonth();
  const s = season(month);
  const ideas = ideasFor(s, n, (data?.past ?? []).some((p) => p.city === 'Baku'));
  const km = out && back ? 4930 : out ? 2465 : 0;
  const parts = [out ? `${back ? t('td.home.flights') : t('td.home.flight')} ${formatSar(trip.prices.flights.amount, { bare: true })}` : null, trip.prices.stays.amount ? `${t('td.home.stay')} ${formatSar(trip.prices.stays.amount, { bare: true })}` : null, trip.prices.pickups.amount ? `${t('td.home.pickups')} ${formatSar(trip.prices.pickups.amount, { bare: true })}` : null].filter(Boolean).join(' · ');
  return (
    <>
      <Rise style={{ gap: 6 }}>
        <Display size={46}>{t('td.home.title')}</Display>
        <T v="body">{out && !back ? t('td.home.oneWay', { agent: trip.agent.name }) : out && dest.city === 'Istanbul' ? t('td.home.noLag', { city: trip.city }) : t('td.home.rest')}</T>
      </Rise>
      <Rise step={1}>
        <View style={[styles.recap, shadow('focal')]} testID="recap">
          {local.photos[0] ? <Image source={{ uri: local.photos[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Photo k={trip.imageUrl} style={[StyleSheet.absoluteFill, { borderRadius: 0 }]} />}
          <Veil id="recap" />
          <View style={{ position: 'absolute', top: 14, start: 14 }}><Tag tone="glass" label={trip.endDate ? `${dayOfMonth(trip.startDate)}–${dayOfMonth(trip.endDate)} ${monthOf(trip.endDate)}` : trip.startDate} /></View>
          <Stamp day={start} label={dest.stamp} code={out?.to ?? ''} />
          <View style={{ padding: 18, gap: 12 }}>
            <View style={{ gap: 4 }}>
              <Display size={36} color={colors.paper}>{nights ? t(nights === 1 ? 'td.home.night' : 'td.home.nights', { n: nights, city: trip.city }) : trip.city}</Display>
              <T style={{ color: 'rgba(255,253,249,0.88)', fontSize: 14, lineHeight: 19 }}>{t('td.home.newStamp', { country: dest.country })} {stamps ? t('td.home.countries', { n: stamps + 1 }) : t('td.home.first')}</T>
            </View>
            <View style={styles.stats}>
              {[[formatNumber(km), t('td.home.km')], [localizeDigits(String(nights)), nights === 1 ? t('td.home.nightWord') : t('td.home.nightsWord')], [localizeDigits(String(n)), n === 1 ? t('td.home.traveller') : t('td.home.ofYou')]].map(([v, k]) => (
                <View key={k} style={styles.stat}><Num size={20} color={colors.paper}>{v}</Num><T style={{ fontSize: 12, color: 'rgba(255,253,249,0.8)' }}>{k}</T></View>
              ))}
            </View>
          </View>
        </View>
      </Rise>
      <Rise step={2}><RateTrip trip={trip} /></Rise>
      <Box padding={18} gap={12}>
        <Spread align="flex-start">
          <View><Tiny>{t('td.home.whole')}</Tiny><Num size={26}>{formatSar(trip.prices.total.amount)}</Num></View>
          <Tag tone="ok" label={t('td.home.noExtra')} />
        </Spread>
        <Tiny>{parts}</Tiny>
        {refunds.map((r) => (
          <View key={r.id} style={styles.moneyRow}><Icon name="refund" size={20} color={colors.goldInk} /><Grow gap={1}><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('td.home.refund', { amount: formatSar(r.amount.amount) })}</T><Tiny>{r.stage === 'requested' ? t('td.home.refundAsked', { airline: r.airline ?? t('trip.theAirline') }) : t('td.home.refundApproved', { card: r.card })}</Tiny></Grow></View>
        ))}
        {credit > 0 ? (
          <Pressable onPress={() => { buzz('tap'); router.push('/ask'); }} style={styles.moneyRow}>
            <View style={styles.credit}><Sun width={20} /></View>
            <Grow gap={1}><T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('td.home.credit', { amount: formatSar(credit) })}</T><Tiny>{t('td.home.creditSub')}</Tiny></Grow>
            <Icon name="chevron" size={18} />
          </Pressable>
        ) : null}
        <SmallButton tone="soft" label={t('td.home.receipts')} onPress={() => router.push(`/trip/${trip.id}/payments` as Href)} />
      </Box>
      <Memories trip={trip} />
      <Spread style={{ marginTop: 6 }}>
        <T v="h2" style={{ fontSize: 22, lineHeight: 27 }}>{t(`td.home.good.${s}` as never)}</T>
        <TextLink label={t('td.home.planNext')} onPress={() => router.push('/ask')} />
      </Spread>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 20, paddingBottom: 6 }}>
        {ideas.map((c) => (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => { buzz('tap'); router.push(`/ask?prefill=${encodeURIComponent(c.ask)}` as Href); }}>
            <Photo k={c.photo} style={{ width: 200, height: 250, borderRadius: radii.card }}>
              <Veil id={`idea-${c.id}`} />
              <View style={{ flex: 1, justifyContent: 'flex-end', padding: 14, gap: 2 }}>
                <Display size={28} color={colors.paper}>{c.title}</Display>
                <T style={{ fontSize: 13, lineHeight: 17, color: 'rgba(255,253,249,0.9)' }}>{c.note}</T>
              </View>
            </Photo>
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  stamp: { position: 'absolute', top: 46, end: 16, transform: [{ rotate: '-14deg' }], zIndex: 2 },
  dot: { width: 18, height: 4, borderRadius: 9, backgroundColor: '#e3dcd1' },
  note: { minHeight: 88, borderRadius: 16, backgroundColor: colors.mist, padding: 12, paddingHorizontal: 16, fontSize: 15, lineHeight: 21, color: colors.green, fontFamily: ff.ui400, textAlignVertical: 'top' },
  pola: { flex: 1, aspectRatio: 1 / 1.1, borderRadius: 10, backgroundColor: '#fff', padding: 5, paddingBottom: 16 },
  polaEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.goldDeep, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center', padding: 0 },
  polaX: { position: 'absolute', top: -8, end: -8, width: 26, height: 26, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  recap: { minHeight: 360, borderRadius: 28, overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: colors.green },
  stats: { flexDirection: 'row', borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,253,249,0.18)', gap: 1, backgroundColor: 'rgba(255,253,249,0.16)' },
  stat: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(15,26,22,0.4)', gap: 1 },
  moneyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#f3ead8' },
  credit: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
