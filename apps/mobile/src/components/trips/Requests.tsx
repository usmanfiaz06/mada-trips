import { requestLabel, type TripRequestView } from '@mada/shared';
import { t } from '@/lib/i18n';
import { useAgent } from '@/lib/trips';
import { Tag, Tracker } from './ui';

const OPEN = ['queued', 'sent', 'reviewing', 'with_agent', 'needs_answer'];

/** The pill on a request: "Sent to Mada", "Faisal is asking Saudia", "Confirmed by Saudia", "Can't do it". */
export function RequestStatusPill({ r }: { r: TripRequestView }) {
  const agent = useAgent();
  const tone = r.status === 'confirmed' || r.status === 'done' ? 'ok' : r.status === 'cancelled' && r.outcome === 'no' ? 'warn' : r.status === 'quoted' || r.status === 'awaiting_payment' ? 'gold' : 'default';
  return <Tag label={requestLabel(r, agent.name)} tone={tone} style={{ flexShrink: 0 }} />;
}

/** Sent → asking the airline or hotel → their answer. Hidden once it's done. */
export function RequestTracker({ r }: { r: TripRequestView }) {
  const agent = useAgent();
  if (!OPEN.includes(r.status)) return null;
  const who = r.withName ?? t(`trip.with.${r.withWhom}`);
  const asking = r.status === 'reviewing' || r.status === 'with_agent';
  return (
    <Tracker items={[
      { title: r.status === 'queued' ? t('rq.tr.savedPhone') : t('rq.sent'), sub: r.status === 'queued' ? t('td.req.queued') : t('rf.tr.today'), state: r.status === 'queued' ? 'now' : 'done' },
      { title: r.withWhom === 'faisal' ? t('rq.onIt', { agent: agent.name }) : t('rq.asking', { agent: agent.name, who }), sub: asking ? t('rq.tr.withinHour') : null, state: asking ? 'now' : '' },
      { title: r.withWhom === 'faisal' ? t('rq.done') : t('rq.confirmedBy', { who }), sub: null, state: '' },
    ]} />
  );
}
