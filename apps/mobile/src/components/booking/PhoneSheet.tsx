import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { OTP_MAX_TRIES, checkSaudiMobile, prettyPhone } from '@mada/shared';
import { Button, LinkButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { sayAuthError } from '@/components/auth/say';
import { AuthError, CODE_RESEND_SECONDS, auth, syncIdentity } from '@/lib/auth';
import { codeFrom } from '@/lib/auth/code';
import { useBookingNeedsPhone } from '@/lib/beta';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';
import { MadaDot } from './parts';

/*
 * Your mobile, asked once and early: a bottom sheet over the booking, with the number and then the code in the same
 * sheet (resend, a wrong code, a number already on another account, all said inline). On success it closes and the
 * booking carries on from exactly where it was. Only when the server says booking needs a verified phone
 * (GET /config features.bookingNeedsPhone, or a PHONE_REQUIRED answer); email-only testers book without one when the
 * server allows it (APP_BOOKING_REQUIRES_PHONE=no).
 */

/** True when this account has to verify a phone before it can book. */
export function usePhoneNeeded() {
  const needs = useBookingNeedsPhone();
  const user = useSession((s) => s.user);
  return needs && !!user && !user.phone;
}

export function PhoneSheet({ visible, onClose, onDone, why }: { visible: boolean; onClose: () => void; onDone: () => void; why?: string }) {
  const user = useSession((s) => s.user);
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!resendIn) return undefined;
    const id = setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);
  useEffect(() => { if (visible && user?.phone) onDone(); }, [visible, user?.phone]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = checkSaudiMobile(phone);
  const problem = check.ok || check.problem === 'empty' ? null : check.problem === 'short' ? t('phone.problem.short', { count: check.digits.length }) : t(`phone.problem.${check.problem}`);
  const showProblem = touched || (!check.ok && check.problem !== 'short' && check.problem !== 'empty');

  const send = async () => {
    if (!check.ok) { setTouched(true); buzz('warn'); return; }
    setBusy(true); setError(null);
    try {
      if (!(await auth().hasSession())) throw new AuthError('noSession');
      await auth().addPhone(check.e164);
      setSentTo(check.e164); setStep('code'); setCode(''); setTries(0); setResendIn(CODE_RESEND_SECONDS);
      buzz('tap');
      setTimeout(() => codeRef.current?.focus(), 350);
    } catch (e) {
      buzz('soft');
      if (e instanceof AuthError && e.code === 'wait') { setSentTo(check.e164); setStep('code'); setResendIn(e.seconds ?? CODE_RESEND_SECONDS); return; }
      setError(e instanceof AuthError && e.code === 'offline' ? t('phone.offline') : sayAuthError(e, 'phone'));
    } finally { setBusy(false); }
  };

  const verify = async (value: string) => {
    if (value.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try {
      const token = await auth().verifyAddedPhone(sentTo, value);
      await syncIdentity(token);
      buzz('success');
      setStep('number'); setCode('');
      onDone();
    } catch (e) {
      buzz('soft'); setCode('');
      if (e instanceof AuthError && e.code === 'wrong') {
        const left = OTP_MAX_TRIES - (tries + 1);
        setTries(tries + 1);
        setError(left > 0 ? tn('otp.wrong', left) : t('otp.locked'));
      } else setError(sayAuthError(e, 'phone'));
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setError(null);
    try { await auth().addPhone(sentTo); setResendIn(CODE_RESEND_SECONDS); setTries(0); setCode(''); buzz('tap'); }
    catch (e) {
      if (e instanceof AuthError && e.code === 'wait' && e.seconds) setResendIn(e.seconds);
      setError(sayAuthError(e, 'phone'));
    }
  };

  const locked = tries >= OTP_MAX_TRIES;
  return (
    <Sheet visible={visible} onClose={onClose} label={t('ask.phone.title')}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <MadaDot size={36} />
        <T v="h2" style={{ flex: 1 }} accessibilityRole="header">{step === 'number' ? t('ask.phone.title') : t('otp.title')}</T>
      </View>
      {step === 'number' ? (
        <>
          <T v="body">{why ?? t('ask.phone.body')}</T>
          <Field
            label={t('phone.label')} prefix="+966" value={phone} onChangeText={(v) => { setPhone(v); setError(null); }} onBlur={() => setTouched(true)}
            keyboardType="phone-pad" inputMode="tel" autoComplete="tel" textContentType="telephoneNumber" placeholder={t('phone.placeholder')}
            error={(showProblem ? problem : null) ?? error} onSubmitEditing={send} returnKeyType="send" testID="phone-sheet-input"
          />
          <Button label={t('phone.send')} disabled={!check.ok} busy={busy} onPress={send} testID="phone-sheet-send" />
          <View style={{ alignSelf: 'center' }}><LinkButton label={t('ask.phone.later')} size={14} onPress={onClose} /></View>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>
            <T v="body">{t('otp.sentTo', { phone: prettyPhone(sentTo) })}</T>
            <LinkButton label={t('otp.change')} onPress={() => { setStep('number'); setError(null); setCode(''); }} testID="phone-sheet-change" />
          </View>
          <Field
            ref={codeRef} label={t('otp.label')} big value={code} editable={!busy && !locked} testID="phone-sheet-code"
            keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode" bad={!!error} error={error}
            onChangeText={(v) => { const d = codeFrom(v, code); setCode(d); if (error && !locked) setError(null); if (d.length === 6) void verify(d); }}
          />
          {SHOW_DEMO_HINTS ? <T v="tiny" color={colors.goldInk}>{t('otp.demo')}</T> : null}
          {resendIn > 0
            ? <T v="small" accessibilityLiveRegion="polite">{t('otp.resendIn', { seconds: String(Math.min(59, resendIn)).padStart(2, '0') })}</T>
            : <Button variant="secondary" size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('otp.resend')} onPress={resend} haptic={null} testID="phone-sheet-resend" />}
        </>
      )}
    </Sheet>
  );
}

/**
 * The gentle prompt in a booking flow, before the traveller invests time: a line and a button, with the sheet opened
 * once by itself. `onDone` runs when the number is verified, so the flow carries on where it was.
 */
export function PhoneGate({ why, onDone }: { why?: string; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const id = setTimeout(() => setOpen(true), 450); return () => clearTimeout(id); }, []);
  return (
    <View style={{ gap: 12 }} testID="phone-gate">
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <MadaDot size={32} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="h3">{t('ask.phone.gateTitle')}</T>
          <T v="small">{why ?? t('ask.phone.body')}</T>
        </View>
      </View>
      <Button size="small" block={false} style={{ alignSelf: 'flex-start' }} label={t('auth.verifyPhone.go')} onPress={() => setOpen(true)} testID="phone-gate-open" />
      <PhoneSheet visible={open} why={why} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onDone?.(); }} />
    </View>
  );
}

