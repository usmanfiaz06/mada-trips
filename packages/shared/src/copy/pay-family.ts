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
} as const;
