import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { checkSaudiMobile } from '@mada/shared';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Act } from '@/components/Layout';
import { T } from '@/components/Text';
import { AuthError } from '@/lib/auth';
import { AUTO_FOCUS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { sayAuthError } from './say';

/**
 * +966 and 9 digits starting with 5. A short, long or wrong-prefix number gets an inline explanation (FLOWS.md §1).
 * `onSend` gets the E.164 number; if a code was sent less than a minute ago the screen moves on to the code anyway.
 */
export function PhoneForm({ title, body, initial = '', onSend, onSent, hint }: {
  title: string;
  body: string;
  initial?: string;
  onSend: (e164: string) => Promise<void>;
  onSent: (e164: string) => void;
  hint?: ReactNode;
}) {
  const [phone, setPhone] = useState(initial.replace(/^\+966/, ''));
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
      await onSend(check.e164);
      onSent(check.e164);
    } catch (e) {
      buzz('soft');
      // A code went out a moment ago: that one still works.
      if (e instanceof AuthError && e.code === 'wait') { onSent(check.e164); return; }
      setServerError(e instanceof AuthError && e.code === 'offline' ? t('phone.offline') : sayAuthError(e, 'phone'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
        <T v="h1" accessibilityRole="header">{title}</T>
        <T v="body">{body}</T>
        <Field
          label={t('phone.label')} prefix="+966" value={phone} onChangeText={(v) => { setPhone(v); setServerError(null); }} onBlur={() => setTouched(true)}
          keyboardType="phone-pad" inputMode="tel" autoComplete="tel" textContentType="telephoneNumber" placeholder={t('phone.placeholder')}
          error={(showProblem ? problem : null) ?? serverError} onSubmitEditing={send} returnKeyType="send" testID="phone-input" autoFocus={AUTO_FOCUS}
          hint={hint}
        />
      </View>
      <Act>
        <Button label={t('phone.send')} disabled={!check.ok} busy={busy} onPress={send} testID="phone-send" />
      </Act>
    </KeyboardAvoidingView>
  );
}
