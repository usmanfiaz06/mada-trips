import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { dayLabel, daysBetween, liveStay, localizeDigits, parseThingWishes, thingWishLabel, type ThingWish, type ThingsQuery, type ThingsResponse } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { SkeletonCard } from '@/components/states/Skeleton';
import { StaleBadge } from '@/components/states/StaleBadge';
import { ArtCompass } from '@/components/circles/art';
import { buzz } from '@/lib/haptics';
import { isRTL, t } from '@/lib/i18n';
import { thingId, useThings, type Thing } from '@/lib/things';
import { useTrip } from '@/lib/trips';
import { colors, ff, shadow } from '@/theme';
import { EventRow, ExperienceCard, PlaceCard, PlaceRow, Rail } from './parts';
import { DirectionsSheet, RideSheet } from './go';
import { BookSheet, ThingSheet, type ThingsContext } from './sheets';
import { GoneState } from '@/components/states';
import { describeError } from '@/lib/net/describe';

/*
 * Things to do. As a section (a city's page, a trip) it shows today's ideas, the best places, what we can book and
 * what's on, with "See all". As a screen it adds the filters (open now, family, indoors, near the hotel) and, in a
 * trip, the days. Sources are always one tap away (licences: OSM, Wikidata, Commons, Open-Meteo, Ticketmaster).
 */

type Props = {
  placeId: string;
  city: string;
  tripId?: string | null;
  /** The trip's days, for the day chips and "which day". */
  days?: string[];
  mode: 'section' | 'full';
  initialDay?: string | null;
};

type Filter = 'open' | 'family' | 'indoor' | 'outdoor' | 'see' | 'near';

function Heading({ title, action, onAction, testID }: { title: string; action?: string; onAction?: () => void; testID?: string }) {
  return (
    <View style={st.head}>
      <T v="h2" style={{ fontSize: 22, flex: 1 }}>{title}</T>
      {action ? <Pressable testID={testID} onPress={() => { buzz('tap'); onAction?.(); }} accessibilityRole="link" hitSlop={8}><T v="small" style={st.link}>{action}</T></Pressable> : null}
    </View>
  );
}

/** Weather is a fact only near the trip: more than this many days before it starts, today's sky says nothing about it. */
const WEATHER_WITHIN_DAYS = 5;

function TodayCard({ data, days }: { data: ThingsResponse; days: string[] }) {
  // A trip weeks away hears nothing of today's rain there (CRITIQUE-2 #12).
  if (days[0] && daysBetween(data.day, days[0]) > WEATHER_WITHIN_DAYS) return null;
  const w = data.weather;
  const why = data.today?.why;
  if (!w && !why && !data.today?.prayer) return null;
  return (
    <View style={st.today} testID="things-today">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={w?.mood === 'rain' ? 'rain' : 'star'} size={18} color={colors.gold} />
        <T v="eyebrow" color={colors.gold}>{t('things.today.title')} · {localizeDigits(data.localTime)}</T>
      </View>
      {w ? <T v="h3" color={colors.paper} style={{ fontSize: 17 }}>{t('things.today.weather', { temp: w.tempC, max: w.maxC })}</T> : null}
      {why ? <T v="small" color={colors.onDark2}>{t(`things.today.why.${why}`)}</T> : null}
      {data.today?.prayer ? <T v="tiny" color={colors.onDark2}>{t('things.today.prayer', { prayer: t(`things.prayer.${data.today.prayer.name}`), time: localizeDigits(data.today.prayer.at) })}</T> : null}
    </View>
  );
}

