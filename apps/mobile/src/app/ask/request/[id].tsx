import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Scroll, TopBar } from '@/components/Layout';
import { SentRequest } from '@/components/booking/Requests';
import { t } from '@/lib/i18n';

/* One request, its quote per person and the thread: opened from Trips → Requests and from "Mada replied". */
export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  return (
    <Screen>
      <TopBar onBack={() => router.back()} backLabel={t('common.back')} />
      <Scroll top={4}>
        <SentRequest id={String(id ?? '')} />
      </Scroll>
    </Screen>
  );
}
