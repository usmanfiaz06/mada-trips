import { t, type CopyKey } from './copy';
import type { SupportCard, SupportIntent } from './schemas/wallet';
import { callbackBy, carNowAsk, problemIn, problemKey, problemOf, type DisruptionProblem } from './schemas/now-path';

/*
 * Instant answers from Mada (prototype Support.jsx `answer`), as one pure function the Core API and the app's mock
 * both use. Mada's voice ("we"); nothing claims to be done unless it was: rebooking and seats are "we're on it", and
 * a person confirms them (COPY.md §1). The caller supplies what it knows about the traveller's trip and refunds.
 */

export type SupportReply = { body: string; card?: SupportCard };

export type SupportContext = {
  trip: null | {
    id: string;
    bookingRef: string | null;
    /** The first flight's airline, or null when the trip has no flights. */
    airline: string | null;
    /** First names of the people travelling; `self` marks the account holder. */
    travellers: { name: string; self: boolean }[];
    /** Where the trip goes, for the disruption card ("your Istanbul trip"). */
    city?: string;
    /** Within 24 hours of the first flight, or under way (tripIsNow): urgent help opens the trip's disruption card. */
    now?: boolean;
  };
  refund: null | { amount: number; title: string; stage: string; card: string };
  deskPhone: string;
  /** The clock, for the call-back promise (tests pass one; defaults to now). */
  now?: number;
};

export type SupportAsk =
  | { kind: 'intent'; intent: SupportIntent; text: string }
  | { kind: 'pick'; choice: string; label: string }
  | { kind: 'bag'; ref: string; to: string }
  | { kind: 'bagNone' };

/** Who answers on their own: urgent, emergency and airport help are fixed templates and always sent. */
export const isSafetyIntent = (i: SupportIntent) => i === 'urgent' || i === 'emergency' || i === 'airport';
/** A choice on the disruption card: always answered, like the urgent message that opened it. */
export const isSafetyChoice = (choice: string) => problemOf(choice) !== null;

const PROBLEMS: readonly DisruptionProblem[] = ['delayed', 'cancelled', 'connection', 'hotel', 'docs', 'emergency', 'other'];
const NEXT: Partial<Record<DisruptionProblem, CopyKey>> = {
  delayed: 'support.dx.next.delayed', cancelled: 'support.dx.next.cancelled', connection: 'support.dx.next.connection', hotel: 'support.dx.next.hotel', docs: 'support.dx.next.docs',
};

/** Someone hurt or unsafe: 997 and 112 first, then Mada. The only answer that names emergency numbers. */
const emergency = (ctx: SupportContext): SupportReply => ({ body: t('support.reply.emergency', { phone: ctx.deskPhone }), card: { urgent: true, intent: 'emergency', emergency: true } });

/** The promise: who calls (Mada), by when, and what to do meanwhile. */
function callback(problem: DisruptionProblem | null, ctx: SupportContext): SupportReply {
  const next = problem ? NEXT[problem] : undefined;
  return {
    body: [t('support.reply.callback'), next ? t(next) : ''].filter(Boolean).join(' '),
    card: { urgent: true, intent: 'urgent', callback: { by: callbackBy(ctx.now ?? Date.now()), ...(problem ? { problem } : {}) } },
  };
}

