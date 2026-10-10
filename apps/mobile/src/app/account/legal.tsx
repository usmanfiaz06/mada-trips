import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { t } from '@/lib/i18n';

/** Terms of use and the privacy policy, in plain words (Account.jsx Legal). */
export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const which = doc === 'privacy' ? 'privacy' : 'terms';
  return (
    <AccountScreen testID="legal">
      <T v="h1" accessibilityRole="header">{which === 'privacy' ? t('help.privacy') : t('help.terms')}</T>
      <T v="tiny">{t('legal.updated')}</T>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ gap: 6 }}>
          <T v="h3">{t(`legal.${which}.${i}h` as 'legal.terms.1h')}</T>
          <T v="body" style={{ fontSize: 15 }}>{t(`legal.${which}.${i}b` as 'legal.terms.1b')}</T>
        </View>
      ))}
    </AccountScreen>
  );
}
