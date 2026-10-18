/**
 * Booking, pay, hotel, money and family (CRITIQUE-2 #1, #4, #9, #10, #13, #19): a passport Mada renews while the
 * booking goes ahead, the hotel page, the family lines on the order sheet, one list of payment methods, and what
 * the rules give you on refunds and changes.
 */
export const payFamilyCopy = {
  // ───────────── a passport too short for the trip (#1) ─────────────
  'rn.eyebrow': 'What Mada does',
  'rn.step': 'Renew {name}’s passport',
  'rn.by': 'Ready by {date}',
  'rn.cost': '{price} for Mada to do it. The passport fee is paid on Absher.',
  'rn.book': 'Book now, Mada renews it by {date} · {price}',
  'rn.alongside': 'Your seats are booked now. The renewal runs alongside, and Mada tells you the day it’s ready.',
  'rn.late': 'A renewal takes about {days} days, so it’s ready {date}: too close to the flight.',
  'rn.lateNext': 'Pick later dates, or book without {name}.',
  'rn.asking': 'Asking Mada…',
  'rn.onIt': 'Mada is renewing it',
  'rn.renewingLine': 'Mada is renewing it. Ready by {date}.',
  'rn.pill': 'Renewing',
  'entry.passport.renewing': 'Mada is renewing {name}’s passport. Ready by {date}.',
  'rn.without': 'Book without {name}',
  'rn.payNote': 'Mada asks for the renewal with this booking. The {price} is paid on its own, once Mada has the appointment.',

  // ───────────── the family on the order sheet (#10) ─────────────
  'pf.title': 'For the family',
  'pf.bags': 'Bags {bags} each',
  'pf.bassinet.one': 'bassinet requested',
  'pf.bassinet.other': '{count} bassinets requested',
  'pf.meals': 'child meals × {count}',
  'pf.adultFare': '{name}, {age}: airlines charge 12 and over as adults.',
  'party.childrenHintFare': 'Up to 17, an age each. Airlines charge 12 and over as adults.',
  'party.adultAge': 'Airlines charge 12 and over as adults.',

  // ───────────── one list of payment methods (#13) ─────────────
  'pm.saved': 'Saved card',
  'pm.usedHere': 'Used on this trip · not saved',
  'pm.usedBefore': 'Used {date} · not saved',
  'pm.walletUsed': 'None saved · {label} used before',

  // ───────────── what the rules give you, on refunds and changes (#19) ─────────────
  'gr.ifAirline': 'If {airline} cancels, or moves your flight by more than 3 hours:',
  'gr.ifAirlineBody': 'the next flight or a full refund, your choice, even on a fare that says non-refundable.',
  'gr.within24': 'Booked {hours} hours ago.',
  'gr.within24Body': 'Some airlines cancel free within 24 hours of booking when the flight is a week or more away. Mada asks {airline} first, before any fee.',
  'gr.yours': 'Cancelling because your plans changed:',
  'gr.yoursBody': 'the {airline} fare rules above apply. Mada never adds a fee of its own.',
  'gr.yoursChange': 'Changing because your plans changed:',
  'gr.yoursChangeBody': 'the {airline} change fee above applies, plus any difference in fare. Mada never adds a fee of its own.',

  // ───────────── the hotel page and the bundle card (#9) ─────────────
  'hp.stay': 'This stay',
  'hp.rooms.one': '{room} · 1 room',
  'hp.rooms.other': '{room} × {count} rooms',
  'hp.connecting': 'Connecting rooms, side by side',
  'hp.roomPlain': 'A room',
  'hp.perNight': '{price} a night, for all of you',
  'hp.total.one': '1 night · {price} in all',
  'hp.total.other': '{count} nights · {price} in all',
  'hp.rating': 'Guests rate it {rating}',
  'hp.cancelWeek': 'Free to cancel until a week before you arrive',
  'hp.included': 'Included',
  'hp.pickup': 'Airport pickup both ways',
  'hp.line.room': '{room} · {board}',
  'hp.line.price': '{price} a night · free to cancel until {date}',
  'hp.line.priceNoDate': '{price} a night · free to cancel a week before',
} as const;
