import { useState } from 'react';
import { serverNow } from '@/lib/net/clock';
import { formatSar, type RefundView } from '@mada/shared';
import { t } from '@/lib/i18n';
import { agentName, useAgent } from '@/lib/agent';
import { colors } from '@/theme';
import { AgentIntro, Box, Small, SmallButton, Tracker } from './ui';
import { OutcomeCard } from '@/components/outcome/Outcome';

/** Requested → Approved → Sent → In your bank. Credit is instant; instalments go back through Tabby; a no comes with a reason. */
export function RefundTracker({ r, onTalk }: { r: RefundView; onTalk?: () => void }) {
  const agent = agentName(useAgent());
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
  if (r.destination === 'credit') {
    return <Tracker items={[{ title: t('rf.tr.requested'), sub: t('rf.tr.today'), state: 'done' }, { title: t('rf.tr.approvedBy', { agent }), sub: t('rf.tr.today'), state: 'done' }, { title: t('rf.tr.inCredit', { amount: formatSar(r.amount.amount) }), sub: t('rf.tr.readyNow'), state: 'done' }]} />;
  }
  const stage = r.stage === 'requested' ? 0 : r.stage === 'approved' ? 1 : 2;
  const inBank = !!r.sentAt && now - Date.parse(r.sentAt) > 10 * 86_400_000;
  const tabby = r.destination === 'instalments';
  return (
    <Tracker items={[
      { title: t('rf.tr.requested'), sub: t('rf.tr.today'), state: 'done' },
      { title: r.law && r.airline ? t('rf.tr.approvedByAirline', { airline: r.airline }) : t('rf.tr.approvedBy', { agent }), sub: stage >= 1 ? t('rf.tr.today') : t('rf.tr.days13'), state: stage >= 1 ? 'done' : 'now' },
      { title: tabby ? t('rf.tr.sentProvider', { provider: r.provider === 'tamara' ? 'Tamara' : 'Tabby' }) : t('rf.tr.sentCard', { card: r.card }), sub: stage >= 2 ? (tabby && r.cancelledInstalments ? t('rf.tr.cancelledLeft', { n: r.cancelledInstalments.count }) : t('rf.tr.today')) : r.law ? t('rf.tr.law') : t('rf.tr.days714'), state: stage >= 2 ? 'done' : stage === 1 ? 'now' : '' },
      { title: tabby ? t('rf.tr.backOnCard') : t('rf.tr.inBank'), sub: inBank ? t('rf.tr.arrived') : t('rf.tr.afterSent'), state: inBank ? 'done' : stage >= 2 ? 'now' : '' },
    ]} />
  );
}
