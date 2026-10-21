import { useMemo, useState } from 'react';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { durationLabel, formatSar, hasKey, rangeLabel, todayIn, type CopyKey, type FlightSearchResponse } from '@mada/shared';
import { ArtFriends } from '@/components/art/Arts';
import { Card } from '@/components/Card';
import { VGradient } from '@/components/Gradient';
import { Icon, type IconName } from '@/components/Icon';
import { T } from '@/components/Text';
import { photoOf, Rise, Spread } from '@/components/trips/ui';
import { useMemory } from '@/lib/ask-memory';
import { useCircles, useMeId, useSaved } from '@/lib/circles';
import { useMyEsims } from '@/lib/esim';
import { t } from '@/lib/i18n';
import { placePhoto } from '@/lib/places';
import { usePeople } from '@/lib/queries';
import { HOME_CITY_OF, homeFromText, pickIdeas, type HomeCode, type IdeaCard, type IdeaInput } from '@/lib/today-ideas';
import { useTrips } from '@/lib/trips';
import { colors, font, radii } from '@/theme';

const photo = (k: string | null): ImageSource | ImageSourcePropType => placePhoto(k) ?? photoOf(k);
const ICON: Partial<Record<IdeaCard['kind'], IconName>> = { esim: 'sim', saved: 'pin', event: 'calendar', umrah: 'umrah' };
const HOMES: readonly HomeCode[] = ['RUH', 'JED', 'DMM'];

/** Flight searches still in this phone's cache (FlightFlow's ['booking', 'flights', …] queries), newest first. */
function useCachedSearches(): NonNullable<IdeaInput['searches']> {
  const qc = useQueryClient();
  // Read once when Today opens: a search still cached then is one they really ran, at a price still held.
  const [now] = useState(() => Date.now());
  const list = qc.getQueryCache().findAll({ queryKey: ['booking', 'flights'] })
    .filter((q) => q.state.status === 'success' && q.state.data)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    .map((q) => q.state.data as FlightSearchResponse)
    .filter((r) => r.options?.length && Date.parse(r.cachedUntil) > now && HOMES.includes(r.from as HomeCode))
    .map((r) => {
      const real = r.options.filter((o) => !o.demo);
      const direct = r.options.filter((o) => !o.stop).map((o) => o.out.durationMin);
      return {
        dest: r.destination, from: r.from as HomeCode, depart: r.depart,
        fromHalalas: real.length ? Math.min(...real.map((o) => o.pricePerPerson.amount)) : null,
        durationMin: direct.length ? Math.min(...direct) : null,
      };
    });
  const key = JSON.stringify(list);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => list, [key]);
}

/** Everything the picker reads, from what the app already has. Guests: the day only. */
function useIdeaInput(guest: boolean): IdeaInput {
  const { data } = useTrips();
  const people = usePeople();
  const memory = useMemory();
  const saved = useSaved();
  const circles = useCircles();
  const esims = useMyEsims();
  const me = useMeId();
  const searches = useCachedSearches();
  const today = data?.clock.today ?? todayIn();
  return useMemo<IdeaInput>(() => {
    if (guest) return { today, guest: true, home: null };
    const fact = memory.data?.find((f) => f.kind === 'home_airport');
    const home = homeFromText(fact?.text) ?? searches[0]?.from ?? null;
    const byCity = new Map<string, number>();
    for (const s of saved.data?.saved ?? []) byCity.set(s.city, (byCity.get(s.city) ?? 0) + 1);
    const withEsim = new Set((esims.data?.esims ?? []).map((e) => e.tripId).filter(Boolean));
    const latest = (circles.data?.circles ?? [])
      .filter((c) => c.last?.author.kind === 'user' && c.last.author.id !== me && !c.muted)
      .sort((a, b) => Date.parse(b.last!.createdAt) - Date.parse(a.last!.createdAt))[0];
    const author = latest?.last?.author.kind === 'user' ? latest.last.author.name : null;
    return {
      today, guest: false, home,
      past: (data?.past ?? []).map((p) => ({ city: p.city, startDate: p.startDate, endDate: p.endDate })),
      upcoming: (data?.upcoming ?? []).map((u) => ({ id: u.id, city: u.city, country: u.country, startDate: u.startDate, endDate: u.endDate, hasEsim: withEsim.has(u.id) })),
      saved: [...byCity].map(([city, count]) => ({ city, count })),
      searches,
      circle: latest && author ? { circleId: latest.id, circleName: latest.name, person: author.split(' ')[0]!, dest: latest.dest, at: latest.last!.createdAt } : null,
      family: (people.data?.length ?? 1) > 1,
    };
  }, [guest, today, memory.data, searches, saved.data, esims.data, circles.data, me, data, people.data]);
}

