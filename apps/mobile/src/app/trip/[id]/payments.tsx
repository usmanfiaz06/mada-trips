import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { formatSar, type TripPayment } from '@mada/shared';
import { brandOf, dl, methodName } from '@/components/trips/money';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon, type IconName } from '@/components/Icon';
import { PayMark } from '@/components/PayMark';
import { ArtReceipt } from '@/components/trips/Arts';
import { Box, Eyebrow, Grow, H3, IconTile, Num, Rise, Row, Small, Spread, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { usePayments, useTrip } from '@/lib/trips';
import { colors } from '@/theme';

const ICON: Record<TripPayment['item'], IconName> = { flight: 'flight', stay: 'stay', pickup: 'car', change: 'flight', extra: 'star' };
/** Every payment for the trip, with its VAT invoice, instalments and refunds (prototype Payments). */
export default function Payments() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const trip = useTrip(id).data?.trip;
  const q = usePayments(id);
  const list = q.data?.payments ?? [];
  if (q.data && !list.length) {
    return (
      <TripScreen title={t('pay.title')}>
        <EmptyState art={<ArtReceipt />} title={t('pay.emptyTitle')} body={t('pay.emptyBody')} action={<Button label={t('pay.plan')} onPress={() => router.push('/ask')} />} />
      </TripScreen>
    );
  }
  const upcoming = list.flatMap((p) => (p.plan && !p.refunded ? p.plan.filter((i) => !i.paid).map((i) => ({ ...i, what: p.title, p })) : []));
  const next = upcoming[0];
  return (
    <TripScreen title={t('pay.title')}>
      <Rise style={{ gap: 4 }}>
        <Eyebrow>{trip ? t('pay.eyebrow', { city: trip.city, ref: trip.bookingRef ?? '' }) : ''}</Eyebrow>
        <Num size={38} style={{ lineHeight: 40 }}>{formatSar(q.data?.total.amount ?? 0)}</Num>
        <Small>{q.data?.refunded.amount ? t('pay.totalRefunded', { amount: formatSar(q.data.refunded.amount) }) : t('pay.total')}</Small>
      </Rise>
      {next ? (
        <Rise step={1}>
          <Box tone="focal">
            <Row><PayMark brand={brandOf(next.p)} size={22} /><H3 color={colors.mist} style={{ flex: 1 }}>{t('pay.next', { amount: formatSar(next.amount.amount), day: dl(next.dueOn) })}</H3></Row>
            <Small color={colors.onDark2}>{t('pay.nextBody', { what: next.what, n: upcoming.length, card: next.p.label ?? '' })}</Small>
          </Box>
        </Rise>
      ) : null}
      {q.data?.credit.amount ? <Box tone="well" style={{ flexDirection: 'row', alignItems: 'center' }}><PayMark brand="credit" size={22} /><Small color={colors.green} style={{ flex: 1 }}>{t('pay.credit', { amount: formatSar(q.data.credit.amount) })}</Small></Box> : null}
      <Rise step={2}>
        <Box padding={6} gap={0}>
          {list.map((p, i) => (
            <Pressable key={p.id} testID={`payment-${p.item}`} accessibilityRole="button" accessibilityLabel={t('pay.a11y', { title: p.title, amount: formatSar(p.amount.amount) })} disabled={!p.invoiceId}
              onPress={() => { buzz('tap'); router.push(`/trip/${id}/invoice/${p.invoiceId}` as Href); }}
              style={({ pressed }) => [styles.pay, i ? styles.payLine : null, pressed ? { backgroundColor: colors.mist } : null]}>
              <IconTile name={ICON[p.item]} />
              <Grow gap={2}>
                <H3 size={15}>{p.title}</H3>
                <Tiny>{dl(p.paidAt)} · {methodName(p)}</Tiny>
                {p.refunded ? <Tag tone="ok" label={t('pay.credited', { amount: formatSar(p.refunded.amount) })} /> : null}
                {p.plan && !p.refunded ? (
                  <Row gap={4} style={{ marginTop: 2 }}>
                    {p.plan.map((x) => <View key={x.seq} style={[styles.inst, x.paid ? { backgroundColor: colors.ok } : null]} />)}
                    <Tiny style={{ marginStart: 4 }}>{t('pay.ofPaid', { n: p.plan.filter((x) => x.paid).length, total: p.plan.length })}</Tiny>
                  </Row>
                ) : null}
              </Grow>
              <View style={{ alignItems: 'flex-end', gap: 2 }}><Num size={15}>{formatSar(p.amount.amount, { bare: true })}</Num><Tiny>{t('pay.invoice')}</Tiny></View>
            </Pressable>
          ))}
        </Box>
      </Rise>
      {upcoming.length ? (
        <Box>
          <H3>{t('pay.plan.title')}</H3>
          {list.filter((p) => p.plan && !p.refunded).map((p) => (
            <View key={p.id} style={{ gap: 6 }}>
              <Row><PayMark brand={brandOf(p)} size={18} /><Small>{p.title}</Small></Row>
              {p.plan!.map((x, k) => (
                <Spread key={x.seq} style={styles.instRow}>
                  <Small color={colors.green}>{k === 0 ? t('pay.atBooking') : t('pay.payment', { n: k + 1 })} · {dl(x.dueOn)}</Small>
                  <Num size={13} color={x.paid ? colors.ok : colors.green}>{x.paid ? t('pay.paid') : t('pay.due')} · {formatSar(x.amount.amount)}</Num>
                </Spread>
              ))}
            </View>
          ))}
          <Tiny>{t('pay.plan.foot')}</Tiny>
        </Box>
      ) : null}
      <Button testID="payments-refund" label={t('tm.m.refund')} variant="secondary" onPress={() => router.push(`/trip/${id}/refund` as Href)} />
    </TripScreen>
  );
}

const styles = StyleSheet.create({
  pay: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 18 },
  payLine: { borderTopWidth: 1, borderTopColor: colors.line, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  inst: { width: 18, height: 5, borderRadius: 9, backgroundColor: '#e3dcd1' },
  instRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line },
});

void Icon;
