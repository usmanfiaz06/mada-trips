import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { addDays, dayLabel, durationLabel, FlightNumber, AIRPORT_CITY, todayIn, type TrackedFlightView } from '@mada/shared';
import { ArtFriends, ArtPass } from '@/components/art/Arts';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { VGradient } from '@/components/Gradient';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { Box, Display, Eyebrow, H3, Rise, Row, RouteLine, Small, Spread, Tag, TextLink, Tiny, Dot } from '@/components/trips/ui';
import { eidLine } from '@/lib/days';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { usePeople, useUpdateMe } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, tk, useGuestFlights, useTrips, useTripMutation, type GuestFlight } from '@/lib/trips';
import { colors, ff, font, radii, shadow } from '@/theme';
import { RequestsCard } from './common';

const SERVICES: [IconName, 'today.service.flight' | 'today.service.stay' | 'today.service.visa' | 'today.service.umrah' | 'today.service.car' | 'today.service.food' | 'today.service.todo', string][] = [
  ['flight', 'today.service.flight', 'flight'], ['stay', 'today.service.stay', 'stay'], ['visa', 'today.service.visa', 'visa'], ['umrah', 'today.service.umrah', 'umrah'],
  ['car', 'today.service.car', 'car'], ['food', 'today.service.food', 'food'], ['star', 'today.service.todo', 'todo'],
];

export function Composer({ title = t('today.composer.title') }: { title?: string }) {
  const router = useRouter();
  return (
    <Card padding={18} style={[{ gap: 14 }, shadow('card')]}>
      <Card onPress={() => router.push('/ask')} padding={0} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' }} accessibilityLabel={title}>
        <View style={{ flex: 1, gap: 4 }}>
          <T style={font('displaySmall')}>{title}</T>
          <T v="small">{t('today.composer.body')}</T>
        </View>
        <View style={styles.mic}><Icon name="mic" color={colors.mist} size={20} /></View>
      </Card>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 18 }}>
        {SERVICES.map(([icon, key, intent]) => <Chip key={key} label={t(key)} icon={(c) => <Icon name={icon} size={18} color={c} />} onPress={() => router.push(`/ask?intent=${intent}` as Href)} />)}
      </ScrollView>
    </Card>
  );
}

