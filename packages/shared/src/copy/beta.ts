/**
 * The beta: flights by request (where and when → fares from the desk → pay → tickets), a contact number for accounts
 * without a verified phone, files from the desk in a conversation, and a Circles pause set on the desk.
 * Spread into the catalogue in en.ts, so the copy lint covers every line. Arabic: ./ar/beta.ts.
 */
export const betaCopy = {
  // ───────────── flights by request: the form ─────────────
  'beta.fr.title': 'Tell us where and when',
  'beta.fr.body': 'Someone at Mada finds the fares and holds the best ones for you. Your options arrive here, usually within the hour.',
  'beta.fr.route': '{from} to {to}',
  'beta.fr.oneWay': '{date}, one way',
  'beta.fr.travellers.one': '1 traveller',
  'beta.fr.travellers.other': '{count} travellers',
  'beta.fr.flex.title': 'Can you move your dates?',
  'beta.fr.flex.0': 'Exact dates',
  'beta.fr.flex.1': '1 day either side',
  'beta.fr.flex.3': '3 days either side',
  'beta.fr.bags.title': 'Bags, each',
  'beta.fr.bags.cabin': 'Cabin bag only',
  'beta.fr.bags.one': 'One checked bag',
  'beta.fr.bags.two': 'Two checked bags',
  'beta.fr.cabin.title': 'Cabin',
  'beta.fr.prefs.title': 'Anything you’d like',
  'beta.fr.pref.direct': 'Direct only',
  'beta.fr.pref.morning': 'Morning flights',
  'beta.fr.pref.evening': 'Evening flights',
  'beta.fr.pref.saudia': 'Saudia',
  'beta.fr.pref.together': 'Seats together',
  'beta.fr.pref.aisle': 'Aisle seats',
  'beta.fr.note.label': 'Anything else',
  'beta.fr.note.hint': 'A loyalty number, a meal, a time that suits you',
  'beta.fr.send': 'Send to Mada',
  'beta.fr.change': 'Change',
  // The request's one-line summary, made on the server in the traveller's language.
  'beta.fr.sum.flex': '±{count} days',
  'beta.fr.sum.exact': 'Exact dates',

  // ───────────── flights by request: the fares from the desk ─────────────
  'beta.fq.lead.one': 'I found this fare and I’m holding it for you.',
  'beta.fq.lead.other': 'I found {count} fares and I’m holding them for you.',
  'beta.fq.choose': 'Choose this one',
  'beta.fq.chosen': 'Chosen',
  'beta.fq.direct': 'Direct',
  'beta.fq.stops.one': '1 stop',
  'beta.fq.stops.other': '{count} stops',
  'beta.fq.out': 'Going',
  'beta.fq.back': 'Coming back',
  'beta.fq.bags': 'Bags',
  'beta.fq.change': 'Changes',
  'beta.fq.refund': 'Refund',
  'beta.fq.each': 'Per person',
  'beta.fq.total': 'All in',
  'beta.fq.held': 'Held for {time}',
  'beta.fq.heldUntil': 'Held until {time}',
  'beta.fq.ended': 'This hold has ended. Ask {agent} to check the fare again.',
  'beta.fq.pay': 'Pay {price}',
  'beta.fq.another': 'Ask for another option',
  'beta.fq.anotherText': 'Could you look for another option?',
  'beta.fq.checkAgain': 'Could you check the fare again?',
  'beta.fq.paid': 'Paid. {agent} is issuing your tickets.',
  'beta.fq.ticketed': 'Ticketed. Your trip is in Trips.',

  // ───────────── a contact number at payment (no verified phone yet) ─────────────
  'beta.contact.title': 'A number to reach you',
  'beta.contact.body': 'We call this number if anything about the booking changes. Saudi or international.',
  'beta.contact.label': 'Phone number',
  'beta.contact.hint': '05X XXX XXXX or +44 7…',
  'beta.contact.invalid': 'Check the number. Add the country code if it isn’t Saudi.',
  'beta.contact.note': 'You can verify your phone in Profile any time.',
  'beta.contact.needed': 'Add a number to reach you first.',

  // ───────────── the trip: tickets ─────────────
  'beta.trip.tickets': 'Tickets',
  'beta.trip.ticket': 'Ticket {number}',
  'beta.trip.pnr': 'Airline booking {ref}',

  // ───────────── files from the desk ─────────────
  'beta.file.open': 'Open',
  'beta.file.pdf': 'PDF · {size}',
  'beta.file.photo': 'Photo · {size}',
  'beta.file.gone': 'This file isn’t available now. Ask Mada to send it again.',

  // ───────────── Circles paused on the desk ─────────────
  'beta.limited.title': 'Circles is paused for you',
  'beta.limited.body': 'Posting and messages in Circles are paused on your account. Talk to Mada if this looks wrong.',
  'error.accountLimited': 'Posting and messages in Circles are paused on your account. Talk to Mada if this looks wrong.',

  // ───────────── messages that leave the app ─────────────
  'notify.export.title': 'Your copy is ready',
  'notify.export.body': 'We emailed you a link to everything we hold. It works for 7 days.',
  'notify.quoteEnded.title': 'Your held fare ended',
  'notify.quoteEnded.body': 'Ask {agent} to check the price again. Nothing was charged.',
  'beta.quote.ended': 'The hold on this price ended. Ask me and I’ll check it again.',
  'notify.orderStopped.title': 'Your payment didn’t finish',
  'notify.orderStopped.body': 'Nothing was charged. Try again when you’re ready.',
} as const;
