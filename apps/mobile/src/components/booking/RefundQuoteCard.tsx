import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatSar, nameIn, type ChatCard, type RefundView } from '@mada/shared';
import { Button } from '@/components/Button';
import { Pill } from '@/components/Pill';
import { PayMark } from '@/components/PayMark';
import { SlideToConfirm } from '@/components/SlideToConfirm';
import { RefundTracker } from '@/components/trips/RefundTracker';
import { Box, H3, Num, PickCard, Row, Small, Tiny } from '@/components/trips/ui';
import type { IconName } from '@/components/Icon';
import { agentName, useAgent } from '@/lib/agent';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { kvReadJson, kvWriteJson } from '@/lib/net/kv';
import { toTab, tripsApi, useTripMutation, useTrips } from '@/lib/trips';
import { usePayMethods } from '@/lib/wallet';
import { colors } from '@/theme';
import { Frame, Line } from './PeopleFrame';

/*
 * Cancel and refund in the chat (refund_quote, docs/app/ASK-REFUND.md): what is cancelled, "You get back SAR X" big,
 * what the hotel or airline keeps in one line, and the refund screen's two places for the money: the Mada Wallet first,
 * chosen and Recommended ("instantly" only when the rules approve it at once), or back to the card in 5–10 working days.
 * Nothing is cancelled until the slide, which calls the refund screen's own POST with the card's key, so a second slide
 * finds the same refund. Then the card is the tracker: in the Mada Wallet, approved, or waiting for the team.
 */

type RefundQuoteChatCard = Extract<ChatCard, { type: 'refund_quote' }>;
/** The refund each card's slide made, kept on this phone so the card opens on its tracker. */
const DONE_KEY = 'mada.askRefund.done.v1';
const doneMap = async () => (await kvReadJson<Record<string, string>>(DONE_KEY)) ?? {};

const ICON: Record<string, IconName> = { stay: 'stay', flight: 'flight', pickup: 'car', extra: 'sim' };
const providerName = (p: string | null) => (p === 'tamara' ? 'Tamara' : 'Tabby');

/** Where it stands, in a word: in the Mada Wallet, approved, sent, waiting for the team, or not refunded. */
function stateOf(r: RefundView): { text: string; variant: 'ok' | 'gold' | 'default' } {
  if (r.stage === 'rejected') return { text: t('chat.refund.state.declined'), variant: 'default' };
  if (r.stage === 'requested') return { text: t('chat.refund.state.waiting'), variant: 'gold' };
  if (r.destination === 'credit') return { text: t('chat.refund.state.wallet'), variant: 'ok' };
  return r.stage === 'approved' ? { text: t('chat.refund.state.approved'), variant: 'ok' } : { text: t('chat.refund.state.sent'), variant: 'ok' };
}

