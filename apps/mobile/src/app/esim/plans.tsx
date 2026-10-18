import { useLocalSearchParams } from 'expo-router';
import { EsimPlanner } from '@/components/esim/EsimPlanner';
import { TripScreen } from '@/components/trips/ui';
import { t } from '@/lib/i18n';

/* An eSIM for a trip (Today's readiness, the trip page): the planner on its own screen, the total and Review pinned at the bottom. */
export default function EsimPlansScreen() {
  const { trip, destination, days } = useLocalSearchParams<{ trip?: string; destination?: string; days?: string }>();
  return (
    <EsimPlanner tripId={trip ?? null} destination={destination ?? null} days={days ? Number(days) : null}
      layout={(body, bar) => <TripScreen title={t('es.list.title')} act={bar ?? undefined}>{body}</TripScreen>} />
  );
}
