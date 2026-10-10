import { useState } from 'react';
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ROUTES, SignInResponse, prettyPhone } from '@mada/shared';
import { ApiError, api, deviceInfo, request } from '@/lib/api';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { t } from '@/lib/i18n';
import { clearSessionExpired, useGates } from '@/lib/net/gates';
import { clearCache } from '@/lib/net/persist';
import { queryClient } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, font } from '@/theme';
import { Button } from '../Button';
import { Field } from '../Field';
import { Sheet } from '../Sheet';
import { T } from '../Text';

/*
 * The session ran out and couldn't refresh. Instead of throwing the traveller back to the welcome screen (and losing
 * whatever they were typing), this sheet opens over the current screen: a code to their number, six digits, and
 * they're back exactly where they were; the screens underneath never unmount. Whatever failed while signed out is
 * fetched again. A different account signing in here starts fresh instead.
 */
export function SessionExpired() {
  const expired = useGates((s) => s.expired);
  const tokens = useSession((s) => s.tokens);
  const user = useSession((s) => s.user);
  const visible = expired && !!tokens;
  const [step, setStep] = useState<'ask' | 'code'>('ask');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const phone = user?.phone ?? null;

  const send = async () => {
    if (!phone) { clearSessionExpired(); await useSession.getState().clear(); router.replace('/signin' as Href); return; }
    setBusy(true); setProblem(null);
    try { await api.startOtp(phone); setStep('code'); }
    catch (e) {
      if (e instanceof ApiError && e.code === 'OTP_COOLDOWN') setStep('code');
      else setProblem(e instanceof ApiError ? (e.kind === 'offline' ? t('phone.offline') : e.message) : t('error.internal'));
    } finally { setBusy(false); }
  };

  const verify = async (value: string) => {
    if (value.length < 6 || busy) return;
    setBusy(true); setProblem(null);
    const before = user?.id;
    try {
      // A fresh sign-in, not a refresh: the dead tokens aren't sent.
      const r = await request({ method: 'POST', path: ROUTES.otpVerify, body: { phone, code: value, device: deviceInfo() }, auth: false }, SignInResponse);
      await useSession.getState().signIn(r.tokens, r.user);
      setStep('ask'); setCode('');
      clearSessionExpired();
      if (before && before !== r.user.id) {
        await clearCache();
        queryClient.clear();
        router.replace('/' as Href);
      } else {
        void queryClient.invalidateQueries();
      }
    } catch (e) {
      setCode('');
      setProblem(e instanceof ApiError ? e.message : t('error.internal'));
    } finally { setBusy(false); }
  };

  return (
    <Sheet visible={visible} onClose={() => { /* stays until signed in: the screen behind needs it */ }} label={t('session.expired.title')}>
      <View style={{ gap: 8 }} testID="session-expired">
        <T style={font('displaySmall')} accessibilityRole="header">{t('session.expired.title')}</T>
        <T v="body">{t('session.expired.body')}</T>
      </View>
      {step === 'ask' ? (
        <>
          {phone ? <T v="callout" color={colors.ink2}>{t('session.expired.to', { phone: prettyPhone(phone) })}</T> : null}
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
          <Button label={phone ? t('phone.send') : t('session.expired.action')} busy={busy} onPress={send} testID="reauth-send" />
        </>
      ) : (
        <>
          <Field label={t('otp.label')} value={code} big keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6}
            onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); if (d.length === 6) void verify(d); }}
            error={problem} hint={SHOW_DEMO_HINTS ? <T v="tiny">{t('otp.demo')}</T> : null} testID="reauth-code" />
          <Button label={t('session.expired.action')} busy={busy} disabled={code.length < 6} onPress={() => void verify(code)} testID="reauth-verify" />
        </>
      )}
    </Sheet>
  );
}
