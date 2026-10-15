import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Image as ExpoImage } from 'expo-image';
import Animated from 'react-native-reanimated';
import {
  CITY_CENTRES, anchorName, anchorOfLandmark, distanceFrom, distanceLabel, formatSar, kmApart, landmarkById, landmarksIn, mergeWishes, parseStayWishes, reasonsLine, refineStays, sortByDistance, sortStays,
  tripShape, wishKey, wishLabel, type DistanceAnchor, type Person, type StayOption, type StaySearchResponse, type StaySort, type StayWish,
} from '@mada/shared';
import { useStayAnchor } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { Button, LinkButton } from '../Button';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { StaysMap } from '../maps/StaysMap';
import { DistanceSheet } from './DistanceSheet';
import type { Cta } from './FlightFlow';
import { StayCard } from './StayCard';
import { MadaDot, Photo, enter } from './parts';

/*
 * Stay results the way people decide (docs/app/EXPERIENCE.md §2, RANKING.md): three picks first, each with a reason
 * from the facts that ranked it, for who is going; "See all" opens the whole list with one quiet row (sort, distance
 * from, list or map). Saying what matters in the box below ("a pool, near Burj Khalifa") is the main way to refine:
 * each wish is a chip, the list re-ranks, and Mada says in one line what changed, or that the facts can't tell and
 * the desk can look.
 */

const PAGE = 10;
type Sort = StaySort | 'near';

