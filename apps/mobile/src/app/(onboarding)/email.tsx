import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Act, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { looksLikeEmail, sayAuthError } from '@/components/auth/say';
import { AuthError, auth } from '@/lib/auth';
import { AUTO_FOCUS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';

/** Continue with email: a 6-digit code by email (not a link, so it works inside the app). */
export default function Email() {
  const router = useRouter();
  const { email: saved, set } = useOnboarding();
  const [email, setEmail] = useState(saved);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = looksLikeEmail(email);

  const go = (e: string) => { set({ email: e, via: 'email', social: null }); router.push('/email-code'); };
  const send = async () => {
    if (!ok) { setTouched(true); return; }
    const e = email.trim().toLowerCase();
    setBusy(true); setError(null);
    try {
      await auth().sendEmailCode(e);
      go(e);
    } catch (x) {
      buzz('soft');
      if (x instanceof AuthError && x.code === 'wait') { go(e); return; }
      setError(sayAuthError(x, 'email'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
          <T v="h1" accessibilityRole="header">{t('auth.email.title')}</T>
          <T v="body">{t('auth.email.body')}</T>
          <Field
            label={t('auth.email.label')} value={email} onChangeText={(v) => { setEmail(v); setError(null); }} onBlur={() => setTouched(true)}
            keyboardType="email-address" inputMode="email" autoComplete="email" textContentType="emailAddress" autoCapitalize="none" autoCorrect={false}
            placeholder={t('auth.email.placeholder')} error={(touched && email && !ok ? t('auth.email.problem') : null) ?? error}
            onSubmitEditing={send} returnKeyType="send" testID="email-input" autoFocus={AUTO_FOCUS}
          />
        </View>
        <Act>
          <Button label={t('auth.email.send')} disabled={!ok} busy={busy} onPress={send} testID="email-send" />
        </Act>
      </KeyboardAvoidingView>
    </Screen>
  );
}
