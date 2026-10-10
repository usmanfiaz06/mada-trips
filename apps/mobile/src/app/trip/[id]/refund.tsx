import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { formatSar, RefundReason, type RefundView } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { PayMark } from '@/components/PayMark';
import { SlideToConfirm } from '@/components/SlideToConfirm';
import { T } from '@/components/Text';
import { ArtCardSlot } from '@/components/art/Arts';
import { ArtReceipt } from '@/components/trips/Arts';
import { RefundTracker } from '@/components/trips/RefundTracker';
import { AgentNote, BigCheck, Box, H3, Num, PickCard, Rise, Row, Small, TripScreen } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, toTab, tripsApi, useRefundQuote, useTrip, useTripMutation, useTrips } from '@/lib/trips';
import { colors } from '@/theme';

const REASONS = RefundReason.options;

/** Ask for a refund (prototype Refund): pick what, see exactly what comes back by the rules, then slide. */
export default function Refund() {
  const { id, keys } = useLocalSearchParams<{ id: string; keys?: string }>();
  const router = useRouter();
  const trip = useTrip(id).data?.trip;
  const q = useRefundQuote(id);
    const list = useTrips();
  const [chosen, setChosen] = useState<string[]>(keys ? keys.split(',') : []);
  const [reason, setReason] = useState<RefundReason | null>(null);
  const [dest, setDest] = useState<'original' | 'credit'>('original');
  const [sent, setSent] = useState<RefundView | null>(null);
  const [clientKey] = useState(newKey);
  const create = useTripMutation((r: RefundReason) => tripsApi.refund(id, { paymentIds: chosen, reason: r, destination: dest, clientKey }));
  const data = q.data;
  if (!trip || !data) return <TripScreen title={t('rf.title')}>{null}</TripScreen>;
  if (!data.items.length) return <TripScreen title={t('rf.title')}><EmptyState art={<ArtCardSlot />} title={t('rf.emptyTitle')} body={t('rf.emptyBody')} action={<Button label={t('pay.plan')} onPress={() => router.push('/ask')} />} /></TripScreen>;
  const agent = trip.agent.name;
  const effReason = reason ?? (data.airlineCancelled ? 'airline' : null);

  if (sent) {
    const live = list.data?.refunds.find((r) => r.id === sent.id) ?? sent;
    return (
      <TripScreen title={t('rf.title')} act={<>
        <Button testID="see-in-trips" label={t('rf.seeTrips')} onPress={() => toTab(router, '/trips?tab=requests')} />
        <Button label={t('rf.done')} variant="ghost" onPress={() => router.back()} />
      </>}>
        <Rise style={{ marginTop: 30 }}><BigCheck /></Rise>
        <Rise step={1}><T v="h1" accessibilityRole="header">{live.anyway ? t('rf.sent.anyway') : live.destination === 'credit' ? t('rf.sent.credit', { amount: formatSar(live.amount.amount) }) : t('rf.sent.card', { amount: formatSar(live.amount.amount) })}</T></Rise>
        <Rise step={2}><T v="body">{live.anyway ? t('rf.sent.anywayBody', { agent }) : live.destination === 'credit' ? t('rf.sent.creditBody') : live.destination === 'instalments' ? t('rf.sent.tabbyBody', { provider: live.provider === 'tamara' ? 'Tamara' : 'Tabby' }) : t('rf.sent.cardBody', { card: live.card })}</T></Rise>
        <Box><RefundTracker r={live} /></Box>
        <AgentNote initial={trip.agent.initial}>{live.anyway ? t('rf.sent.lineAnyway') : live.destination === 'credit' ? t('rf.sent.lineCredit') : t('rf.sent.line')}</AgentNote>
      </TripScreen>
    );
  }

  if (data.allUsed && !data.items.some((i) => i.back.amount > 0 || i.askAnyway)) {
    return (
      <TripScreen title={t('rf.title')}>
        <EmptyState art={<ArtReceipt stamp />} title={t('rf.doneTitle')} body={t('rf.doneBody', { agent })} action={<Button label={t('action.talk')} onPress={() => router.push('/support?topic=refund' as Href)} />} />
      </TripScreen>
    );
  }
  const picked = data.items.filter((i) => chosen.includes(i.paymentId));
  const back = picked.reduce((a, i) => a + i.cash.amount, 0);
  const credited = picked.reduce((a, i) => a + i.back.amount, 0);
  const cancelledTotal = picked.reduce((a, i) => a + (i.cancelled?.amount.amount ?? 0), 0);
  const anyway = picked.length > 0 && credited === 0;
  const instal = picked.filter((i) => i.method === 'tabby' || i.method === 'tamara');
  const allInstal = instal.length > 0 && instal.length === picked.length;
  const ready = picked.length > 0 && !!effReason;
  const card = data.card;
  const toggle = (pid: string) => setChosen(chosen.includes(pid) ? chosen.filter((k) => k !== pid) : [...chosen, pid]);
  return (
    <TripScreen title={t('rf.askTitle')} act={
      <SlideToConfirm disabled={!ready} busy={create.isPending} label={!picked.length ? t('rf.slide.pick') : !effReason ? t('rf.slide.reason') : anyway ? t('rf.slide.anyway') : t('rf.slide.ask', { amount: formatSar(back) })}
        onConfirm={() => { if (!effReason) return; create.mutate(effReason, { onSuccess: (r) => { buzz('success'); setSent(r.refund); }, onError: (e) => toast(e.message) }); }} />
    }>
      <Rise><T v="h1" accessibilityRole="header">{t('rf.what')}</T></Rise>
      {data.airlineCancelled ? <Box tone="focal"><H3 color={colors.mist}>{t('rf.cancelled', { airline: trip.segments[0]?.carrierName ?? '', code: trip.segments[0]?.flightNumber ?? '' })}</H3><Small color={colors.onDark2}>{t('rf.cancelledBody')}</Small></Box> : null}
      {data.partlyUsed ? <Box style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}><Icon name="flight" size={20} /><View style={{ flex: 1, gap: 4 }}><H3 size={15}>{t('rf.used')}</H3><Small>{t('rf.usedBody')}</Small></View></Box> : null}
      <View style={{ gap: 10 }}>
        {data.items.map((i) => {
          const on = chosen.includes(i.paymentId);
          return (
            <PickCard key={i.paymentId} testID={`refund-${i.item}`} on={on} disabled={i.alreadyRefunded || (i.back.amount === 0 && !i.askAnyway)} onPress={() => toggle(i.paymentId)}
              title={i.title} sub={i.alreadyRefunded ? t('rf.already') : i.rule}
              right={i.alreadyRefunded ? t('rf.refunded') : i.cash.amount > 0 ? `+${formatSar(i.cash.amount, { bare: true })}` : i.back.amount > 0 ? t('rf.paymentsStop') : t('rf.nothingBack')}
              note={on ? [i.why, i.back.amount > 0 && i.back.amount < i.paid.amount ? t('rf.youPaid', { amount: formatSar(i.paid.amount) }) : '', i.cancelled ? t('rf.instNote', { paid: formatSar(i.paid.amount - i.cancelled.amount.amount), n: i.cancelled.count, provider: i.method === 'tamara' ? 'Tamara' : 'Tabby', left: formatSar(i.cancelled.amount.amount) }) : '', i.owe ? t('rf.owe', { provider: i.method === 'tamara' ? 'Tamara' : 'Tabby', amount: formatSar(i.owe.amount) }) : ''].filter(Boolean).join(' ') : null}
            />
          );
        })}
      </View>
      {picked.length ? (<>
        <H3>{t('rf.why')}</H3>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>{REASONS.map((r) => <Chip key={r} label={t(`rf.reason.${r}`)} on={effReason === r} onPress={() => setReason(r)} />)}</Row>
        {effReason === 'ill' ? <Small>{t('rf.illNote')}</Small> : null}
        {effReason === 'airline' && !data.airlineCancelled ? <Small>{t('rf.airlineNote', { airline: trip.segments[0]?.carrierName ?? '' })}</Small> : null}
        {!anyway ? (<>
          <H3>{t('rf.where')}</H3>
          {allInstal ? (
            <Box tone="well" gap={6}>
              <Row><PayMark brand={instal[0]!.method === 'tamara' ? 'tamara' : 'tabby'} size={22} /><H3 size={15}>{t('rf.backThrough', { provider: instal[0]!.method === 'tamara' ? 'Tamara' : 'Tabby' })}</H3></Row>
              <Small>{t('rf.backThroughBody')}</Small>
            </Box>
          ) : (
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
              <PickCard radio testID="dest-card" on={dest === 'original'} onPress={() => setDest('original')} title={t('rf.toCard', { card })} sub={t('rf.toCardSub')} />
              <PickCard radio testID="dest-credit" on={dest === 'credit'} onPress={() => setDest('credit')} title={t('rf.toCredit')} sub={t('rf.toCreditSub')} />
              {instal.length ? <Small>{t('rf.mixed', { provider: instal[0]!.method === 'tamara' ? 'Tamara' : 'Tabby' })}</Small> : null}
            </View>
          )}
        </>) : null}
        <View style={{ gap: 2, paddingVertical: 4 }}>
          <Small>{anyway ? t('rf.sumAnyway', { agent }) : t('rf.youGet')}</Small>
          {!anyway ? <Num size={38}>{formatSar(back)}</Num> : null}
          {!anyway && cancelledTotal > 0 ? <Small>{t('rf.sumInst', { left: formatSar(cancelledTotal), all: formatSar(credited) })}</Small> : null}
        </View>
      </>) : null}
    </TripScreen>
  );
}
