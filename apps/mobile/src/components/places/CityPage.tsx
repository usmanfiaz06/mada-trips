import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Line, Rect } from 'react-native-svg';
import { type CityGuide, type GuideSectionKey } from '@mada/shared';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { VGradient } from '@/components/Gradient';
import { Icon, type IconName } from '@/components/Icon';
import { Act, Screen, Scroll, TopBar, useTopInset } from '@/components/Layout';
import { Pill } from '@/components/Pill';
import { T } from '@/components/Text';
import { ArtCompass } from '@/components/circles/art';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { localTime, minutesAhead, placePhoto, placesApi, useNow, usePlace } from '@/lib/places';
import { usePresence } from '@/lib/wallet';
import { colors, ff, font, shadow } from '@/theme';
import { PlanSheet, type PlanChoice } from './PlanSheet';

/*
 * The page for any city in the world: a photo (ours, or the lead photo from Wikimedia Commons with its credit) or a
 * typographic hero, local time, airports, money, and the open guide with its sources. One action: "Plan it with Mada".
 * Cities we sell go to Ask; anywhere else becomes a request the team plans by hand, and the chat opens with it.
 */

const SECTION_ICON: Record<GuideSectionKey, IconName> = { understand: 'globe', getIn: 'flight', see: 'star', do: 'pin', eat: 'food', staySafe: 'lock' };

function diffLabel(min: number) {
  if (Math.abs(min) < 1) return t('places.city.sameTime');
  const h = Math.abs(min) / 60;
  const hours = Number.isInteger(h) ? tn('places.city.hour', h) : `${Math.floor(h) ? `${Math.floor(h)}h ` : ''}${Math.abs(min) % 60}m`;
  return min > 0 ? t('places.city.ahead', { hours }) : t('places.city.behind', { hours });
}

const open = (url: string) => { buzz('tap'); void Linking.openURL(url); };

/** No photo of our own and none from Commons: the city's name, set large, on the green with a faint chart grid. */
function TypeHero({ g, time }: { g: CityGuide; time: string | null }) {
  const top = useTopInset();
  return (
    <View style={[s.hero, { backgroundColor: colors.green }]} accessibilityRole="image" accessibilityLabel={t('places.city.a11yHero', { city: g.name, country: g.country })}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        {Array.from({ length: 12 }, (_, i) => <Line key={`v${i}`} x1={i * 44} y1={0} x2={i * 44} y2={400} stroke="rgba(217,183,122,0.07)" strokeWidth={1} />)}
        {Array.from({ length: 9 }, (_, i) => <Line key={`h${i}`} x1={0} y1={i * 44} x2={600} y2={i * 44} stroke="rgba(217,183,122,0.06)" strokeWidth={1} />)}
        <Rect x={0} y={0} width="100%" height="100%" fill="transparent" />
      </Svg>
      {g.airports[0] ? <T style={s.code} accessibilityElementsHidden>{g.airports[0].iata}</T> : null}
      <View style={[s.rose, { top: top + 34 }]}><ArtCompass width={132} height={99} /></View>
      <View style={s.heroText}>
        <T v="eyebrow" color={colors.gold}>{g.country}</T>
        <T style={[font('display', colors.paper), { fontSize: 50, lineHeight: 54 }]} numberOfLines={2} adjustsFontSizeToFit>{g.name}</T>
        {time ? <T v="small" color={colors.onDark2}>{t('places.city.timeThere', { time })}</T> : null}
      </View>
    </View>
  );
}

function PhotoHero({ g, failed, onFail }: { g: CityGuide; failed: boolean; onFail: () => void }) {
  const ours = placePhoto(g.photo);
  const source = ours ?? (g.image && !failed ? { uri: g.image.url } : null);
  if (!source) return null;
  return (
    <View style={s.hero}>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" onError={onFail} accessibilityLabel={t('places.city.a11yHero', { city: g.name, country: g.country })} transition={250} />
      <VGradient id={`hero-${g.id}`} stops={[[0.25, 'rgba(15,26,22,0.05)'], [1, 'rgba(15,26,22,0.78)']]} />
      <View style={s.heroText}>
        {g.curation === 'curated' ? <Pill variant="glass" label={g.served ? t('circles.discover.book') : t('places.city.plan')} style={{ alignSelf: 'flex-start' }} /> : null}
        <T style={[font('display', colors.paper), { fontSize: 46, lineHeight: 50 }]} numberOfLines={2} adjustsFontSizeToFit>{g.name}</T>
        <T v="small" color="rgba(255,253,249,0.9)">{g.region && g.region !== g.name ? `${g.region}, ${g.country}` : g.country}</T>
      </View>
    </View>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <View style={[s.fact, shadow('card')]}>
      <T v="tiny">{label}</T>
      <T v="h3" style={{ fontSize: 22, fontFamily: ff.ui600 }}>{value}</T>
      {sub ? <T v="tiny">{sub}</T> : null}
    </View>
  );
}

