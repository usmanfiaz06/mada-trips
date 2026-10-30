import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter, type Href } from 'expo-router';
import { serverNow } from '@/lib/net/clock';
import { formatSar, refundBankLate, shortDay, type RefundView } from '@mada/shared';
import { t } from '@/lib/i18n';
import { agentName, useAgent } from '@/lib/agent';
import { buzz } from '@/lib/haptics';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { AgentIntro, Box, Row, Small, SmallButton, TextLink, Tiny, Tracker } from './ui';
import { OutcomeCard } from '@/components/outcome/Outcome';

/**
 * Requested → Approved → Sent → In your bank. The Mada Wallet is instant; instalments go back through Tabby; a no comes
 * with a reason. Once a card refund is sent the step carries the bank's reference to copy, and after 10 working days
 * without it settling the traveller can tell us, with the refund already written out.
 */
export function RefundTracker({ r, onTalk }: { r: RefundView; onTalk?: () => void }) {
  const agent = agentName(useAgent());
  const router = useRouter();
  const [now] = useState(serverNow);
  if (r.anyway) {
    const decided = r.stage === 'rejected';
    return (
      <>
        <Tracker items={[
          { title: t('rf.tr.requested'), sub: t('rf.tr.today'), state: 'done' },
          { title: decided ? t('rf.tr.couldnt', { agent }) : t('rf.tr.asking', { agent }), sub: decided ? null : t('rf.tr.withinDay'), state: decided ? 'done' : 'now' },
        ]} />
        {decided && r.result ? (<>
          <OutcomeCard compact result={r.result} tripId={r.tripId} testID="refund-outcome" />
          {r.alt ? <Small color={colors.green}>“{r.alt}”</Small> : null}
        </>) : decided ? (
          <Box tone="well" gap={8}>
            <AgentIntro />
            {r.reject ? <Small color={colors.green}>“{r.reject}”</Small> : null}
            {r.alt ? <Small color={colors.green}>“{r.alt}”</Small> : null}
            {onTalk ? <SmallButton tone="primary" label={t('action.talk')} onPress={onTalk} /> : null}
          </Box>
        ) : null}
      </>
    );
  }
  const approvedTitle = r.auto ? t('rf.tr.approvedAuto') : r.law && r.airline ? t('rf.tr.approvedByAirline', { airline: r.airline }) : t('rf.tr.approvedBy', { agent });
  if (r.destination === 'credit') {
    const inWallet = r.stage === 'sent';
    return <Tracker items={[
      { title: t('rf.tr.requested'), sub: t('rf.tr.today'), state: 'done' },
      { title: inWallet ? approvedTitle : t('rf.tr.asking', { agent }), sub: inWallet ? t('rf.tr.today') : t('rf.tr.withinDay'), state: inWallet ? 'done' : 'now' },
      { title: t('rf.tr.inCredit', { amount: formatSar(r.amount.amount) }), sub: t('rf.tr.readyNow'), state: inWallet ? 'done' : '' },
    ]} />;
  }
  const stage = r.stage === 'requested' ? 0 : r.stage === 'approved' ? 1 : 2;
  const inBank = !!r.sentAt && now - Date.parse(r.sentAt) > 10 * 86_400_000;
  const late = refundBankLate(r, now);
  const tabby = r.destination === 'instalments';
  const ref = r.reference ?? null;
  const sentTitle = tabby ? t('rf.tr.sentProvider', { provider: r.provider === 'tamara' ? 'Tamara' : 'Tabby' }) : stage >= 2 && r.sentAt ? t('rf.tr.sentOn', { card: r.card, day: shortDay(r.sentAt.slice(0, 10)) }) : t('rf.tr.sentCard', { card: r.card });
  const copy = async () => {
    buzz('tap');
    try { await Clipboard.setStringAsync(ref ?? ''); toast(t('rf.tr.copied')); } catch { toast(ref ?? ''); }
  };
  const tell = () => router.push(`/support?topic=refund&text=${encodeURIComponent(t('rf.tr.stillNotAsk', { amount: formatSar(r.amount.amount), card: r.card, ref: ref ?? '-' }))}` as Href);
  return (
    <>
      <Tracker items={[
        { title: t('rf.tr.requested'), sub: t('rf.tr.today'), state: 'done' },
        { title: stage >= 1 ? approvedTitle : t('rf.tr.asking', { agent }), sub: stage >= 1 ? t('rf.tr.today') : t('rf.tr.withinDay'), state: stage >= 1 ? 'done' : 'now' },
        { title: sentTitle, sub: stage >= 2 ? (tabby && r.cancelledInstalments ? t('rf.tr.cancelledLeft', { n: r.cancelledInstalments.count }) : ref ? null : t('rf.tr.today')) : r.law ? t('rf.tr.law') : t('rf.tr.days510'), state: stage >= 2 ? 'done' : stage === 1 ? 'now' : '' },
        { title: tabby ? t('rf.tr.backOnCard') : t('rf.tr.inBank'), sub: inBank && !late ? t('rf.tr.arrived') : t('rf.tr.afterSent'), state: inBank && !late ? 'done' : stage >= 2 ? 'now' : '' },
      ]} />
      {stage >= 2 && ref ? (
        <Box tone="well" gap={6} testID="refund-reference">
          <Row gap={8}>
            <View style={{ flex: 1 }}><Small color={colors.green}><T v="small" color={colors.green} style={{ fontVariant: ['tabular-nums'] }}>{t('rf.tr.reference', { ref: `⁦${ref}⁩` })}</T></Small></View>
            <Pressable testID="copy-reference" accessibilityRole="button" accessibilityLabel={t('rf.tr.copyRef')} onPress={() => void copy()} hitSlop={10}><Icon name="doc" size={18} color={colors.green} /></Pressable>
          </Row>
          <Tiny>{t('rf.tr.bankNote')}</Tiny>
        </Box>
      ) : null}
      {late ? <TextLink testID="refund-still-not" label={t('rf.tr.stillNot')} onPress={tell} /> : null}
    </>
  );
}
