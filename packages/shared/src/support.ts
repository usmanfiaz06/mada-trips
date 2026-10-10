import { t } from './copy';
import type { SupportCard, SupportIntent } from './schemas/wallet';

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
  };
  refund: null | { amount: number; title: string; stage: string; card: string };
  deskPhone: string;
};

export type SupportAsk =
  | { kind: 'intent'; intent: SupportIntent; text: string }
  | { kind: 'pick'; choice: string; label: string }
  | { kind: 'bag'; ref: string; to: string }
  | { kind: 'bagNone' };

/** Who answers on their own: urgent and airport help are fixed templates and always sent. */
export const isSafetyIntent = (i: SupportIntent) => i === 'urgent' || i === 'airport';

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
    if (ask.choice === 'refund') return [{ body: t('support.reply.pickedRefund'), card: { action: { label: t('support.reply.refundStart'), to: '/trips' } } }];
    return [{ body: t('support.reply.picked', { flight: ask.label.split(' · ')[0] ?? ask.label }), card: { resolved: true } }];
  }

  const text = ask.text.toLowerCase();
  const trip = ctx.trip;
  switch (ask.intent) {
    case 'urgent':
      return [{ body: t('support.reply.urgent', { phone: ctx.deskPhone }), card: { urgent: true, intent: 'urgent' } }];
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
      return [{ body: t('support.reply.free') }];
  }
}