export function ThingsView({ placeId, city, tripId = null, days = [], mode, initialDay = null }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  // "Indoors, it's hot, for the kids, tonight": said once, it turns on the filters that fit, and says so.
  const [wish, setWish] = useState('');
  const [wishAnswer, setWishAnswer] = useState<string | null>(null);
  const sayWish = () => {
    const text = wish.trim();
    if (!text) return;
    const p = parseThingWishes(text);
    const map: Partial<Record<ThingWish['k'], Filter>> = { indoor: 'indoor', outdoor: 'outdoor', kids: 'family', today: 'open', tonight: 'open' };
    const on = p.wishes.map((w) => map[w.k]).filter((f): f is Filter => !!f);
    if (!on.length) { setWishAnswer(t('refine.notRead')); return; }
    setFilters((prev) => {
      const next = new Set(prev);
      for (const f of on) { next.add(f); if (f === 'indoor') next.delete('outdoor'); if (f === 'outdoor') next.delete('indoor'); }
      return next;
    });
    setWishAnswer(t('refine.t.applied', { wishes: p.wishes.filter((w) => map[w.k]).map(thingWishLabel).join(isRTL() ? '، ' : ', ') }));
    setWish('');
  };
  const [day, setDay] = useState<string | null>(initialDay);
  const [picked, setPicked] = useState<Thing | null>(null);
  const [booking, setBooking] = useState<Thing | null>(null);
  const [going, setGoing] = useState<Thing | null>(null);
  const [riding, setRiding] = useState<Thing | null>(null);
  /** One sheet at a time: close this one, open the next once it has slid away. */
  const then = (close: () => void, open: () => void) => { close(); setTimeout(open, 350); };
  const full = mode === 'full';
  const query: ThingsQuery = useMemo(() => ({
    ...(day ? { day } : {}),
    ...(filters.has('open') ? { open: '1' as const } : {}),
    ...(filters.has('family') ? { family: '1' as const } : {}),
    kind: filters.has('indoor') ? 'indoor' : filters.has('outdoor') ? 'outdoor' : filters.has('see') ? 'see' : 'all',
    limit: full ? 40 : 12,
  }), [day, filters, full]);
  const q = useThings({ placeId, tripId }, query);
  const data = q.data;
  const trip = useTrip(tripId).data?.trip ?? null;
  const stay = trip ? liveStay(trip) : null;
  const ctx: ThingsContext = {
    placeId: data?.place.id ?? placeId, city: data?.place.name ?? city, tripId, days, day: data?.day && days.includes(data.day) ? data.day : day, ages: data?.ages ?? [], near: data?.near ?? null,
    hotel: stay?.name ?? null, travellers: trip?.travellers.length ?? 0,
  };
  const hotelPoint = data?.near?.label === 'hotel' ? data.near : null;
  const toggle = (f: Filter) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else {
        next.add(f);
        if (f === 'indoor') { next.delete('outdoor'); next.delete('see'); }
        if (f === 'outdoor') { next.delete('indoor'); next.delete('see'); }
        if (f === 'see') { next.delete('indoor'); next.delete('outdoor'); }
      }
      return next;
    });
  };
  const seeAll = () => router.push({ pathname: '/things/[id]', params: { id: placeId, city, ...(tripId ? { trip: tripId } : {}) } } as unknown as Href);

  const acts = data?.activities ?? [];
  const todayIds = data?.today?.ids ?? [];
  const ordered = mode === 'section' && todayIds.length ? [...acts].sort((a, b) => (todayIds.includes(b.id) ? 1 : 0) - (todayIds.includes(a.id) ? 1 : 0)) : acts;
  const near = filters.has('near') && data?.near;
  const shown = near ? [...ordered].sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99)) : ordered;
  const ar = isRTL();

  const body = () => {
    if (!data) {
      if (q.isError && describeError(q.error).kind === 'gone') return <GoneState variant="card" />;
      if (q.isError) return (
        <View style={[st.note, shadow('card')]}>
          <T v="small" color={colors.green}>{t('things.offline')}</T>
          <Button label={t('things.retry')} variant="secondary" size="small" block={false} onPress={() => void q.refetch()} />
        </View>
      );
      return <View style={{ flexDirection: 'row', gap: 12 }}><SkeletonCard photo style={{ flex: 1 }} /><SkeletonCard photo style={{ flex: 1 }} /></View>;
    }
    if (data.status === 'gathering') return (
      <View style={[st.note, shadow('card')]} testID="things-gathering">
        <ArtCompass width={90} height={68} />
        <T v="small" color={colors.green} style={{ textAlign: 'center' }}>{t('things.gathering', { city: ctx.city })}</T>
      </View>
    );
    return (
      <View style={{ gap: 14 }}>
        <TodayCard data={data} days={days} />
        {data.status === 'none' && !data.experiences.length && !data.events.length ? (
          <View style={[st.note, shadow('card')]} testID="things-none">
            <T v="small" color={colors.green} style={{ textAlign: 'center' }}>{t('things.none', { city: ctx.city })}</T>
            <Button label={t('things.noneAsk')} variant="secondary" size="small" block={false} onPress={() => router.push({ pathname: '/ask', params: { prefill: t('things.titleIn', { city: ctx.city }) } })} />
          </View>
        ) : null}
        {shown.length ? (
          <View style={{ gap: 10 }}>
            {full ? <T v="eyebrow">{t('things.places')}</T> : null}
            {full ? shown.map((a) => <PlaceRow key={a.id} testID={`place-${a.id}`} a={a} fromHotel={hotelPoint} onPress={() => setPicked({ kind: 'activity', a })} />)
              : <Rail testID="things-rail">{shown.slice(0, 8).map((a) => <PlaceCard key={a.id} testID={`place-${a.id}`} a={a} from={hotelPoint} onPress={() => setPicked({ kind: 'activity', a })} />)}</Rail>}
          </View>
        ) : data.status === 'ready' && filters.size ? (
          <View style={[st.note, shadow('card')]} testID="things-nomatch">
            <T v="small" color={colors.green}>{t('things.noMatch')}</T>
            <Button label={t('things.clearFilters')} variant="secondary" size="small" block={false} onPress={() => setFilters(new Set())} />
          </View>
        ) : null}
        {data.experiences.length ? (
          <View style={{ gap: 8 }} testID="things-book">
            <T v="h3" style={{ fontSize: 18 }}>{t('things.book')}</T>
            <T v="tiny" style={{ marginTop: -4 }}>{t('things.bookSub')}</T>
            <Rail>{data.experiences.map((e) => <ExperienceCard key={e.id} testID={`exp-${e.id}`} e={e} wide={full} onPress={() => setPicked({ kind: 'experience', e })} />)}</Rail>
          </View>
        ) : null}
        {data.events.length ? (
          <View style={{ gap: 8 }} testID="things-events">
            <T v="h3" style={{ fontSize: 18 }}>{day ? t('things.whatsOnDay', { day: dayLabel(day, { today: day }) }) : t('things.whatsOn')}</T>
            {(full ? data.events : data.events.slice(0, 3)).map((w) => <EventRow key={w.id} testID={`event-${w.id}`} w={w} onPress={() => setPicked({ kind: 'event', w })} />)}
          </View>
        ) : null}
        <View style={st.sources}>
          <Pressable testID="things-sources" onPress={() => router.push('/things/sources' as Href)} accessibilityRole="link">
            <T v="tiny" style={st.link}>{t('things.sourcesLink')}</T>
          </Pressable>
          <T v="tiny" numberOfLines={full ? undefined : 2}>{data.attributions.map((a) => a.text).join(' · ')}</T>
          {q.isError ? <StaleBadge updatedAt={q.dataUpdatedAt || null} stale /> : null}
        </View>
      </View>
    );
  };

  return (
    <View style={{ gap: 12 }} testID={`things-${mode}`}>
      {full ? null : <Heading title={t('things.title')} action={t('things.seeAll')} onAction={seeAll} testID="things-see-all" />}
      {full ? (
        <View style={{ gap: 10 }}>
          {days.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} testID="things-days">
              <Chip label={t('things.day.any')} on={day === null} onPress={() => setDay(null)} />
              {days.map((d) => <Chip key={d} label={dayLabel(d, { today: d })} on={day === d} onPress={() => setDay(d)} />)}
            </ScrollView>
          ) : null}
          <View style={st.wishBox}>
            <TextInput value={wish} onChangeText={setWish} placeholder={t('things.ask.hint')} placeholderTextColor={colors.muted} accessibilityLabel={t('things.ask.hint')} returnKeyType="send"
              onSubmitEditing={sayWish} style={[st.wishInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]} testID="things-wish" />
            <Pressable accessibilityRole="button" accessibilityLabel={t('ask.a11y.send')} onPress={sayWish} style={st.wishSend} testID="things-wish-send"><Icon name="up" size={18} color={colors.mist} /></Pressable>
          </View>
          {wishAnswer ? <T v="small" color={colors.green} testID="things-wish-answer">{wishAnswer}</T> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }} testID="things-filters">
            {!day ? <Chip label={t('things.filter.open')} on={filters.has('open')} onPress={() => toggle('open')} /> : null}
            <Chip label={data?.ages.length ? t('things.filter.kids', { ages: data.ages.map((a) => localizeDigits(String(a))).join(ar ? '، ' : ', ') }) : t('things.filter.family')} on={filters.has('family')} onPress={() => toggle('family')} />
            <Chip label={t('things.filter.indoor')} on={filters.has('indoor')} onPress={() => toggle('indoor')} />
            <Chip label={t('things.filter.outdoor')} on={filters.has('outdoor')} onPress={() => toggle('outdoor')} />
            <Chip label={t('things.filter.see')} on={filters.has('see')} onPress={() => toggle('see')} />
            {data?.near?.label === 'hotel' ? <Chip label={t('things.filter.near')} on={filters.has('near')} onPress={() => toggle('near')} /> : null}
          </ScrollView>
        </View>
      ) : null}
      {body()}
      <ThingSheet
        x={picked} ctx={ctx} onClose={() => setPicked(null)}
        onBook={(x) => then(() => setPicked(null), () => setBooking(x))}
        onDirections={(x) => then(() => setPicked(null), () => setGoing(x))}
        onRide={(x) => then(() => setPicked(null), () => setRiding(x))}
      />
      <BookSheet key={booking ? `${booking.kind}` : 'none'} x={booking} ctx={ctx} onClose={() => setBooking(null)} />
      {/* Closing the chooser goes back to the place's sheet. */}
      <DirectionsSheet x={going} ctx={ctx} onClose={() => { const x = going; then(() => setGoing(null), () => setPicked(x)); }} onRide={(x) => then(() => setGoing(null), () => setRiding(x))} />
      <RideSheet key={riding ? thingId(riding) : 'none'} x={riding} ctx={ctx} onClose={() => setRiding(null)} />
    </View>
  );
}

const st = StyleSheet.create({
  wishBox: { height: 48, borderRadius: 999, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, paddingStart: 16, paddingEnd: 4, flexDirection: 'row', alignItems: 'center', gap: 8 },
  wishInput: { flex: 1, minWidth: 0, fontSize: 15, color: colors.green },
  wishSend: { width: 40, height: 40, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  link: { color: colors.goldInk, fontFamily: ff.ui600 },
  today: { gap: 4, padding: 16, borderRadius: 22, backgroundColor: colors.green },
  note: { alignItems: 'center', gap: 10, padding: 18, borderRadius: 22, backgroundColor: colors.paper },
  sources: { gap: 4, paddingHorizontal: 4 },
});
