import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { VGradient } from '@/components/Gradient';
import { useBottomInset, useTopInset } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { rise, useReduceMotion } from '@/lib/motion';
import { useOnboarding } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { colors, font } from '@/theme';

const VIDEO = require('../../../assets/video/welcome.mp4');
const POSTER = require('../../../assets/images/welcome.jpg');

/** "We'll take it from here." over the film, Start, or just track a flight without an account (FLOWS.md §1). */
export default function Welcome() {
  const router = useRouter();
  const top = useTopInset();
  const bottom = useBottomInset();
  const still = useReduceMotion();
  const player = useVideoPlayer(VIDEO, (p) => { p.loop = true; p.muted = true; p.play(); });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.night }]}>
      <Image source={POSTER} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} />
      {!still && <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} accessible={false} pointerEvents="none" />}
      <VGradient id="welcome" stops={[[0, 'rgba(15,26,22,0.45)'], [0.22, 'rgba(15,26,22,0)'], [0.42, 'rgba(15,26,22,0)'], [0.66, 'rgba(30,53,45,0.82)'], [0.84, '#1e352d'], [1, '#1e352d']]} />
      <View style={[styles.content, { paddingTop: top + 20, paddingBottom: bottom + 40 }]}>
        <Sun width={64} />
        <View style={{ gap: 26 }}>
          <View style={{ gap: 14, paddingHorizontal: 4 }}>
            <Animated.View entering={rise(0)}>
              <T style={[font('displayXL', colors.mist)]} accessibilityRole="header">{t('welcome.title')}</T>
            </Animated.View>
            <Animated.View entering={rise(2)}>
              <T v="body" color="#e1dacd" style={{ fontSize: 18, lineHeight: 26 }}>{t('welcome.body')}</T>
            </Animated.View>
          </View>
          <View style={{ gap: 10 }}>
            <Button variant="gold" label={t('welcome.start')} onPress={() => { useOnboarding.getState().reset(); router.push('/signin'); }} testID="welcome-start" />
            <Button variant="glass" label={t('welcome.track')} onPress={() => { useSession.getState().becomeGuest(); router.replace('/today'); }} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24 },
});
