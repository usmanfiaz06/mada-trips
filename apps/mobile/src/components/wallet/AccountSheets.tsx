import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { checkSaudiMobile } from '@mada/shared';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { keys as coreKeys } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useAccount, useUpdateAccount, walletApi, walletKeys } from '@/lib/wallet';
import { demo } from '@/lib/wallet-demo';
import { prettyPhone, useOnOpen } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { Field } from '../Field';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { CodeStep, Group, Notice, Row, Source, Toggle } from './ui';

/* The sheets behind "Your details" (Account.jsx): name, email, phone, home airport, language, currency. */

const well = { backgroundColor: colors.mist };

export function LanguageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const account = useAccount();
  const update = useUpdateAccount();
  const on = !!account.data?.arabicNotify;
  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.language.title')}>
      <T v="h2">{t('account.language.title')}</T>
      <Group well>
        <Row value="English" right={<Icon name="check" color={colors.ok} width={2.4} />} />
        <Row value="العربية" sub={t('account.language.arabicSub')} right={<View style={{ height: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: colors.paper, justifyContent: 'center' }}><T v="caption" style={{ fontFamily: ff.ui600 }}>{t('account.language.next')}</T></View>} />
      </Group>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{t('account.language.notify')}</T><T v="tiny">{t('account.language.notifySub')}</T></View>
        <Toggle label={t('account.language.notify')} value={on} testID="arabic-notify" onChange={(v) => update.mutate({ arabicNotify: v }, { onSuccess: () => { if (v) toast(t('account.language.notifyOn')); } })} />
      </View>
      <Button label={t('account.language.done')} onPress={onClose} />
    </Sheet>
  );
}

export function PreferredSheet({ visible, onClose, current }: { visible: boolean; onClose: () => void; current: string }) {
  const account = useAccount();
  const update = useUpdateAccount();
  const [v, setV] = useState(current);
  useOnOpen(visible, () => setV(current));
  const s = v.trim();
  const err = !s ? t('account.preferred.empty') : s.length > 30 ? t('account.preferred.long') : /[0-9@#$%^*_=+<>{}[\]\\|]/.test(s) ? t('account.preferred.letters') : null;
  const save = () => { if (err) return; update.mutate({ preferredName: s }, { onSuccess: () => { buzz('success'); toast(t('account.preferred.saved', { name: s })); onClose(); }, onError: () => toast(t('error.internal')) }); };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.calledYou')}>
      <T v="h2">{t('account.preferred.title')}</T>
      <T v="small">{t('account.preferred.body')}</T>
      <Field label={t('account.name')} value={v} onChangeText={setV} autoCapitalize="words" maxLength={40} error={err && v ? err : null} onSubmitEditing={save} testID="preferred-input" />
      <Button label={t('account.preferred.save')} disabled={!!err} busy={update.isPending} onPress={save} testID="preferred-save" />
      {account.data?.preferredName ? <Button variant="ghost" label={t('account.preferred.usePassport')} onPress={() => update.mutate({ preferredName: null }, { onSuccess: () => { toast(t('account.preferred.reset')); onClose(); } })} /> : null}
    </Sheet>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function EmailSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const account = useAccount();
  const [step, setStep] = useState<'view' | 'enter' | 'code'>('view');
  const [v, setV] = useState('');
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useOnOpen(visible, () => { setStep(user?.email ? 'view' : 'enter'); setV(''); setTouched(false); setProblem(null); });
  const e = v.trim().toLowerCase();
  const err = !e ? null : !EMAIL_RE.test(e) ? t('account.email.bad') : user?.email && e === user.email.toLowerCase() ? t('account.email.same') : null;
  const offline = demo('offline');
  const send = async () => {
    setTouched(true);
    if (err || !e || offline) return;
    setBusy(true); setProblem(null);
    try { await walletApi.emailStart(e); buzz('tap'); setStep('code'); } catch (x) { setProblem(x instanceof ApiError ? x.message : t('error.internal')); } finally { setBusy(false); }
  };
  if (step === 'code') {
    return (
      <Sheet visible={visible} onClose={onClose} label={t('account.email')}>
        <CodeStep to={e} onBack={() => setStep('enter')} testID="email-code" resend={async () => { await walletApi.emailStart(e).catch(() => {}); toast(t('account.code.resent')); }}
          check={async (code) => {
            try {
              const { user: u } = await walletApi.emailVerify(e, code);
              useSession.getState().setUser(u); qc.setQueryData(coreKeys.me, u); qc.invalidateQueries({ queryKey: walletKeys.account });
              toast(t('account.email.verified')); onClose(); return null;
            } catch (x) {
              if (x instanceof ApiError && x.code === 'OTP_LOCKED') return { locked: true };
              if (x instanceof ApiError) return { triesLeft: x.extra.triesLeft, message: x.message };
              return { message: t('error.internal') };
            }
          }} />
      </Sheet>
    );
  }
  if (step === 'enter') {
    return (
      <Sheet visible={visible} onClose={onClose} label={t('account.email')}>
        <T v="h2">{user?.email ? t('account.email.new') : t('account.email.add')}</T>
        <T v="small">{t('account.email.body')}</T>
        <Field label={t('account.email')} value={v} onChangeText={setV} onBlur={() => setTouched(true)} keyboardType="email-address" autoCapitalize="none" autoComplete="email"
          error={(touched && err) || problem || (offline ? t('account.offline') : null)} onSubmitEditing={send} testID="email-input" />
        <Button label={t('account.email.send')} disabled={!e || (touched && !!err) || offline} busy={busy} onPress={send} testID="email-send" />
      </Sheet>
    );
  }
  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.email')}>
      <T v="h2">{t('account.email.yours')}</T>
      <Card variant="well" style={{ gap: 6 }}>
        <T v="h3" style={{ fontSize: 15 }}>{user?.email}</T>
        {user?.emailRelay ? <Source kind="apple" /> : <Source kind="verified" at={account.data?.emailVerifiedAt} />}
      </Card>
      {user?.emailRelay ? <Notice title={t('account.email.relayTitle')} body={t('account.email.relayBody')} /> : null}
      <Button label={user?.emailRelay ? t('account.email.useOwn') : t('account.email.change')} onPress={() => setStep('enter')} testID="email-change" />
      <Button variant="ghost" label={t('account.email.keep')} onPress={onClose} />
    </Sheet>
  );
}

