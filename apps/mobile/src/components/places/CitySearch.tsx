import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import type { PlaceHit } from '@mada/shared';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ArtCompass } from '@/components/circles/art';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { placePhoto, usePlaceSearch, usePopular, useRecentPlaces } from '@/lib/places';
import { colors, ff, font } from '@/theme';

/*
 * Worldwide city search (prototype: Circles → Discover → "What's on where?"). Typeahead over every city, other names,
 * Arabic names and airport codes; recent picks on this phone; "Near you" and "Where people go" before typing.
 * A true no-match is calm and offers the closest names.
 */

/** "Georgia · TBS", or what matched ("Heathrow (LHR) · United Kingdom"). Region only when it tells two apart. */
function sub(p: PlaceHit, showRegion: boolean) {
  if (p.matched && (p.matched.kind === 'code' || p.matched.kind === 'airport')) return `${p.matched.label} · ${p.country}`;
  const where = showRegion && p.region && p.region !== p.name ? `${p.region}, ${p.country}` : p.country;
  const also = p.matched && p.matched.kind === 'alt' ? ` · ${t('places.hit.alsoCalled', { name: p.matched.label })}` : p.matched?.kind === 'arabic' ? ` · ${p.matched.label}` : '';
  return `${where}${p.iata ? ` · ${p.iata}` : ''}${also}`;
}

export function CityRow({ p, onPick, showRegion, on }: { p: PlaceHit; onPick: (p: PlaceHit) => void; showRegion?: boolean; on?: boolean }) {
  const photo = placePhoto(p.photo);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.country}`} accessibilityState={on === undefined ? undefined : { selected: on }} testID={`city-${p.id}`}
      onPress={() => { buzz('select'); onPick(p); }} style={({ pressed }) => [s.row, on ? s.rowOn : null, pressed ? { transform: [{ scale: 0.985 }] } : null]}>
      {photo ? <Image source={photo} style={s.tile} contentFit="cover" /> : (
        <View style={[s.tile, s.mono]}><T style={s.monoText}>{p.iata ?? p.name.slice(0, 2).toUpperCase()}</T></View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="h3" style={{ fontSize: 16 }} numberOfLines={1}>{p.name}</T>
        <T v="tiny" numberOfLines={1}>{sub(p, !!showRegion)}</T>
      </View>
      {on ? <Icon name="check" size={20} width={2.4} /> : <Icon name="chevron" size={18} color={colors.muted} />}
    </Pressable>
  );
}

export function CitySearch({ onPick, autoFocus, current }: { onPick: (p: PlaceHit) => void; autoFocus?: boolean; current?: string }) {
  const [q, setQ] = useState('');
  const search = usePlaceSearch(q);
  const popular = usePopular('RUH');
  const recent = useRecentPlaces();
  useEffect(() => { void recent.load(); }, [recent]);
  const pick = (p: PlaceHit) => { recent.add(p); onPick(p); };
  const term = q.trim();
  const data = search.data;
  const names = new Map<string, number>();
  (data?.results ?? []).forEach((r) => names.set(r.name, (names.get(r.name) ?? 0) + 1));
  const offline = search.error instanceof ApiError && search.error.code === 'OFFLINE';
  const near = (popular.data ?? []).filter((p) => p.countryCode === 'SA');
  const away = (popular.data ?? []).filter((p) => p.countryCode !== 'SA');

  return (
    <View style={{ gap: 14 }}>
      <View style={s.inputWrap}>
        <Icon name="globe" size={20} color={colors.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('places.search.placeholder')} placeholderTextColor={colors.muted} accessibilityLabel={t('places.search.label')}
          autoFocus={autoFocus} autoCorrect={false} autoCapitalize="words" returnKeyType="search" testID="place-search" style={[s.input, font('body', colors.green)]} />
        {search.isFetching && term ? <ActivityIndicator size="small" color={colors.muted} /> : null}
        {q ? <Pressable accessibilityRole="button" accessibilityLabel={t('places.search.clear')} hitSlop={10} onPress={() => setQ('')}><Icon name="close" size={18} color={colors.muted} /></Pressable> : null}
      </View>

      {term ? (
        offline ? (
          <EmptyState compact art={<ArtCompass />} title={t('places.search.offline')} action={<Pressable onPress={() => void search.refetch()}><T v="small" style={{ fontFamily: ff.ui600 }} color={colors.green}>{t('places.search.retry')}</T></Pressable>} />
        ) : data && data.results.length ? (
          <View style={{ gap: 8 }} testID="place-results">
            {data.results.map((p) => <CityRow key={p.id} p={p} onPick={pick} showRegion={(names.get(p.name) ?? 0) > 1} on={current ? p.name === current : undefined} />)}
          </View>
        ) : data && !search.isPlaceholderData ? (
          <View style={{ gap: 10 }} testID="place-none">
            <EmptyState compact art={<ArtCompass />} title={t('places.search.none', { q: term })} body={t('places.search.noneBody')} />
            {data.suggestions.length ? <T v="eyebrow">{t('places.search.closest')}</T> : null}
            {data.suggestions.map((p) => <CityRow key={p.id} p={p} onPick={pick} />)}
          </View>
        ) : null
      ) : (
        <>
          {recent.items.length ? (
            <View style={{ gap: 8 }}>
              <View style={s.head}>
                <T v="eyebrow">{t('places.search.recent')}</T>
                <Pressable accessibilityRole="button" onPress={() => { buzz('tap'); recent.clear(); }} hitSlop={8}><T v="tiny" style={{ fontFamily: ff.ui600 }} color={colors.goldInk}>{t('places.search.clearRecent')}</T></Pressable>
              </View>
              {recent.items.map((p) => <CityRow key={p.id} p={p} onPick={pick} on={current ? p.name === current : undefined} />)}
            </View>
          ) : null}
          {near.length ? <View style={{ gap: 8 }}><T v="eyebrow">{t('places.search.near')}</T>{near.slice(0, 4).map((p) => <CityRow key={p.id} p={p} onPick={pick} on={current ? p.name === current : undefined} />)}</View> : null}
          {away.length ? <View style={{ gap: 8 }}><T v="eyebrow">{t('places.search.popular')}</T>{away.slice(0, 6).map((p) => <CityRow key={p.id} p={p} onPick={pick} on={current ? p.name === current : undefined} />)}</View> : null}
        </>
      )}
    </View>
  );
}

/** The search in a bottom sheet, over whatever screen opened it. */
export function CitySearchSheet({ visible, onClose, onPick, current }: { visible: boolean; onClose: () => void; onPick: (p: PlaceHit) => void; current?: string }) {
  return (
    <Sheet visible={visible} onClose={onClose} label={t('places.search.label')}>
      <View style={{ gap: 14 }}>
        <T v="h2">{t('places.search.title')}</T>
        {visible ? <CitySearch onPick={onPick} current={current} /> : null}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingStart: 8, paddingEnd: 12, borderRadius: 18, backgroundColor: colors.mist },
  rowOn: { backgroundColor: colors.goldWash, borderWidth: 1.5, borderColor: colors.gold },
  tile: { width: 48, height: 48, borderRadius: 12 },
  mono: { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  monoText: { fontFamily: ff.mono, fontSize: 13, letterSpacing: 0.5, color: colors.gold },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 56, borderRadius: 16, paddingHorizontal: 16, backgroundColor: colors.paper, borderWidth: 1.5, borderColor: colors.line },
  input: { flex: 1, height: 56, fontSize: 17, outlineStyle: 'none' } as never,
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
