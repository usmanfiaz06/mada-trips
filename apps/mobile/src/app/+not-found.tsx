import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Screen, TopBar } from '@/components/Layout';
import { GoneState } from '@/components/states/ErrorState';
import { t } from '@/lib/i18n';

/**
 * A link to something that isn't there (a deep link to a cancelled trip, an old notification, a mistyped address):
 * say so plainly and give a way back, never a blank screen.
 */
export default function NotFound() {
  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/today' as Href))} backLabel={t('common.back')} />
      <View style={{ flex: 1 }}><GoneState /></View>
    </Screen>
  );
}
