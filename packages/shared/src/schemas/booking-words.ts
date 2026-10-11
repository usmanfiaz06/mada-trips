/**
 * What the traveller reads for a value that is stored in English: request-form answers ("Standard car"), needs, the
 * desk's by-hand flight lines. The stored value stays English, so the desk, Ops and old requests keep working; the
 * screen shows it in the traveller's language. A value with no entry is shown as it is (a name, a free answer).
 */
import { t, type CopyKey } from '../copy';
import type { Lang } from '../locale';

const WORDS: Readonly<Record<string, CopyKey>> = {
  Schengen: 'opt.schengen', UK: 'opt.uk', 'United States': 'opt.us', 'Somewhere else': 'opt.elsewhere',
  'Within a month': 'opt.withinMonth', 'In 1 to 3 months': 'opt.oneToThree', 'Not sure yet': 'opt.notSure',
  'This summer': 'opt.thisSummer', 'In the next 3 months': 'opt.nextThree',
  'In Ramadan': 'opt.ramadan', 'After Eid': 'opt.afterEid', 'Pick dates later': 'opt.datesLater',
  'Steps from the Haram': 'opt.nearHaram', 'Good value, short ride': 'opt.shortRide',
  Istanbul: 'opt.istanbul', Riyadh: 'opt.riyadh', '7 seats for the family': 'opt.sevenSeats', 'Standard car': 'opt.standardCar',
  '1 day': 'opt.oneDay', '3 days': 'opt.threeDays', 'The whole trip': 'opt.wholeTrip',
  'Istanbul, near the hotel': 'opt.istanbulHotel', Tonight: 'opt.tonight', Tomorrow: 'opt.tomorrow', 'First night of the trip': 'opt.firstNight',
  Halal: 'opt.halal', 'Family seating': 'opt.familySeating', 'A view': 'opt.view', Quiet: 'opt.quiet',
  'Bosphorus dinner cruise': 'opt.cruise', 'Princes’ Islands day trip': 'opt.islands', 'Topkapı Palace tickets': 'opt.topkapi', 'A food walk in Kadıköy': 'opt.foodWalk',
  'Wheelchair to the gate': 'need.wheelchairGate', 'Wheelchair to the seat': 'need.wheelchairSeat', 'Diabetic meal': 'need.diabetic',
  'Low-salt meal': 'need.lowSalt', 'Soft food': 'need.soft', 'Seat near the toilet': 'need.toilet', 'Travelling with oxygen': 'need.oxygen',
  'flynas direct on Thursdays and Sundays, 4h 05m': 'dq.hand.tbilisi', 'Saudia direct to Charles de Gaulle, 6h 50m': 'dq.hand.paris',
  'Saudia direct to Denpasar three times a week, 9h 40m': 'dq.hand.bali', 'Saudia direct to Malé, 5h 30m': 'dq.hand.maldives',
  'one stop, about 9 hours': 'dq.hand.other',
  // the server names a support conversation in English
  'Your account': 'support.aboutAccount',
  // Ask's newer chips (ask-flow.ts).
  Jeddah: 'request.opt.jeddah', Dubai: 'request.opt.dubai', Today: 'request.opt.today', 'This weekend': 'request.opt.thisWeekend', 'Next week': 'request.opt.nextWeek',
  'For my trip dates': 'request.opt.tripDates', 'Any day is fine': 'request.opt.anyDay', 'A car with a driver': 'request.opt.withDriver', 'A week': 'request.opt.aWeek',
};

/** A stored English value in the display language: "Standard car" → "سيارة عادية". */
export function wordFor(value: string, locale?: Lang): string {
  const k = WORDS[value];
  return k ? t(k, undefined, locale) : value;
}

/** "A, B, C" / "A، B، C". */
export function commaList(items: readonly string[], locale?: Lang): string {
  return items.length ? items.reduce((a, b) => t('list.comma', { a, b }, locale)) : '';
}

/** A list in the display language: "A, B and C" / "A، B وC". */
export function listOf(items: readonly string[], locale?: Lang): string {
  if (items.length < 2) return items[0] ?? '';
  return t('list.and', { a: commaList(items.slice(0, -1), locale), b: items.at(-1)! }, locale);
}
