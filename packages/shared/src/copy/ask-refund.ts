/**
 * Cancel and refund in Ask (refund_quote, docs/app/ASK-REFUND.md): the card's own words. The two places the money goes,
 * "You get back" and the tracker reuse the refund screen's words (rf.*), so the chat and the screen say the same thing.
 * Spread into the catalogue in en.ts; the Arabic is in ./ar/askRefund.ts.
 */
export const askRefundCopy = {
  'chat.refund.cancelling': 'Cancelling · {city}',
  'chat.refund.allBack': 'All of it comes back under the rules.',
  'chat.refund.kept.hotel': 'The hotel keeps {amount} under its cancellation rules.',
  'chat.refund.kept.airline': 'The airline keeps {amount} under the fare rules.',
  'chat.refund.kept.driver': 'The driver keeps {amount}: it’s inside 24 hours.',
  'chat.refund.kept.supplier': '{amount} isn’t refundable under the rules.',
  'chat.refund.slide': 'Cancel and refund {amount}',
  'chat.refund.nothingCancelled': 'Nothing is cancelled until you slide.',
  'chat.refund.failed': 'That didn’t go through, and nothing was cancelled. Slide again to try once more.',
  'chat.refund.state.wallet': 'In your Mada Wallet',
  'chat.refund.state.approved': 'Approved',
  'chat.refund.state.sent': 'Sent to your card',
  'chat.refund.state.waiting': 'Waiting for the team',
  'chat.refund.state.declined': 'Not refunded',
  'chat.refund.status': 'Checking what comes back',
} as const;
