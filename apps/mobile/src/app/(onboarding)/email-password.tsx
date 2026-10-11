import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, LinkButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { Act, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { PasswordField } from '@/components/auth/PasswordField';
import { PauseSheet } from '@/components/auth/PauseSheet';
import { looksLikeEmail, sayAuthError } from '@/components/auth/say';
import { AuthError, auth, finishSignIn } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { colors } from '@/theme';

/** Wrong passwords before a short pause (Supabase limits sign-ins per address and network on its side too). */
const PASSWORD_TRIES = 5;
const PASSWORD_PAUSE = 45;

/*
 * Sign in with a password: only for people who set one in Profile (codes stay the default). Email and password are
 * marked for password managers (username + current password). A wrong one never says whether the email has an
 * account; it counts down to a short pause. Forgot password? sends a code by email, never a link.
 */
export default function EmailPassword() {
  const router = useRouter();
  const { email: saved, set } = useOnboarding();
  const [email, setEmail] = useState(saved);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wrong, setWrong] = useState(0);
  const [pause, setPause] = useState<{ until: number; open: boolean } | null>(null);
  const ok = looksLikeEmail(email) && password.length > 0;

  const signIn = async () => {
    if (!ok || busy) return;
    if (pause && pause.until > Date.now()) { setPause({ ...pause, open: true }); return; }
    const e = email.trim().toLowerCase();
    setBusy(true); setError(null);
    try {
      const id = await auth().signInWithPassword(e, password);
      set({ email: e, via: 'email', social: null });
      const next = await finishSignIn(id, 'email');
      buzz('success');
      router.replace(next);
    } catch (x) {
      buzz('soft');
      setPassword('');
      if (x instanceof AuthError && x.code === 'wrongPassword') {
        const used = wrong + 1;
        const left = PASSWORD_TRIES - used;
        if (left <= 0) { setWrong(0); setError(null); setPause({ until: Date.now() + PASSWORD_PAUSE * 1000, open: true }); }
        else { setWrong(used); setError(tn('auth.password.wrong', left)); }
      } else setError(sayAuthError(x, 'email'));
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
          <T v="h1" accessibilityRole="header">{t('auth.password.title')}</T>
          <T v="body">{t('auth.password.body')}</T>
          <Field label={t('auth.email.label')} value={email} onChangeText={(v) => { setEmail(v); setError(null); }}
            keyboardType="email-address" inputMode="email" autoComplete="email" textContentType="username" autoCapitalize="none" autoCorrect={false}
            placeholder={t('auth.email.placeholder')} testID="password-email" />
          <PasswordField label={t('auth.password.label')} value={password} onChangeText={(v) => { setPassword(v); setError(null); }}
            error={error} onSubmitEditing={signIn} returnKeyType="go" testID="password-input" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 18 }}>
            <LinkButton label={t('auth.password.forgot')} onPress={() => { set({ email: email.trim().toLowerCase() }); router.push('/forgot'); }} />
            <LinkButton label={t('auth.password.useCode')} color={colors.ink3} onPress={() => { set({ email: email.trim().toLowerCase() }); router.back(); }} />
          </View>
        </View>
        <Act>
          <Button label={t('auth.password.signIn')} disabled={!ok} busy={busy} onPress={signIn} testID="password-signin" />
        </Act>
      </KeyboardAvoidingView>
      <PauseSheet visible={!!pause?.open} seconds={PASSWORD_PAUSE} until={pause?.until ?? 0} doneLabel={t('auth.password.signIn')}
        onClose={() => setPause((p) => (p ? { ...p, open: false } : p))} onDone={() => setPause(null)} />
    </Screen>
  );
}
