import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { OTP_MAX_TRIES, prettyPhone } from '@mada/shared';
import { Button, LinkButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { T } from '@/components/Text';
import { CODE_RESEND_SECONDS, AuthError } from '@/lib/auth';
import { codeFrom } from '@/lib/auth/code';
import { AUTO_FOCUS, SHOW_DEMO_HINTS } from '@/lib/config';
import { buzz } from '@/lib/haptics';
import { isRTL, t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';
import { CodeHelpSheet, type CodeFlow } from './CodeHelp';
import { PauseSheet, mmss } from './PauseSheet';
import { sayAuthError } from './say';

/** After the last wrong try, a short pause (at least this long, and never shorter than the wait for a new code). */
export const PAUSE_SECONDS = 45;
/** iOS offers the code from Messages above the keyboard; Android reads it from the SMS (autofill service). */
const OTP_AUTOCOMPLETE = Platform.OS === 'android' ? 'sms-otp' : 'one-time-code';

/** "Open Mail": the mail app, where the code is waiting (iOS's Mail by its own scheme; elsewhere the default mail app). */
export function openMail() {
  const url = Platform.OS === 'ios' ? 'message://' : 'mailto:';
  void Linking.openURL(url).catch(() => {});
}

/**
 * Six digits, checked as soon as the sixth arrives (typed, pasted or filled in by the phone). A wrong code shakes
 * gently and says how many tries are left; after the last one, a short pause with a countdown. A new code after the
 * minute (Supabase's own wait); "Didn't get the code?" opens the other ways forward. Used by every code screen:
 * sign-in by phone and email, Verify your phone, and adding a way in from Profile.
 */
export function CodeEntry({ title, about, contact, onChange, onVerify, onResend, flow, demoHint, testID = 'otp-input' }: {
  title: string;
  about: 'phone' | 'email';
  /** Where the code went: E.164 or an email address. */
  contact: string;
  /** Back to the number or address, filled in. */
  onChange: () => void;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  /** Sign-in offers other ways in; adding a way in from Profile doesn't. */
  flow: CodeFlow;
  demoHint?: string;
  testID?: string;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(CODE_RESEND_SECONDS);
  const [tries, setTries] = useState(0);
  // The pause runs to its end even if the sheet is closed: the field stays still until then.
  const [pause, setPause] = useState<{ seconds: number; until: number; open: boolean } | null>(null);
  const [clock, setClock] = useState(0);
  const paused = !!pause && pause.until > clock;
  const [help, setHelp] = useState(false);
  const input = useRef<TextInput>(null);
  const x = useSharedValue(0);
  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  // A number keeps its own order inside an Arabic sentence.
  const shown = about === 'phone' ? (isRTL() ? `\u2066${prettyPhone(contact)}\u2069` : prettyPhone(contact)) : contact;

  useEffect(() => {
    const id = setInterval(() => { setResendIn((n) => (n > 0 ? n - 1 : 0)); setClock(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);

  const wobble = () => {
    buzz('soft');
    x.set(withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 70 }), withTiming(-5, { duration: 60 }), withTiming(4, { duration: 60 }), withTiming(0, { duration: 50 })));
  };

  const submit = async (value: string) => {
    if (value.length !== 6 || busy || paused) return;
    setBusy(true);
    try {
      await onVerify(value);
    } catch (e) {
      wobble();
      setCode('');
      if (e instanceof AuthError && e.code === 'wrong') {
        const used = tries + 1;
        setTries(used);
        const left = OTP_MAX_TRIES - used;
        if (left <= 0) { const seconds = Math.max(PAUSE_SECONDS, resendIn); setError(null); const until = Date.now() + seconds * 1000; setClock(Date.now()); setPause({ seconds, until, open: true }); }
        else setError(tn('otp.wrong', left));
      } else setError(sayAuthError(e, about));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await onResend();
      setError(null); setCode(''); setTries(0); setPause(null); setResendIn(CODE_RESEND_SECONDS);
      buzz('tap');
      toast(t('auth.code.resentTo', { contact: shown }));
      input.current?.focus();
    } catch (e) {
      if (e instanceof AuthError && e.code === 'wait' && e.seconds) setResendIn(e.seconds);
      setError(sayAuthError(e, about));
    }
  };

  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
      <T v="h1" accessibilityRole="header">{title}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>
        <T v="body">{about === 'phone' ? t('otp.sentTo', { phone: shown }) : t('auth.email.sentTo', { email: shown })}</T>
        <LinkButton label={about === 'phone' ? t('otp.change') : t('auth.email.change')} onPress={onChange} />
      </View>
      <Animated.View style={shake}>
        <Field
          ref={input} label={t('otp.label')} big value={code} editable={!busy && !paused} autoFocus={AUTO_FOCUS} testID={testID}
          keyboardType="number-pad" inputMode="numeric" autoComplete={OTP_AUTOCOMPLETE} textContentType="oneTimeCode"
          bad={!!error} error={error}
          onChangeText={(v) => { const d = codeFrom(v, code); setCode(d); if (error) setError(null); if (d.length === 6) void submit(d); }}
        />
      </Animated.View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {paused && !pause?.open
          ? <LinkButton label={t('auth.pause.title')} onPress={() => setPause((p) => (p ? { ...p, open: true } : p))} />
          : resendIn > 0
          ? <T v="small" style={{ fontVariant: ['tabular-nums'] }} testID="code-countdown">{t('auth.code.resendIn', { time: mmss(resendIn) })}</T>
          : <Button variant="secondary" size="small" block={false} label={t('otp.resend')} onPress={resend} haptic={null} testID="code-resend" />}
        {about === 'email' ? <Button variant="secondary" size="small" block={false} label={t('auth.email.openMail')} onPress={openMail} testID="open-mail" /> : null}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <LinkButton label={t('auth.help.link')} onPress={() => setHelp(true)} />
      </View>
      {SHOW_DEMO_HINTS && demoHint ? <T v="tiny" color={colors.ink3}>{demoHint}</T> : null}

      <CodeHelpSheet visible={help} onClose={() => setHelp(false)} about={about} contact={contact} resendIn={resendIn} onResend={resend} onChange={onChange} flow={flow} />
      <PauseSheet visible={!!pause?.open} seconds={pause?.seconds ?? PAUSE_SECONDS} until={pause?.until ?? 0} doneLabel={t('otp.resend')}
        onClose={() => setPause((p) => (p ? { ...p, open: false } : p))} onDone={() => { void resend(); }} />
    </View>
  );
}
