import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatSar, rangeLabel, type CancelSupplierVoucherResponse } from '@mada/shared';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, Divider, H3, Rise, Small, Spread, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { saveVoucher, transferKeys, transfersApi, useVoucher } from '@/lib/transfers';
import { colors } from '@/theme';

/*
 * A Hotelbeds voucher (certification §4): hotel name and address, the HBX Group reference, our reference, the lead
 * guest and a name per room with children's ages, dates, room, board, the hotel's essential information in full, the
 * cancellation rule, and the payment statement (no price). Download it (the same page the server prints), or cancel:
 * Hotelbeds says what it costs first, then the traveller confirms.
 */
export default function VoucherScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useVoucher(id);
  const [sheet, setSheet] = useState(false);
  const [sim, setSim] = useState<CancelSupplierVoucherResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const v = q.data?.voucher;
  if (!v) {
    return <TripScreen title={t('voucher.title')}>{q.isPending ? <View style={{ paddingTop: 40 }}><ActivityIndicator color={colors.green} /></View> : <EmptyState art={<ArtSuitcase />} title={t('error.notFound')} body="" />}</TripScreen>;
  }
  const row = (label: string, value: string | null | undefined, testID?: string) => (value ? <View testID={testID} style={{ gap: 2 }}><Tiny>{label}</Tiny><Small color={colors.green}>{value}</Small></View> : null);

  async function check() {
    setSheet(true); setSim(null); setBusy(true);
    try { setSim(await transfersApi.cancel(id, false)); } catch (e) { toast(e instanceof Error ? e.message : ''); setSheet(false); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    try {
      await transfersApi.cancel(id, true);
      buzz('success');
      toast(t('voucher.cancelDone'));
      setSheet(false);
      await qc.invalidateQueries({ queryKey: transferKeys.voucher(id) });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    } catch (e) { toast(e instanceof Error ? e.message : ''); } finally { setBusy(false); }
  }

  return (
    <TripScreen title={t(v.kind === 'stay' ? 'voucher.title' : 'voucher.titleTransfer')}>
      <Rise><T v="h1" accessibilityRole="header">{v.hotel?.name ?? v.transfer?.vehicle ?? ''}</T></Rise>
      <Rise step={1}><Small style={{ marginTop: -8 }}>{v.status === 'cancelled' ? t('voucher.cancelled') : t('voucher.show')}</Small></Rise>
      <Box testID="voucher-ref">
        <Spread><Tiny>{t('voucher.reference')}</Tiny>{v.status === 'cancelled' ? <Tag tone="bad" label={t('voucher.cancelled')} /> : <Tag tone="ok" label="HBX Group" />}</Spread>
        <T style={{ fontSize: 24, fontWeight: '600', letterSpacing: 0.6, color: colors.green, writingDirection: 'ltr' }} selectable>{v.reference}</T>
        {v.agencyReference ? <Tiny>{t('voucher.agency')}: {v.agencyReference}</Tiny> : null}
      </Box>
      <Box testID="voucher-facts" gap={12}>
        {v.hotel ? <>{row(t('voucher.hotel'), v.hotel.name)}{row(t('voucher.address'), v.hotel.address)}{row(t('voucher.category'), v.hotel.category)}{row(t('voucher.destination'), v.hotel.destination)}{row(t('voucher.phone'), v.hotel.phone)}<Divider /></> : null}
        {v.checkIn && v.checkOut ? row(`${t('voucher.checkIn')} – ${t('voucher.checkOut')}`, `${rangeLabel(v.checkIn, v.checkOut, getLocale())} (${v.checkIn} → ${v.checkOut})`) : null}
        {row(t('voucher.room'), v.room)}{row(t('voucher.board'), v.board)}
        {v.transfer ? <>{row(t('voucher.vehicle'), `${v.transfer.vehicle} · ${t(v.transfer.kind === 'private' ? 'pickup.private' : 'pickup.shared')}`)}{row(t('voucher.route'), `${v.transfer.from} → ${v.transfer.to}`)}{row(t('voucher.when'), `${v.transfer.date} ${v.transfer.time}`)}{row(t('voucher.flight'), v.transfer.flight)}{row(t('voucher.pickup'), v.transfer.pickup)}</> : null}
        <Divider />
        {row(t('voucher.holder'), v.holder)}
        {v.paxes.length ? <View style={{ gap: 2 }}><Tiny>{t('voucher.guests')}</Tiny>{v.paxes.map((p, i) => <Small key={i} color={colors.green}>{t('voucher.roomN', { n: p.room })} · {p.name}{p.child ? ` · ${t('voucher.child', { age: p.age ?? '' })}` : ''}</Small>)}</View> : null}
        {row(t('voucher.bookedOn'), v.bookedOn)}
      </Box>
      {v.remarks ? <Box tone="cream" testID="voucher-remarks"><H3 size={15}>{t('voucher.remarks')}</H3><Small>{v.remarks}</Small></Box> : null}
      {v.cancellation ? <Box testID="voucher-cancellation"><H3 size={15}>{t('voucher.cancellation')}</H3><Small>{v.cancellation}</Small></Box> : null}
      <Box testID="voucher-payment"><H3 size={15}>{t('voucher.payment')}</H3><Tiny>{v.payableThrough}</Tiny>{getLocale() === 'ar' ? <Tiny>{t('voucher.payableAr')}</Tiny> : null}</Box>
      <Button testID="voucher-download" variant="secondary" label={t('voucher.download')} onPress={() => void saveVoucher(v, getLocale())} />
      {v.canCancel ? <Button testID="voucher-cancel" variant="secondary" color={colors.badInk} label={t('voucher.cancel')} onPress={() => void check()} /> : null}
      <Sheet visible={sheet} onClose={() => setSheet(false)} label={t('voucher.cancel')}>
        <T v="h2">{t('voucher.cancel')}</T>
        {busy && !sim ? <Small>{t('voucher.cancelCheck')}</Small> : sim ? <T v="small" testID="voucher-fee">{sim.fee.amount > 0 ? t('voucher.cancelFee', { amount: formatSar(sim.fee.amount).replace(/^SAR\s?/, '') }) : t('voucher.cancelFree')}</T> : null}
        <Button testID="voucher-cancel-confirm" label={t('voucher.cancelConfirm')} color={colors.badInk} variant="secondary" disabled={!sim} busy={busy && !!sim} onPress={() => void cancel()} />
        <Button label={t('voucher.keep')} onPress={() => setSheet(false)} />
      </Sheet>
    </TripScreen>
  );
}
