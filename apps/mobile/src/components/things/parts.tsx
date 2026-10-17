import type { ReactNode } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { dayLabel, localizeDigits, travelEstimate, type Activity, type Experience, type WhatsOn } from '@mada/shared';
import { Icon, type IconName } from '@/components/Icon';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { isRTL, t } from '@/lib/i18n';
import { durationLine, openLine, priceLine, type Thing } from '@/lib/things';
import { colors, ff, font, shadow } from '@/theme';
import { writtenIn } from '@/components/booking/Translate';

/* The pieces Things to do is made of: cards for places, experiences and events, a small drawn map, and the photo. */

/** Our own photos for places we know by hand (apps/mobile/assets/photos, Unsplash licence, docs/app/photos/CREDITS.md). */
export const THING_PHOTOS: Record<string, ImageSourcePropType> = {
  'istanbul-sultanahmet': require('../../../assets/photos/istanbul-sultanahmet.jpg'),
  'istanbul-bosphorus': require('../../../assets/photos/istanbul-bosphorus.jpg'),
  'istanbul-galata': require('../../../assets/photos/istanbul-galata.jpg'),
  'riyadh-diriyah': require('../../../assets/photos/riyadh-diriyah.jpg'),
  'riyadh-night': require('../../../assets/photos/riyadh-night.jpg'),
  'riyadh-kingdom-centre': require('../../../assets/photos/riyadh-kingdom-centre.jpg'),
  'alula-hegra': require('../../../assets/photos/alula-hegra.jpg'),
  'alula-elephant-rock': require('../../../assets/photos/alula-elephant-rock.jpg'),
  'alula-maraya': require('../../../assets/photos/alula-maraya.jpg'),
  'desert-camp': require('../../../assets/photos/desert-camp.jpg'),
  'dubai-skyline': require('../../../assets/photos/dubai-skyline.jpg'),
  'dubai-creek': require('../../../assets/photos/dubai-creek.jpg'),
  'dubai-desert': require('../../../assets/photos/dubai-desert.jpg'),
  'london-kensington': require('../../../assets/photos/london-kensington.jpg'),
};

export const KIND_ICON: Record<Activity['kind'], IconName> = {
  attraction: 'star', museum: 'globe', gallery: 'star', viewpoint: 'up', park: 'pin', theme_park: 'star', zoo: 'pin', aquarium: 'rain', water_park: 'rain', historic: 'umrah', mosque: 'umrah',
};

export function sourceOf(x: Thing): ImageSourcePropType | { uri: string } | null {
  const photo = x.kind === 'activity' ? x.a.photo : x.kind === 'experience' ? x.e.photo : x.w.photo;
  if (photo && THING_PHOTOS[photo]) return THING_PHOTOS[photo]!;
  const url = x.kind === 'activity' ? x.a.image?.url : x.kind === 'experience' ? x.e.image?.url : x.w.image?.url;
  return url ? { uri: url } : null;
}

/** The photo, or the kind's mark on green when there isn't one (never a stock stand-in). */
export function ThingPhoto({ x, style, children }: { x: Thing; style?: object; children?: ReactNode }) {
  const src = sourceOf(x);
  const icon: IconName = x.kind === 'activity' ? KIND_ICON[x.a.kind] : x.kind === 'experience' ? 'star' : 'bell';
  return (
    <View style={[s.photo, style]}>
      {src ? <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityIgnoresInvertColors /> : (
        <View style={[StyleSheet.absoluteFill, s.noPhoto]}><View style={s.noPhotoMark}><Icon name={icon} size={24} color={colors.goldInk} /></View></View>
      )}
      {children}
    </View>
  );
}

const kindLabel = (a: Activity) => t(`things.kind.${a.kind}`);

/** "12 min drive" or "6 min walk" from the hotel. */
export function minutesFrom(from: { lat: number; lon: number }, a: { lat: number; lon: number }): string {
  const e = travelEstimate(from, a);
  return t(e.mode === 'walk' ? 'things.go.minWalk' : 'things.go.minDrive', { n: localizeDigits(String(e.min)) });
}