export function CityPage({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const q = usePlace(id);
  const now = useNow();
  const presence = usePresence();
  const [failed, setFailed] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [clientId] = useState(() => `plan-${id}-${Date.now().toString(36)}`);
  const plan = useMutation({
    mutationFn: (c: PlanChoice) => placesApi.plan(q.data!.id, { travellers: c.travellers, ...(c.month ? { month: c.month } : {}), message: c.message, from: 'RUH', clientId }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['booking'] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
      setPlanning(false);
      router.push(`/ask/request/${r.request.id}`);
    },
  });
  const agent = presence.data?.agent?.name ?? null;
  const byHand = agent ? t('places.city.planByHand', { agent }) : t('places.city.planByHandAway');

  const g = q.data;
  const time = g ? localTime(g.timezone, now) : null;
  const ahead = useMemo(() => (g ? minutesAhead(g.timezone, now) : 0), [g, now]);

  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.code === 'NOT_FOUND';
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <Scroll top={20}>
          <EmptyState art={<ArtCompass />} title={notFound ? t('places.city.notFound') : t('places.search.offline')} body={notFound ? t('places.city.notFoundBody') : undefined}
            action={<Button label={notFound ? t('places.city.search') : t('places.search.retry')} onPress={() => (notFound ? router.replace('/city') : void q.refetch())} />} />
        </Scroll>
      </Screen>
    );
  }
  if (!g) {
    return (
      <Screen background={colors.green}>
        <TopBar onBack={() => router.back()} dark />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ArtCompass width={132} height={99} />
          <T v="small" color={colors.onDark2}>{t('places.city.loadingGuide')}</T>
        </View>
      </Screen>
    );
  }

  const photoHero = !!placePhoto(g.photo) || (!!g.image && !failed);
  const credit = !placePhoto(g.photo) && g.image && !failed ? g.attributions.find((a) => a.source === 'wikimedia') : null;
  const voyage = g.attributions.find((a) => a.source === 'wikivoyage');
  const wiki = g.attributions.find((a) => a.source === 'wikipedia');
  const quick = g.served || g.curation === 'curated';
  const go = () => {
    buzz('tap');
    if (quick) router.push({ pathname: '/ask', params: { prefill: t('places.request.title', { city: g.name }) } });
    else setPlanning(true);
  };

  return (
    <Screen>
      <Scroll gutter={0} bottomPad={190} contentStyle={{ gap: 0 }}>
        {photoHero ? <PhotoHero g={g} failed={failed} onFail={() => setFailed(true)} /> : <TypeHero g={g} time={time} />}
        {credit ? (
          <Pressable onPress={() => open(credit.url)} accessibilityRole="link" style={s.credit}><T v="tiny" numberOfLines={1}>{credit.text}</T></Pressable>
        ) : null}
        <View style={s.body}>
          <View style={s.facts}>
            <Fact label={t('places.city.localTime')} value={time ?? ''} sub={diffLabel(ahead)} />
            {g.airports[0] ? <Fact label={t('places.city.nearest')} value={g.airports[0].iata} sub={t('places.city.airportKm', { km: g.airports[0].km })} /> : null}
          </View>
          <View style={[s.well]}>
            <Icon name="rain" size={20} color={colors.goldInk} />
            <T v="small" color={colors.green} style={{ flex: 1 }}>{t('places.city.weather')}</T>
          </View>
          {g.summary ? (
            <View style={[s.card, shadow('card')]}>
              <T v="body" color={colors.green}>{g.summary.text}</T>
              {wiki ? <Pressable onPress={() => open(g.summary!.url)} accessibilityRole="link"><T v="tiny" style={s.link}>{wiki.text} · {t('places.city.wikipedia')}</T></Pressable> : null}
            </View>
          ) : null}
          {g.sections.length ? <T v="h2" style={{ fontSize: 22, marginTop: 6 }}>{t('places.city.guide')}</T> : null}
          {g.sections.map((sec) => (
            <View key={sec.key} style={[s.card, shadow('card')]} testID={`guide-${sec.key}`}>
              <View style={s.secHead}>
                <View style={s.ic}><Icon name={SECTION_ICON[sec.key]} size={16} /></View>
                <T v="h3" style={{ fontSize: 17 }}>{t(`places.city.section.${sec.key}`)}</T>
              </View>
              <T v="small" color={colors.green} style={{ lineHeight: 20 }}>{sec.text}</T>
              <Pressable onPress={() => open(sec.url)} accessibilityRole="link">
                <T v="tiny" style={s.link}>{voyage?.text ?? 'Wikivoyage'}{sec.trimmed ? ` · ${t('places.city.trimmed')}` : ''} · {t('places.city.readOn')}</T>
              </Pressable>
            </View>
          ))}
          {g.airports.length ? (
            <View style={[s.card, shadow('card')]}>
              <T v="eyebrow">{t('places.city.airports')}</T>
              {g.airports.map((a) => (
                <View key={a.iata} style={s.airport}>
                  <View style={s.code3}><T style={{ fontFamily: ff.mono, fontSize: 13, color: colors.gold }}>{a.iata}</T></View>
                  <View style={{ flex: 1 }}><T v="small" color={colors.green} numberOfLines={1}>{a.name}</T><T v="tiny">{t('places.city.airportKm', { km: a.km })}</T></View>
                </View>
              ))}
            </View>
          ) : null}
          {g.currency ? (
            <View style={[s.card, shadow('card'), { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
              <View style={s.ic}><Icon name="card" size={16} /></View>
              <View style={{ flex: 1 }}><T v="tiny">{t('places.city.money')}</T><T v="h3" style={{ fontSize: 16 }}>{g.currency.name} ({g.currency.code})</T></View>
            </View>
          ) : null}
          <View style={{ gap: 4, paddingHorizontal: 4 }}>
            <T v="eyebrow">{t('places.city.sources')}</T>
            {g.attributions.map((a) => (
              <Pressable key={a.source + a.url} onPress={() => open(a.url)} accessibilityRole="link"><T v="tiny" style={s.link}>{a.text}</T></Pressable>
            ))}
          </View>
        </View>
      </Scroll>
      <View style={[StyleSheet.absoluteFill, { pointerEvents: 'box-none' }]}>
        <TopBar onBack={() => router.back()} dark />
      </View>
      <View style={s.fade} pointerEvents="none"><VGradient id="city-fade" stops={[[0, 'rgba(233,226,216,0)'], [0.35, colors.sand], [1, colors.sand]]} /></View>
      <Act>
        <T v="tiny" style={{ textAlign: 'center' }}>{quick && g.served ? t('places.city.planServed', { city: g.name }) : byHand}</T>
        <Button label={t('places.city.plan')} onPress={go} testID="plan-it" />
      </Act>
      {planning ? (
        <PlanSheet place={g} visible={planning} onClose={() => setPlanning(false)} onSend={(c) => plan.mutate(c)} busy={plan.isPending} error={plan.error} note={byHand} />
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { height: 320, overflow: 'hidden', justifyContent: 'flex-end' },
  heroText: { padding: 20, gap: 4 },
  code: { position: 'absolute', right: -6, bottom: 70, fontFamily: ff.mono, fontSize: 104, lineHeight: 110, color: 'rgba(217,183,122,0.13)' },
  rose: { position: 'absolute', right: 6, opacity: 0.92 },
  credit: { paddingHorizontal: 20, paddingTop: 6 },
  body: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  facts: { flexDirection: 'row', gap: 10 },
  fact: { flex: 1, gap: 2, padding: 14, borderRadius: 20, backgroundColor: colors.paper },
  well: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: colors.mist },
  card: { gap: 8, padding: 16, borderRadius: 22, backgroundColor: colors.paper },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ic: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mist },
  link: { color: colors.goldInk, fontFamily: ff.ui600 },
  airport: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  code3: { width: 44, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 200 },
});
