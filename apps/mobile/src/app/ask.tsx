import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Screen, TopBar } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { colors, font } from '@/theme';

/** Ask, opened by the sun orb. The concierge arrives in M2; for now it says so plainly and hands back. */
export default function Ask() {
  const router = useRouter();
  return (
    <Screen>
      <TopBar onBack={() => router.back()} backLabel={t('common.cancel')} />
      <View style={styles.body}>
        <Sun width={72} color={colors.goldDeep} />
        <T style={[font('display'), { textAlign: 'center' }]} accessibilityRole="header">{t('ask.placeholder')}</T>
        <T v="small" style={{ textAlign: 'center' }}>{t('ask.disclosure')}</T>
        <T v="body" style={{ textAlign: 'center' }}>{t('ask.soon')}</T>
        <Button variant="secondary" label={t('common.back')} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 } });
