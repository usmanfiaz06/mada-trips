/**
 * Waiting on a search, said as it happens (components/states/Waiting.tsx): a line that moves on with the clock and
 * names what is really being done, never a bare spinner. Index 0 shows at once, the next ones at about 3 s, 8 s and
 * 14 s. The give-up lines come with a way on. Also the Ask chat's richer cards (request, trips, handoff, pay).
 * Spread into the catalogue in en.ts.
 */
export const waitingCopy = {
  // ───────────── hotels ─────────────
  'waiting.stays.0': 'Asking hotels in {city} for {dates}',
  'waiting.stays.1': 'Comparing rooms and prices',
  'waiting.stays.2': 'Checking which ones cancel free',
  'waiting.stays.3': 'Still going, a few hotels answer slowly',
  // ───────────── flights ─────────────
  'waiting.flights.0': 'Checking flights to {city} for {dates}',
  'waiting.flights.1': 'Comparing times and fares',
  'waiting.flights.2': 'Putting the easiest ones first',
  'waiting.flights.3': 'Still going, a few airlines answer slowly',
  // ───────────── eSIM ─────────────
  'waiting.esim.0': 'Finding internet plans for {where}',
  'waiting.esim.1': 'Picking the best value for {days}',
  'waiting.esim.2': 'Still going, a few plans answer slowly',
  // ───────────── an airport pickup ─────────────
  'waiting.pickup.0': 'Asking for cars to meet you in {city}',
  'waiting.pickup.1': 'Comparing cars and prices',
  'waiting.pickup.2': 'Still going, a few companies answer slowly',
  // ───────────── things to do ─────────────
  'waiting.things.0': 'Finding things to do in {city}',
  'waiting.things.1': 'Picking the ones that fit your days',
  'waiting.things.2': 'Still going, a few places answer slowly',
  // ───────────── the Ask chat, after Mada's own line ─────────────
  'waiting.chat.1': 'Comparing what came back',
  'waiting.chat.2': 'Still on it',
  'waiting.chat.3': 'Still going, some answers come slowly',
  /** One true thing while waiting, only when the app already knows it. */
  'waiting.fact.time': 'It’s {time} in {city} right now',
  /** For screen readers, once per change. */
  'waiting.a11y': 'Still looking. {line}',
  // ───────────── when it gives up ─────────────
  'waiting.gaveUp.stays.title': 'The hotels are slow to answer right now',
  'waiting.gaveUp.stays.body': 'Nothing is lost. Try again, or Mada finds the rooms for you and gets back to you.',
  'waiting.gaveUp.flights.title': 'The airlines are slow to answer right now',
  'waiting.gaveUp.flights.body': 'Nothing is lost. Try again, or Mada finds the flights for you and gets back to you.',
  'waiting.gaveUp.find': 'Ask Mada to find it for you',

  // ───────────── the Ask chat's cards ─────────────
  /** The request card: where it stands, and what was asked, written out. */
  'chat.request.status': 'With the team · back by {time}',
  'chat.request.statusOpen': 'With the team',
  'chat.request.what': 'What',
  'chat.request.where': 'Where',
  'chat.request.when': 'When',
  'chat.request.who': 'Who',
  'chat.who.justYou': 'Just you',
  'chat.who.youAnd': 'You and {names}',
  'chat.trip.open': 'Open the trip',
  'chat.handoff.card': 'A person at Mada has it from here',
  'chat.handoff.cardNamed': '{agent} at Mada has it from here',
  'chat.pay.line': 'Nothing is charged until you confirm',
  'chat.car.line': 'You confirm the meeting point before the car is booked',
} as const;
