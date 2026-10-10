/**
 * What the agent desk (Mada Ops) sends to travellers: lines in the request thread, notifications and the words on
 * the waiting screen. COPY.md §1: when a person acted, the line is theirs ("I"), sent with their name and face;
 * when the system did, it is Mada ("we"). Spread into the catalogue in en.ts, so the copy lint covers every line.
 */
export const deskCopy = {
  // ───────────── desk: an order with the agent ─────────────
  'desk.order.held': "I'm holding your seats. Your tickets are next.",
  'desk.order.issued': "You're booked. Booking {ref}. Your tickets are in the Wallet.",
  'desk.order.priceChanged': 'The price moved to {amount} before I could book it. Nothing has been charged. Take the new price, or pick again.',
  'desk.order.priceChanged.reason': 'The airline changed the price at booking.',
  'desk.order.notIssued': "We couldn't book these tickets. Nothing was charged, and the hold on your card is released.",
  'desk.order.notIssued.next': 'Ask Mada and we will find the next best option.',
  'desk.order.question.waiting': '{agent} needs an answer before booking.',

  // ───────────── desk: quotes and requests ─────────────
  'desk.quote.sent': "Here's the price for each of you.",
  'desk.request.done': 'All done. Everything is in your trip.',
  'desk.checklist.title': 'What we need from you',

  // ───────────── desk: refunds ─────────────
  'desk.refund.approved.card': 'Your refund of {amount} is approved. It goes back to your {card}, usually in 5 to 10 days.',
  'desk.refund.approved.credit': 'Your refund of {amount} is approved and is in your Mada credit now.',
  'desk.refund.rejected': "We can't refund this one. {reason}",
  'desk.refund.instalments': 'Paid with {provider}: the remaining payments are cancelled, and what you paid comes back to your card.',

  // ───────────── desk: disruption ─────────────
  'desk.disruption.voucher': '{amount} in Mada credit for the trouble. It is in your account now.',

  // ───────────── desk: notifications ─────────────
  'notify.desk.question.title': 'Mada needs an answer',
  'notify.desk.question.body': '{agent}: {question}',
  'notify.desk.price.title': 'The price changed',
  'notify.desk.price.body': 'Nothing has been charged. Take the new price, or pick again.',
  'notify.desk.notIssued.title': "We couldn't book it",
  'notify.desk.notIssued.body': 'Nothing was charged. Ask Mada and we will find another way.',
  'notify.desk.quote.title': 'Your price is ready',
  'notify.desk.quote.body': '{agent} sent the price for {summary}.',
  'notify.desk.reply.title': 'Mada',
  'notify.desk.reply.body': '{agent}: {text}',
  'notify.desk.refund.title': 'Refund approved',
  'notify.desk.refund.body': '{amount} is on its way back to you.',
  'notify.desk.refundNo.title': 'About your refund',
  'notify.desk.refundNo.body': "We can't refund this one. Open it to see why.",
  'notify.desk.plan.title': 'A new plan for {flight}',
  'notify.desk.plan.body': '{agent}: {plan}',
} as const;