/** The words for a card, in the app's language. */
function words(c: IdeaCard, home: HomeCode | null) {
  const v = c.go.to === 'ask' ? c.go.vars : {};
  const dates = typeof v.from === 'string' && typeof v.to === 'string' ? rangeLabel(v.from, v.to) : '';
  const place = !c.place ? '' : hasKey(`ti.place.${c.place}`) ? t(`ti.place.${c.place}` as CopyKey) : c.place;
  const vars = { ...c.vars, dates, place, price: c.fromHalalas !== null ? formatSar(c.fromHalalas) : '' };
  const title = t(c.title, vars);
  const body = t(c.body, vars);
  const from = c.durationMin && home ? t('ti.from', { time: durationLabel(c.durationMin), city: HOME_CITY_OF[home] }) : null;
  const ask = c.go.to === 'ask' ? t(c.go.ask, { ...c.go.vars, dates, place }) : null;
  return { title, body, from, ask };
}

/**
 * The bento: a hero photo tile and two smaller ones of different kinds, chosen by lib/today-ideas.ts from what is
 * true today. The look is Today's own (EXPERIENCE.md §6.2); Rise brings it in, and stays still with reduced motion.
 */
export function IdeasBento({ guest = false, step = 4, testID = 'today-ideas' }: { guest?: boolean; step?: number; testID?: string }) {
  const router = useRouter();
  const input = useIdeaInput(guest);
  const cards = useMemo(() => pickIdeas(input), [input]);
  const [hero, ...rest] = cards;
  if (!hero) return null;
  const open = (c: IdeaCard, ask: string | null) => {
    const g = c.go;
    if (g.to === 'ask') router.push(`/ask?prefill=${encodeURIComponent(ask ?? '')}` as Href);
    else if (g.to === 'umrah') router.push('/ask?intent=umrah' as Href);
    else if (g.to === 'esim') router.push(`/esim/plans?trip=${encodeURIComponent(g.tripId)}` as Href);
    else if (g.to === 'circle') router.push(`/circle/${g.id}` as Href);
    else router.push(`/${g.to}` as Href);
  };
  const h = words(hero, input.home);
  return (
    <Rise step={step} style={styles.bento}>
      <View style={styles.bentoRow} testID={testID}>
        <View style={{ flex: 1 }} testID={`idea-${hero.kind}`}>
        <Card onPress={() => open(hero, h.ask)} padding={0} style={styles.photoTile} accessibilityLabel={[h.title, h.body, h.from].filter(Boolean).join('. ')}>
          <Image source={photo(hero.photo) as ImageSource} style={StyleSheet.absoluteFill} contentFit="cover" />
          <VGradient id={`idea-hero-${hero.id}`} stops={[[0, 'rgba(15,26,22,0.05)'], [0.3, 'rgba(15,26,22,0.1)'], [1, 'rgba(15,26,22,0.8)']]} />
          <View style={{ padding: 16, gap: 4 }}>
            <T style={[font('displaySmall', colors.paper), { fontSize: 28 }]} numberOfLines={2}>{h.title}</T>
            <T v="small" color="rgba(255,253,249,0.92)" numberOfLines={3}>{h.body}</T>
            {h.from ? <T v="tiny" color="rgba(255,253,249,0.8)">{h.from}</T> : null}
          </View>
        </Card>
        </View>
        <View style={{ flex: 1, gap: 12 }}>
          {rest.map((c, i) => <SmallTile key={c.id} card={c} dark={i === 0} home={input.home} onPress={(ask) => open(c, ask)} />)}
        </View>
      </View>
    </Rise>
  );
}

function SmallTile({ card: c, dark, home, onPress }: { card: IdeaCard; dark: boolean; home: HomeCode | null; onPress: (ask: string | null) => void }) {
  const w = words(c, home);
  const ink = dark ? colors.mist : colors.green;
  const sub = dark ? colors.onDark2 : undefined;
  const people = c.kind === 'family' || c.kind === 'circle';
  return (
    <View style={{ flex: 1 }} testID={`idea-${c.kind}`}>
    <Card variant={dark ? 'focal' : undefined} onPress={() => onPress(w.ask)} style={styles.smallTile} accessibilityLabel={[w.title, w.body, w.from].filter(Boolean).join('. ')}>
      <Spread>
        {people ? <View style={{ marginStart: -8, marginTop: -6 }}><ArtFriends width={66} height={50} /></View>
          : c.photo ? <Image source={photo(c.photo) as ImageSource} style={styles.cityDot} contentFit="cover" />
            : <View style={[styles.iconDot, { backgroundColor: dark ? 'rgba(217,183,122,0.18)' : colors.goldWash }]}><Icon name={ICON[c.kind] ?? 'star'} size={18} color={dark ? colors.gold : colors.goldInk} /></View>}
        {people ? null : <Icon name="chevron" color={dark ? colors.gold : colors.green} />}
      </Spread>
      <View>
        <T v="h3" color={ink} numberOfLines={2}>{w.title}</T>
        <T v="tiny" color={sub} numberOfLines={2}>{w.from && c.kind === 'idea' ? w.from : w.body}</T>
      </View>
    </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  bento: { gap: 12 },
  bentoRow: { flexDirection: 'row', gap: 12 },
  photoTile: { flex: 1, minHeight: 250, borderRadius: radii.card, overflow: 'hidden', justifyContent: 'flex-end' },
  smallTile: { flex: 1, minHeight: 119, justifyContent: 'space-between' },
  cityDot: { width: 34, height: 34, borderRadius: 999, borderWidth: 2, borderColor: colors.gold },
  iconDot: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
