import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { T } from '@/components/Text';
import { CODE_RESEND_SECONDS, AuthError } from '@/lib/auth';
import { AUTO_FOCUS, SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';
import { sayAuthError } from './say';

/**
 * Six digits, checked as soon as the sixth is typed. A wrong code clears the field and says so; a new code after a
 * minute (Supabase's own wait between codes). Used for phone and email codes alike.
 */
export function CodeEntry({ title, sent, onVerify, onResend, about, demoHint, testID = 'otp-input' }: {
  title: string;
  /** "Sent to …" with a Change link. */
  sent: ReactNode;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  about: 'phone' | 'email';
  demoHint?: string;
  testID?: string;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(CODE_RESEND_SECONDS);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const id = setInterval(() => setResendIn((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const submit = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    try {
      await onVerify(value);
    } catch (e) {
      buzz('soft');
      setCode('');
      setError(sayAuthError(e, about));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await onResend();
      setError(null); setCode(''); setResendIn(CODE_RESEND_SECONDS);
      toast(t('otp.resent'));
      input.current?.focus();
    } catch (e) {
      if (e instanceof AuthError && e.code === 'wait' && e.seconds) setResendIn(e.seconds);
      setError(sayAuthError(e, about));
    }
  };

  const mm = Math.floor(resendIn / 60);
  const ss = String(resendIn % 60).padStart(2, '0');
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
      <T v="h1" accessibilityRole="header">{title}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>{sent}</View>
      <Field
        ref={input} label={t('otp.label')} big value={code} editable={!busy} maxLength={6} autoFocus={AUTO_FOCUS} testID={testID}
        keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode"
        bad={!!error} error={error}
        onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); if (error) setError(null); if (d.length === 6) submit(d); }}
      />
      <View style={{ flexDirection: 'row' }}>
        {resendIn > 0
          ? <T v="small" style={{ fontVariant: ['tabular-nums'] }}>{t('auth.code.resendIn', { time: `${mm}:${ss}` })}</T>
          : <Button variant="secondary" size="small" block={false} label={t('otp.resend')} onPress={resend} testID="code-resend" />}
      </View>
      {SHOW_DEMO_HINTS && demoHint ? <T v="tiny" color={colors.ink3}>{demoHint}</T> : null}
    </View>
  );
}
