import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { dayLabel, formatSar, nameIn, shortDay, type TransferOption } from '@mada/shared';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { ArtSuitcase } from '@/components/trips/Arts';
import { AgentNote, Box, H3, IconTile, PickCard, Rise, Row, Small, Spread, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { agentName } from '@/lib/agent';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, useTrip } from '@/lib/trips';
import { WaitTrouble } from '@/components/states/WaitTrouble';
import { STAGES_SHORT, Waiting, useStagedLine } from '@/components/states/Waiting';
import { useGiveUp } from '@/lib/net/give-up';
import { talkToMada } from '@/lib/net/talk';
import { useSession } from '@/lib/session';
import { transferKeys, transfersApi, useTransferOptions } from '@/lib/transfers';

/*
 * Airport pickup: what Hotelbeds has for the trip's landing, private and shared, each with its all-in price and rule.
 * In the beta a pick goes to the person on duty as a request with the supplier's rate: they book it and send the price
 * to pay here. Nothing is charged on this screen.
 */
export default function Pickup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const trip = useTrip(id).data?.trip;
  const q = useTransferOptions(id);
  // No endless spinner: no answer in GIVE_UP_MS, a failure, or no session each get an honest screen.
  const wait = useGiveUp(q, { key: id, queryKey: transferKeys.options(id), signedIn: useSession((s) => !!s.tokens) });
  // While the companies answer: the cars to come, and a line that says what is being done.
  const pickupLines = [t('waiting.pickup.0', { city: trip?.city ? nameIn(trip.city, getLocale()) : '' }), t('waiting.pickup.1'), t('waiting.pickup.2')];
  const waitLine = useStagedLine(pickupLines, STAGES_SHORT, !q.data ? `pickup-${id}` : null);
  const [pick, setPick] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const agent = agentName(trip?.agent);
  const d = q.data;
  const chosen: TransferOption | undefined = d?.options.find((o) => o.id === pick) ?? d?.options[0];

  async function send() {
    if (!chosen) return;
    setBusy(true);
    try {
      await transfersApi.choose(id, chosen.id, newKey());
      buzz('success');
      toast(t('pickup.sent', { agent }));
      setConfirm(false);
      await qc.invalidateQueries({ queryKey: transferKeys.options(id) });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    } catch (e) {
      toast(e instanceof Error ? e.message : t('pickup.down'));
    } finally { setBusy(false); }
  }

  if (!d && wait.view === 'loading') return <TripScreen title={t('pickup.title')}><View style={{ paddingTop: 8 }}><Waiting kind="pickup" line={waitLine} count={2} testID="pickup-loading" /></View></TripScreen>;
  if (!d && (wait.view === 'timeout' || wait.view === 'signin')) return <TripScreen title={t('pickup.title')}><WaitTrouble wait={wait} testID={`pickup-${wait.view}`} /></TripScreen>;
  if (q.isError || !d) {
    return (
      <TripScreen title={t('pickup.title')}>
        <EmptyState art={<ArtSuitcase />} title={t('pickup.down')} body="" action={<Button testID="pickup-retry" label={t('pickup.retry')} onPress={wait.retry} />} ideas={[[t('action.talk'), () => talkToMada()]]} />
      </TripScreen>
    );
  }
  const day = d.arrival ? dayLabel(d.arrival.slice(0, 10), { today: d.arrival.slice(0, 10) }) : '';
  const time = d.arrival?.slice(11, 16) ?? '';
  const where = d.airportName ?? d.airport ?? '';
  const hotel = d.hotel ?? trip?.city ?? '';

  if (d.outcome === 'requested' && d.request) {
    return (
      <TripScreen title={t('pickup.title')}>
        <Rise><T v="h1" accessibilityRole="header">{t('pickup.withAgent', { agent })}</T></Rise>
        <Rise step={1}><Box testID="pickup-requested"><Row><IconTile name="car" tone="gold" /><Small style={{ flex: 1 }}>{t('pickup.withAgentBody', { agent, vehicle: d.request.vehicle.toLowerCase() })}</Small></Row></Box></Rise>
        <Button testID="pickup-requests" variant="secondary" label={t('pickup.seeRequest')} onPress={() => router.push('/trips?tab=requests' as Href)} />
      </TripScreen>
    );
  }
  if (d.outcome === 'no_flight' || d.outcome === 'no_hotel' || d.outcome === 'none') {
    const title = d.outcome === 'no_flight' ? t('pickup.noFlight') : d.outcome === 'no_hotel' ? t('pickup.noHotel') : t('pickup.none');
    return (
      <TripScreen title={t('pickup.title')}>
        <EmptyState art={<ArtSuitcase />} title={title} body={d.outcome === 'none' ? t('pickup.noneBody') : ''}
          action={<Button testID="pickup-ask" label={t('pickup.ask')} onPress={() => router.push(`/trip/${id}/special` as Href)} />} />
      </TripScreen>
    );
  }
  return (
    <TripScreen title={t('pickup.title')} act={chosen ? <Button testID="pickup-choose" label={`${t('pickup.choose')} · ${formatSar(chosen.total.amount)}`} onPress={() => { buzz('tap'); setConfirm(true); }} /> : undefined}>
      <Rise><T v="h1" accessibilityRole="header">{t('pickup.title')}</T></Rise>
      <Rise step={1}>
        <Small style={{ marginTop: -8 }}>{t('pickup.sub', { airport: where, hotel, day, time })}</Small>
        <Tiny>{tn('pickup.people', d.people, { count: d.people })}</Tiny>
      </Rise>
      {d.options.map((o, i) => (
        <Rise key={o.id} step={i + 2}>
          <PickCard testID={`pickup-${o.kind}-${i}`} on={chosen?.id === o.id} onPress={() => setPick(o.id)} radio
            title={`${o.vehicle} · ${t(o.kind === 'private' ? 'pickup.private' : 'pickup.shared')}`}
            sub={[t(o.kind === 'private' ? 'pickup.privateSub' : 'pickup.sharedSub'), t('pickup.upTo', { n: o.maxPax }), o.minutes ? t('pickup.minutes', { n: o.minutes }) : null].filter(Boolean).join(' · ')}
            right={formatSar(o.total.amount)}
            note={o.refundable && o.freeCancelUntil ? t('pickup.freeCancel', { date: shortDay(o.freeCancelUntil) }) : t('pickup.noCancel')} />
        </Rise>
      ))}
      {chosen?.pickupNote ? <Box tone="cream" testID="pickup-meet"><Tiny style={{ writingDirection: 'ltr', textAlign: 'left' }}>{chosen.pickupNote}</Tiny></Box> : null}
      <Tiny>{t('pickup.note')}</Tiny>
      <Sheet visible={confirm} onClose={() => setConfirm(false)} label={t('pickup.sendTitle', { agent })}>
        <T v="h2">{t('pickup.sendTitle', { agent })}</T>
        {chosen ? (
          <Spread><H3 size={15} style={{ flex: 1 }}>{chosen.vehicle} · {t(chosen.kind === 'private' ? 'pickup.private' : 'pickup.shared')}</H3><Tag tone="gold" label={t('pickup.total', { amount: (chosen.total.amount / 100).toLocaleString('en-US') })} /></Spread>
        ) : null}
        <AgentNote initial={trip?.agent.initial}>{t('pickup.sendBody', { agent })}</AgentNote>
        <Button testID="pickup-send" label={t('pickup.send')} busy={busy} onPress={() => void send()} />
        <Button label={t('pickup.keep')} variant="secondary" onPress={() => setConfirm(false)} />
      </Sheet>
    </TripScreen>
  );
}