export function PhoneSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const [step, setStep] = useState<'enter' | 'code' | 'confirm'>('enter');
  const [v, setV] = useState('');
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useOnOpen(visible, () => { setStep('enter'); setV(''); setTouched(false); setProblem(null); });
  const chk = checkSaudiMobile(v);
  const digits = v.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '');
  const current = (user?.phone ?? '').replace(/^\+966/, '');
  const localErr = !digits ? null : !chk.ok ? (touched || digits.length > 9 ? chk.problem : null) : digits === current ? t('account.phone.same') : null;
  const offline = demo('offline');
  const e164 = chk.ok ? chk.e164 : '';
  const send = async () => {
    setTouched(true);
    if (!chk.ok || localErr || offline) return;
    setBusy(true); setProblem(null);
    try { await walletApi.phoneStart(e164); buzz('tap'); setStep('code'); } catch (x) { setProblem(x instanceof ApiError ? x.message : t('error.internal')); setStep('enter'); } finally { setBusy(false); }
  };
  const confirm = async (code: string) => {
    try {
      const { user: u } = await walletApi.phoneVerify(e164, code);
      useSession.getState().setUser(u); qc.setQueryData(coreKeys.me, u);
      buzz('success'); toast(current ? t('account.phone.changed') : t('account.phone.added')); onClose(); return null;
    } catch (x) {
      if (x instanceof ApiError && x.code === 'OTP_LOCKED') return { locked: true };
      if (x instanceof ApiError) return { triesLeft: x.extra.triesLeft, message: x.message };
      return { message: t('error.internal') };
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.phone.change')}>
      {step === 'enter' ? (
        <>
          <T v="h2">{current ? t('account.phone.change') : t('account.phone.add')}</T>
          <T v="small">{`${current ? `${t('account.phone.now', { phone: prettyPhone(user?.phone) })} ` : ''}${t('account.phone.body')}`}</T>
          <Field label={t('account.phone.label')} prefix="+966" value={v} onChangeText={(x) => { setV(x); setProblem(null); }} onBlur={() => setTouched(true)} keyboardType="phone-pad" placeholder="5X XXX XXXX"
            error={localErr || problem || (offline ? t('account.offline') : null)} testID="phone-new" />
          <Button label={t('phone.send')} disabled={!chk.ok || !!localErr || offline} onPress={() => { setTouched(true); if (chk.ok && !localErr && !offline) setStep('confirm'); }} testID="phone-new-send" />
        </>
      ) : null}
      {step === 'code' ? (
        <CodeStep to={prettyPhone(e164)} onBack={() => setStep('enter')} testID="phone-code" resend={async () => { await walletApi.phoneStart(e164).catch(() => {}); toast(t('account.code.resent')); }}
          check={confirm} />
      ) : null}
      {step === 'confirm' ? (
        <>
          <T v="h2">{current ? t('account.phone.switchTo', { phone: prettyPhone(e164) }) : t('account.phone.use', { phone: prettyPhone(e164) })}</T>
          {current ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 20, backgroundColor: colors.mist }}>
              <View><T v="tiny">{t('account.phone.stops')}</T><T v="h3" style={{ fontSize: 15, textDecorationLine: 'line-through', color: colors.ink3 }}>{prettyPhone(user?.phone)}</T></View>
              <Icon name="arrow" size={18} />
              <View><T v="tiny">{t('account.phone.fromNow')}</T><T v="h3" style={{ fontSize: 15 }}>{prettyPhone(e164)}</T></View>
            </View>
          ) : null}
          <T v="body">{t('account.phone.confirmBody')}</T>
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
          <Button label={t('account.phone.useNew')} busy={busy} testID="phone-use-new" onPress={send} />
          <Button variant="ghost" label={t('account.phone.keepOld')} onPress={onClose} />
        </>
      ) : null}
    </Sheet>
  );
}

