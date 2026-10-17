import { useLocalSearchParams } from 'expo-router';
import { EsimPlanner } from '@/components/esim/EsimPlanner';
import { TripScreen } from '@/components/trips/ui';
import { t } from '@/lib/i18n';

/* An eSIM for a trip (Today's readiness, the trip page): the planner on its own screen. */
export default function EsimPlansScreen() {
  const { trip, destination, days } = useLocalSearchParams<{ trip?: string; destination?: string; days?: string }>();
  return (
    <TripScreen title={t('es.list.title')}>
      <EsimPlanner tripId={trip ?? null} destination={destination ?? null} days={days ? Number(days) : null} />
    </TripScreen>
  );
}
