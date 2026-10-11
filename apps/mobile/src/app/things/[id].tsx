import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDays } from '@mada/shared';
import { Screen, Scroll, TopBar } from '@/components/Layout';
import { ThingsView } from '@/components/things/ThingsView';
import { t } from '@/lib/i18n';
import { useTrip } from '@/lib/trips';

/** Things to do, the whole list: /things/<city id or name>?city=Istanbul&trip=<trip id>&day=2027-03-12. */
export default function ThingsScreen() {
  const { id, city, trip, day } = useLocalSearchParams<{ id: string; city?: string; trip?: string; day?: string }>();
  const router = useRouter();
  const tr = useTrip(trip ?? '').data?.trip;
  const days: string[] = [];
  if (tr) for (let d = tr.startDate, i = 0; d <= (tr.endDate ?? tr.startDate) && i < 30; d = addDays(d, 1), i++) days.push(d);
  const name = city ?? tr?.city ?? id;
  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/trips'))} title={t('things.titleIn', { city: name })} />
      <Scroll top={8} bottomPad={80}>
        <ThingsView mode="full" placeId={id} city={name} tripId={trip ?? null} days={days} initialDay={day ?? null} />
      </Scroll>
    </Screen>
  );
}
