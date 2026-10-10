import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { Group, Notice, Row, StatusPill } from '@/components/wallet/ui';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { keys as coreKeys } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { socialIdentity } from '@/lib/social';
import { toast } from '@/lib/toast';
import { walletApi } from '@/lib/wallet';
import { demo } from '@/lib/wallet-demo';
import { prettyPhone } from '@/lib/wallet-model';
import { colors } from '@/theme';

type Method = 'apple' | 'google' | 'phone';
const METHODS: { id: Method; name: Parameters<typeof t>[0]; sub: Parameters<typeof t>[0] }[] = [
  { id: 'apple', name: 'signinMethods.apple', sub: 'signinMethods.appleSub' },
  { id: 'google', name: 'signinMethods.google', sub: 'signinMethods.googleSub' },
  { id: 'phone', name: 'signinMethods.phone', sub: 'signinMethods.phoneSub' },
];

/** Sign-in methods (Account.jsx SignIn): keep at least two; never remove the last way in. */
export default function SignInMethods() {
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const [sheet, setSheet] = useState<{ id: Method; mode: 'link' | 'manage' } | null>(null);
  const [busy, setBusy] = useState(false);
  const methods = user?.methods ?? { apple: false, google: false, phone: false };
  const count = METHODS.filter((m) => methods[m.id]).length;
  const m = sheet ? METHODS.find((x) => x.id === sheet.id)! : null;
  const name = m ? t(m.name) : '';
  const done = (u: Awaited<ReturnType<typeof walletApi.unlinkMethod>>['user']) => { useSession.getState().setUser(u); qc.setQueryData(coreKeys.me, u); };

  const link = async () => {
    if (!m || m.id === 'phone') return;
    setBusy(true);
    try {
      const id = await socialIdentity(m.id, { hideEmail: m.id === 'apple' });
      done((await walletApi.linkMethod(m.id, id.idToken)).user);
      buzz('success'); toast(t('signinMethods.added', { name })); setSheet(null);
    } catch (e) { toast(e instanceof ApiError ? e.message : t('error.notConfigured')); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!m) return;
    setBusy(true);
    try { done((await walletApi.unlinkMethod(m.id)).user); buzz('tap'); toast(t('signinMethods.removed', { name })); setSheet(null); } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };

  return (
    <AccountScreen title={t('signinMethods.title')} testID="signin-methods">
      <T v="body">{t('signinMethods.body')}</T>
      <Group>
        {METHODS.map((x) => (
          <Row key={x.id} testID={`method-${x.id}`}
            lead={<View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: methods[x.id] ? colors.green : colors.mist, alignItems: 'center', justifyContent: 'center' }}><Icon name={x.id === 'phone' ? 'bell' : 'lock'} size={18} color={methods[x.id] ? colors.mist : colors.green} /></View>}
            value={t(x.name)}
            sub={methods[x.id] ? (x.id === 'phone' ? prettyPhone(user?.phone) : x.id === 'apple' && user?.emailRelay ? t('signinMethods.hideOn') : t(x.sub)) : t('signinMethods.notLinked')}
            right={<StatusPill label={methods[x.id] ? t('signinMethods.linked') : t('signinMethods.add')} tone={methods[x.id] ? 'ok' : 'muted'} />}
            onPress={() => setSheet({ id: x.id, mode: methods[x.id] ? 'manage' : 'link' })} />
        ))}
      </Group>
      {count === 1 ? <Notice warn title={t('signinMethods.onlyOne')} body={t('signinMethods.onlyOneBody')} testID="only-one" /> : null}
      {methods.apple ? <Card variant="well" style={{ gap: 6 }}><T v="h3" style={{ fontSize: 15 }}>{t('signinMethods.hideTitle')}</T><T v="small">{t('signinMethods.hideBody')}</T></Card> : null}

      <Sheet visible={!!sheet && sheet.mode === 'link'} onClose={() => setSheet(null)} label={name}>
        {m?.id === 'phone' ? (
          <>
            <T v="h2">{t('signinMethods.addTitle', { name })}</T>
            <T v="body">{t('account.phone.body')}</T>
            <Button label={t('account.phone.add')} onPress={() => { setSheet(null); toast(t('account.mobileWarn')); }} />
          </>
        ) : (
          <>
            <T v="h2">{t('signinMethods.addTitle', { name })}</T>
            <T v="body">{m?.id === 'apple' ? t('signinMethods.addApple') : t('signinMethods.addGoogle')}</T>
            <Button label={t('signinMethods.continue', { name })} disabled={demo('offline')} busy={busy} onPress={link} testID="method-continue" />
            {demo('offline') ? <T v="small" color={colors.badInk} accessibilityRole="alert">{t('signinMethods.offline')}</T> : null}
          </>
        )}
        <Button variant="ghost" label={t('common.cancel')} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={!!sheet && sheet.mode === 'manage'} onClose={() => setSheet(null)} label={name}>
        <T v="h2">{name}</T>
        <T v="body">{m?.id === 'phone' ? t('signinMethods.phoneManage', { phone: prettyPhone(user?.phone) }) : t('signinMethods.canSignIn', { name })}</T>
        {count <= 1 ? <Notice warn title={t('signinMethods.onlyWay')} body={t('signinMethods.onlyWayBody')} testID="only-way" /> : (
          <>
            {m?.id === 'apple' && user?.emailRelay ? <T v="small" color={colors.goldInk}>{t('signinMethods.relayNote')}</T> : null}
            <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('signinMethods.remove', { name })} busy={busy} onPress={remove} testID="method-remove" />
          </>
        )}
        <Button label={t('signinMethods.keep')} onPress={() => setSheet(null)} />
      </Sheet>
    </AccountScreen>
  );
}
