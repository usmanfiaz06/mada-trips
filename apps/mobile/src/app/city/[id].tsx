import { useLocalSearchParams } from 'expo-router';
import { CityPage } from '@/components/places/CityPage';

/* Any city: /city/611717 (GeoNames id) or /city/tbilisi (a name, as Discover links it). */
export default function CityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CityPage id={decodeURIComponent(String(id ?? ''))} />;
}
