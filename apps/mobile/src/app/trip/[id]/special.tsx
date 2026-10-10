import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { addDays, dayOfMonth, destinationOf, formatSar, liveStay, outSegment, backSegment, seatText, stayEnd, weekdayOf, type CreateTripAskRequest, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ArtSuitcase } from '@/components/trips/Arts';
import { RequestStatusPill } from '@/components/trips/Requests';
import { Box, H3, IconTile, Num, PickCard, Rise, Row, Small, Spread, Tiny, TripScreen } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, useOutbox, useDemo, useTrip, useTripMutation, useTripRequests } from '@/lib/trips';
import { colors, ff } from '@/theme';

type Sid = 'wheelchair' | 'meal' | 'bassinet' | 'seats' | 'celebration' | 'prayer' | 'bags' | 'sports' | 'pet';
const SPECIALS: { id: Sid; icon: IconName }[] = [
  { id: 'wheelchair', icon: 'user' }, { id: 'meal', icon: 'food' }, { id: 'bassinet', icon: 'stay' }, { id: 'seats', icon: 'flight' }, { id: 'celebration', icon: 'star' },
  { id: 'prayer', icon: 'globe' }, { id: 'bags', icon: 'bag' }, { id: 'sports', icon: 'bag' }, { id: 'pet', icon: 'pin' },
];

/** Special requests (prototype SpecialRequests): Mada passes them to the airline and the hotel, and says when they confirm. */
export default function SpecialRequests() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const trip = useTrip(id).data?.trip;
  const reqs = useTripRequests(id);
  const queued = useOutbox((s) => s.items.filter((q) => q.kind === 'ask' && q.tripId === id));
  const [forWho, setForWho] = useState<string>('all');
  const [open, setOpen] = useState<Sid | null>(null);
  if (!trip) return <TripScreen title={t('sr.title')}><EmptyState art={<ArtSuitcase />} title={t('sr.emptyTitle')} body={t('sr.emptyBody')} /></TripScreen>;
  const mine = (reqs.data?.requests ?? []).filter((r) => r.area === 'special');
  return (
    <TripScreen title={t('sr.title')}>
      <Rise><T v="h1" accessibilityRole="header">{t('sr.anything')}</T></Rise>
      <Rise step={1}><T v="body" style={{ marginTop: -8 }}>{t('sr.intro', { airline: outSegment(trip)?.carrierName ?? t('trip.theAirline') })}</T></Rise>
      <Row gap={8} style={{ flexWrap: 'wrap' }} >
        {[['all', t('sr.everyoneCap')] as const, ...trip.travellers.map((p) => [p.id, p.firstName] as const)].map(([pid, label]) => <Chip key={pid} label={label} on={forWho === pid} onPress={() => setForWho(pid)} />)}
      </Row>
      <View style={styles.grid}>
        {SPECIALS.map((x) => (
          <Pressable key={x.id} testID={`sr-${x.id}`} accessibilityRole="button" accessibilityLabel={t(`sr.t.${x.id}`)} onPress={() => { buzz('tap'); setOpen(x.id); }} style={({ pressed }) => [styles.tile, pressed ? { transform: [{ scale: 0.98 }] } : null]}>
            <IconTile name={x.icon} />
            <H3 size={15}>{t(`sr.t.${x.id}`)}</H3>
            <Tiny>{t(`sr.s.${x.id}`)}</Tiny>
          </Pressable>
        ))}
      </View>
      {mine.length || queued.length ? (
        <Box testID="sr-asked">
          <H3>{t('sr.asked')}</H3>
          {queued.map((q) => <Spread key={q.id}><Small style={{ flex: 1 }}>{q.kind === 'ask' ? q.title : ''}</Small><RequestStatusPill r={{ id: q.id, tripId: id, kind: 'x', area: 'special', status: 'queued', title: '', short: null, detail: null, withWhom: 'faisal', withName: null, outcome: null, alt: null, yesText: null, quote: null, quoteText: null, createdAt: '', updatedAt: '' }} /></Spread>)}
          {mine.map((r) => (
            <View key={r.id} style={{ gap: 4 }}>
              <Spread><Small style={{ flex: 1 }} color={colors.green}>{r.title}</Small><RequestStatusPill r={r} /></Spread>
              {r.outcome === 'no' && r.alt ? <Tiny>{r.alt}</Tiny> : null}
            </View>
          ))}
        </Box>
      ) : null}
      <Button label={t('sr.else')} variant="ghost" onPress={() => router.push('/support?topic=other' as Href)} />
      {open ? <SpecialSheet trip={trip} sid={open} forWho={forWho} onClose={() => setOpen(null)} /> : null}
    </TripScreen>
  );
}

