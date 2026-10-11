import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { passwordMeetsRules } from '@mada/shared';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Act, Screen, Scroll, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { CodeEntry } from '@/components/auth/CodeEntry';
import { PasswordField, PasswordRules } from '@/components/auth/PasswordField';
import { looksLikeEmail, sayAuthError } from '@/components/auth/say';
import { AuthError, auth, finishSignIn } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { toast } from '@/lib/toast';

/*
 * Forgot password: a 6-digit code by email (Supabase's recovery code, never a link), which signs in; then a new
 * password, checked against the same rules Supabase holds (PASSWORD_RULES), and on into the app.
 */
export default function Forgot() {
  const router = useRouter();
  const { email: saved, set } = useOnboarding();
  const [step, setStep] = useState<'email' | 'code' | 'new'>('email');
  const [email, setEmail] = useState(saved);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e = email.trim().toLowerCase();

  const send = async () => {
    if (!looksLikeEmail(e) || busy) return;
    setBusy(true); setError(null);
    try {
      await auth().sendPasswordReset(e);
      set({ email: e });
      setStep('code');
    } catch (x) {
      if (x instanceof AuthError && x.code === 'wait') { set({ email: e }); setStep('code'); return; }
      buzz('soft'); setError(sayAuthError(x, 'email'));
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!passwordMeetsRules(password) || busy) return;
    setBusy(true); setError(null);
    try {
      const token = await auth().setPassword(password);
      const next = await finishSignIn({ accessToken: token }, 'email');
      buzz('success');
      toast(t('auth.password.saved'));
      router.replace(next);
    } catch (x) {
      buzz('soft'); setError(sayAuthError(x, 'email'));
    } finally { setBusy(false); }
  };

  if (step === 'code') {
    return (
      <Screen>
        <TopBar onBack={() => setStep('email')} />
        <CodeEntry title={t('auth.email.codeTitle')} about="email" contact={e} flow="signin" testID="reset-code-input" demoHint={t('auth.email.demo')}
          onChange={() => setStep('email')}
          onVerify={async (code) => { await auth().verifyPasswordReset(e, code); buzz('success'); setStep('new'); }}
          onResend={() => auth().sendPasswordReset(e)} />
      </Screen>
    );
  }

  if (step === 'new') {
    return (
      <Screen>
        <TopBar />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <Scroll top={24} gutter={24} bottomPad={140}>
            <T v="h1" accessibilityRole="header">{t('auth.password.forgotTitle')}</T>
            <T v="body">{t('auth.password.newHint')}</T>
            {/* The username keeps password managers saving it against the right account. */}
            <View style={{ height: 0, overflow: 'hidden' }}>
              <Field label={t('auth.email.label')} value={e} editable={false} autoComplete="email" textContentType="username" />
            </View>
            <PasswordField fresh label={t('auth.password.newLabel')} value={password} onChangeText={(v) => { setPassword(v); setError(null); }} error={error} testID="new-password" />
            <PasswordRules value={password} />
          </Scroll>
          <Act>
            <Button label={t('auth.password.saveSignIn')} disabled={!passwordMeetsRules(password)} busy={busy} onPress={save} testID="new-password-save" />
          </Act>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
          <T v="h1" accessibilityRole="header">{t('auth.password.forgotTitle')}</T>
          <T v="body">{t('auth.password.forgotBody', { email: looksLikeEmail(e) ? e : t('auth.provider.email') })}</T>
          <Field label={t('auth.email.label')} value={email} onChangeText={(v) => { setEmail(v); setError(null); }} error={error}
            keyboardType="email-address" inputMode="email" autoComplete="email" textContentType="username" autoCapitalize="none" autoCorrect={false}
            placeholder={t('auth.email.placeholder')} testID="forgot-email" onSubmitEditing={send} />
        </View>
        <Act>
          <Button label={t('auth.email.send')} disabled={!looksLikeEmail(e)} busy={busy} onPress={send} testID="forgot-send" />
        </Act>
      </KeyboardAvoidingView>
    </Screen>
  );
}
