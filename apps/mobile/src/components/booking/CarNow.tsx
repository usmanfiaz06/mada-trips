import { useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { RIDE_CITIES, formatSar, nameIn, rideCity, rideRouteEstimate, rideSaid, sarToHalalas, tripIsNow, wantsNow, type Ride, type RideWhen } from '@mada/shared';
import { ridesApi, rideKeys, askMadaForCar, useRide } from '@/lib/rides';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useTrips } from '@/lib/wallet';
import { hhmm, nextTrip } from '@/lib/wallet-model';
import { colors, ff, font, radii } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { T } from '../Text';
import { ChipWrap, MadaDot, Notice, enter } from './parts';
import { HeardChips } from './Conversation';
import { TypingDots } from '../wallet/ui';

/*
 * A car right now (critique 4). Asked for now, so nothing offers tomorrow: now or in 15 minutes, the city and where
 * to meet, then the honest state as it moves: finding a car → the driver by name with the car, plate, meeting point
 * and price (call, message, cancel) → here. No car free: said plainly, and Mada finds one by hand with a call-back.
 */

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const CITY_CHOICES = ['Riyadh', 'Jeddah', 'Makkah', 'Istanbul', 'Dubai'];
const newKey = () => `ride-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function CarNow({ query, city: cityHint }: { query: string; city?: string | null }) {
  const trips = useTrips();
  const nt = nextTrip(trips.data);
  const [opened] = useState(() => Date.now());
  const ar = getLocale() === 'ar';
  // A trip under way (or leaving within 24 hours): its city and hotel are the likely answers.
  const live = nt && tripIsNow({ startDate: nt.trip.startDate, endDate: nt.trip.endDate ?? nt.trip.startDate }, opened) ? nt : null;
  const hotel = live?.trip.stays[0]?.name ?? null;
  // What the words already say (critique 2, #2 and #17): "right now", the city, the airport, "to Taksim". None of it is
  // asked again; each shows as a chip, a tap away from changing.
  const heard = useMemo(() => rideSaid(query), [query]);
  const said = heard.city ?? rideCity(query) ?? (cityHint ? rideCity(cityHint) ?? cityHint : null) ?? cityFromText(query);
  const saidWhen: RideWhen | null = /\bin 15|in fifteen|ربع ساعة|ربع ساعه/i.test(query) ? 'in15' : wantsNow(query) ? 'now' : null;
  const placeName = (p: { name: string; nameAr: string | null } | null) => (p ? (ar && p.nameAr ? p.nameAr : p.name) : null);
  const saidFrom = placeName(heard.from);
  const saidTo = heard.to ? placeName(heard.to) : heard.toText;
  const [when, setWhen] = useState<RideWhen | null>(saidWhen);
  // What was said or picked wins; until then the trip under way (which may load after the first paint) suggests.
  const [picked, setCity] = useState<string | null>(null);
  const [typed, setPlace] = useState<string | null>(saidFrom);
  const [dest, setDest] = useState<string>(saidTo ?? '');
  // Questions shown open: those the words didn't answer, and any chip tapped to change.
  const [reopened, setReopened] = useState<Set<string>>(() => new Set());
  const city = picked ?? said ?? live?.city ?? null;
  const place = typed ?? (hotel ? t('now.car.hotel', { hotel }) : '');
  const [rideId, setRideId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);
  const qc = useQueryClient();
  const served = city ? rideCity(city) : null;
  const est = served && dest.trim() ? rideRouteEstimate(served, place, dest, RIDE_CITIES[served]!) : null;

  const send = async () => {
    if (!when || !city || place.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await ridesApi.request({ when, city, meetingPoint: place.trim(), destination: dest.trim().length >= 2 ? dest.trim() : null, tripId: live?.id ?? null, clientKey: key });
      qc.setQueryData(rideKeys.ride(r.ride.id), r);
      setRideId(r.ride.id);
      buzz('success');
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  const again = () => { setRideId(null); setKey(newKey()); };

  if (rideId) return <RideState id={rideId} onAgain={again} tripId={live?.id ?? null} />;

  const cityLabel = (c: string) => nameIn(c, getLocale());
  const cities = [...new Set([...(live ? [live.city] : []), ...(city && !CITY_CHOICES.includes(city) ? [city] : []), ...CITY_CHOICES])];
  const open = (k: string) => reopened.has(k);
  const reopen = (k: string) => setReopened((x) => new Set(x).add(k));
  const showWhen = !saidWhen || open('when');
  const showCity = !!when && (!said || open('city'));
  const showPlace = !!when && !!city && (!saidFrom || open('place'));
  const showTo = !!when && !!city && (!saidTo || open('to'));
  const chips = [
    ...(saidWhen && !showWhen && when ? [{ label: t(when === 'now' ? 'now.car.now' : 'now.car.in15'), onPress: () => reopen('when'), testID: 'car-heard-when' }] : []),
    ...(said && !open('city') && city ? [{ label: cityLabel(city), onPress: () => reopen('city'), testID: 'car-heard-city' }] : []),
    ...(saidFrom && !open('place') ? [{ label: place, onPress: () => reopen('place'), testID: 'car-heard-place' }] : []),
    ...(saidTo && !open('to') && dest ? [{ label: t('now.car.toChip', { place: dest }), onPress: () => reopen('to'), testID: 'car-heard-to' }] : []),
  ];
  return (
    <View style={{ gap: 18 }} testID="car-now">
      <HeardChips items={chips} testID="car-heard" />
      {showWhen ? (
        <Animated.View entering={enter(0)} style={{ gap: 10 }}>
          <T v="h2" accessibilityRole="header">{t('now.car.when')}</T>
          <ChipWrap>
            {(['now', 'in15'] as const).map((w) => (
              <Button key={w} size="small" block={false} variant={when === w ? 'primary' : 'secondary'} label={t(w === 'now' ? 'now.car.now' : 'now.car.in15')} onPress={() => setWhen(w)} testID={`car-now-when-${w}`} />
            ))}
          </ChipWrap>
        </Animated.View>
      ) : null}
      {showCity ? (
        <Animated.View entering={enter(0)} style={{ gap: 10 }}>
          <T v="h2" accessibilityRole="header">{t('now.car.city')}</T>
          <ChipWrap>
            {cities.map((c) => <Button key={c} size="small" block={false} variant={city === c ? 'primary' : 'secondary'} label={cityLabel(c)} onPress={() => setCity(c)} testID={`car-now-city-${c}`} />)}
          </ChipWrap>
        </Animated.View>
      ) : null}
      {showPlace ? (
        <Animated.View entering={enter(0)} style={{ gap: 10 }}>
          <T v="h2" accessibilityRole="header">{t('now.car.where')}</T>
          <TextInput accessibilityLabel={t('now.car.where')} value={place} onChangeText={setPlace} placeholder={t('now.car.wherePlaceholder')} placeholderTextColor={colors.muted}
            style={[styles.input, font('body', colors.green), webNoOutline]} testID="car-now-place" returnKeyType="next" />
        </Animated.View>
      ) : null}
      {showTo ? (
        <Animated.View entering={enter(0)} style={{ gap: 10 }}>
          <T v="h2" accessibilityRole="header">{t('now.car.to')}</T>
          <TextInput accessibilityLabel={t('now.car.to')} value={dest} onChangeText={setDest} placeholder={t('now.car.toPlaceholder')} placeholderTextColor={colors.muted}
            style={[styles.input, font('body', colors.green), webNoOutline]} testID="car-now-to" returnKeyType="done" onSubmitEditing={send} />
        </Animated.View>
      ) : null}
      {when && city ? (
        <Animated.View entering={enter(0)} style={{ gap: 10 }}>
          {/* The ride itself, before asking for it: how far, how long, the fixed fare (or that the driver says it). */}
          {dest.trim() ? (
            <View style={styles.row}><Icon name="car" size={16} color={colors.goldInk} />
              <T v="small" color={colors.green} style={{ flex: 1 }} testID="car-now-route">{est ? t('now.car.route', { km: est.km, min: est.min, price: formatSar(sarToHalalas(est.fareSar)) }) : t('now.car.routeLater')}</T>
            </View>
          ) : null}
          <Button label={t('now.car.send')} busy={busy} disabled={place.trim().length < 2} onPress={send} testID="car-now-send" />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A city named in the words that the supplier doesn't serve ("a taxi now in Abha"): kept, so the answer is honest. */
function cityFromText(text: string): string | null {
  const m = text.match(/\bin ([A-Z][a-z]+)\b/);
  if (!m || RIDE_CITIES[m[1]!]) return null;
  return m[1]!;
}

function RideState({ id, onAgain, tripId }: { id: string; onAgain: () => void; tripId: string | null }) {
  const q = useRide(id);
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState(false);
  const [asking, setAsking] = useState(false);
  const [callBy, setCallBy] = useState<string | null>(null);
  const r = q.data?.ride;
  if (!r) return <Card variant="well" style={{ alignItems: 'center' }}><TypingDots /></Card>;

  const cancel = async () => {
    setCancelling(true);
    try { qc.setQueryData(rideKeys.ride(id), await ridesApi.cancel(id)); buzz('soft'); } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setCancelling(false); }
  };
  const askMada = async () => {
    setAsking(true);
    try { setCallBy(await askMadaForCar(t('now.car.askMadaText', { city: r.city, place: r.meetingPoint }), tripId) ?? new Date(Date.now() + 10 * 60_000).toISOString()); buzz('success'); } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setAsking(false); }
  };

  return (
    <Animated.View entering={enter(0)} style={{ gap: 14 }} testID={`ride-${r.status}`}>
      {r.status === 'requesting' ? (
        <Card style={{ gap: 8 }}>
          <View style={styles.row}><TypingDots /><T v="h2" style={{ flex: 1 }}>{t('now.car.requesting')}</T></View>
          <T v="small">{t('now.car.requestingSub', { place: r.meetingPoint, city: nameIn(r.city, getLocale()) })}</T>
        </Card>
      ) : null}
      {(r.status === 'assigned' || r.status === 'arrived') && r.driver ? <DriverCard r={r} /> : null}
      {r.status === 'none' ? (
        <Card variant="warn" style={{ gap: 10 }}>
          <T v="h2" testID="ride-none-title">{t('now.car.none')}</T>
          {callBy ? (
            <View style={styles.row}><MadaDot size={28} /><T v="body" color={colors.green} style={{ flex: 1 }} testID="ride-asked">{t('now.car.asked', { time: hhmm(callBy) })}</T></View>
          ) : (
            <>
              <T v="small">{t('now.car.noneSub')}</T>
              <Button label={t('now.car.askMada')} busy={asking} onPress={askMada} testID="ride-ask-mada" />
              <Button variant="secondary" label={t('now.car.again')} onPress={onAgain} testID="ride-again" />
            </>
          )}
        </Card>
      ) : null}
      {r.status === 'cancelled' ? (
        <Card variant="well" style={{ gap: 10 }}>
          <T v="h3" testID="ride-cancelled">{t('now.car.cancelled')}</T>
          <Button variant="secondary" size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('now.car.another')} onPress={onAgain} />
        </Card>
      ) : null}
      {r.cancellable ? (
        <View style={{ gap: 6 }}>
          <Button variant="ghost" label={t('now.car.cancel')} busy={cancelling} onPress={cancel} testID="ride-cancel" />
          <T v="tiny" style={{ textAlign: 'center' }}>{t('now.car.cancelNote')}</T>
        </View>
      ) : null}
      {r.supplier === 'mock' ? <Notice icon="car"><T v="tiny">{t('now.car.test')}</T></Notice> : null}
    </Animated.View>
  );
}

function DriverCard({ r }: { r: Ride }) {
  const d = r.driver!;
  const here = r.status === 'arrived';
  const time = r.pickupAt ? hhmm(r.pickupAt) : '';
  const call = () => Linking.openURL(`tel:${d.phone}`).catch(() => toast(d.phone));
  const sms = () => Linking.openURL(`sms:${d.phone}${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(t('now.car.messageBody', { driver: d.name, place: r.meetingPoint }))}`).catch(() => toast(d.phone));
  const rows: [string, string, string][] = [
    [t('now.car.car'), d.car, 'ride-car'], [t('now.car.plate'), d.plate, 'ride-plate'], [t('now.car.meet'), r.meetingPoint, 'ride-meet'],
    ...(r.destination ? [[t('now.car.dest'), r.km ? `${r.destination} · ${t('now.car.km', { km: r.km })}` : r.destination, 'ride-dest'] as [string, string, string]] : []),
    ...(r.price ? [[t('now.car.price'), formatSar(r.price.amount), 'ride-price'] as [string, string, string]] : []),
  ];
  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.row}>
        <View style={styles.face}><T style={{ fontFamily: ff.ui600, fontSize: 18, color: colors.sand }}>{d.name.charAt(0)}</T></View>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h2" testID="ride-driver">{here ? t('now.car.arrived', { driver: d.name }) : r.when === 'in15' ? t('now.car.assignedLater', { driver: d.name, time }) : t('now.car.assigned', { driver: d.name })}</T>
          <T v="small">{here ? t('now.car.arrivedSub', { car: d.car, plate: d.plate }) : t('now.car.arrives', { time })}</T>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        {rows.map(([k, v, id]) => (
          <View key={k} style={styles.line}><T v="small">{k}</T><T v="body" color={colors.green} style={{ fontFamily: ff.ui600, flexShrink: 1 }} testID={id}>{v}</T></View>
        ))}
        {r.price ? <T v="tiny">{t('now.car.priceNote')}</T> : null}
      </View>
      <View style={[styles.row, { gap: 8 }]}>
        <Button size="small" block={false} label={t('now.car.call', { driver: d.name })} onPress={call} testID="ride-call" />
        <Button size="small" block={false} variant="secondary" label={t('now.car.message')} onPress={sms} testID="ride-message" />
        <Icon name="car" size={18} color={colors.goldInk} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  face: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderRadius: radii.card, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, fontSize: 16 },
});
