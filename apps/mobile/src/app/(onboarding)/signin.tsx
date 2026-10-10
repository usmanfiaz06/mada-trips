import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';
import { Button } from '@/components/Button';
import { Act, Screen, TopBar } from '@/components/Layout';
import { Pill } from '@/components/Pill';
import { Sheet } from '@/components/Sheet';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { ApiError, api } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { rise } from '@/lib/motion';
import { useOnboarding } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { socialIdentity } from '@/lib/social';
import { toast } from '@/lib/toast';
import { colors, radii, shadow } from '@/theme';

const PHOTOS = [
  { src: require('../../../assets/images/alula.jpg'), x: -78 },
  { src: require('../../../assets/images/riyadh.jpg'), x: 78 },
  { src: require('../../../assets/images/istanbul.jpg'), x: 0 },
];

/** Apple, Google or a phone number. Apple and Google still need a mobile number for alerts (FLOWS.md §1). */
export default function SignIn() {
  const router = useRouter();
  const [sheet, setSheet] = useState<'apple' | 'google' | null>(null);
  const [hideEmail, setHideEmail] = useState(true);
  const [busy, setBusy] = useState(false);

  const cancel = () => { setSheet(null); toast(t('signin.cancelled')); };

  const continueWith = async (provider: 'apple' | 'google') => {
    setBusy(true);
    try {
      const id = await socialIdentity(provider, { hideEmail });
      const r = await api.signInWith(provider, id.idToken, id.givenName);
      await useSession.getState().signIn(r.tokens, r.user);
      useOnboarding.getState().set({ social: provider, suggestedName: r.user.name || id.givenName || '' });
      buzz('success');
      setSheet(null);
      router.push(r.user.phone ? (r.isNew ? '/name' : '/today') : '/phone');
    } catch (e) {
      buzz('soft');
      toast(e instanceof ApiError ? e.message : t('error.internal'));
    } finally {
      setBusy(false);
    }
  };

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
      <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 12 }}>
        <T v="h1" accessibilityRole="header">{t('signin.title')}</T>
        <T v="body">{t('signin.body')}</T>
      </View>
      <Act>
        <Button label={t('signin.apple')} onPress={() => setSheet('apple')} testID="signin-apple" />
        <Button variant="secondary" label={t('signin.google')} onPress={() => setSheet('google')} />
        <Button variant="ghost" label={t('signin.phone')} onPress={() => { useOnboarding.getState().set({ social: null }); router.push('/phone'); }} testID="signin-phone" />
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
        <Button label={t('common.continue')} busy={busy} onPress={() => sheet && continueWith(sheet)} haptic={null} />
        <Button variant="ghost" label={t('common.cancel')} onPress={cancel} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photos: { height: 250, marginTop: 8, alignItems: 'center' },
  photo: { position: 'absolute', top: 18, width: 168, height: 220, borderRadius: radii.card, borderWidth: 4, borderColor: colors.paper, overflow: 'hidden', backgroundColor: colors.mist },
  badge: { position: 'absolute', start: 0, end: 0, bottom: -4, alignItems: 'center' },
  option: { borderRadius: radii.card, padding: 16, gap: 4, backgroundColor: colors.mist },
  optionOn: { borderWidth: 2, borderColor: colors.green, padding: 14 },
});
