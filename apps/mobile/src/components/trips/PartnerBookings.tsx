import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Box, Grow, H3, IconTile, ListRow, Row, Small } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useTripVouchers } from '@/lib/transfers';

/*
 * On a trip: "Airport pickup" when the trip lands somewhere and no pickup is booked yet (Hotelbeds transfers, sent to
 * the desk in the beta), and the trip's Hotelbeds pickup vouchers (the hotel's is under its Manage).
 */
export function TripPartnerBookings({ trip, hasArrivalPickup }: { trip: TripDetail; hasArrivalPickup: boolean }) {
  const router = useRouter();
  // The hotel's voucher is under the hotel's Manage on the trip page; the pickup's stays here.
  const vouchers = (useTripVouchers(trip.id).data?.vouchers ?? []).filter((v) => v.kind !== 'stay');
  const outs = trip.segments.filter((s) => s.direction === 'out');
  const land = outs[outs.length - 1];
  const stay = trip.stays.find((s) => s.status !== 'cancelled');
  const offerPickup = !!land && !hasArrivalPickup && trip.status !== 'cancelled';
  if (!offerPickup && !vouchers.length) return null;
  return (
    <View style={{ gap: 12 }}>
      {offerPickup ? (
        <Box testID="pickup-entry">
          <Row><IconTile name="car" tone="gold" /><Grow gap={2}><H3 size={15}>{t('pickup.entry.title')}</H3><Small>{t('pickup.entry.sub', { airport: land!.to, hotel: stay?.name ?? trip.noStay?.label ?? trip.city })}</Small></Grow></Row>
          <Button testID="pickup-open" label={t('pickup.entry.cta')} variant="secondary" size="small" block={false} onPress={() => { buzz('tap'); router.push(`/trip/${trip.id}/pickup` as Href); }} />
        </Box>
      ) : null}
      {vouchers.length ? (
        <Box padding={6} gap={0}>
          {vouchers.map((v, i) => (
            <ListRow key={v.id} testID={`voucher-${i}`} first={i === 0} icon={v.kind === 'stay' ? 'stay' : 'car'} title={t(v.kind === 'stay' ? 'voucher.open' : 'voucher.openTransfer')}
              sub={v.status === 'cancelled' ? t('voucher.cancelled') : t('voucher.openSub', { ref: v.reference })} onPress={() => router.push(`/voucher/${v.id}` as Href)} />
          ))}
        </Box>
      ) : null}
    </View>
  );
}
