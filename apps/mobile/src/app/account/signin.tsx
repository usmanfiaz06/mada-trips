import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { looksLikeEmail, sayAuthError } from '@/components/auth/say';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { Group, Notice, Row, StatusPill } from '@/components/wallet/ui';
import { AUTH_MODE, AuthError, auth, syncIdentity, type SocialProvider } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { demo } from '@/lib/wallet-demo';
import { prettyPhone } from '@/lib/wallet-model';
import { colors } from '@/theme';

type Method = 'apple' | 'google' | 'email' | 'phone';
const METHODS: { id: Method; name: Parameters<typeof t>[0]; sub: Parameters<typeof t>[0] }[] = [
  { id: 'apple', name: 'signinMethods.apple', sub: 'signinMethods.appleSub' },
  { id: 'google', name: 'signinMethods.google', sub: 'signinMethods.googleSub' },
  { id: 'email', name: 'auth.methods.email', sub: 'auth.methods.emailSub' },
  { id: 'phone', name: 'signinMethods.phone', sub: 'signinMethods.phoneSub' },
];
const APPLE_HERE = Platform.OS === 'ios' || AUTH_MODE === 'mock';

/*
 * Sign-in methods (Account.jsx SignIn), through Supabase Auth: Apple and Google are linked to (or unlinked from) the
 * Supabase identity, an email or a number is proven with a code, then the account picks it up (/auth/session/sync).
 * Keep at least two; never remove the last way in. The phone stays: it's how Faisal reaches you on a trip.
 */