/** A place in a row of cards. */
export function PlaceCard({ a, onPress, from, testID }: { a: Activity; onPress: () => void; from?: { lat: number; lon: number } | null; testID?: string }) {
  const ar = isRTL();
  const line = openLine(a);
  const away = from ? minutesFrom(from, a) : a.distanceKm !== null ? `${localizeDigits(String(a.distanceKm))} km` : null;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={(ar && a.nameAr) || a.name} onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [s.card, shadow('card'), pressed && s.pressed]}>
      <ThingPhoto x={{ kind: 'activity', a }} style={{ height: 118 }} />
      <View style={s.cardBody}>
        <T v="tiny" color={colors.goldInk} numberOfLines={1}>{kindLabel(a)}{away ? ` · ${away}` : ''}</T>
        <T v="h3" style={{ fontSize: 15, lineHeight: 19 }} numberOfLines={2}>{(ar && a.nameAr) || a.name}</T>
        {line ? <T v="tiny" color={a.openNow === false ? colors.badInk : colors.ok} numberOfLines={1}>{line}</T> : null}
      </View>
    </Pressable>
  );
}

/** A place as a list row (the full list). */
export function PlaceRow({ a, onPress, fromHotel, testID }: { a: Activity; onPress: () => void; fromHotel?: { lat: number; lon: number } | null; testID?: string }) {
  const ar = isRTL();
  const line = openLine(a);
  // During a trip: "12 min drive" from the hotel (a straight-line guess); otherwise how far.
  const away = fromHotel ? minutesFrom(fromHotel, a) : a.distanceKm !== null ? t('things.kmAway', { km: localizeDigits(String(a.distanceKm)) }) : null;
  const meta = [kindLabel(a), away, a.free ? t('things.free') : null].filter(Boolean).join(' · ');
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [s.row, shadow('card'), pressed && s.pressed]}>
      <ThingPhoto x={{ kind: 'activity', a }} style={{ width: 76, height: 76, borderRadius: 16 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T v="h3" style={{ fontSize: 16 }} numberOfLines={2}>{(ar && a.nameAr) || a.name}</T>
        <T v="tiny" numberOfLines={1}>{meta}</T>
        {line ? <T v="tiny" color={a.openNow === false ? colors.badInk : colors.ok} numberOfLines={1}>{line}</T> : null}
      </View>
      <Icon name="chevron" size={18} color={colors.ink3} />
    </Pressable>
  );
}

/** Something to book: photo, title, how long, from what price. */
export function ExperienceCard({ e, onPress, wide, testID }: { e: Experience; onPress: () => void; wide?: boolean; testID?: string }) {
  const meta = [durationLine(e.durationMin), e.rating ? `★ ${localizeDigits(e.rating.toFixed(1))}` : null].filter(Boolean).join(' · ');
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={e.title} onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [s.card, wide && s.wide, shadow('card'), pressed && s.pressed]}>
      <ThingPhoto x={{ kind: 'experience', e }} style={{ height: wide ? 150 : 118 }}>
        {e.freeCancel ? <View style={s.badge}><T v="tiny" color={colors.green}>{t('things.freeCancel')}</T></View> : null}
      </ThingPhoto>
      <View style={s.cardBody}>
        <T v="h3" style={{ fontSize: 15, lineHeight: 19 }} numberOfLines={2} {...writtenIn(e.title)}>{e.title}</T>
        {meta ? <T v="tiny" numberOfLines={1}>{meta}</T> : null}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <T style={[font('h3', colors.green), { fontSize: 15, fontFamily: ff.ui600 }]}>{priceLine(e)}</T>
          <T v="tiny">{t('things.perPerson')}</T>
        </View>
      </View>
    </Pressable>
  );
}

/** An event as a row: the date block, what, when and where. */
export function EventRow({ w, onPress, testID }: { w: WhatsOn; onPress: () => void; testID?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const ongoing = w.startsOn < today && w.endsOn > w.startsOn;
  const shownDay = ongoing ? w.endsOn : w.startsOn;
  const d = Number(shownDay.slice(8, 10));
  const month = dayLabel(shownDay, { today: shownDay }).split(' ').slice(-1)[0] ?? '';
  const when = w.startsOn === w.endsOn ? dayLabel(w.startsOn, { today: w.startsOn }) : t('things.event.dates', { from: dayLabel(w.startsOn, { today: w.startsOn }), to: dayLabel(w.endsOn, { today: w.endsOn }) });
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [s.row, shadow('card'), pressed && s.pressed]}>
      <View style={s.date}>{ongoing ? <T v="tiny" color={colors.onDark2}>{t('things.event.until')}</T> : null}<T style={[font('h2', colors.paper), { fontSize: 22, lineHeight: 24 }]}>{localizeDigits(String(d))}</T><T v="tiny" color={colors.gold}>{month}</T></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T v="h3" style={{ fontSize: 16 }} numberOfLines={2} {...writtenIn(w.title)}>{w.title}</T>
        <T v="tiny" numberOfLines={1}>{[when, w.time ? localizeDigits(w.time) : null, w.venue].filter(Boolean).join(' · ')}</T>
        <T v="tiny" color={colors.goldInk} numberOfLines={1}>{w.source === 'desk' ? t('things.event.fromDesk') : 'Ticketmaster'}</T>
      </View>
      <Icon name="chevron" size={18} color={colors.ink3} />
    </Pressable>
  );
}