export function StayResults({ s, city, cityName, dates, people, who, checkIn, summary, entry, block, setCta, onReview, onDesk }: {
  s: StaySearchResponse; city: string; cityName: string; dates: string; people: Person[]; who: string[]; checkIn: string;
  summary: React.ReactNode; entry: React.ReactNode; block: string | null; setCta: (c: Cta) => void;
  onReview: (o: StayOption) => void; onDesk: (note: string) => void;
}) {
  const router = useRouter();
  const lang = getLocale();
  const guests = who.length;
  const shape = useMemo(() => tripShape(people.filter((p) => who.includes(p.id)), checkIn), [people, who, checkIn]);
  const [wishes, setWishes] = useState<StayWish[]>([]);
  const [unread, setUnread] = useState<string | null>(null);
  const [mode, setMode] = useState<'picks' | 'all'>('picks');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [sort, setSort] = useState<Sort>('best');
  const [pick, setPick] = useState<string | null>(null);
  const [mapSel, setMapSel] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [distOpen, setDistOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const stored = useStayAnchor((x) => x.byCity[city]);
  const setStored = useStayAnchor((x) => x.set);
  const first = landmarksIn(city)[0];
  const centre = CITY_CENTRES[city];
  const anchor: DistanceAnchor | null = useMemo(() => stored ?? (first ? anchorOfLandmark(first) : centre ? { id: 'centre', kind: 'centre', name: t('dist.centre'), lat: centre.lat, lng: centre.lng } : null), [stored, first, centre]);

  const refined = useMemo(() => refineStays(s.options, wishes, lang), [s.options, wishes, lang]);
  const evidence = useMemo(() => new Map([...refined.matches, ...refined.closest].map((m) => [m.option.id, m.ev])), [refined]);
  const pool = wishes.length ? refined.matches.map((m) => m.option) : s.options;
  const list = useMemo(() => {
    const base = pool.length ? pool : refined.closest.map((m) => m.option);
    if (sort === 'near' && anchor) return sortByDistance(base, anchor);
    if (sort === 'best') return wishes.length ? base : sortStays(base, 'best');
    return sortStays(base, sort as StaySort);
  }, [pool, refined.closest, sort, anchor, wishes.length]);

  // Three picks: the best fit for who is going, the lowest price still at 3 stars and up, the closest to where they measure from.
  const picks = useMemo(() => {
    const from = pool.length ? pool : refined.closest.map((m) => m.option);
    const out: { o: StayOption; reason: string }[] = [];
    const used = new Set<string>();
    const take = (o: StayOption | undefined, reason: string) => { if (o && !used.has(o.id)) { used.add(o.id); out.push({ o, reason }); } };
    const top = from[0];
    if (top) {
      const ev = evidence.get(top.id) ?? [];
      const why = top.fit?.reasons.length ? reasonsLine(top.fit.reasons, lang) : null;
      take(top, wishes.length && ev.length ? t('pick.match', { why: ev.slice(0, 3).join(lang === 'ar' ? '، ' : ', ') })
        : shape.shape === 'family' && why ? t('pick.family', { count: guests, why }) : t('pick.best', { why: why ?? t('fit.plain') }));
    }
    const cheap = [...from].sort((a, b) => a.total.amount - b.total.amount);
    const rated = cheap.find((o) => (o.facts?.stars ?? 0) >= 3 && !used.has(o.id));
    take(rated ?? cheap.find((o) => !used.has(o.id)), rated ? t('pick.lowest', { n: 3 }) : t('pick.lowestAny'));
    if (anchor) {
      const near = sortByDistance(from.filter((o) => !used.has(o.id) && (o.facts?.stars ?? 3) >= 3), anchor)[0];
      const km = near ? kmFrom(near, anchor) : null;
      if (near && km != null) take(near, t('pick.closest', { place: anchorName(anchor, lang), distance: distanceLabel(km) }));
    }
    for (const o of from) if (out.length < 3) take(o, o.fit?.reasons.length ? t('pick.value', { why: reasonsLine(o.fit.reasons, lang) }) : t('pick.best', { why: t('fit.plain') }));
    return out;
  }, [pool, refined.closest, evidence, wishes.length, shape.shape, guests, anchor, lang]);

  const visible = mode === 'picks' ? picks.map((x) => x.o) : list;
  const cur = s.options.find((o) => o.id === pick) ?? visible[0] ?? null;

  const addText = (text: string) => {
    const p = parseStayWishes(text, city);
    buzz('tap');
    if (!p.wishes.length) { setUnread(text); return; }
    setUnread(null);
    setWishes((w) => mergeWishes(w, p.wishes));
    setPick(null); setShown(PAGE);
    // "Closer to Dubai Mall": measure from there, nearest first.
    const near = p.wishes.find((w): w is Extract<StayWish, { k: 'near' }> => w.k === 'near');
    const l = near ? landmarkById(near.id) : null;
    if (l) { setStored(city, anchorOfLandmark(l)); setSort('near'); }
  };
  const remove = (w: StayWish) => { buzz('select'); setUnread(null); setWishes((x) => x.filter((y) => wishKey(y) !== wishKey(w))); setPick(null); };

  useEffect(() => {
    if (!cur) { setCta(null); return; }
    setCta({
      label: block ?? t('search.review', { price: formatSar(cur.total.amount) }), disabled: !!block, testID: 'ask-review', onPress: () => onReview(cur),
      refine: { hint: t('stays.ask.hint', { example: first ? t('stays.ask.example', { place: lang === 'ar' ? first.nameAr : first.name }) : t('stays.ask.exampleAny') }), onSubmit: addText, testID: 'stays-refine' },
    });
  }, [cur?.id, block, wishes, city]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setCta(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const details = (h: StayOption) => (h.hotel ? () => router.push(`/hotel/${h.hotel!.code}?offer=${h.id}&guests=${guests}&city=${city}&who=${who.join(',')}` as Href) : undefined);
  const card = (h: StayOption, i: number, reason?: string) => (
    <Animated.View key={h.id} entering={enter(i < PAGE ? i + 1 : 0)}>
      <StayCard h={h} i={i} on={cur?.id === h.id} guests={guests} reason={reason} noBadge={!!reason} distance={distanceFrom(h, anchor, lang)?.text ?? null} evidence={evidence.get(h.id)}
        onPress={() => { buzz('select'); setPick(h.id); }} onDetails={details(h)} />
    </Animated.View>
  );

  // Quick wishes to tap, the ones that matter most to who is going first; the applied ones show as chips instead.
  const quick: StayWish[] = [
    ...(shape.shape === 'family' ? [{ k: 'has', what: 'connecting' } as const, { k: 'has', what: 'pool' } as const] : []),
    ...(shape.shape === 'pilgrimage' && first ? [{ k: 'near', id: first.id, walk: true } as const] : []),
    { k: 'freeCancel' }, { k: 'board', board: 'BB' }, ...(shape.shape !== 'family' ? [{ k: 'has', what: 'pool' } as const] : []), { k: 'stars', min: 4 },
    ...(first && shape.shape !== 'pilgrimage' ? [{ k: 'near', id: first.id, walk: false } as const] : []),
  ].filter((w) => !wishes.some((x) => wishKey(x) === wishKey(w as StayWish))) as StayWish[];

  const answer = unread ? t('refine.notRead') : wishes.length ? refined.answer : null;
  const offerDesk = !!unread || (wishes.length > 0 && (!refined.matches.length || refined.unknown.length > 0));
  const deskNote = [...wishes.map((w) => wishLabel(w, lang)), unread].filter(Boolean).join(' · ');
  const sortLabel = t(sort === 'near' ? 'stays.sort.near' : `stays.sort.${sort}`);
  const total = s.options.length;

  const mapPoints = list.filter((o) => o.facts?.lat != null && o.facts?.lng != null)
    .map((o) => ({ id: o.id, lat: o.facts!.lat!, lng: o.facts!.lng!, label: formatSar(o.total.amount), selected: (mapSel ?? cur?.id) === o.id }));
  const nearMarks = wishes.filter((w): w is Extract<StayWish, { k: 'near' }> => w.k === 'near').map((w) => landmarkById(w.id)).filter((l): l is NonNullable<typeof l> => !!l)
    .map((l) => ({ id: l.id, lat: l.lat, lng: l.lng, name: lang === 'ar' ? l.nameAr : l.name }));
  const marks = anchor && !nearMarks.some((m) => m.id === anchor.id) ? [...nearMarks, { id: anchor.id, lat: anchor.lat, lng: anchor.lng, name: anchorName(anchor, lang) }] : nearMarks;
  const sel = mapSel ? list.find((o) => o.id === mapSel) : null;

  return (
    <View style={{ gap: 12 }}>
      <Animated.View entering={enter(0)} style={{ gap: 8 }}>
        <T v="h2" style={{ fontSize: 24, lineHeight: 30 }} accessibilityRole="header" testID="stays-heading">
          {mode === 'picks' ? t(picks.length >= 3 ? 'stays.picks.title' : 'stays.picks.titleFew', { city: cityName }) : tn('stays.count', list.length, { city: cityName })}
        </T>
        {summary}
        {mode === 'picks'
          ? <T v="tiny" testID="stays-shape">{t(`stays.shape.${shape.shape}`, { because: shape.because })} {tn('stays.picks.from', total)}</T>
          : <T v="tiny">{t('stays.sub')}</T>}
      </Animated.View>

      {wishes.length ? (
        <View style={st.wrap} testID="stays-wishes">
          {wishes.map((w) => (
            <Pressable key={wishKey(w)} accessibilityRole="button" accessibilityLabel={t('stays.wishes.remove', { wish: wishLabel(w, lang) })} onPress={() => remove(w)} style={st.wish} testID={`wish-${wishKey(w)}`}>
              <T v="small" color={colors.mist} style={{ fontFamily: ff.ui600 }}>{wishLabel(w, lang)}</T>
              <Icon name="close" size={14} color={colors.mist} />
            </Pressable>
          ))}
          {wishes.length > 1 ? <LinkButton label={t('stays.wishes.clear')} size={13} onPress={() => { setWishes([]); setUnread(null); }} /> : null}
        </View>
      ) : null}
      {answer ? (
        <View style={st.answer} testID="stays-answer" accessibilityLiveRegion="polite">
          <MadaDot size={26} />
          <View style={{ flex: 1, gap: 8 }}>
            <T v="small" color={colors.green}>{answer}</T>
            {offerDesk ? <View style={{ alignSelf: 'flex-start' }}><Button size="small" block={false} variant="secondary" label={t('stays.desk', { agent: 'Faisal' })} onPress={() => onDesk(deskNote)} testID="stays-desk" /></View> : null}
          </View>
        </View>
      ) : null}
      {mode === 'all' ? (
        <View style={st.controls} testID="stays-controls">
          <Pressable accessibilityRole="button" onPress={() => setSortOpen(true)} style={[st.control, { flexShrink: 1 }]} testID="stays-sort">
            <T v="small" color={colors.green} style={{ fontFamily: ff.ui500, flexShrink: 1 }} numberOfLines={1}>{sort === 'near' && anchor ? t('stays.sort.nearTo', { place: anchorName(anchor, lang) }) : t('stays.sortValue', { sort: sortLabel })}</T><Icon name="chevron" size={14} />
          </Pressable>
          {quick.length || wishes.length ? (
            <Pressable accessibilityRole="button" onPress={() => setFiltersOpen(true)} style={st.control} testID="stays-filters">
              <Icon name="filter" size={14} /><T v="small" color={colors.green} style={{ fontFamily: ff.ui500 }}>{wishes.length ? t('stays.filtersCount', { n: wishes.length }) : t('stays.filters')}</T>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t(view === 'map' ? 'stays.view.list' : 'stays.view.map')} onPress={() => { buzz('select'); setView(view === 'map' ? 'list' : 'map'); setMapSel(null); }}
            style={[st.round, view === 'map' ? st.roundOn : null]} testID={view === 'map' ? 'stays-view-list' : 'stays-view-map'}>
            <Icon name={view === 'map' ? 'list' : 'map'} size={18} color={view === 'map' ? colors.mist : colors.green} />
          </Pressable>
        </View>
      ) : null}

      {mode === 'picks' ? (
        <>
          {picks.map((x, i) => card(x.o, i, x.reason))}
          <Button variant="secondary" label={tn('stays.seeAll', total)} onPress={() => { buzz('tap'); setMode('all'); setShown(PAGE); }} testID="stays-see-all" />
        </>
      ) : view === 'map' ? (
        <View style={{ gap: 10 }}>
          <View>
            <StaysMap points={mapPoints} marks={marks} height={520} onPick={(id) => { buzz('select'); setMapSel(id); setPick(id); }} testID="stays-map" />
            {sel ? (
              <Pressable accessibilityRole="button" accessibilityLabel={sel.name} onPress={details(sel) ?? (() => setPick(sel.id))} style={st.mapCard} testID="stays-map-card">
                <View style={st.mapPhoto}>{sel.hotel?.imageUrl ? <ExpoImage source={{ uri: sel.hotel.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} /> : <Photo name={sel.photo} focal={sel.focal} />}</View>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="h3" style={{ fontSize: 15 }} numberOfLines={1}>{sel.name}</T>
                  {sel.facts?.stars ? <T v="tiny">{`★ ${tn('stay.starsCount', sel.facts.stars, { n: sel.facts.stars })}`}</T> : null}
                  <T style={st.mapPrice}>{formatSar(sel.total.amount)} <T v="tiny">{t('stays.priceFor', { guests: tn('ask.stay.guests', guests) })}</T></T>
                  {distanceFrom(sel, anchor, lang) ? <T v="tiny" numberOfLines={1}>{distanceFrom(sel, anchor, lang)!.text}</T> : null}
                  {sel.hotel ? <T v="tiny" color={colors.green} style={{ textDecorationLine: 'underline', fontFamily: ff.ui600 }}>{t('stays.map.open')}</T> : null}
                </View>
              </Pressable>
            ) : null}
          </View>
          {list.length > mapPoints.length ? <T v="tiny">{t('stays.map.noPlace', { count: list.length - mapPoints.length })}</T> : null}
        </View>
      ) : (
        <>
          {!pool.length && refined.closest.length ? <T v="eyebrow">{t('stays.closestTitle')}</T> : null}
          {list.slice(0, shown).map((h, i) => card(h, i))}
          {list.length > shown ? <Button variant="secondary" label={t('stays.more', { count: Math.min(PAGE, list.length - shown) })} onPress={() => setShown(shown + PAGE)} testID="stays-more" /> : null}
          <View style={{ alignSelf: 'center' }}><LinkButton label={t('stays.backToPicks')} size={13} onPress={() => { setMode('picks'); setView('list'); }} testID="stays-back-picks" /></View>
        </>
      )}
      <T v="tiny" style={{ textAlign: 'center' }}>{t('stays.checked')}</T>
      {entry}
      <View style={{ height: 120 }} />

      <DistanceSheet visible={distOpen} city={city} cityName={cityName} value={anchor} onClose={() => setDistOpen(false)} onPick={(a) => { setStored(city, a); setSort('near'); setDistOpen(false); }} />
      <Sheet visible={sortOpen} label={t('stays.sort.a11y')} onClose={() => setSortOpen(false)}>
        <T v="h2">{t('stays.sort.a11y')}</T>
        {(['best', 'price', 'stars', ...(anchor ? ['near' as const] : [])] as Sort[]).map((k) => (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: sort === k }} onPress={() => { buzz('select'); setSort(k); setSortOpen(false); }} style={[st.sortRow, sort === k ? st.sortOn : null]} testID={`sort-${k}`}>
            <T v="h3" style={{ fontSize: 15, flex: 1 }} color={sort === k ? colors.mist : colors.green}>{k === 'near' && anchor ? t('stays.sort.nearTo', { place: anchorName(anchor, lang) }) : t(`stays.sort.${k}`)}</T>
            {sort === k ? <Icon name="check" size={18} color={colors.mist} /> : null}
          </Pressable>
        ))}
        <Pressable accessibilityRole="button" onPress={() => { setSortOpen(false); setDistOpen(true); }} style={st.distRow} testID="stays-distance">
          <Icon name="pin" size={16} color={colors.green} />
          <View style={{ flex: 1 }}>
            <T v="small" style={{ fontFamily: ff.ui600 }}>{t('stays.distanceFrom')}</T>
            <T v="tiny">{anchor ? anchorName(anchor, lang) : t('stays.distanceFromPick')}</T>
          </View>
          <Icon name="chevron" size={16} />
        </Pressable>
      </Sheet>
      <Sheet visible={filtersOpen} label={t('stays.filters')} onClose={() => setFiltersOpen(false)}>
        <T v="h2">{t('stays.filters')}</T>
        <T v="small">{t('stays.filtersHint')}</T>
        {[...wishes, ...quick.slice(0, 6)].map((w) => {
          const on = wishes.some((x) => wishKey(x) === wishKey(w));
          return (
            <Pressable key={wishKey(w)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[st.sortRow, on ? st.sortOn : null]} testID={`quick-${wishKey(w)}`}
              onPress={() => {
                buzz('select'); setUnread(null); setPick(null);
                if (on) { remove(w); return; }
                setWishes((x) => mergeWishes(x, [w]));
                if (w.k === 'near') { const l = landmarkById(w.id); if (l) { setStored(city, anchorOfLandmark(l)); setSort('near'); } }
              }}>
              <T v="h3" style={{ fontSize: 15, flex: 1 }} color={on ? colors.mist : colors.green}>{wishLabel(w, lang)}</T>
              {on ? <Icon name="check" size={18} color={colors.mist} /> : <Icon name="plus" size={18} color={colors.green} />}
            </Pressable>
          );
        })}
        <Button label={t('stays.filtersDone')} onPress={() => setFiltersOpen(false)} testID="stays-filters-done" />
      </Sheet>
    </View>
  );
}

/** Straight-line km from a stay to a point (for tests and the details screen). */
export const kmFrom = (o: StayOption, p: { lat: number; lng: number }) => (o.facts?.lat != null && o.facts?.lng != null ? kmApart(p, { lat: o.facts.lat, lng: o.facts.lng }) : null);

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  wish: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 99, backgroundColor: colors.green },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: 99, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  answer: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 18, backgroundColor: colors.paper },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  control: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 99, backgroundColor: colors.paper },
  round: { marginStart: 'auto', width: 36, height: 36, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  roundOn: { backgroundColor: colors.green },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.mist },
  sortOn: { backgroundColor: colors.green },
  mapCard: { position: 'absolute', start: 10, end: 10, bottom: 10, flexDirection: 'row', gap: 12, padding: 10, borderRadius: 18, backgroundColor: colors.paper, boxShadow: '0px 10px 30px -14px rgba(15,26,22,0.5)' },
  mapPhoto: { width: 84, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.stage },
  mapPrice: { fontFamily: ff.ui600, fontSize: 15, color: colors.green, fontVariant: ['tabular-nums'] },
});
