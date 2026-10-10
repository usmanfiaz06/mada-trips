import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { checkSaudiMobile } from '@mada/shared';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Act, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { ApiError, api } from '@/lib/api';
import { AUTO_FOCUS, SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';

/** +966 and 9 digits starting with 5. A short, long or wrong-prefix number gets an inline explanation (FLOWS.md §1). */
export default function Phone() {
  const router = useRouter();
  const { social, phone: saved, set } = useOnboarding();
  const [phone, setPhone] = useState(saved.replace(/^\+966/, ''));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const check = checkSaudiMobile(phone);
  const problem = check.ok ? null
    : check.problem === 'empty' ? null
      : check.problem === 'short' ? t('phone.problem.short', { count: check.digits.length })
        : t(`phone.problem.${check.problem}`);
  const showProblem = touched || (!check.ok && check.problem !== 'short' && check.problem !== 'empty') || (!check.ok && check.digits.length > 9);

  const send = async () => {
    if (!check.ok) { setTouched(true); return; }
    setBusy(true);
    setServerError(null);
    try {
      const r = await api.startOtp(check.e164);
      set({ phone: r.phone });
      router.push('/otp');
    } catch (e) {
      buzz('soft');
      if (e instanceof ApiError && e.code === 'OTP_COOLDOWN') { set({ phone: check.e164 }); router.push('/otp'); return; }
      const msg = e instanceof ApiError ? (e.code === 'OFFLINE' ? t('phone.offline') : e.message) : t('error.internal');
      setServerError(msg);
      if (!(e instanceof ApiError)) toast(msg);
    } finally {
      setBusy(false);
    }
  };

  const provider = social === 'apple' ? 'Apple' : 'Google';
  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
          <T v="h1" accessibilityRole="header">{social ? t('phone.titleSocial') : t('phone.title')}</T>
          <T v="body">{social ? t('phone.bodySocial', { provider }) : t('phone.body')}</T>
          <Field
            label={t('phone.label')} prefix="+966" value={phone} onChangeText={(v) => { setPhone(v); setServerError(null); }} onBlur={() => setTouched(true)}
            keyboardType="phone-pad" inputMode="tel" autoComplete="tel" textContentType="telephoneNumber" placeholder={t('phone.placeholder')}
            error={(showProblem ? problem : null) ?? serverError} onSubmitEditing={send} returnKeyType="send" testID="phone-input" autoFocus={AUTO_FOCUS}
            hint={!social && SHOW_DEMO_HINTS ? <T v="tiny" color={colors.ink3}>{t('phone.demo')}</T> : null}
          />
        </View>
        <Act>
          <Button label={t('phone.send')} disabled={!check.ok} busy={busy} onPress={send} testID="phone-send" />
        </Act>
      </KeyboardAvoidingView>
    </Screen>
  );
}