/** A horizontal row of cards that bleeds to the screen edges. */
export function Rail({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ScrollView testID={testID} horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 6 }}>
      {children}
    </ScrollView>
  );
}

/** A drawn map: no tiles from anyone's server, just where it is, and Maps to go there. */
export function MiniMap({ lat, lon, name, from, onPress }: { lat: number; lon: number; name: string; from?: { lat: number; lon: number } | null; onPress?: () => void }) {
  const open = () => {
    buzz('tap');
    if (onPress) return onPress();
    const label = encodeURIComponent(name);
    const url = Platform.OS === 'ios' ? `maps://?q=${label}&ll=${lat},${lon}` : Platform.OS === 'android' ? `geo:${lat},${lon}?q=${lat},${lon}(${label})` : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
    void Linking.openURL(url).catch(() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`));
  };
  // The hotel, when we know it, as the second dot, placed by bearing and distance on the same little grid.
  const dx = from ? Math.max(-1, Math.min(1, (from.lon - lon) * 18)) : 0;
  const dy = from ? Math.max(-1, Math.min(1, (lat - from.lat) * 18)) : 0;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('things.mapA11y', { name })} onPress={open} style={s.map} testID="thing-map">
      <Svg width="100%" height="100%" viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice">
        <Rect x={0} y={0} width={320} height={120} fill="#e6eee6" />
        {Array.from({ length: 9 }, (_, i) => <Line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={120} stroke="rgba(30,53,45,0.06)" strokeWidth={1} />)}
        {Array.from({ length: 4 }, (_, i) => <Line key={`h${i}`} x1={0} y1={i * 40} x2={320} y2={i * 40} stroke="rgba(30,53,45,0.06)" strokeWidth={1} />)}
        <Path d="M-10 86 C 60 70, 110 98, 170 80 S 280 52, 340 66" stroke="#fffdf9" strokeWidth={9} fill="none" />
        <Path d="M120 -10 C 128 40, 150 80, 140 130" stroke="#fffdf9" strokeWidth={6} fill="none" />
        {from ? <Circle cx={160 + dx * 110} cy={56 + dy * 40} r={6} fill={colors.green} stroke="#fffdf9" strokeWidth={2} /> : null}
        <Path d="M160 62 c -9 -10 -14 -16 -14 -24 a 14 14 0 0 1 28 0 c 0 8 -5 14 -14 24 z" fill={colors.goldDeep} stroke="#fffdf9" strokeWidth={2} />
        <Circle cx={160} cy={38} r={5} fill="#fffdf9" />
      </Svg>
      <View style={s.mapBtn}><Icon name="pin" size={15} color={colors.green} /><T v="tiny" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('things.map')}</T></View>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  photo: { overflow: 'hidden', backgroundColor: colors.green2 },
  noPhoto: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.goldWash },
  noPhotoMark: { width: 52, height: 52, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,253,249,0.7)' },
  card: { width: 196, borderRadius: 20, backgroundColor: colors.paper, overflow: 'hidden' },
  wide: { width: 260 },
  cardBody: { padding: 12, gap: 3 },
  pressed: { transform: [{ scale: 0.98 }] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingEnd: 14, borderRadius: 20, backgroundColor: colors.paper },
  date: { width: 56, height: 64, borderRadius: 14, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, start: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: 'rgba(255,253,249,0.92)' },
  map: { height: 120, borderRadius: 18, overflow: 'hidden', backgroundColor: '#e6eee6' },
  mapBtn: { position: 'absolute', bottom: 10, end: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, backgroundColor: colors.paper },
});
