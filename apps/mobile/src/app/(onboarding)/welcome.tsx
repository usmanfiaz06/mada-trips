import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Button, LinkButton } from '@/components/Button';
import { Entering } from '@/components/Entering';
import { VGradient } from '@/components/Gradient';
import { useBottomInset, useTopInset } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { riseStyle, useReduceMotion } from '@/lib/motion';
import { slowLink } from '@/lib/net/slow-link';
import { useOnboarding } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { colors, font } from '@/theme';

const VIDEO = require('../../../assets/video/welcome.mp4');
const POSTER = require('../../../assets/images/welcome.jpg');

/**
 * "We'll take it from here." over the film (FLOWS.md §1). Get started (a new account) is the one gold button,
 * I have an account sits under it, and looking around or tracking a flight (no account) are quiet links below.
 */
export default function Welcome() {
  const router = useRouter();
  const top = useTopInset();
  const bottom = useBottomInset();
  const still = useReduceMotion();
  // On a slow or metered connection the photo stays and the film (1 MB) isn't fetched: the first screen's files come first.
  const [film] = useState(() => !slowLink());
  const player = useVideoPlayer(film ? VIDEO : null, (p) => { p.loop = true; p.muted = true; p.play(); });
  // Both buttons open the same sign-in (the same code flow); only its headline differs. The account decides the rest.
  const signIn = (intent: 'new' | 'back') => {
    useOnboarding.getState().reset();
    useOnboarding.getState().set({ intent });
    router.push(intent === 'new' ? '/signin?mode=new' : '/signin');
  };
  const guest = (track?: boolean) => {
    useSession.getState().becomeGuest();
    router.replace(track ? '/today?track=1' : '/today');
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.night }]}>
      {/* React Native's own Image: the first screen doesn't carry expo-image (docs/app/PERF.md). */}
      <Image source={POSTER} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
      {!still && film && <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} accessible={false} pointerEvents="none" />}
      <VGradient id="welcome" stops={[[0, 'rgba(15,26,22,0.45)'], [0.22, 'rgba(15,26,22,0)'], [0.38, 'rgba(15,26,22,0)'], [0.6, 'rgba(30,53,45,0.82)'], [0.8, '#1e352d'], [1, '#1e352d']]} />
      <View style={[styles.content, { paddingTop: top + 20, paddingBottom: bottom + 32 }]}>
        <Sun width={64} />
        <View style={{ gap: 26 }}>
          <View style={{ gap: 14, paddingHorizontal: 4 }}>
            <Entering step={0} style={riseStyle(0)}>
              <T style={[font('displayXL', colors.mist)]} accessibilityRole="header">{t('welcome.title')}</T>
            </Entering>
            <Entering step={2} style={riseStyle(2)}>
              <T v="body" color="#e1dacd" style={{ fontSize: 18, lineHeight: 26 }}>{t('welcome.body')}</T>
            </Entering>
          </View>
          <View style={{ gap: 12 }}>
            <Button variant="gold" label={t('welcome.start')} onPress={() => signIn('new')} testID="welcome-start" />
            <Button variant="glass" label={t('welcome.signin')} onPress={() => signIn('back')} testID="welcome-signin" />
            {/* Search, prices, hotels, Discover and a flight's status need no account; booking asks then (SignInSheet). */}
            <View style={[styles.links, { paddingTop: 8 }]}>
              <LinkButton label={t('welcome.browse')} color="#e1dacd" size={15} onPress={() => guest()} testID="welcome-browse" />
              <LinkButton label={t('welcome.track')} color="#e1dacd" size={15} onPress={() => guest(true)} testID="welcome-track" />
            </View>
            <View style={styles.links}>
              <LinkButton label={t('circles.code.welcome')} color="#e1dacd" size={13} onPress={() => router.push('/invite-code')} testID="welcome-invite-code" />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 24 },
  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: 28, rowGap: 10, paddingTop: 2 },
});
