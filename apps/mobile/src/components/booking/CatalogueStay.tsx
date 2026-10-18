import { View } from 'react-native';
import { formatSar, shortDay, type CatalogueStay } from '@mada/shared';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { t, tn } from '@/lib/i18n';
import { colors } from '@/theme';

/*
 * A catalogue hotel's facts for this stay (shared catalogueStay): room × rooms, the price a night and in all, the board,
 * the rating, the last day to cancel free, what's included. The hotel page shows them in full; the bundle card in two lines.
 */

export const roomLine = (s: CatalogueStay) => {
  const room = s.room ?? t('hp.roomPlain');
  return s.rooms > 1 ? tn('hp.rooms', s.rooms, { room }) : tn('hp.rooms', 1, { room });
};
const boardOf = (s: CatalogueStay) => (s.board && s.board !== 'other' ? t(`stay.board.${s.board}`) : null);

/** Two lines for the bundle card: "Deluxe double × 2 rooms · Breakfast included", "SAR 980 a night · free to cancel until 2 Mar". */
export function BundleStayLines({ s, testID = 'bundle-stay' }: { s: CatalogueStay; testID?: string }) {
  const board = boardOf(s);
  return (
    <View style={{ gap: 2 }} testID={testID}>
      <T v="tiny" color={colors.green}>{board ? t('hp.line.room', { room: roomLine(s), board }) : roomLine(s)} · ★ {s.rating}</T>
      <T v="tiny">{s.freeUntil ? t('hp.line.price', { price: formatSar(s.perNight), date: shortDay(s.freeUntil) }) : t('hp.line.priceNoDate', { price: formatSar(s.perNight) })}</T>
    </View>
  );
}

/** The hotel page's "This stay": every fact before the biggest line of the trip. */
export function CatalogueStayFacts({ s, pickup, testID = 'hotel-stay' }: { s: CatalogueStay; pickup?: boolean; testID?: string }) {
  const board = boardOf(s);
  const row = (icon: Parameters<typeof Icon>[0]['name'], text: string, id: string, color: string = colors.green) => (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} testID={`${testID}-${id}`}>
      <Icon name={icon} size={16} color={colors.ink3} /><T v="small" color={color} style={{ flex: 1 }}>{text}</T>
    </View>
  );
  const included = [board, s.connecting ? t('hp.connecting') : null, ...s.amenities.filter((a) => a !== 'connecting').map((a) => t(`wish.has.${a}`)), pickup ? t('hp.pickup') : null].filter((x): x is string => !!x);
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <T v="h3" style={{ fontSize: 15 }}>{t('hp.stay')}</T>
      {row('stay', roomLine(s), 'room')}
      {row('card', t('hp.perNight', { price: formatSar(s.perNight) }), 'night')}
      {s.checkIn ? row('calendar', tn('hp.total', s.nights, { price: formatSar(s.total) }), 'total') : null}
      {row('star', t('hp.rating', { rating: s.rating }), 'rating')}
      {row('check', s.freeUntil ? t('hotel.cancelFree', { date: shortDay(s.freeUntil) }) : t('hp.cancelWeek'), 'cancel', colors.ok)}
      {included.length ? (
        <View style={{ gap: 4, marginTop: 2 }}>
          <T v="tiny">{t('hp.included')}</T>
          <T v="small" color={colors.green} testID={`${testID}-included`}>{included.join(' · ')}</T>
        </View>
      ) : null}
    </View>
  );
}
