import { Pressable, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { formatSar, stayLines, type StayOption } from '@mada/shared';
import { t, tn } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { Pill } from '../Pill';
import { T } from '../Text';
import { Photo } from './parts';

/*
 * One stay, in the traveller's language: the photo, the name and stars, the total for the whole party (per night
 * second), the room and board, the cancellation (green when it's free), local tax paid at the hotel, the distance
 * from where they measure, and why it's here (a pick's reason, a wish's evidence). Nothing from the supplier raw.
 */
export function StayCard({ h, i, on, guests, reason, distance, evidence, onPress, onDetails, compact, noBadge }: {
  h: StayOption; i: number; on: boolean; guests: number; reason?: string | null; noBadge?: boolean; distance?: string | null; evidence?: string[]; onPress: () => void; onDetails?: () => void; compact?: boolean;
}) {
  const l = stayLines(h);
  const img = h.hotel?.imageUrl ?? null;
  // At most one badge per list: "Our pick" and "Lowest price" (older answers without badges keep their label).
  const badge = noBadge ? null : h.badge !== undefined ? (h.badge ? t(h.badge === 'best' ? 'stays.badge.best' : 'search.label.lowest') : null) : t(`search.label.${h.label}`);
  return (
    <Card padding={0} selected={on} onPress={onPress} accessibilityLabel={`${h.name}, ${formatSar(h.total.amount)}`} style={{ overflow: 'hidden', gap: 0 }}>
      <View style={[s.photo, compact ? { height: 96 } : null]} testID={`stay-photo-${i}`}>
        {img ? <ExpoImage source={{ uri: img }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} recyclingKey={h.id} accessible={false} /> : <Photo name={h.photo} focal={h.focal} />}
        {badge ? <Pill label={badge} variant={on ? 'gold' : 'default'} style={[s.tl, on ? null : s.glass]} /> : null}
      </View>
      <View style={s.body}>
        {reason ? <T v="small" color={colors.goldInk} style={{ fontFamily: ff.ui600 }} testID={`stay-reason-${i}`}>{reason}</T> : null}
        <View style={s.spread}>
          <T v="h3" style={{ flex: 1 }} numberOfLines={2}>{h.name}</T>
          <View style={{ alignItems: 'flex-end' }}>
            <T style={s.price} testID={`stay-price-${i}`}>{formatSar(h.total.amount)}</T>
            <T v="tiny">{t('stays.priceFor', { guests: tn('ask.stay.guests', guests) })}</T>
          </View>
        </View>
        {l.where ? <T v="small">{l.where}</T> : null}
        <T v="small" color={colors.green} testID={`stay-room-${i}`}>{l.room}</T>
        <View style={s.row}>
          <Icon name={l.cancel.free ? 'check' : 'refund'} size={16} color={l.cancel.free ? colors.ok : colors.ink3} />
          <T v="small" color={l.cancel.free ? colors.ok : colors.ink2} style={{ flex: 1 }} testID={`stay-cancel-${i}`}>{l.cancel.text}</T>
        </View>
        {distance ? <View style={s.row}><Icon name="pin" size={16} color={colors.ink3} /><T v="small" style={{ flex: 1 }} testID={`stay-distance-${i}`}>{distance}</T></View> : null}
        {evidence?.length ? (
          <View style={s.chips} testID={`stay-evidence-${i}`}>{evidence.map((e) => <View key={e} style={s.ev}><Icon name="check" size={13} color={colors.ok} /><T v="tiny" color={colors.green}>{e}</T></View>)}</View>
        ) : null}
        <View style={s.spread}>
          <T v="tiny" style={{ flex: 1 }}>{[l.perNight, l.tax].filter(Boolean).join(' · ')}</T>
          {onDetails ? (
            <Pressable testID={`hotel-details-${i}`} accessibilityRole="link" onPress={onDetails} hitSlop={10}>
              <T v="small" color={colors.green} style={{ textDecorationLine: 'underline', fontFamily: ff.ui500 }}>{t('hotel.details')}</T>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  photo: { height: 132, position: 'relative', backgroundColor: colors.stage },
  tl: { position: 'absolute', top: 10, start: 10 },
  glass: { backgroundColor: 'rgba(255,253,249,0.92)' },
  body: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 5 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontFamily: ff.ui600, fontSize: 17, color: colors.green, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ev: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: 'rgba(47,122,75,0.1)' },
});
