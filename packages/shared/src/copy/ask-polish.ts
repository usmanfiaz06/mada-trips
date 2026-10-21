/**
 * Cross-feature polish (docs/app/ASK-INTEGRATED.md §11 U9): Today's cards from the plan (pickup, check-in, drive day,
 * what's left before the trip), the payer's card for a companion's change that needs booking, and the pushes for a
 * price ready on a plan item and a plan check that needs a look. Spread into the catalogue in en.ts; the Arabic is in
 * ./ar/askPolish.ts.
 */
export const askPolishCopy = {
  // Today, from the plan
  'tp.when.today': 'Today',
  'tp.when.tomorrow': 'Tomorrow',
  'tp.when.inDays': 'In {n} days',
  'tp.pickup': 'Car at {time}, {place}',
  'tp.pickupTime': 'Car at {time}',
  'tp.pickupPlace': 'Your car, {place}',
  'tp.carCollect': 'Pick up the car at {time}, {place}',
  'tp.carCollectPlace': 'Pick up the car, {place}',
  'tp.carCollectAny': 'Pick up the car',
  'tp.checkin': 'Check in at {hotel}',
  'tp.drive': '{duration} to {place}, leave by {time}',
  'tp.driveNoTime': '{duration} to {place}',
  'tp.todo.title': 'Before you go',
  'tp.todo.passportsWarn': 'Passport to renew: {names}',
  'tp.todo.passportsMissing': 'Passport to add: {names}',
  'tp.open': 'Open the plan',
  // A companion's change that needs booking, on the payer's phone
  'chat.payChange.title': '{name}’s change needs booking',
  'chat.payChange.pricing': 'We’re getting the price. Back by {time}.',
  'chat.payChange.book': 'Book',
  'chat.payChange.later': 'Not now',
  'chat.payChange.parked': 'It’s on the plan when you’re ready.',
  'people.line.needsBooking': '{name}’s change needs booking. We’re getting the price.',
  'people.line.priced': 'The price for {name}’s change is in.',
  // The desk changed the plan (§3.6): a visible line in the traveller's chat
  'plan.line.desk': 'The team at Mada updated your plan: {title}.',
  // Pushes
  'notify.planQuote.title': 'Price ready',
  'notify.planQuote.body': '{what} for {trip}: {amount}',
  'notify.planPayChange.title': '{name}’s change needs booking',
  'notify.planPayChange.body': '{trip} · {amount}. Book it when you’re ready.',
  'notify.planCheck.title': 'Before your trip',
  'notify.planCheck.passports.body': '{names}: passport to renew for {trip}.',
  'notify.planCheck.body': '{trip}: one thing needs a look.',
} as const;