function SpecialSheet({ trip, sid, forWho, onClose }: { trip: TripDetail; sid: Sid; forWho: string; onClose: () => void }) {
  const router = useRouter();
  const offline = useOffline();
  const addQueued = useOutbox((s) => s.add);
  const [opt, setOpt] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const out = outSegment(trip);
  const back = backSegment(trip);
  const st = liveStay(trip);
  const airline = out?.carrierName ?? t('trip.theAirline');
  const who = forWho === 'all' ? trip.travellers : trip.travellers.filter((p) => p.id === forWho);
  const whoTxt = forWho === 'all' ? t('sr.everyone') : who[0]?.firstName ?? '';
  const year = new Date(trip.clock.now).getUTCFullYear();
  const R = trip.fare;
  const days = (() => { const a = st?.checkIn ?? out?.departLocal.slice(0, 10); const b = back?.departLocal.slice(0, 10) ?? (st ? stayEnd(st) : null); const r: string[] = []; for (let d = a, i = 0; a && b && d! <= b && i < 30; d = addDays(d!, 1), i += 1) r.push(d!); return r; })();
  const [day, setDay] = useState<string | null>(days[2] ?? days[0] ?? null);
  const ask = useTripMutation((b: CreateTripAskRequest) => tripsApi.ask(trip.id, b));
  const send = (o: Omit<CreateTripAskRequest, 'area' | 'kind' | 'clientKey'>, title: string) => {
    const body: CreateTripAskRequest = { area: 'special', kind: sid, travellerIds: forWho === 'all' ? undefined : [forWho], ...o, clientKey: newKey() };
    if (offline) {
      addQueued({ id: body.clientKey, kind: 'ask', tripId: trip.id, body, title, at: Date.now() });
      buzz('soft'); toast(t('sr.queued')); onClose(); return;
    }
    ask.mutate(body, { onSuccess: () => { buzz('success'); toast(sid === 'bags' ? t('sr.bags.toast') : t('sr.sentToast')); onClose(); }, onError: (e) => toast(e.message) });
  };
  const needsFlight = ['wheelchair', 'meal', 'bassinet', 'seats', 'bags', 'sports'].includes(sid);
  let body: React.ReactNode;
  const sendBtn = (title: string, o: Omit<CreateTripAskRequest, 'area' | 'kind' | 'clientKey'> = {}, disabled = false, label = t('action.send')) => <Button testID="sr-send" label={label} disabled={disabled} busy={ask.isPending} onPress={() => send(o, title)} />;
  if (needsFlight && !out) body = (<><T v="body">{t('sr.noFlights', { airline })}</T><Button label={t('sr.close')} onPress={onClose} /></>);
  else if (sid === 'wheelchair') body = (<>
    <Small>{t('sr.w.intro', { who: whoTxt, airline })}</Small>
    {(['gate', 'seat', 'own'] as const).map((o) => <PickCard inSheet radio key={o} testID={`w-${o}`} on={opt === o} onPress={() => setOpt(o)} title={t(`sr.w.${o}`)} sub={t(`sr.w.${o}Sub`)} />)}
    {sendBtn(t(`sr.wheelchair.title.${(opt ?? 'gate') as 'gate'}`), { option: opt ?? undefined }, !opt)}
  </>);
  else if (sid === 'meal') {
    const kids = who.filter((p) => p.birthYear !== null && p.birthYear > year - 12);
    body = (<>
      <Small>{t('sr.m.intro', { airline, who: whoTxt })}</Small>
      {(['child', 'veg', 'diabetic', 'gluten'] as const).map((o) => <PickCard inSheet radio key={o} testID={`m-${o}`} on={opt === o} disabled={o === 'child' && !kids.length} onPress={() => setOpt(o)} title={t(`sr.meal.${o}`)} sub={o === 'child' ? (kids.length ? t('sr.m.for', { names: kids.map((k) => k.firstName).join(', ') }) : t('sr.meal.childOnly')) : t(`sr.m.${o}Sub`)} />)}
      <Tiny>{t('sr.m.foot')}</Tiny>
      {sendBtn(t(`sr.meal.${(opt ?? 'veg') as 'veg'}`), { option: opt ?? undefined }, !opt)}
    </>);
  } else if (sid === 'bassinet') {
    const baby = trip.travellers.some((p) => p.birthYear !== null && p.birthYear >= year - 2);
    body = baby ? (<><Small>{t('sr.b.intro')}</Small>{sendBtn(t('sr.bassinet.title'))}</>) : (<><T v="body">{t('sr.bassinet.none')}</T><Small>{t('sr.b.addBaby')}</Small><Button label={t('sr.close')} onPress={onClose} /></>);
  } else if (sid === 'seats') body = (<>
    <Small>{t(back ? 'sr.se.introBack' : 'sr.se.intro', { out: seatText(out!.seats), back: back ? seatText(back.seats) : '' })}{trip.travellers.length > 1 ? `, ${t('sr.se.side')}` : ''}.</Small>
    <PickCard inSheet radio testID="se-keep" on={opt === 'keep'} onPress={() => setOpt('keep')} title={t('sr.se.keep')} sub={t('sr.se.keepSub')} />
    <PickCard inSheet radio on={opt === 'kids'} onPress={() => setOpt('kids')} title={t('sr.se.kids')} sub={t('sr.se.kidsSub')} />
    {sendBtn(t('sr.seats.keep'), { option: opt ?? undefined }, !opt)}
  </>);
  else if (sid === 'celebration') body = (<>
    <Small>{t('sr.c.intro')}</Small>
    <Row gap={8} style={{ flexWrap: 'wrap' }}>{(['Birthday', 'Anniversary', 'Something else'] as const).map((k) => <Chip key={k} label={t(`sr.celebration.${k === 'Something else' ? 'else' : k.toLowerCase() as 'birthday'}`)} on={opt === k} onPress={() => setOpt(k)} />)}</Row>
    <Row gap={8} style={{ flexWrap: 'wrap' }}>{days.map((d) => <Chip key={d} label={`${weekdayOf(d)} ${dayOfMonth(d)}`} on={day === d} onPress={() => setDay(d)} />)}</Row>
    <T style={styles.label}>{t('sr.c.note')}</T>
    <TextInput testID="sr-note" value={note} onChangeText={setNote} maxLength={80} placeholder={forWho === 'all' ? t('sr.c.notePh') : t('sr.c.notePhOne', { name: whoTxt })} placeholderTextColor={colors.muted} style={styles.input} />
    {sendBtn(t('sr.celebration.birthday'), { option: opt ?? undefined, day: day ?? undefined, note: note || undefined }, !opt)}
  </>);
  else if (sid === 'prayer') {
    const dest = destinationOf(trip);
    body = (<>
      {dest.prayer ? <Small>{t('sr.p.times', { city: trip.city, times: dest.prayer })}</Small> : null}
      <PickCard inSheet on={opt === 'mat'} onPress={() => setOpt(opt === 'mat' ? null : 'mat')} title={t('sr.prayer.title')} sub={dest.qibla ?? t('sr.p.qibla')} />
      {dest.mosques ? <Tiny>{dest.mosques}</Tiny> : null}
      {sendBtn(t('sr.prayer.title'), {}, !opt)}
    </>);
  } else if (sid === 'bags') {
    const people = forWho === 'all' ? trip.travellers.length : 1;
    const legsN = back ? 2 : 1;
    const price = (R?.bagFee ?? 25000) * count * legsN;
    body = (<>
      <Small>{t('sr.bg.intro', { bags: R?.bags ?? '', airline, kg: R?.bagKg ?? 23, fee: formatSar(R?.bagFee ?? 25000) })}</Small>
      <Box tone="well" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Small color={colors.green} style={{ flex: 1 }}>{forWho === 'all' ? t('sr.bg.total') : t('sr.bg.for', { who: whoTxt })}</Small>
        <Row gap={6}>
          <Pressable testID="bags-minus" accessibilityRole="button" accessibilityLabel={t('sr.bg.fewer')} disabled={count <= 1} onPress={() => setCount(Math.max(1, count - 1))} style={styles.step}><T style={{ fontSize: 22 }}>−</T></Pressable>
          <Num size={16} style={{ minWidth: 20, textAlign: 'center' }}>{String(count)}</Num>
          <Pressable testID="bags-plus" accessibilityRole="button" accessibilityLabel={t('sr.bg.more')} disabled={count >= people * 2} onPress={() => setCount(Math.min(people * 2, count + 1))} style={styles.step}><Icon name="plus" size={18} /></Pressable>
        </Row>
      </Box>
      <Spread><Small>{`${count} × ${formatSar(R?.bagFee ?? 25000)}${legsN === 2 ? ` × ${t('sr.bg.twoFlights')}` : ''}`}</Small><Num size={16}>{formatSar(price)}</Num></Spread>
      {sendBtn(t('sr.bags.short'), { count }, false, t('sr.bg.ask', { amount: formatSar(price) }))}
    </>);
  } else if (sid === 'sports') body = (<>
    <Small>{t('sr.sp.intro', { kg: R?.bagKg ?? 23 })}</Small>
    {(['golf', 'bike', 'ski'] as const).map((o) => <PickCard inSheet radio key={o} on={opt === o} onPress={() => setOpt(o)} title={t(`sr.sp.${o}`)} sub={t(`sr.sp.${o}Sub`)} />)}
    {sendBtn(t(`sr.sports.${(opt ?? 'golf') as 'golf'}`), { option: opt ?? undefined }, !opt)}
  </>);
  else body = (<>
    <T v="body">{t('sr.pet.no', { airline })}</T>
    <Small>{t('sr.pet.guide')}</Small>
    <Button label={t('action.talk')} onPress={() => { onClose(); router.push('/support?topic=other' as Href); }} />
  </>);
  return (
    <Sheet visible onClose={onClose} label={t(`sr.t.${sid}`)}>
      <Row><IconTile name={SPECIALS.find((x) => x.id === sid)!.icon} /><T v="h2">{t(`sr.t.${sid}`)}</T></Row>
      {body}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, borderRadius: 22, backgroundColor: colors.paper, padding: 14, gap: 6, minHeight: 128 },
  label: { fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.ink2 },
  input: { height: 52, borderRadius: 16, backgroundColor: colors.mist, paddingHorizontal: 16, fontSize: 16, fontFamily: ff.ui500, color: colors.green },
  step: { width: 44, height: 44, borderRadius: 99, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
});
