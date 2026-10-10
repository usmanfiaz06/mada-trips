import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { prettyPhone } from '@mada/shared';
import { Button, LinkButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { ApiError, api } from '@/lib/api';
import { AUTO_FOCUS, SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { keys, queryClient } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';

/** Six digits. Wrong: "2 tries left". Three wrong: locked until a new code. A new code after 30 s (FLOWS.md §1). */
export default function Otp() {
  const router = useRouter();
  const { phone, set } = useOnboarding();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(30);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const id = setInterval(() => setResendIn((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const submit = async (value: string) => {
    if (value.length !== 6 || locked || busy) return;
    setBusy(true);
    try {
      const r = await api.verifyOtp(phone, value);
      await useSession.getState().signIn(r.tokens, r.user);
      queryClient.setQueryData(keys.me, r.user);
      buzz('success');
      if (r.isNew) router.replace('/name');
      else { set({ returning: { name: r.user.name } }); router.replace('/welcome-back'); }
    } catch (e) {
      buzz('soft');
      setCode('');
      if (e instanceof ApiError && (e.code === 'OTP_LOCKED')) { setLocked(true); setError(t('otp.locked')); }
      else if (e instanceof ApiError) setError(e.code === 'OFFLINE' ? t('error.offline') : e.message);
      else setError(t('error.internal'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api.startOtp(phone);
      setLocked(false); setError(null); setCode(''); setResendIn(30);
      toast(t('otp.resent'));
      input.current?.focus();
    } catch (e) {
      if (e instanceof ApiError) { setError(e.message); if (e.extra.retryAfter) setResendIn(Math.min(e.extra.retryAfter, 3600)); }
    }
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
        <T v="h1" accessibilityRole="header">{t('otp.title')}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>
          <T v="body">{phone ? t('otp.sentTo', { phone: prettyPhone(phone) }) : t('otp.sentToFallback')}</T>
          <LinkButton label={t('otp.change')} onPress={() => router.back()} />
        </View>
        <Field
          ref={input} label={t('otp.label')} big value={code} editable={!locked && !busy} maxLength={6} autoFocus={AUTO_FOCUS} testID="otp-input"
          keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode"
          bad={!!error && !locked} error={error}
          onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); if (error && !locked) setError(null); if (d.length === 6) submit(d); }}
        />
        <View style={{ flexDirection: 'row' }}>
          {resendIn > 0 && !locked
            ? <T v="small" style={{ fontVariant: ['tabular-nums'] }}>{t('otp.resendIn', { seconds: String(resendIn).padStart(2, '0') })}</T>
            : <Button variant="secondary" size="small" block={false} label={t('otp.resend')} onPress={resend} disabled={resendIn > 0 && !locked} />}
        </View>
        {SHOW_DEMO_HINTS ? <T v="tiny" color={colors.ink3}>{t('otp.demo')}</T> : null}
      </View>
    </Screen>
  );
}