export function supportReplies(ask: SupportAsk, ctx: SupportContext): SupportReply[] {
  if (ask.kind === 'bagNone') return [{ body: t('support.reply.bagNone') }];
  if (ask.kind === 'bag') {
    return [{
      body: t('support.reply.bagFiled', { ref: ask.ref }),
      card: {
        steps: [t('support.reply.bagStep1'), t(/hotel/i.test(ask.to) ? 'support.reply.bagStep2Hotel' : 'support.reply.bagStep2Home'), t('support.reply.bagStep3'), t('support.reply.bagStep4')],
        resolved: true,
      },
    }];
  }
  if (ask.kind === 'pick') {
    const problem = problemOf(ask.choice);
    if (problem === 'emergency') return [emergency(ctx)];
    if (problem) return [callback(problem, ctx)];
    if (ask.choice === 'refund') return [{ body: t('support.reply.pickedRefund'), card: { action: { label: t('support.reply.refundStart'), to: '/trips' } } }];
    return [{ body: t('support.reply.picked', { flight: ask.label.split(' · ')[0] ?? ask.label }), card: { resolved: true } }];
  }

  const text = ask.text.toLowerCase();
  const trip = ctx.trip;
  switch (ask.intent) {
    case 'emergency':
      return [emergency(ctx)];
    case 'urgent': {
      // Said already ("my flight is cancelled"): straight to the promise. A trip under way or within 24 hours: the
      // trip's disruption card, so Mada knows what's wrong before calling. 997 only when it's someone's safety.
      const named = problemIn(ask.text);
      if (named === 'emergency') return [emergency(ctx)];
      // A car nobody could find in the app: Mada finds one by hand and calls.
      if (/\bcar\b|\btaxi\b|سيارة|تاكسي/i.test(ask.text)) return [callback(null, ctx)];
      if (named) return [callback(named, ctx)];
      if (trip?.now) {
        return [{
          body: t('support.reply.urgentTrip', { city: trip.city ?? '' }),
          card: { urgent: true, intent: 'urgent', disruption: { tripId: trip.id, city: trip.city ?? '' }, choices: PROBLEMS.map((p) => ({ key: problemKey(p), label: t(`support.dx.${p}` as CopyKey) })) },
        }];
      }
      const cb = callback(null, ctx);
      return [{ ...cb, body: t('support.reply.urgent'), card: { ...cb.card, choices: [{ key: problemKey('emergency'), label: t('support.dx.emergency') }] } }];
    }
    case 'airport':
      return [{ body: t('support.reply.airport'), card: { urgent: true, intent: 'airport' } }];
    case 'bag':
      return [{ body: t('support.reply.bag'), card: { form: 'bag', intent: 'bag' } }];
    case 'missed':
      if (trip?.airline) {
        return [{
          body: t('support.reply.missedTrip'),
          card: { intent: 'missed', choices: [{ label: 'Saudia SV265 · leaves 13:30', key: 'sv265' }, { label: 'flynas XY125 · leaves 10:25', key: 'xy125' }, { label: t('support.reply.leaveLater'), key: 'refund' }] },
        }];
      }
      return [{ body: t('support.reply.missed') }];
    case 'refund':
      if (/twice|double|charged|deducted/.test(text)) {
        return [{ body: trip?.bookingRef ? t('support.reply.refundTwiceRef', { ref: trip.bookingRef }) : t('support.reply.refundTwice') }];
      }
      if (ctx.refund) return [{ body: t('support.reply.refundLatest'), card: { refund: ctx.refund, action: { label: t('support.reply.refundAnother'), to: '/trips' } } }];
      return [{ body: t('support.reply.refundNone'), card: { action: { label: t('support.reply.refundStart'), to: '/trips' } } }];
    case 'seat': {
      if (!trip?.airline) return [{ body: t('support.reply.seatNoTrip') }];
      const names = trip.travellers.filter((p) => p.name);
      const who = names.find((p) => new RegExp(`\\b${p.name.toLowerCase()}\\b`).test(text)) ?? names.find((p) => p.self) ?? names[0];
      const other = names.find((p) => p !== who);
      return [{
        body: t('support.reply.seat', {
          airline: trip.airline,
          seat: t(/window/.test(text) ? 'support.reply.seatWindow' : 'support.reply.seatAisle'),
          next: other ? t('support.reply.seatNext', { name: other.name }) : '',
        }),
      }];
    }
    case 'change':
      return [{ body: t('support.reply.change'), ...(trip ? { card: { action: { label: t('support.reply.changeFlight'), to: `/trips/${trip.id}` } } } : {}) }];
    case 'docs':
      return [{ body: t('support.reply.docs') }];
    case 'other':
      return [{ body: t('support.reply.other') }];
    case 'photo':
      return [{ body: t('support.reply.photo') }];
    default:
      // "I need a car now": the car-now flow, which never offers tomorrow.
      if (carNowAsk('', ask.text)) return [{ body: t('support.reply.carNow'), card: { action: { label: t('now.car.send'), to: `/ask?prefill=${encodeURIComponent(ask.text)}` } } }];
      return [{ body: t('support.reply.free') }];
  }
}
