import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { checkSaudiMobile, prettyPhone, type RecoveryContact } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Screen, Scroll, TopBar } from '@/components/Layout';
import { Sun } from '@/components/Sun';
import { T } from '@/components/Text';
import { looksLikeEmail } from '@/components/auth/say';
import { ApiError } from '@/lib/api';
import { sendRecovery } from '@/lib/auth/recovery';
import { buzz } from '@/lib/haptics';
import { getLocale, isRTL, t } from '@/lib/i18n';
import { newIdempotencyKey } from '@/lib/net/retry';
import { useSession } from '@/lib/session';
import { colors, ff } from '@/theme';

type Kind = 'phone' | 'email';
const local = (e164: string) => e164.replace(/^\+966/, '');

/** One contact: phone or email, the field for it, and what's wrong with it (only once they've moved on). */
function ContactInput({ kind, value, onKind, onValue, label, problem, testID }: {
  kind: Kind; value: string; onKind: (k: Kind) => void; onValue: (v: string) => void; label: string; problem: string | null; testID: string;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
        <Chip label={t('recover.kind.phone')} on={kind === 'phone'} onPress={() => onKind('phone')} />
        <Chip label={t('recover.kind.email')} on={kind === 'email'} onPress={() => onKind('email')} />
      </View>
      {kind === 'phone' ? (
        <Field label={label} prefix="+966" value={value} onChangeText={onValue} keyboardType="phone-pad" inputMode="tel" autoComplete="tel-national"
          placeholder={t('phone.placeholder')} error={problem} testID={testID} />
      ) : (
        <Field label={label} value={value} onChangeText={onValue} keyboardType="email-address" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect={false}
          placeholder={t('auth.email.placeholder')} error={problem} testID={testID} />
      )}
    </View>
  );
}

/*
 * "I can't use this number or email any more" (from Didn't get the code?). Signed out works: who they are, the old
 * number or address, a new way to reach them, anything that helps. A person at Mada checks it's them (passport details
 * on file, their last booking) and moves the account, usually within a day. The answer is the same whether or not an
 * account uses the old contact, so the screen never says either.
 */
export default function Recover() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: Kind; value?: string }>();
  const signedIn = useSession((s) => s.status === 'signedIn');
  const [name, setName] = useState('');
  const [oldKind, setOldKind] = useState<Kind>(params.kind === 'email' ? 'email' : 'phone');
  const [oldValue, setOldValue] = useState(params.value ? (params.kind === 'email' ? params.value : local(params.value)) : '');
  const [newKind, setNewKind] = useState<Kind>(params.kind === 'phone' ? 'email' : 'phone');
  const [newValue, setNewValue] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // One key for this screen: a retry after a dropped connection is the same request.
  const key = useRef(newIdempotencyKey('rec'));

  const parse = (kind: Kind, v: string): { contact: RecoveryContact | null; problem: string | null } => {
    if (kind === 'email') {
      const e = v.trim().toLowerCase();
      return looksLikeEmail(e) ? { contact: { kind, value: e }, problem: null } : { contact: null, problem: t('auth.email.problem') };
    }
    const c = checkSaudiMobile(v);
    if (c.ok) return { contact: { kind, value: c.e164 }, problem: null };
    return { contact: null, problem: c.problem === 'short' ? t('phone.problem.short', { count: c.digits.length }) : t(`phone.problem.${c.problem}`) };
  };
  const oldP = parse(oldKind, oldValue);
  const newP = parse(newKind, newValue);
  const same = !!oldP.contact && !!newP.contact && oldP.contact.value === newP.contact.value;
  const ready = !!name.trim() && !!oldP.contact && !!newP.contact && !same;

  const send = async () => {
    setTried(true);
    if (!ready || busy) { buzz('soft'); return; }
    setBusy(true); setProblem(null);
    try {
      await sendRecovery({ name: name.trim(), oldContact: oldP.contact!, newContact: newP.contact!, note: note.trim() || undefined, locale: getLocale() }, key.current);
      buzz('success');
      const c = newP.contact!;
      setSent(c.kind === 'phone' ? (isRTL() ? `\u2066${prettyPhone(c.value)}\u2069` : prettyPhone(c.value)) : c.value);
    } catch (e) {
      buzz('soft');
      setProblem(e instanceof ApiError ? (e.code === 'RATE_LIMITED' ? t('recover.tooMany') : e.message) : t('error.internal'));
    } finally { setBusy(false); }
  };

  const leave = () => (signedIn || router.canGoBack() ? router.back() : router.replace('/signin'));

  if (sent) {
    return (
      <Screen>
        <TopBar onBack={leave} />
        <Scroll top={24} gutter={24}>
          <Sun width={56} />
          <T v="h1" accessibilityRole="header" testID="recover-sent">{t('recover.sent.title')}</T>
          <T v="body">{t('recover.sent.body')}</T>
          <T v="body" style={{ fontFamily: ff.ui600 }}>{t('recover.sent.reach', { contact: sent })}</T>
          <Button label={t('recover.sent.done')} onPress={() => (signedIn ? router.back() : router.replace('/signin'))} testID="recover-done" />
        </Scroll>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={leave} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Scroll top={16} gutter={24} bottomPad={48}>
          <T v="h1" accessibilityRole="header">{t('recover.title')}</T>
          <T v="body">{t('recover.body')}</T>
          <Field label={t('recover.name')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" autoCapitalize="words"
            error={tried && !name.trim() ? t('recover.nameNeeded') : null} testID="recover-name" />
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('recover.oldKind')}</T>
          <ContactInput kind={oldKind} value={oldValue} onKind={(k) => { setOldKind(k); setOldValue(''); }} onValue={setOldValue}
            label={oldKind === 'phone' ? t('recover.oldPhone') : t('recover.oldEmail')} problem={tried ? oldP.problem : null} testID="recover-old" />
          <T v="small" style={{ fontFamily: ff.ui600 }}>{t('recover.newKind')}</T>
          <ContactInput kind={newKind} value={newValue} onKind={(k) => { setNewKind(k); setNewValue(''); }} onValue={setNewValue}
            label={newKind === 'phone' ? t('recover.newPhone') : t('recover.newEmail')} problem={same ? t('recover.same') : tried ? newP.problem : null} testID="recover-new" />
          <Field label={t('recover.note')} value={note} onChangeText={setNote} placeholder={t('recover.notePlaceholder')} multiline maxLength={500}
            style={{ height: 96, paddingTop: 12, textAlignVertical: 'top' }} testID="recover-note" />
          <T v="tiny" color={colors.ink3}>{t('recover.privacy')}</T>
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
          <Button label={t('recover.send')} busy={busy} disabled={tried && !ready} onPress={send} testID="recover-send" />
        </Scroll>
      </KeyboardAvoidingView>
    </Screen>
  );
}

