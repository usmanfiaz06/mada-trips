import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Act, Screen, useTopInset } from '@/components/Layout';
import { T } from '@/components/Text';
import { api } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { useOnboarding } from '@/lib/onboarding';
import { colors, font, shadow } from '@/theme';

const POLAROIDS = [
  { src: require('../../../assets/images/alula.jpg'), rot: '-14deg', x: -86 },
  { src: require('../../../assets/images/riyadh.jpg'), rot: '11deg', x: 86 },
  { src: require('../../../assets/images/istanbul.jpg'), rot: '-2deg', x: 0 },
];

/** An existing account signs in again: "Welcome back", everything restored (FLOWS.md §1). */
export default function WelcomeBack() {
  const router = useRouter();
  const top = useTopInset();
  const name = useOnboarding((s) => s.returning?.name ?? '');
  return (
    <Screen>
      <View style={[styles.hero, { paddingTop: top + 26 }]}>
        <View style={styles.photos} accessible={false}>
          {POLAROIDS.map((p, i) => (
            <Animated.View key={i} entering={rise(i * 2)} style={[styles.polaroid, shadow('focal'), { transform: [{ translateX: p.x }, { rotate: p.rot }] }]}>
              <Image source={p.src} style={{ flex: 1, borderRadius: 4 }} contentFit="cover" />
            </Animated.View>
          ))}
          <Animated.View entering={ZoomIn.duration(450).delay(1050)} style={styles.stamp}>
            <T style={[font('display', colors.goldInk), { fontSize: 22, lineHeight: 24, letterSpacing: 0.8 }]}>{'MADA'}</T>
          </Animated.View>
        </View>
        <Animated.View entering={rise(10)}>
          <T style={[font('displayXL'), { fontSize: 46, lineHeight: 46, textAlign: 'center' }]} accessibilityRole="header">
            {name ? t('welcomeBack.titleNamed', { name }) : t('welcomeBack.title')}
          </T>
        </Animated.View>
        <Animated.View entering={rise(12)}><T v="body" color={colors.inkSoft} style={{ textAlign: 'center' }}>{t('welcomeBack.line')}</T></Animated.View>
      </View>
      <Act>
        <Button label={t('welcomeBack.open')} onPress={() => { buzz('success'); router.replace('/today'); }} testID="welcome-back-open" haptic={null} />
        <Button variant="ghost" label={t('welcomeBack.notMe')} onPress={async () => { await api.logout(); router.replace('/signin'); }} />
      </Act>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: 24, gap: 14 },
  photos: { width: '100%', height: 250, alignItems: 'center' },
  polaroid: { position: 'absolute', top: 10, width: 150, height: 196, padding: 8, paddingBottom: 30, backgroundColor: colors.paper, borderRadius: 10 },
  stamp: { position: 'absolute', top: 150, start: '55%', width: 96, height: 96, borderRadius: 999, borderWidth: 3, borderColor: colors.goldDeep, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-14deg' }], backgroundColor: 'rgba(255,253,249,0.35)' },
});