export default function SignInMethods() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const [sheet, setSheet] = useState<{ id: Method; mode: 'link' | 'manage' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [emailStep, setEmailStep] = useState<'address' | 'code'>('address');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const methods = { apple: false, google: false, phone: false, email: false, ...user?.methods };
  const shown = METHODS.filter((m) => m.id !== 'apple' || APPLE_HERE || methods.apple);
  const count = METHODS.filter((m) => methods[m.id]).length;
  const m = sheet ? METHODS.find((x) => x.id === sheet.id)! : null;
  const name = m ? t(m.name) : '';

  const open = (id: Method) => {
    setProblem(null); setEmail(''); setCode(''); setEmailStep('address'); setChanging(false);
    if (id === 'phone' && !methods.phone) { router.push('/verify-phone?then=back'); return; }
    setSheet({ id, mode: methods[id] ? 'manage' : 'link' });
  };
  const close = () => setSheet(null);

  /** Every change needs this phone's Supabase session (it proves it's you). */
  const withSession = async (work: () => Promise<void>) => {
    setBusy(true); setProblem(null);
    try {
      if (!(await auth().hasSession())) throw new AuthError('noSession');
      await work();
    } catch (e) {
      buzz('soft');
      if (e instanceof AuthError && e.code === 'cancelled') return;
      const taken = e instanceof AuthError && e.code === 'taken';
      setProblem(taken && m && m.id !== 'email' ? t('auth.methods.taken', { name }) : sayAuthError(e, m?.id === 'phone' ? 'phone' : 'email'));
    } finally { setBusy(false); }
  };

  const link = (p: SocialProvider) => withSession(async () => {
    const token = await auth().link(p);
    if (!token) return; // the web went to Apple or Google; /auth-callback?link=1 finishes
    await syncIdentity(token);
    buzz('success'); toast(t('signinMethods.added', { name })); close();
  });
  const unlink = (p: SocialProvider) => withSession(async () => {
    await syncIdentity(await auth().unlink(p));
    buzz('tap'); toast(t('signinMethods.removed', { name })); close();
  });
  const sendEmail = () => withSession(async () => {
    try { await auth().addEmail(email); } catch (e) { if (!(e instanceof AuthError && e.code === 'wait')) throw e; }
    setEmailStep('code');
  });
  const verifyEmail = (value: string) => withSession(async () => {
    try {
      await syncIdentity(await auth().verifyAddedEmail(email, value));
    } catch (e) { setCode(''); throw e; }
    buzz('success'); toast(t('auth.methods.emailAdded')); close();
  });

  const subOf = (x: (typeof METHODS)[number]) => {
    if (!methods[x.id]) return t('signinMethods.notLinked');
    if (x.id === 'phone') return prettyPhone(user?.phone);
    if (x.id === 'email') return user?.email ?? t(x.sub);
    if (x.id === 'apple' && user?.emailRelay) return t('signinMethods.hideOn');
    return t(x.sub);
  };

  const emailForm = (
    <>
      {emailStep === 'address' ? (
        <>
          <Field label={t('auth.email.label')} value={email} onChangeText={(v) => { setEmail(v); setProblem(null); }} keyboardType="email-address" inputMode="email"
            autoComplete="email" autoCapitalize="none" autoCorrect={false} placeholder={t('auth.email.placeholder')} error={problem} testID="method-email-input" onSubmitEditing={sendEmail} />
          <Button label={t('auth.email.send')} disabled={!looksLikeEmail(email)} busy={busy} onPress={sendEmail} testID="method-email-send" />
        </>
      ) : (
        <>
          <T v="body">{t('auth.email.sentTo', { email: email.trim().toLowerCase() })}</T>
          <Field label={t('otp.label')} big value={code} maxLength={6} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode"
            bad={!!problem} error={problem} editable={!busy} testID="method-email-code"
            onChangeText={(v) => { const d = v.replace(/\D/g, '').slice(0, 6); setCode(d); if (problem) setProblem(null); if (d.length === 6) verifyEmail(d); }} />
          {AUTH_MODE === 'mock' ? <T v="tiny" color={colors.ink3}>{t('auth.email.demo')}</T> : null}
        </>
      )}
    </>
  );

  return (
    <AccountScreen title={t('signinMethods.title')} testID="signin-methods">
      <T v="body">{t('signinMethods.body')}</T>
      <Group>
        {shown.map((x) => (
          <Row key={x.id} testID={`method-${x.id}`}
            lead={<View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: methods[x.id] ? colors.green : colors.mist, alignItems: 'center', justifyContent: 'center' }}><Icon name={x.id === 'phone' ? 'bell' : x.id === 'email' ? 'doc' : 'lock'} size={18} color={methods[x.id] ? colors.mist : colors.green} /></View>}
            value={t(x.name)} sub={subOf(x)}
            right={<StatusPill label={methods[x.id] ? t('signinMethods.linked') : t('signinMethods.add')} tone={methods[x.id] ? 'ok' : 'muted'} />}
            onPress={() => open(x.id)} />
        ))}
      </Group>
      {count === 1 ? <Notice warn title={t('signinMethods.onlyOne')} body={t('signinMethods.onlyOneBody')} testID="only-one" /> : null}
      {methods.apple ? <Card variant="well" style={{ gap: 6 }}><T v="h3" style={{ fontSize: 15 }}>{t('signinMethods.hideTitle')}</T><T v="small">{t('signinMethods.hideBody')}</T></Card> : null}

      <Sheet visible={!!sheet && sheet.mode === 'link'} onClose={close} label={name}>
        {m?.id === 'email' ? (
          <>
            <T v="h2">{t('auth.methods.addEmail')}</T>
            <T v="body">{t('auth.methods.addEmailBody')}</T>
            {emailForm}
          </>
        ) : (
          <>
            <T v="h2">{t('signinMethods.addTitle', { name })}</T>
            <T v="body">{m?.id === 'apple' ? t('signinMethods.addApple') : t('signinMethods.addGoogle')}</T>
            {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
            <Button label={t('signinMethods.continue', { name })} disabled={demo('offline')} busy={busy} onPress={() => (m?.id === 'apple' || m?.id === 'google') && link(m.id)} testID="method-continue" />
            {demo('offline') ? <T v="small" color={colors.badInk} accessibilityRole="alert">{t('signinMethods.offline')}</T> : null}
          </>
        )}
        <Button variant="ghost" label={t('common.cancel')} onPress={close} />
      </Sheet>

      <Sheet visible={!!sheet && sheet.mode === 'manage'} onClose={close} label={name}>
        <T v="h2">{name}</T>
        {m?.id === 'phone' ? (
          <>
            <T v="body">{t('signinMethods.phoneManage', { phone: prettyPhone(user?.phone) })}</T>
            <T v="small">{t('auth.methods.phoneKept')}</T>
            <Button variant="secondary" label={t('auth.methods.changePhone')} onPress={() => { close(); router.push('/verify-phone?then=back'); }} testID="method-change-phone" />
          </>
        ) : m?.id === 'email' ? (
          <>
            <T v="body">{t('auth.methods.emailManage', { email: user?.email ?? '' })}</T>
            {changing ? emailForm : <Button variant="secondary" label={t('auth.methods.changeEmail')} onPress={() => setChanging(true)} testID="method-change-email" />}
          </>
        ) : (
          <>
            <T v="body">{t('signinMethods.canSignIn', { name })}</T>
            {count <= 1 ? <Notice warn title={t('signinMethods.onlyWay')} body={t('signinMethods.onlyWayBody')} testID="only-way" /> : (
              <>
                {m?.id === 'apple' && user?.emailRelay ? <T v="small" color={colors.goldInk}>{t('signinMethods.relayNote')}</T> : null}
                {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
                <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('signinMethods.remove', { name })} busy={busy}
                  onPress={() => (m?.id === 'apple' || m?.id === 'google') && unlink(m.id)} testID="method-remove" />
              </>
            )}
          </>
        )}
        <Button label={t('signinMethods.keep')} onPress={close} />
      </Sheet>
    </AccountScreen>
  );
}
