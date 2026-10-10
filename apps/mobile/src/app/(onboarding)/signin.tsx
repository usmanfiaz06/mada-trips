import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { GoogleMark } from '@/components/BrandMarks';
import { AppleButton } from '@/components/auth/AppleButton';
import { sayAuthError } from '@/components/auth/say';
import { Act, Screen, TopBar } from '@/components/Layout';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { AUTH_MODE, AuthError, auth, finishSignIn, type SocialProvider } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { useOnboarding } from '@/lib/onboarding';
import { toast } from '@/lib/toast';
import { colors, radii, shadow } from '@/theme';

const PHOTOS = [
  { src: require('../../../assets/images/alula.jpg'), x: -78 },
  { src: require('../../../assets/images/riyadh.jpg'), x: 78 },
  { src: require('../../../assets/images/istanbul.jpg'), x: 0 },
];

/** Apple (iOS), Google, email or phone, all through Supabase Auth. Without a phone yet, Verify your phone comes next. */
const SHOW_APPLE = Platform.OS === 'ios' || (AUTH_MODE === 'mock' && Platform.OS === 'web');

export default function SignIn() {
  const router = useRouter();
  // Mock mode stands in for Apple's and Google's own sheets so the choices can be seen and tested.
  const [sheet, setSheet] = useState<SocialProvider | null>(null);
  const [hideEmail, setHideEmail] = useState(true);
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  const cancel = () => { setSheet(null); toast(t('auth.signin.cancelled')); };

  const continueWith = async (provider: SocialProvider) => {
    setBusy(provider);
    try {
      const id = await auth().signInWith(provider, { hideEmail });
      if (!id) return; // the web went to Apple or Google; /auth-callback carries on
      const next = await finishSignIn(id, provider);
      buzz('success');
      setSheet(null);
      router.push(next);
    } catch (e) {
      buzz('soft');
      if (e instanceof AuthError && e.code === 'cancelled') { setSheet(null); toast(t('auth.signin.cancelled')); return; }
      toast(sayAuthError(e));
    } finally {
      setBusy(null);
    }
  };
  const tapProvider = (p: SocialProvider) => (AUTH_MODE === 'mock' ? setSheet(p) : continueWith(p));
  const go = (path: '/email' | '/phone') => { useOnboarding.getState().set({ social: null, via: path === '/email' ? 'email' : 'phone' }); router.push(path); };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <View style={styles.photos} accessible={false}>
        {PHOTOS.map((p, i) => (
          <Animated.View key={i} entering={rise(i)} style={[styles.photo, shadow('focal'), { transform: [{ translateX: p.x }] }]}>
            <Image source={p.src} style={StyleSheet.absoluteFill} contentFit="cover" />
          </Animated.View>
        ))}
        <View style={styles.badge}>
          <Animated.View entering={rise(6)}>
            <Pill variant="dark" height={32} label={t('signin.badge')} icon={<Sun width={18} />} style={{ paddingHorizontal: 14 }} />
          </Animated.View>
        </View>
      </View>
      <View style={{ paddingHorizontal: 24, paddingTop: 20, gap: 10 }}>
        <T v="h1" accessibilityRole="header">{t('signin.title')}</T>
        <T v="body">{t('signin.body')}</T>
      </View>
      <Act>
        {SHOW_APPLE ? <AppleButton onPress={() => tapProvider('apple')} busy={busy === 'apple'} /> : null}
        <Button variant="secondary" label={t('signin.google')} icon={<GoogleMark size={19} />} busy={busy === 'google' && !sheet} onPress={() => tapProvider('google')} testID="signin-google" />
        <Button variant="secondary" label={t('auth.signin.email')} onPress={() => go('/email')} testID="signin-email" />
        <Button variant="ghost" label={t('auth.signin.phone')} onPress={() => go('/phone')} testID="signin-phone" />
        <T v="small" color={colors.ink3} style={{ textAlign: 'center' }}>{t('signin.note')}</T>
      </Act>

      <Sheet visible={!!sheet} onClose={cancel} label={t('signin.sheet.title', { provider: sheet === 'google' ? 'Google' : 'Apple' })}>
        <T v="h2">{t('signin.sheet.title', { provider: sheet === 'google' ? 'Google' : 'Apple' })}</T>
        {sheet === 'apple' ? (
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {([[false, 'signin.sheet.shareEmail', 'signin.sheet.shareEmailSub'], [true, 'signin.sheet.hideEmail', 'signin.sheet.hideEmailSub']] as const).map(([v, title, sub]) => (
              <Pressable key={title} accessibilityRole="radio" accessibilityState={{ checked: hideEmail === v }} onPress={() => { buzz('select'); setHideEmail(v); }}
                style={[styles.option, hideEmail === v ? styles.optionOn : null]}>
                <T v="h3" style={{ fontSize: 15 }}>{t(title)}</T>
                <T v="tiny">{t(sub)}</T>
              </Pressable>
            ))}
          </View>
        ) : <T v="body">{t('signin.sheet.google')}</T>}
        <Button label={t('common.continue')} busy={!!busy} onPress={() => sheet && continueWith(sheet)} haptic={null} testID="signin-sheet-continue" />
        <Button variant="ghost" label={t('common.cancel')} onPress={cancel} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photos: { height: 230, marginTop: 4, alignItems: 'center' },
  photo: { position: 'absolute', top: 14, width: 156, height: 204, borderRadius: radii.card, borderWidth: 4, borderColor: colors.paper, overflow: 'hidden', backgroundColor: colors.mist },
  badge: { position: 'absolute', start: 0, end: 0, bottom: -4, alignItems: 'center' },
  option: { borderRadius: radii.card, padding: 16, gap: 4, backgroundColor: colors.mist },
  optionOn: { borderWidth: 2, borderColor: colors.green, padding: 14 },
});
