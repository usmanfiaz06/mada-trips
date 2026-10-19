import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { SlideInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { formatSar, roomsLabel, stayLines, type CopyKey, type StayOption } from '@mada/shared';
import { useBottomInset } from '../Layout';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { T } from '../Text';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { useHotelDetails } from '@/lib/transfers';
import { colors, ff, font } from '@/theme';
import { HotelPhoto } from './HotelPhoto';
import { Photo } from './parts';

/*
 * A hotel's card over the stays map (Airbnb, Booking): one tap on a price shows the place straight away, with its
 * photos, stars and guest rating, where it is and how far from where the traveller measures, what matters before
 * choosing (free cancellation, breakfast), the price a night and the total for who is going, and two ways on: the
 * hotel's page, or this room to review and pay. Another pin swaps it; a pull down, the close button, Escape or a tap
 * on the map closes it.
 */
export function StayMapCard({ o, guests, distance, block, onClose, onSee, onChoose, onHeight }: {
  o: StayOption; guests: number; distance: string | null; block: string | null;
  onClose: () => void; onSee?: () => void; onChoose: () => void; onHeight?: (h: number) => void;
}) {
  const bottom = useBottomInset();
  const l = stayLines(o);
  const f = o.facts;
  const code = o.hotel?.code ?? 0;
  const details = useHotelDetails(code);
  const photos = [...new Set([o.hotel?.imageUrl, ...(details.data?.hotel.images ?? [])].filter((x): x is string => !!x))].slice(0, 8);
  const [w, setW] = useState(0);
  const [pg, setPg] = useState({ id: o.id, n: 0 });
  const page = pg.id === o.id ? pg.n : 0;
  const setPage = (n: number) => setPg({ id: o.id, n });
  const rating = Number(o.rating) > 0 ? o.rating : null;
  const board = f?.board && f.board !== 'other' && f.board !== 'RO' ? t(`stay.board.${f.board}` as CopyKey) : null;
  const where = f?.zone ?? o.area.split(' · ')[0] ?? null;

  // A pull down closes it; a short pull springs back.
  const y = useSharedValue(0);
  useEffect(() => { y.set(0); }, [o.id, y]);
  const pan = Gesture.Pan().activeOffsetY(10).failOffsetX([-14, 14])
    .onChange((e) => { y.set(Math.max(0, y.get() + e.changeY)); })
    .onEnd((e) => {
      if (y.get() > 70 || e.velocityY > 700) y.set(withTiming(420, { duration: 200 }, (done) => { if (done) scheduleOnRN(onClose); }));
      else y.set(withTiming(0, { duration: 200 }));
    });
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));

  // Keyboard: the card takes focus when it opens (so a screen reader reads it), and Escape closes it.
  const box = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    el?.setAttribute('tabindex', '-1');
    el?.focus?.({ preventScroll: true } as FocusOptions);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [o.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View entering={SlideInDown.duration(260)} style={[s.card, { paddingBottom: 14 + bottom }, moved]} onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      testID="stays-map-card">
      <View ref={box} accessibilityRole="summary" accessibilityLabel={o.name} accessibilityLiveRegion="polite" style={{ gap: 10, outlineStyle: 'none' } as object}>
        <GestureDetector gesture={pan}>
          <View style={s.grabZone}><View style={s.grab} /></View>
        </GestureDetector>
        <View style={s.top}>
          {/* Photos: swipe across when the hotel has several. */}
          <View style={s.photo} onLayout={(e) => setW(e.nativeEvent.layout.width)} testID="stays-map-card-photos">
            {photos.length > 1 && w ? (
              <ScrollView key={o.id} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setPage(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / w))}
                onScroll={Platform.OS === 'web' ? (e) => setPage(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / w)) : undefined} scrollEventThrottle={64}>
                {photos.map((uri, i) => <ExpoImage key={uri} source={{ uri }} style={{ width: w, height: 112 }} contentFit="cover" accessibilityLabel={t('stays.card.photo', { n: i + 1, count: photos.length })} />)}
              </ScrollView>
            ) : o.hotel ? <HotelPhoto uri={photos[0]} name={o.name} seed={o.hotel.code} compact recyclingKey={o.id} testID="stays-map-card-photo" />
              : <Photo name={o.photo} focal={o.focal} />}
            {photos.length > 1 ? <View style={s.dots} pointerEvents="none">{photos.map((uri, i) => <View key={uri} style={[s.dot, i === page ? s.dotOn : null]} />)}</View> : null}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <T style={[font('displaySmall'), { fontSize: 22, lineHeight: 25 }]} numberOfLines={2} testID="stays-map-card-name">{o.name}</T>
            {f?.stars || rating ? (
              <View style={s.row}>
                {f?.stars ? <><Icon name="star" size={13} color={colors.goldDeep} /><T v="tiny" color={colors.ink2}>{tn('stay.starsCount', f.stars, { n: f.stars })}</T></> : null}
                {f?.stars && rating ? <T v="tiny">·</T> : null}
                {rating ? <T v="tiny" color={colors.ink2}>{t('stays.card.rating', { rating })}</T> : null}
              </View>
            ) : null}
            {where ? <T v="tiny" numberOfLines={1}>{where}</T> : null}
            {distance ? <View style={s.row}><Icon name="pin" size={13} color={colors.ink3} /><T v="tiny" style={{ flex: 1 }} numberOfLines={2}>{distance}</T></View> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('stays.card.close')} onPress={() => { buzz('tap'); onClose(); }} hitSlop={10} style={s.close} testID="stays-map-card-close">
            <Icon name="close" size={16} color={colors.green} />
          </Pressable>
        </View>
        <View style={s.facts}>
          <View style={s.row}><Icon name={l.cancel.free ? 'check' : 'refund'} size={14} color={l.cancel.free ? colors.ok : colors.ink3} /><T v="tiny" color={l.cancel.free ? colors.ok : colors.ink2} style={{ fontFamily: ff.ui500 }}>{l.cancel.text}</T></View>
          {board ? <View style={s.row}><Icon name="food" size={14} color={colors.ok} /><T v="tiny" color={colors.ok} style={{ fontFamily: ff.ui500 }}>{board}</T></View> : null}
        </View>
        <View style={s.price}>
          <T style={s.night} testID="stays-map-card-night">{l.perNight}</T>
          <T v="small" color={colors.green} style={{ fontFamily: ff.ui600, fontVariant: ['tabular-nums'] }} testID="stays-map-card-total">
            {t('stays.card.total', { rooms: roomsLabel(guests), nights: tn('ask.stay.nights', o.nights), price: formatSar(o.total.amount) })}
          </T>
          <T v="tiny">{t('stays.priceFor', { guests: tn('ask.stay.guests', guests) })}</T>
        </View>
        <View style={s.row}>
          {onSee ? <Button variant="secondary" label={t('stays.card.see')} onPress={onSee} style={{ flex: 1 }} testID="stays-map-card-see" /> : null}
          <Button label={block ?? t('stays.card.choose')} disabled={!!block} onPress={onChoose} style={{ flex: 1.3 }} testID="stays-map-card-choose" />
        </View>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  card: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingHorizontal: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.paper, boxShadow: '0px -10px 30px -14px rgba(15,26,22,0.45)' },
  grabZone: { alignItems: 'center', paddingTop: 8, paddingBottom: 2, marginBottom: -6 },
  grab: { width: 38, height: 5, borderRadius: 99, backgroundColor: colors.grab },
  top: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  photo: { width: 112, height: 112, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.stage },
  dots: { position: 'absolute', bottom: 6, start: 0, end: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 99, backgroundColor: 'rgba(255,253,249,0.55)' },
  dotOn: { backgroundColor: colors.paper },
  close: { width: 30, height: 30, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mist },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4 },
  price: { gap: 1, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  night: { fontFamily: ff.ui700, fontSize: 18, color: colors.green, fontVariant: ['tabular-nums'] },
});
