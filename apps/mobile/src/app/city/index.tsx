import { useRouter } from 'expo-router';
import { Screen, Scroll, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { CitySearch } from '@/components/places/CitySearch';
import { t } from '@/lib/i18n';

/* Search any city in the world; picking one opens its page. Also where a city link we can't find sends people. */
export default function CitySearchScreen() {
  const router = useRouter();
  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <Scroll top={4}>
        <T v="h1">{t('places.search.title')}</T>
        <CitySearch autoFocus onPick={(p) => router.push(`/city/${p.id}`)} />
      </Scroll>
    </Screen>
  );
}
