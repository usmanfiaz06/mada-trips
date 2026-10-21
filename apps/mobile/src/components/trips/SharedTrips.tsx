import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { rangeLabel, type SharedTripCard } from '@mada/shared';
import { Box, Eyebrow, Grow, H3, Row, SmallButton, Tag, Tiny } from '@/components/trips/ui';
import { Initial } from '@/components/booking/PeopleFrame';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { peopleApi, pk, useSharedTrips } from '@/lib/trip-people';

/*
 * Trips someone else organised and put you on (ASK-INTEGRATED.md §5.3), on the Trips tab under your own: going, or an
 * invite waiting for your yes. Opening one shows the plan as a companion sees it, never prices.
 */

export function SharedTrips() {
  const q = useSharedTrips();
  const list = q.data?.trips ?? [];
  if (!list.length) return null;
  return (
    <View style={{ gap: 10 }} testID="shared-trips">
      <Eyebrow style={{ marginTop: 8 }}>{t('people.shared.title')}</Eyebrow>
      {list.map((x) => <SharedRow key={x.tripId} trip={x} />)}
    </View>
  );
}

function SharedRow({ trip }: { trip: SharedTripCard }) {
  const router = useRouter();
  const qc = useQueryClient();
  const answer = async (a: 'accept' | 'decline') => {
    if (!trip.inviteId) return;
    buzz(a === 'accept' ? 'success' : 'tap');
    const r = await peopleApi.answer(trip.inviteId, a).catch(() => null);
    if (r) qc.setQueryData(pk.shared, r);
  };
  const open = trip.status === 'going' ? () => router.push(`/trip/${trip.tripId}/shared` as Href) : undefined;
  return (
    <Box onPress={open} label={trip.title} testID={`shared-trip-${trip.status}`}>
      <Row align="flex-start">
        <Initial letter={(trip.ownerName[0] ?? '?').toUpperCase()} gold size={40} />
        <Grow gap={3}>
          <H3 size={16}>{trip.title}</H3>
          <Tiny>{[rangeLabel(trip.startDate, trip.endDate, getLocale()), trip.status === 'invited' ? t('people.shared.invited', { name: trip.ownerName }) : t('people.shared.from', { name: trip.ownerName })].join(' · ')}</Tiny>
        </Grow>
        <Tag tone={trip.status === 'invited' ? 'when' : 'ok'} label={trip.status === 'invited' ? t('people.status.invited') : t(`people.role.${trip.role}`)} />
      </Row>
      {trip.status === 'invited' ? (
        <Row gap={8}>
          <SmallButton tone="primary" label={t('people.shared.accept')} onPress={() => void answer('accept')} testID="shared-accept" />
          <SmallButton tone="soft" label={t('people.shared.decline')} onPress={() => void answer('decline')} testID="shared-decline" />
        </Row>
      ) : null}
    </Box>
  );
}
