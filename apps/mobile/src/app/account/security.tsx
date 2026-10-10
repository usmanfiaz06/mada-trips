import { useState } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as LocalAuthentication from 'expo-local-authentication';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { ArtPhone } from '@/components/wallet/Arts';
import { SignOutSheet } from '@/components/wallet/SignOutSheet';
import { Group, Row, Spinner, StatusPill, Toggle } from '@/components/wallet/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useAccount, useDevices, useUpdateAccount, walletApi, walletKeys } from '@/lib/wallet';
import { demo } from '@/lib/wallet-demo';
import { fmtDate } from '@/lib/wallet-model';
import { colors } from '@/theme';
import type { Device } from '@mada/shared';

const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 2 ? t('security.device.now') : fmtDate(iso); };

/** Security (Account.jsx Security): Face ID for the Wallet, signed-in devices, sign out everywhere. */
export default function Security() {
  const qc = useQueryClient();
  const account = useAccount();
  const devices = useDevices();
  const update = useUpdateAccount();
  const [sheet, setSheet] = useState<null | 'faceoff' | 'everywhere' | Device>(null);
  const [checking, setChecking] = useState(false);
  const [faceErr, setFaceErr] = useState<string | null>(null);
  const on = account.data?.faceId !== false;
  const list = devices.data ?? [];
  const others = list.filter((d) => !d.current);

  const turnOn = async () => {
    setChecking(true); setFaceErr(null);
    let ok: boolean;
    if (Platform.OS !== 'web') ok = (await LocalAuthentication.authenticateAsync({ promptMessage: t('wallet.lock.prompt') }).catch(() => ({ success: false }))).success;
    else { await new Promise((r) => setTimeout(r, 900)); ok = !demo('faceIdFails'); }
    setChecking(false);
    if (!ok) { setFaceErr(t('security.faceFailed')); buzz('soft'); return; }
    update.mutate({ faceId: true }, { onSuccess: () => { buzz('success'); toast(t('security.faceOnToast')); } });
  };
  const signOutDevice = async (d: Device) => {
    try { await walletApi.signOutDevice(d.id); await qc.invalidateQueries({ queryKey: walletKeys.devices }); buzz('tap'); toast(t('security.device.done', { name: d.name })); setSheet(null); } catch { toast(t('error.internal')); }
  };
  const dev = sheet && typeof sheet === 'object' ? sheet : null;

  return (
    <AccountScreen title={t('security.title')} testID="security">
      <Group label={t('security.wallet')}>
        <Row icon="lock" value={t('security.faceId')} sub={checking ? t('security.checking') : on ? t('security.on') : t('security.off')}
          right={checking ? <Spinner /> : <Toggle label={t('security.faceId')} value={on} onChange={(v) => (v ? turnOn() : setSheet('faceoff'))} testID="faceid-toggle" />} />
        {faceErr ? <T v="small" color={colors.badInk} style={{ padding: 16 }} accessibilityRole="alert">{faceErr}</T> : null}
      </Group>
      <Group label={t('security.signedInOn')}>
        {list.map((d) => (
          <Row key={d.id} icon={d.platform === 'web' ? 'globe' : 'user'} value={d.name} sub={t('security.device.sub', { platform: d.platform === 'web' ? 'Web' : d.platform === 'android' ? 'Android' : 'iOS', when: ago(d.lastUsedAt) })}
            right={d.current ? <StatusPill label={t('security.thisPhone')} tone="ok" /> : <Button variant="secondary" size="small" block={false} color={colors.badInk} style={{ backgroundColor: colors.mist, height: 34 }} label={t('security.signOut')} onPress={() => setSheet(d)} />} />
        ))}
        {!others.length ? <EmptyState compact art={<ArtPhone width={100} height={75} />} title={t('security.onlyThis')} body={t('security.onlyThisBody')} /> : null}
      </Group>
      <T v="tiny" style={{ paddingHorizontal: 4 }}>{t('security.unknown')}</T>
      <Button variant="secondary" color={colors.badInk} label={t('security.everywhere')} onPress={() => setSheet('everywhere')} testID="signout-everywhere" />

      <Sheet visible={sheet === 'faceoff'} onClose={() => setSheet(null)} label={t('security.faceOff.title')}>
        <T v="h2">{t('security.faceOff.title')}</T>
        <T v="body">{t('security.faceOff.body')}</T>
        <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('security.faceOff.confirm')} testID="faceoff-confirm"
          onPress={() => update.mutate({ faceId: false }, { onSuccess: () => { toast(t('security.faceOff.done')); setSheet(null); } })} />
        <Button label={t('security.faceOff.keep')} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={!!dev} onClose={() => setSheet(null)} label={dev ? t('security.device.title', { name: dev.name }) : ''}>
        <T v="h2">{dev ? t('security.device.title', { name: dev.name }) : ''}</T>
        <T v="body">{t('security.device.body')}</T>
        <Button label={dev ? t('security.device.confirm', { name: dev.name }) : ''} disabled={demo('offline')} onPress={() => dev && signOutDevice(dev)} testID="device-signout" />
        {demo('offline') ? <T v="small" color={colors.badInk}>{t('security.device.offline')}</T> : null}
        <Button variant="ghost" label={t('common.cancel')} onPress={() => setSheet(null)} />
      </Sheet>
      <SignOutSheet visible={sheet === 'everywhere'} everywhere onClose={() => setSheet(null)} />
    </AccountScreen>
  );
}
