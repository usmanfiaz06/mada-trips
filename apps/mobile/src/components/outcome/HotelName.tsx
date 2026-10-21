import { Pressable } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useTrip } from '@/lib/trips';
import { colors } from '@/theme';

/** Where a booked stay's hotel page lives (the same link Today and the trip screen use). */
export const hotelHref = (st: { id: string; hotelCode?: string | null }, trip: { id: string; city: string }) =>
  `/hotel/${st.hotelCode ?? 'stay'}?trip=${trip.id}&stay=${st.id}&city=${encodeURIComponent(trip.city)}` as Href;

/**
 * A hotel's name wherever a stay shows (requests, the timeline): tappable to its page when the trip has that stay with
 * a hotel code, plain text otherwise.
 */
export function HotelName({ name, tripId, testID }: { name: string; tripId: string | null | undefined; testID?: string }) {
  const router = useRouter();
  const trip = useTrip(tripId ?? null).data?.trip;
  const st = trip?.stays.find((s) => s.name === name);
  if (!trip || !st?.hotelCode) return <T v="small" testID={testID}>{name}</T>;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={t('hotel.booked.openA11y', { name })} hitSlop={6} testID={testID}
      onPress={() => { buzz('tap'); router.push(hotelHref(st, trip)); }}>
      <T v="small" color={colors.green} style={{ textDecorationLine: 'underline' }}>{name}</T>
    </Pressable>
  );
}