export function RefundQuoteCard({ card }: { card: RefundQuoteChatCard }) {
  const router = useRouter();
  const locale = getLocale();
  const agent = agentName(useAgent());
  const pm = usePayMethods();
  const list = useTrips();
  const [dest, setDest] = useState<'credit' | 'original'>('credit');
  const [done, setDone] = useState<RefundView | null>(card.refund);
  const [problem, setProblem] = useState(false);
  const create = useTripMutation((d: 'credit' | 'original') => tripsApi.refund(card.tripId, { paymentIds: card.paymentIds, reason: card.reason, destination: d, clientKey: card.clientKey }));
  // A card slid earlier opens on its tracker.
  useEffect(() => {
    if (card.refund) return;
    void doneMap().then((m) => { const id = m[card.clientKey]; if (id) void tripsApi.refundOne(id).then((r) => setDone((x) => x ?? r.refund)).catch(() => {}); });
  }, [card.clientKey, card.refund]);
  const live = done ? list.data?.refunds.find((r) => r.id === done.id) ?? done : null;
  const icon = ICON[card.items[0] ?? ''] ?? 'refund';
  const sub = t('chat.refund.cancelling', { city: nameIn(card.city, locale) });
  const amount = formatSar(card.back.amount);

  if (live) {
    const st = stateOf(live);
    const inWallet = !live.anyway && live.destination === 'credit' && live.stage === 'sent';
    const waiting = !live.anyway && live.stage === 'requested';
    const said = formatSar(live.amount.amount);
    return (
      <Frame icon={icon} title={card.title} sub={sub} testID="chat-refund-done"
        pill={<View testID="chat-refund-state"><Pill label={st.text} variant={st.variant} style={{ marginTop: 2, alignSelf: 'flex-start' }} /></View>}>
        <H3 size={15}>{live.anyway ? t('rf.sent.anyway') : waiting ? t('rf.sent.looking') : inWallet ? t('rf.sent.credit', { amount: said }) : t('rf.sent.card', { amount: said })}</H3>
        <RefundTracker r={live} />
        <Button size="small" variant={inWallet ? 'primary' : 'secondary'} label={inWallet ? t('rf.openWallet') : t('rf.seeTrips')} style={{ height: 44, backgroundColor: inWallet ? undefined : colors.mist }}
          onPress={() => { buzz('tap'); toTab(router, inWallet ? '/wallet?credit=1' : '/trips?tab=requests'); }} testID={inWallet ? 'chat-refund-wallet' : 'chat-refund-trips'} />
      </Frame>
    );
  }

  const slide = () => {
    setProblem(false);
    create.mutate(card.instalments || card.anyway ? 'original' : dest, {
      onSuccess: (r) => {
        buzz('success');
        setDone(r.refund);
        void doneMap().then((m) => kvWriteJson(DONE_KEY, Object.fromEntries([...Object.entries(m), [card.clientKey, r.refund.id]].slice(-50))));
      },
      onError: () => { buzz('warn'); setProblem(true); },
    });
  };
  const keptLine = card.kept && card.keptBy ? t(`chat.refund.kept.${card.keptBy}`, { amount: formatSar(card.kept.amount) }) : card.anyway ? t('rf.sumAnyway', { agent }) : t('chat.refund.allBack');
  return (
    <Frame icon={icon} title={card.title} sub={sub} testID="chat-refund-quote">
      {!card.anyway ? (
        <View style={{ gap: 2 }}>
          <Small>{t('rf.youGet')}</Small>
          <View testID="chat-refund-amount"><Num size={34}>{amount}</Num></View>
        </View>
      ) : null}
      <Line icon={card.kept ? 'doc' : card.anyway ? 'bell' : 'check'} text={keptLine} testID="chat-refund-kept" />
      {card.anyway ? null : card.instalments ? (
        <Box tone="well" gap={6}>
          <Row><PayMark brand={card.instalments} size={22} /><H3 size={15}>{t('rf.backThrough', { provider: providerName(card.instalments) })}</H3></Row>
          <Small>{t('rf.backThroughBody')}</Small>
        </Box>
      ) : (
        <View style={{ gap: 10 }} accessibilityRole="radiogroup">
          <PickCard radio testID="chat-refund-credit" on={dest === 'credit'} onPress={() => { buzz('tap'); setDest('credit'); }}
            title={card.walletInstant ? t('rf.toCredit') : t('rf.toCreditWait')} sub={card.walletInstant ? t('rf.toCreditSub') : t('rf.toCreditWaitSub')} badge={t('rf.recommended')} />
          <PickCard radio testID="chat-refund-card" on={dest === 'original'} onPress={() => { buzz('tap'); setDest('original'); }}
            title={t('rf.toCard', { card: card.card })} sub={pm.isCard(card.card) ? `${t('rf.toCardSub')} ${pm.isSaved(card.card) ? t('pm.saved') : t('pm.usedHere')}.` : t('rf.toCardSub')} />
        </View>
      )}
      <View testID="chat-refund-slide">
        <SlideToConfirm compact busy={create.isPending} label={card.anyway ? t('rf.slide.anyway') : t('chat.refund.slide', { amount })} onConfirm={slide} />
      </View>
      {problem ? <Line icon="bell" text={t('chat.refund.failed')} testID="chat-refund-failed" /> : <Tiny color={colors.ink3}>{t('chat.refund.nothingCancelled')}</Tiny>}
    </Frame>
  );
}
