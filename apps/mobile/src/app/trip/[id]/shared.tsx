import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { rangeLabel, type SharedTripItem } from '@mada/shared';
import { ChangeRequestCard } from '@/components/booking/ChangeRequestCard';
import { Initial } from '@/components/booking/PeopleFrame';
import { Icon, type IconName } from '@/components/Icon';
import { Box, Eyebrow, Grow, H3, Rise, Row, Small, SmallButton, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { getLocale, t } from '@/lib/i18n';
import { useSharedTrip } from '@/lib/trip-people';
import { colors } from '@/theme';

/*
 * A trip someone else organised, as a companion sees it (ASK-INTEGRATED.md §5.3): the title, dates, who's going, the
 * plan day by day with places, stay names and times, and the changes he asked for. Never prices, payment, other
 * people's documents or the organiser's own chat. Ask Mada about it opens his own chat for the trip.
 */

const ICON: Record<string, IconName> = { leg: 'flight', stay: 'stay', car: 'car', activity: 'star', meal: 'food', note: 'doc', check: 'check' };

export default function SharedTrip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useSharedTrip(id);
  const trip = q.data?.trip;
  if (!trip) return <TripScreen title={t('people.shared.title')}>{null}</TripScreen>;
  const days = new Map<number | null, SharedTripItem[]>();
  for (const i of trip.items) days.set(i.day, [...(days.get(i.day) ?? []), i]);
  const order = [...days.keys()].sort((a, b) => (a ?? 999) - (b ?? 999));
  return (
    <TripScreen title={trip.title}>
      <Rise style={{ gap: 6 }}>
        <Eyebrow>{rangeLabel(trip.startDate, trip.endDate, getLocale())}</Eyebrow>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {trip.people.map((p) => (
            <Row key={p.name} gap={6}><Initial letter={p.initial} size={28} gold={p.owner} /><Small color={colors.green}>{p.name}</Small></Row>
          ))}
        </Row>
        <Tag tone="ok" label={t(`people.role.${trip.role}`)} style={{ alignSelf: 'flex-start' }} />
      </Rise>
      <Box tone="well" testID="shared-no-prices">
        <Row><Icon name="lock" size={16} color={colors.ink3} /><Small style={{ flex: 1 }}>{t('people.shared.noPrices', { name: trip.ownerName })}</Small></Row>
      </Box>
      {!trip.items.length ? <Small>{t('people.shared.empty')}</Small> : null}
      {order.map((d, k) => (
        <Rise key={String(d)} step={k + 1}>
          <Box testID={`shared-day-${d ?? 'trip'}`}>
            <H3 size={15}>{d == null ? t('people.shared.wholeTrip') : t('people.shared.day', { n: d + 1 })}</H3>
            {days.get(d)!.map((i) => (
              <Row key={i.id} align="flex-start">
                <Icon name={ICON[i.kind] ?? 'pin'} size={18} color={colors.ink3} />
                <Grow gap={1}>
                  <Small color={colors.green}>{i.title}</Small>
                  <Tiny>{[i.at, i.place, i.nights ? `${i.nights} ×` : null].filter(Boolean).join(' · ')}</Tiny>
                </Grow>
                {i.booked ? <Tag tone="ok" label={t('people.shared.booked')} /> : null}
              </Row>
            ))}
          </Box>
        </Rise>
      ))}
      {trip.changes.length ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>{t('people.shared.yourChanges')}</Eyebrow>
          {trip.changes.map((c) => <ChangeRequestCard key={c.id} card={{ type: 'change', change: c }} />)}
        </View>
      ) : null}
      <SmallButton tone="primary" icon="mic" label={t('people.shared.ask')} onPress={() => router.push(`/ask?prefill=${encodeURIComponent(t('people.shared.askSay', { trip: trip.title, name: trip.ownerName }))}` as Href)} testID="shared-ask" />
    </TripScreen>
  );
}