export const AIRPORTS: [string, string, string][] = [
  ['RUH', 'Riyadh', 'King Khalid'], ['JED', 'Jeddah', 'King Abdulaziz'], ['DMM', 'Dammam', 'King Fahd'],
  ['MED', 'Madinah', 'Prince Mohammad bin Abdulaziz'], ['AHB', 'Abha', 'Abha'], ['TIF', 'Taif', 'Taif'],
  ['TUU', 'Tabuk', 'Prince Sultan'], ['ELQ', 'Buraidah', 'Prince Naif'], ['GIZ', 'Jazan', 'King Abdullah'],
  ['HOF', 'Al-Ahsa', 'Al-Ahsa'], ['YNB', 'Yanbu', 'Prince Abdulmohsin'], ['ULH', 'AlUla', 'AlUla'],
  ['HAS', 'Hail', 'Hail'], ['AJF', 'Al-Jouf', 'Al-Jouf'], ['RSI', 'Red Sea', 'Red Sea International'],
];

export function HomeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const account = useAccount();
  const update = useUpdateAccount();
  const [q, setQ] = useState('');
  useOnOpen(visible, () => setQ(''));
  const s = q.trim().toLowerCase();
  const list = s ? AIRPORTS.filter((x) => x.join(' ').toLowerCase().includes(s)) : AIRPORTS.slice(3);
  const home = account.data?.home ?? 'RUH';
  const choose = (code: string) => update.mutate({ home: code }, { onSuccess: () => { buzz('select'); toast(t('account.home.saved', { code })); onClose(); } });
  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.home')}>
      <T v="h2">{t('account.home.title')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel={t('account.home.main')}>
        {AIRPORTS.slice(0, 3).map(([c, city]) => <Chip key={c} on={home === c} label={`${city} · ${c}`} onPress={() => choose(c)} />)}
      </View>
      <Field label={t('account.home.other')} value={q} onChangeText={setQ} placeholder={t('account.home.placeholder')} testID="home-search" />
      <Group well style={{ maxHeight: 240 }}>
        {list.length ? list.slice(0, 5).map(([c, city, name]) => <Row key={c} value={`${city} · ${c}`} sub={name} onPress={() => choose(c)} right={home === c ? <Icon name="check" color={colors.ok} width={2.4} /> : <View />} />)
          : <View style={{ padding: 16 }}><T v="small">{t('account.home.none', { q })}</T></View>}
      </Group>
    </Sheet>
  );
}

const CURRENCIES: [string, string][] = [['SAR', 'Saudi riyal'], ['AED', 'UAE dirham'], ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'Pound sterling']];
export const currencyName = (c: string) => CURRENCIES.find((x) => x[0] === c)?.[1] ?? c;

export function CurrencySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const account = useAccount();
  const update = useUpdateAccount();
  const cur = account.data?.currency ?? 'SAR';
  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.currency')}>
      <T v="h2">{t('account.currency.title')}</T>
      <Group well>
        {CURRENCIES.map(([c, n]) => <Row key={c} value={`${c} · ${n}`} right={cur === c ? <Icon name="check" color={colors.ok} width={2.4} /> : <View />}
          onPress={() => update.mutate({ currency: c as 'SAR' }, { onSuccess: () => { toast(c === 'SAR' ? t('account.currency.sar') : t('account.currency.other', { code: c })); onClose(); } })} />)}
      </Group>
      <T v="small">{t('account.currency.note')}</T>
    </Sheet>
  );
}

/** "Comes from your passport." The name and the passport fields change only with a new scan. */
export function PassportLockedSheet({ visible, onClose, field, scanned, onScan }: { visible: boolean; onClose: () => void; field: 'name' | 'other'; scanned: boolean; onScan: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} label={t('account.fromPassport')}>
      <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: colors.warnWash, alignItems: 'center', justifyContent: 'center' }}><Icon name="lock" color={colors.goldInk} /></View>
      <T v="h2">{field === 'name' ? t('account.locked.nameTitle') : t('account.locked.fieldTitle')}</T>
      <T v="body">{`${field === 'name' ? t('account.locked.nameBody') : t('account.locked.fieldBody')}${scanned ? '' : ` ${t('account.locked.notYet')}`}`}</T>
      <Button label={scanned ? t('account.locked.scanNew') : t('account.locked.scanMine')} icon={<Icon name="scan" color={colors.gold} />} onPress={() => { onClose(); onScan(); }} testID="locked-scan" />
      <Button variant="ghost" label={t('common.notNow')} onPress={onClose} />
    </Sheet>
  );
}

export const _sheetWell = well;