/** Today with nothing planned (EXPERIENCE.md §6.2): one timely line, Ask, the passport nudge, at most 4 tiles. */
export function Nothing({ pastLine }: { pastLine: string | null }) {
  const router = useRouter();
  const people = usePeople();
  const { data } = useTrips();
  const hasPassport = people.data?.some((p) => p.isSelf && p.passport);
  const family = (people.data?.length ?? 1) > 1;
  return (
    <>
      <View style={{ gap: 8 }}>
        <Rise step={0}><T style={[font('display'), { fontSize: 46, lineHeight: 48 }]} accessibilityRole="header">{t('today.nothing.title')}</T></Rise>
        <Rise step={1}><T v="body">{eidLine(new Date())}{pastLine ? ` ${pastLine}` : ''}</T></Rise>
      </View>
      <Rise step={2}><Composer /></Rise>
      <RequestsCard />
      {(data?.tracked.length ?? 0) > 0 ? <TrackedFlights flights={data!.tracked} /> : null}
      {!hasPassport && (
        <Rise step={3}>
          <Card variant="notice" onPress={() => router.push('/wallet')} accessibilityLabel={t('today.passport.title')}>
            <View style={styles.ppMini}><View style={styles.ppMiniRing} /></View>
            <View style={{ flex: 1, gap: 4 }}><T v="h3">{t('today.passport.title')}</T><T v="small">{t('today.passport.body')}</T></View>
            <Icon name="chevron" />
          </Card>
        </Rise>
      )}
      <Rise step={4} style={styles.bento}>
        <Card onPress={() => router.push(`/ask?prefill=${encodeURIComponent(t('td.ideas.alulaAsk'))}` as Href)} padding={0} style={styles.photoTile} accessibilityLabel={t('today.tile.alula.title')}>
          <Image source={require('../../../assets/images/alula.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
          <VGradient id="alula" stops={[[0, 'rgba(15,26,22,0.05)'], [0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />
          <View style={{ padding: 16, gap: 4 }}>
            <T style={[font('displaySmall', colors.paper), { fontSize: 28 }]}>{t('today.tile.alula.title')}</T>
            <T v="small" color="rgba(255,253,249,0.9)">{t('today.tile.alula.body')}</T>
          </View>
        </Card>
        <View style={{ flex: 1, gap: 12 }}>
          <Card variant="focal" onPress={() => router.push(`/ask?prefill=${encodeURIComponent('Istanbul')}` as Href)} style={styles.smallTile} accessibilityLabel={t('today.tile.istanbul.title')}>
            <Spread>
              <Image source={require('../../../assets/images/istanbul.jpg')} style={styles.cityDot} contentFit="cover" />
              <Icon name="chevron" color={colors.gold} />
            </Spread>
            <View><T v="h3" color={colors.mist}>{t('today.tile.istanbul.title')}</T><T v="tiny" color={colors.onDark2}>{t('today.tile.istanbul.body')}</T></View>
          </Card>
          <Card onPress={() => router.push(family ? '/circles' : '/wallet')} style={styles.smallTile} accessibilityLabel={family ? t('td.tile.circle') : t('today.tile.family.title')}>
            <View style={{ marginStart: -8, marginTop: -6 }}><ArtFriends width={66} height={50} /></View>
            <View><T v="h3">{family ? t('td.tile.circle') : t('today.tile.family.title')}</T><T v="tiny">{family ? t('td.tile.circleBody') : t('today.tile.family.body')}</T></View>
          </Card>
        </View>
      </Rise>
    </>
  );
}

/* ───────── tracking a flight, signed in or not ───────── */

type Shown = Pick<TrackedFlightView, 'id' | 'flightNumber' | 'carrierName' | 'date' | 'from' | 'to' | 'departLocal' | 'arriveLocal' | 'durationMin' | 'brand' | 'known' | 'alerts' | 'status'>;

/** Flights the traveller asked us to watch. On the account (or this phone, for a guest), so they survive sign-up. */
export function TrackedFlights({ flights, title, onStop }: { flights: Shown[]; title?: string; onStop?: (f: Shown) => void }) {
  const stop = useTripMutation((id: string) => tripsApi.untrack(id));
  const notifications = useSession((s) => s.user?.notifications);
  const today = todayIn();
  if (!flights.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {title ? <Eyebrow style={{ paddingHorizontal: 4 }}>{title}</Eyebrow> : null}
      {flights.map((f) => {
        const when = f.date === today ? t('td.when.today') : f.date === addDays(today, 1) ? t('td.when.tomorrow') : dayLabel(f.date);
        return (
          <Box key={f.id} gap={12} testID={`tracked-${f.flightNumber}`}>
            <Spread>
              <Row gap={10}>
                <View style={[styles.trackMark, { backgroundColor: f.brand ?? colors.green }]}><T style={{ color: '#fff', fontFamily: ff.ui700, fontSize: 12 }}>{f.flightNumber.slice(0, 2)}</T></View>
                <View><H3 size={15}>{f.flightNumber}{f.carrierName ? ` · ${f.carrierName}` : ''}</H3><Tiny>{when}</Tiny></View>
              </Row>
              {f.known ? <Tag tone="ok" label={t(f.status === 'delayed' ? 'td.track.late' : 'td.track.onTime')} icon={<Dot color={colors.ok} size={6} />} /> : <Tag label={t('td.track.waiting')} />}
            </Spread>
            {f.known && f.departLocal && f.arriveLocal && f.from && f.to
              ? <RouteLine dep={f.departLocal.slice(11, 16)} arr={f.arriveLocal.slice(11, 16)} from={f.from} to={f.to} durationMin={f.durationMin} />
              : <Small>{t('td.track.unknown')}</Small>}
            <Spread>
              <Tiny style={{ flex: 1 }}>{f.alerts ? t('td.track.alerts') : notifications === 'declined' ? t('td.track.alertsOff') : t('td.track.noAlerts')}{f.known && f.from && f.to ? ` · ${t('td.track.fromTo', { from: AIRPORT_CITY[f.from] ?? f.from, to: AIRPORT_CITY[f.to] ?? f.to })}` : ''}</Tiny>
              <TextLink label={t('td.track.stop')} size={13} onPress={() => { if (onStop) onStop(f); else stop.mutate(f.id); toast(t('td.track.stopped', { code: f.flightNumber })); }} />
            </Spread>
          </Box>
        );
      })}
    </View>
  );
}

/** Number, then the day, then (once) whether to alert. */
export function TrackFlight({ guest }: { guest: boolean }) {
  const [q, setQ] = useState('');
  const [touched, setTouched] = useState(false);
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'pick' | null>(null);
  const [picked, setPicked] = useState('');
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const user = useSession((s) => s.user);
  const updateMe = useUpdateMe();
  const addGuest = useGuestFlights((s) => s.add);
  const track = useTripMutation((b: { flightNumber: string; date: string; alerts: boolean }) => tripsApi.track(b));
  const code = q.trim().toUpperCase().replace(/\s+/g, '');
  const valid = FlightNumber.safeParse(code).success;
  const err = !code ? null : /^[A-Z0-9]{2}$/.test(code) ? t('td.track.errNumber') : !/^[A-Z0-9]{2}/.test(code) ? t('td.track.errAirline') : !valid ? t('td.track.errShape') : null;
  const today = todayIn();
  const date = when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : /^\d{4}-\d{2}-\d{2}$/.test(picked) ? picked : null;
  const ready = valid && !!date;
  const choice = guest ? null : user?.notifications === 'allowed' ? true : user?.notifications === 'declined' ? false : null;

  const add = async (alerts: boolean) => {
    setAsk(false);
    if (!date) return;
    setBusy(true);
    try {
      if (guest) {
        const info = (await tripsApi.flightStatus(code, date).catch(() => ({ flight: null }))).flight;
        const g: GuestFlight = { id: newKey(), flightNumber: code, date, alerts, known: !!info, carrierName: info?.carrierName ?? null, from: info?.from ?? null, to: info?.to ?? null, departLocal: info?.departLocal ?? null, arriveLocal: info?.arriveLocal ?? null, durationMin: info?.durationMin ?? null, brand: info?.brand ?? null };
        addGuest(g);
        buzz('success');
        toast(g.known ? t(alerts ? 'td.track.trackingAlerts' : 'td.track.tracking', { code }) : t('td.track.saved', { code }));
      } else {
        const { flight } = await track.mutateAsync({ flightNumber: code, date, alerts });
        buzz('success');
        toast(flight.known ? t(alerts ? 'td.track.trackingAlerts' : 'td.track.tracking', { code }) : t('td.track.saved', { code }));
      }
      setQ(''); setWhen(null); setPicked(''); setTouched(false);
    } catch { toast(t('error.offline')); } finally { setBusy(false); }
  };
  const submit = () => {
    setTouched(true);
    if (!ready) return;
    if (choice === null) { setAsk(true); return; }
    void add(choice);
  };
  return (
    <>
      <Box gap={14}>
        <View style={{ gap: 6 }}>
          <T style={styles.label}>{t('td.track.label')}</T>
          <TextInput testID="track-input" value={q} onChangeText={(v) => setQ(v.toUpperCase())} onBlur={() => setTouched(true)} placeholder="SV263" placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false}
            style={[styles.input, touched && err ? { borderColor: colors.bad } : null]} accessibilityLabel={t('td.track.label')} />
          {(touched || code.length > 3) && err ? <T v="small" color={colors.bad} accessibilityRole="alert">{err}</T> : null}
        </View>
        <View style={{ gap: 6 }}>
          <T style={styles.label}>{t('td.track.when')}</T>
          <Row gap={8} style={{ flexWrap: 'wrap' }}>
            {(['today', 'tomorrow', 'pick'] as const).map((k) => <Chip key={k} label={t(`td.track.${k}`)} on={when === k} onPress={() => setWhen(k)} />)}
          </Row>
          {when === 'pick' ? <TextInput testID="track-date" value={picked} onChangeText={setPicked} placeholder="2027-03-09" placeholderTextColor={colors.muted} style={styles.input} accessibilityLabel={t('td.track.date')} /> : null}
          {touched && valid && !date ? <T v="small" color={colors.bad} accessibilityRole="alert">{t('td.track.pickDay')}</T> : null}
        </View>
        <Button testID="track-submit" label={t('td.track.submit')} onPress={submit} disabled={!code} busy={busy} />
      </Box>
      <Sheet visible={ask} onClose={() => void add(false)} label={t('td.track.askTitle', { code })}>
        <View style={styles.bigIc}><Icon name="bell" size={24} color={colors.goldInk} /></View>
        <T v="h2">{t('td.track.askTitle', { code })}</T>
        <T v="body" style={{ marginTop: -8 }}>{t('td.track.askBody')}</T>
        <Button testID="track-allow" label={t('td.track.allow')} onPress={() => { if (!guest) updateMe.mutate({ notifications: 'allowed' }); void add(true); }} />
        <Button label={t('common.notNow')} variant="ghost" onPress={() => { if (!guest) updateMe.mutate({ notifications: 'declined' }); void add(false); }} />
      </Sheet>
    </>
  );
}

export function Guest() {
  const router = useRouter();
  const flights = useGuestFlights((s) => s.flights);
  const remove = useGuestFlights((s) => s.remove);
  const clear = useSession((s) => s.clear);
  return (
    <>
      <Rise><Display size={44}>{t('td.guest.title')}</Display></Rise>
      <Rise step={1}><TrackFlight guest /></Rise>
      <TrackedFlights flights={flights.map((f) => ({ ...f, status: 'scheduled' as const }))} onStop={(f) => remove(f.id)} />
      {!flights.length ? <EmptyState compact art={<ArtPass width={80} height={60} />} title={t('td.guest.emptyTitle')} body={t('td.guest.emptyBody')} /> : null}
      <Rise step={2}>
        <Box tone="well">
          <H3>{t('td.guest.cardTitle')}</H3>
          <Small>{t('td.guest.cardBody')}{flights.length ? ` ${t('td.guest.comeWith')}` : ''}</Small>
          <Button label={t('td.guest.signIn')} variant="secondary" block={false} onPress={() => { void clear().then(() => router.replace('/signin')); }} />
        </Box>
      </Rise>
    </>
  );
}

/** "Last Eid, the four of you went to Baku." Only from a trip that really happened. */
export function useLastTripLine(): string | null {
  const { data } = useTrips();
  const p = data?.past[0];
  if (!p) return null;
  const n = p.travellerCount;
  const you = n <= 1 ? t('trip.ofYou.one') : n === 2 ? t('trip.ofYou.two') : t('trip.ofYou.many', { n: ['', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? n });
  return t('td.lastTrip', { when: p.when ?? t('td.lastTime'), you, city: p.city });
}

export const queryKeysForToday = tk;

const styles = StyleSheet.create({
  mic: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  ppMini: { width: 28, height: 36, borderRadius: 5, backgroundColor: colors.green, alignItems: 'center', paddingTop: 8, borderWidth: 1, borderColor: 'rgba(217,183,122,0.35)' },
  ppMiniRing: { width: 14, height: 14, borderRadius: 99, borderWidth: 1.5, borderColor: colors.gold },
  bento: { flexDirection: 'row', gap: 12 },
  photoTile: { flex: 1, minHeight: 250, borderRadius: radii.card, overflow: 'hidden', justifyContent: 'flex-end' },
  smallTile: { flex: 1, minHeight: 119, justifyContent: 'space-between' },
  cityDot: { width: 34, height: 34, borderRadius: 999, borderWidth: 2, borderColor: colors.gold },
  trackMark: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.ink2 },
  input: { height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.mist, paddingHorizontal: 16, fontSize: 17, fontFamily: ff.ui500, color: colors.green },
  bigIc: { width: 52, height: 52, borderRadius: 18, backgroundColor: colors.warnWash, alignItems: 'center', justifyContent: 'center' },
});

void durationLabel;
void Pressable;
