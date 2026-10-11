import { requestLabel, type CopyKey, type TripRequestView } from '@mada/shared';
import { isRTL, t } from '@/lib/i18n';
import { useAgent } from '@/lib/trips';
import { Tag, Tracker } from './ui';

const OPEN = ['queued', 'sent', 'reviewing', 'with_agent', 'needs_answer'];

/** The pill on a request: "Sent to Mada", "Faisal is asking Saudia", "Confirmed by Saudia", "Can't do it". */
export function RequestStatusPill({ r }: { r: TripRequestView }) {
  const agent = useAgent();
  const stuck = orderNeedsYou(r);
  if (stuck) return <Tag label={stuck.status === 'ticketing_failed' ? t('rq.order.failed') : t('rq.order.answer')} tone="warn" style={{ flexShrink: 0 }} />;
  const tone = r.status === 'confirmed' || r.status === 'done' ? 'ok' : r.status === 'cancelled' && r.outcome === 'no' ? 'warn' : r.status === 'quoted' || r.status === 'awaiting_payment' ? 'gold' : 'default';
  return <Tag label={requestLabel(r, agent.name)} tone={tone} style={{ flexShrink: 0 }} />;
}

/** Sent → asking the airline or hotel → their answer. Hidden once it's done. */
export function RequestTracker({ r }: { r: TripRequestView }) {
  const agent = useAgent();
  if (!OPEN.includes(r.status) || orderNeedsYou(r)) return null;
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

/** The order a booking's request follows, when it's stopped and waiting for the traveller (tickets that didn't issue, a fare that changed, a question). */
export const orderNeedsYou = (r: TripRequestView) => (r.order && ['ticketing_failed', 'fare_changed', 'needs_answer'].includes(r.order.status) ? r.order : null);

/** Where a request card opens: the booking for an order, the thread for an Ask request, the trip for a trip's own ask. */
export function requestHref(r: TripRequestView): string {
  if (r.order) return `/waiting/${r.order.id}`;
  if (r.tripId && r.area !== 'other') return `/trip/${r.tripId}`;
  return `/ask/request/${r.id}`;
}

const WHAT: Record<string, CopyKey> = {
  visa: 'td.req.what.visa', 'Umrah trip': 'td.req.what.umrah', car: 'td.req.what.car', table: 'td.req.what.table', plans: 'td.req.what.plans',
  flights: 'td.req.what.flights', rooms: 'td.req.what.rooms', request: 'td.req.what.request', trip: 'td.req.what.trip', ride: 'td.req.what.ride', pickup: 'td.req.what.pickup',
};

/** "visa" in "Mada is working on your visa": the request's kind in the reader's language, or its own title as written. */
export function requestWhat(r: Pick<TripRequestView, 'short' | 'title' | 'order'>): string {
  const key = r.short ? WHAT[r.short] : undefined;
  if (key) return t(key);
  if (r.order) return t('td.req.what.booking');
  return isRTL() ? t('td.req.what.request') : r.short ?? r.title;
}
