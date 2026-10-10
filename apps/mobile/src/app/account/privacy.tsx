import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AccountScreen, DeletionBanner } from '@/components/wallet/AccountScreen';
import { Group, Row, StatusPill, Toggle } from '@/components/wallet/ui';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useAccount, useConsents, useExport, useTrips, walletApi, walletKeys } from '@/lib/wallet';
import { demo } from '@/lib/wallet-demo';
import { fmtDate, fullDay, hhmm, nextTrip, useNow } from '@/lib/wallet-model';
import { colors } from '@/theme';
import type { IconName } from '@/components/Icon';

const KEEP: [IconName, Parameters<typeof t>[0], Parameters<typeof t>[0]][] = [
  ['visa', 'privacy.keep.passports', 'privacy.keep.passportsWhy'], ['user', 'privacy.keep.contact', 'privacy.keep.contactWhy'],
  ['trips', 'privacy.keep.trips', 'privacy.keep.tripsWhy'], ['star', 'privacy.keep.prefs', 'privacy.keep.prefsWhy'],
  ['pin', 'privacy.keep.location', 'privacy.keep.locationWhy'], ['gear', 'privacy.keep.usage', 'privacy.keep.usageWhy'],
];

/** Privacy (Account.jsx Privacy): a copy of everything, what we keep and why, consents, delete with 30 days. */
export default function Privacy() {
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const account = useAccount();
  const consents = useConsents();
  const exp = useExport();
  const trips = useTrips();
  const [sheet, setSheet] = useState<null | 'export' | 'delete'>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const c = consents.data?.consents ?? account.data?.consents ?? { marketing: false, analytics: true };
  const now = useNow();
  const pending = !!exp.data && exp.data.status === 'pending' && now - Date.parse(exp.data.requestedAt) < 86_400_000;
  const trip = nextTrip(trips.data);
  const word = typed.trim().toUpperCase();

  const setConsent = async (k: 'marketing' | 'analytics', v: boolean) => {
    try { qc.setQueryData(walletKeys.consents, await walletApi.updateConsents({ [k]: v })); } catch { toast(t('error.internal')); }
  };
  const requestExport = async () => {
    if (demo('offline')) { toast(t('privacy.export.offline')); return; }
    setBusy(true);
    try { const r = await walletApi.requestExport(); qc.setQueryData(walletKeys.export, r.export); buzz('success'); setSheet(null); toast(t('privacy.export.done')); } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  const schedule = async () => {
    setBusy(true);
    try { const r = await walletApi.scheduleDeletion(); await qc.invalidateQueries({ queryKey: walletKeys.account }); buzz('warn'); toast(t('privacy.delete.scheduled', { date: fmtDate(r.deleteAt!, true) })); setSheet(null); } catch { toast(t('error.internal')); } finally { setBusy(false); }
  };

  return (
    <AccountScreen title={t('privacy.title')} testID="privacy">
      <DeletionBanner />
      <Group label={t('privacy.yours')}>
        <Row icon="doc" value={pending ? t('privacy.exportPending') : t('privacy.export')} testID="privacy-export"
          sub={pending ? t('privacy.exportPendingSub', { date: fmtDate(exp.data!.requestedAt), time: hhmm(exp.data!.requestedAt), email: exp.data!.email }) : t('privacy.exportSub')}
          right={pending ? <StatusPill label={t('privacy.pending')} tone="gold" /> : undefined} onPress={pending ? undefined : () => setSheet('export')} />
      </Group>
      <Group label={t('privacy.keep')}>
        {KEEP.map(([icon, title, why]) => <Row key={title} icon={icon} value={t(title)} sub={t(why)} />)}
      </Group>
      <Group label={t('privacy.choose')}>
        <Row value={t('privacy.marketing')} sub={t('privacy.marketingSub')} right={<Toggle label={t('privacy.marketing')} value={c.marketing} onChange={(v) => setConsent('marketing', v)} testID="consent-marketing" />} />
        <Row value={t('privacy.analytics')} sub={t('privacy.analyticsSub')} right={<Toggle label={t('privacy.analytics')} value={c.analytics} onChange={(v) => setConsent('analytics', v)} testID="consent-analytics" />} />
      </Group>
      {!account.data?.deleteAt ? <Button variant="ghost" color={colors.badInk} label={t('privacy.delete')} onPress={() => { setTyped(''); setSheet('delete'); }} testID="privacy-delete" /> : null}
      <T v="tiny" style={{ paddingHorizontal: 4 }}>{t('privacy.footer')}</T>

      <Sheet visible={sheet === 'export'} onClose={() => setSheet(null)} label={t('privacy.export')}>
        <T v="h2">{t('privacy.export.title')}</T>
        <T v="body">{user?.email ? t('privacy.export.bodyTo', { email: user.email }) : t('privacy.export.body')}</T>
        {!user?.email ? <T v="small" color={colors.badInk} accessibilityRole="alert">{t('privacy.export.needEmail')}</T> : <Button label={t('privacy.export.confirm')} busy={busy} onPress={requestExport} testID="export-confirm" />}
        <Button variant="ghost" label={t('common.notNow')} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet visible={sheet === 'delete'} onClose={() => setSheet(null)} label={t('privacy.delete.title')}>
        <T v="h2">{t('privacy.delete.title')}</T>
        <T v="body">{t('privacy.delete.body')}</T>
        <View style={{ gap: 6, paddingStart: 4 }}>
          {[trip ? t('privacy.delete.bookingsTrip', { city: trip.city, date: fullDay(trip.land) }) : t('privacy.delete.bookings'), t('privacy.delete.refunds'), t('privacy.delete.receipts')].map((x) => <T key={x} v="small">{`•  ${x}`}</T>)}
        </View>
        <Field label={t('privacy.delete.type')} value={typed} onChangeText={setTyped} autoCapitalize="characters" autoComplete="off" testID="delete-type"
          error={typed && word !== 'DELETE' && !'DELETE'.startsWith(word) ? t('privacy.delete.typeWord') : null} />
        <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('privacy.delete.confirm')} disabled={word !== 'DELETE'} busy={busy} onPress={schedule} testID="delete-confirm" />
        <Button label={t('privacy.delete.keep')} onPress={() => setSheet(null)} />
      </Sheet>
    </AccountScreen>
  );
}
