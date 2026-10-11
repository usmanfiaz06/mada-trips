import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { useAppLock } from '@/lib/app-lock';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';

/**
 * Over the whole app: the lock while it's locked (signed in only; signing out is always there), and the one-time offer
 * after sign-in. Nothing is drawn when the lock is off.
 */
export function AppLock() {
  const signedIn = useSession((s) => s.status === 'signedIn');
  const { loaded, on, locked, offer, hydrate, unlock, answerOffer } = useAppLock();
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => { void hydrate(); }, [hydrate]);

  const open = async () => {
    setBusy(true);
    const ok = await unlock();
    setBusy(false);
    buzz(ok ? 'success' : 'soft');
  };

  return (
    <>
      {loaded && on && locked && signedIn ? (
        <View style={[StyleSheet.absoluteFill, styles.lock]} testID="app-lock">
          <Sun width={64} />
          <T v="h1" color={colors.onDark} style={{ textAlign: 'center' }} accessibilityRole="header">{t('auth.bio.locked')}</T>
          <T v="body" color={colors.onDark} style={{ textAlign: 'center', opacity: 0.85 }}>{t('auth.bio.lockedBody')}</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 12 }}>
            <Button variant="gold" label={t('auth.bio.unlock')} busy={busy} onPress={open} testID="app-unlock" />
            <Button variant="onDark" label={t('auth.bio.signOut')} onPress={async () => { useAppLock.setState({ locked: false }); await api.logout().catch(() => {}); router.replace('/welcome'); }} />
          </View>
        </View>
      ) : null}
      <Sheet visible={offer && signedIn} onClose={() => void answerOffer(false)} label={t('auth.bio.title')}>
        <T v="h2">{t('auth.bio.title')}</T>
        <T v="body">{t('auth.bio.body')}</T>
        <Button label={t('auth.bio.allow')} onPress={async () => { await answerOffer(true); if (useAppLock.getState().on) toast(t('auth.bio.on')); }} testID="bio-allow" />
        <Button variant="ghost" label={t('auth.bio.later')} onPress={() => void answerOffer(false)} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  lock: { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, zIndex: 50 },
});
