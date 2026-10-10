import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { VGradient } from '@/components/Gradient';
import { Act, Screen, TopBar } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { useUpdateMe } from '@/lib/queries';
import { colors, font, radii, ff } from '@/theme';

const PREVIEW = [
  { title: () => t('notify.gateChange.title', { gate: 'C4' }), body: () => t('notify.gateChange.body', { flight: 'SV263', gate: 'C4', minutes: 6 }), delay: 400 },
  { title: () => t('notify.driver.title'), body: () => t('alerts.preview.driver.body'), delay: 1200 },
  { title: () => t('notify.leave.title', { minutes: 15 }), body: () => t('alerts.preview.leave.body'), delay: 2000 },
];

/** The pre-prompt, then the system prompt on Allow. "Not now" is fine: we ask again after the first booking. */
export default function Alerts() {
  const router = useRouter();
  const update = useUpdateMe();
  const [busy, setBusy] = useState<'allow' | 'later' | null>(null);

  const finish = async (allow: boolean) => {
    setBusy(allow ? 'allow' : 'later');
    let choice: 'allowed' | 'declined' = allow ? 'allowed' : 'declined';
    if (allow && Platform.OS !== 'web') {
      try { choice = (await Notifications.requestPermissionsAsync()).granted ? 'allowed' : 'declined'; } catch { /* keep their answer */ }
    }
    try { await update.mutateAsync({ notifications: choice, onboarded: true }); } catch { /* the app works without it; /me retries later */ }
    buzz('success');
    useOnboarding.getState().reset();
    router.dismissAll?.();
    router.replace('/today');
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
        <View style={styles.preview} accessible={false}>
          <VGradient id="alerts" stops={[[0, colors.green2], [0.55, colors.green], [1, colors.green3]]} />
          <Image source={require('../../../assets/images/istanbul.jpg')} style={[StyleSheet.absoluteFill, { opacity: 0.28 }]} contentFit="cover" />
          <View style={{ alignItems: 'center', marginBottom: 6 }}>
            <T v="tiny" color={colors.mist} style={{ opacity: 0.85, fontFamily: ff.ui500 }}>{t('alerts.preview.day')}</T>
            <T style={[font('hero', colors.mist), { fontSize: 54, lineHeight: 56 }]}>{t('alerts.preview.time')}</T>
          </View>
          {PREVIEW.map((n, i) => (
            <Animated.View key={i} entering={FadeInUp.duration(600).delay(n.delay)} style={styles.banner}>
              <View style={styles.appIcon}><Sun width={18} /></View>
              <View style={{ flex: 1, gap: 1 }}>
                <T v="h3" style={{ fontSize: 13, lineHeight: 17 }}>{n.title()}</T>
                <T v="tiny" color={colors.inkSoft}>{n.body()}</T>
              </View>
            </Animated.View>
          ))}
        </View>
        <T v="h1" accessibilityRole="header">{t('alerts.title')}</T>
        <T v="body">{t('alerts.body')}</T>
      </View>
      <Act>
        <Button label={t('alerts.allow')} busy={busy === 'allow'} disabled={!!busy} onPress={() => finish(true)} testID="alerts-allow" haptic={null} />
        <Button variant="ghost" label={t('alerts.later')} busy={busy === 'later'} disabled={!!busy} onPress={() => finish(false)} />
      </Act>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { height: 300, borderRadius: radii.sheet, overflow: 'hidden', paddingVertical: 22, paddingHorizontal: 14, gap: 10 },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(255,253,249,0.9)' },
  appIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});
