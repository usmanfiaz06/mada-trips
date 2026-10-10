import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Dock } from '@/components/Dock';
import { useMe } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';

/** Today, Trips, (Ask), Circles, Wallet, on the floating dock. */
export default function TabsLayout() {
  const status = useSession((s) => s.status);
  useMe();
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  return (
    <Tabs tabBar={(props) => <Dock {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.sand } }}>
      <Tabs.Screen name="today" />
      <Tabs.Screen name="trips" />
      <Tabs.Screen name="circles" />
      <Tabs.Screen name="wallet" />
    </Tabs>
  );
}
