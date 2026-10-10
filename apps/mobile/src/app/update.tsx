import { Linking, Platform, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { Button } from '@/components/Button';
import { Screen, useTopInset } from '@/components/Layout';
import { ArtUpdate } from '@/components/states/art';
import { StateView } from '@/components/states/StateView';
import { t } from '@/lib/i18n';
import { setAsideUpdate, useGates } from '@/lib/net/gates';

/**
 * This version is older than the server allows (a 426, or GET /config minVersion). Update Mada goes to the store;
 * the trips saved on the phone still open meanwhile.
 */
export default function UpdateScreen() {
  const top = useTopInset();
  const urls = useGates((s) => s.config?.storeUrls);
  const store = Platform.OS === 'android' ? urls?.android ?? 'https://play.google.com/store/apps/details?id=sa.madatrips.app' : urls?.ios ?? 'https://apps.apple.com/app/mada-trips';
  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: top }}>
        <StateView art={<ArtUpdate />} title={t('update.title')} body={t('update.body')} note={t('update.note')} testID="update-screen"
          primary={<Button label={t('update.action')} onPress={() => { void Linking.openURL(store).catch(() => {}); }} testID="update-go" />}
          secondary={<Button variant="ghost" label={t('update.offline')} onPress={() => { setAsideUpdate(); router.replace('/trips' as Href); }} testID="update-trips" />} />
      </View>
    </Screen>
  );
}
