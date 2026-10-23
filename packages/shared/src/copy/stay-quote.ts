/**
 * Rooms the team priced by hand for a stay request: the card in Ask (hotel, dates, nights, room, board, total,
 * cancellation, Book · Not now), the push, and the cancellation rule on the pay sheet. Spread into the catalogue in
 * en.ts; the Arabic is in ./ar/stayQuote.ts. Boards read with stay.board.* (stays.ts).
 */
export const stayQuoteCopy = {
  'chat.stayQuote.lead.one': '{agent} at Mada found your room. Book it when you’re ready.',
  'chat.stayQuote.lead.other': '{agent} at Mada found {count} rooms. Pick the one you like.',
  'chat.stayQuote.option': 'Option {n}',
  'chat.stayQuote.nights.one': '1 night',
  'chat.stayQuote.nights.other': '{count} nights',
  'chat.stayQuote.guests.one': '1 guest',
  'chat.stayQuote.guests.other': '{count} guests',
  'chat.stayQuote.freeUntil': 'Free cancellation until {date}, {time} hotel time',
  'chat.stayQuote.book': 'Book',
  'chat.stayQuote.later': 'Not now',
  'chat.stayQuote.parked': 'It’s in your requests when you’re ready.',
  'chat.stayQuote.ended': 'This price has ended. Ask Mada to check it again.',
  'notify.stayQuote.title': 'Your room is priced',
  'notify.stayQuote.body': '{hotel} · {amount}. Book it in the chat.',
  'notify.stayQuotes.title': 'Rooms ready to book',
  'notify.stayQuotes.body': '{count} rooms in {city}, from {amount}.',
  'pay.rule.stayQuote': 'Free cancellation until {date}, {time} hotel time. After that the hotel charges for the stay.',
} as const;
