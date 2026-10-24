import { describe, expect, it } from 'vitest';
import {
  bannedIn, bundleFor, calendarMonths, cardBrandOf, cardProblems, checkPromo, deskFirstReply, deskQuote, deskReply, requestText, requestTitle, wordFor, entryChecks, eventIn, fareSar, luhnOk, parseAskRules, quickDates, seatsFor,
  weekendDates, weekendLine, type Person,
} from '../src';

const TODAY = '2026-10-10';
const person = (id: string, firstName: string, relation: Person['relation'], extra: Partial<Person> = {}): Person => ({
  id, isSelf: relation === 'self', givenNames: firstName, surname: 'Alharbi', firstName, relation, dateOfBirth: null, sex: null, nationality: null, passport: null, createdAt: '2026-01-01T00:00:00Z', ...extra,
});
const pp = (expiry: string, nationality = 'SAU') => ({ numberMasked: 'A11•••07', issuingCountry: nationality, nationality, expiry, source: 'scan' as const, updatedAt: '2026-01-01T00:00:00Z' });
const OMAR = person('00000000-0000-4000-8000-000000000001', 'Omar', 'self', { passport: pp('2031-06-22') });
const HESSA = person('00000000-0000-4000-8000-000000000002', 'Hessa', 'spouse', { passport: pp('2029-01-15') });
const SARA = person('00000000-0000-4000-8000-000000000003', 'Sara', 'child', { dateOfBirth: '2013-05-12', passport: pp('2027-08-14') });
const AHMED = person('00000000-0000-4000-8000-000000000004', 'Ahmed', 'child', { dateOfBirth: '2016-09-03', passport: pp('2030-03-21') });
const LINA = person('00000000-0000-4000-8000-000000000005', 'Lina', 'helper', { passport: pp('2028-11-02', 'PHL') });
const FAMILY = [OMAR, HESSA, SARA, AHMED, LINA];

describe('reading what people type', () => {
  it('finds the place, dates, cabin and people', () => {
    const a = parseAskRules('One way business to Istanbul on 20 Jun, all of us', { today: TODAY, people: FAMILY });
    expect(a).toMatchObject({ kind: 'flight', destination: 'istanbul', depart: '2027-06-20', return: null, tripType: 'oneway', cabin: 'business' });
    expect(a.ids).toEqual([OMAR.id, HESSA.id, SARA.id, AHMED.id]);
    const b = parseAskRules('Just me from Jeddah to London 3-10 Dec in premium', { today: TODAY, people: FAMILY });
    expect(b).toMatchObject({ from: 'JED', destination: 'london', depart: '2026-12-03', return: '2026-12-10', cabin: 'premium', ids: [OMAR.id] });
    const c = parseAskRules('Flights to Dubai next weekend for the family', { today: TODAY, people: FAMILY });
    expect([c.depart, c.return]).toEqual(weekendDates(TODAY, 1));
    expect(c.depart).toBe('2026-10-15'); // TODAY is a Saturday: the weekend is ending, "next weekend" is the coming one
    const d = parseAskRules('Flights to Istanbul in March for 2', { today: TODAY, people: FAMILY });
    expect(d).toMatchObject({ monthOnly: { month: 3, year: 2027 }, count: 2, ask: 'when' });
    expect(parseAskRules('first class to Cairo with twins', { today: TODAY, people: FAMILY })).toMatchObject({ cabin: 'business', infants: 2, cabinNote: expect.stringContaining('First') });
    expect(parseAskRules('A hotel in Istanbul', { today: TODAY, people: FAMILY }).kind).toBe('stay');
    expect(parseAskRules('A weekend in AlUla', { today: TODAY, people: FAMILY }).kind).toBe('plan');
    expect(parseAskRules('Schengen visa for Sara', { today: TODAY, people: FAMILY })).toMatchObject({ kind: 'visa', answers: { where: ['Schengen'] } });
    expect(parseAskRules('Flights to Muscat on 5 Nov', { today: TODAY, people: FAMILY })).toMatchObject({ destination: 'other', destinationName: 'Muscat' });
    expect(parseAskRules('Umrah. Hessa uses a wheelchair, Omar is diabetic', { today: TODAY, people: FAMILY }).needs).toEqual({ [HESSA.id]: ['wheelchairSeat'], [OMAR.id]: ['diabetic'] });
  });
  it('offers 12 months and quick picks from today', () => {
    expect(calendarMonths(TODAY).map((m) => m.first)).toHaveLength(12);
    expect(calendarMonths(TODAY)[0]!.first).toBe('2026-10-01');
    expect(quickDates(TODAY).map((q) => q.id)).toEqual(['thisWeekend', 'nextWeekend', 'eid', 'school']);
    expect(quickDates('2027-02-01').map((q) => q.id)).not.toContain('school');
  });
});

describe('prices', () => {
  it('cabins, one way, bundles and seats', () => {
    expect(fareSar(2160, 'economy', false)).toBe(2160);
    expect(fareSar(2160, 'business', true)).toBe(Math.round(2160 * 3.2 * 0.55));
    expect(bundleFor(4, '2027-03-09', '2027-03-15')).toMatchObject({ nights: 6, staySar: 5880, pickupSar: 440, totalSar: 6320 });
    expect(bundleFor(2, '2027-03-09', '2027-03-15').staySar).toBe(Math.round(980 * 6 * 0.55));
    expect(seatsFor(4, 'economy')).toEqual(['14A', '14B', '14C', '14D']);
    expect(seatsFor(2, 'business', true)).toEqual(['5A', '5B']);
  });
  it('promo codes', () => {
    expect(checkPromo('eid10', TODAY, 1_000_000)).toMatchObject({ status: 'applied', discount: 30_000 });
    expect(checkPromo('EID10', TODAY, 100_000)?.discount).toBe(10_000);
    expect(checkPromo('RAMADAN', TODAY, 100_000)).toMatchObject({ status: 'ended', message: 'That code ended on 30 March.' });
    expect(checkPromo('X', TODAY, 1)?.status).toBe('unknown');
    expect(checkPromo('', TODAY, 1)).toBeNull();
  });
});

describe('cards', () => {
  it('brands, mada BINs, Luhn and expiry', () => {
    expect(cardBrandOf('4242424242424242')).toBe('visa');
    expect(cardBrandOf('5555555555554444')).toBe('mastercard');
    expect(cardBrandOf('4406470000000000')).toBe('mada');
    expect(cardBrandOf('378282246310005')).toBeNull();
    expect(luhnOk('4242424242424242')).toBe(true);
    expect(luhnOk('4242424242424241')).toBe(false);
    const ok = cardProblems({ number: '4242 4242 4242 4242', expiry: '08/28', cvv: '123', name: 'OMAR ALHARBI' }, TODAY);
    expect(ok.ok).toBe(true);
    expect(cardProblems({ number: '3782 8224 6310 005', expiry: '', cvv: '', name: '' }, TODAY).problems.number).toContain('American Express');
    expect(cardProblems({ number: '4242424242424241', expiry: '', cvv: '', name: '' }, TODAY).problems.number).toContain('look right');
    expect(cardProblems({ number: '4242', expiry: '01/25', cvv: '', name: '' }, TODAY, { number: true, expiry: true }).problems).toEqual({ number: 'Card numbers have 16 digits.', expiry: 'This card has expired.' });
    expect(cardProblems({ number: '', expiry: '1', cvv: '', name: '' }, TODAY, { expiry: true }).problems.expiry).toBe('Use MM/YY, like 08/28.');
  });
});

describe('entry checks', () => {
  it('Türkiye for the family and the helper', () => {
    const r = entryChecks({ destination: 'istanbul', travellers: FAMILY, depart: '2027-03-09', return: '2027-03-15', answers: {}, today: TODAY, iqamaOf: (p) => (p.relation === 'helper' ? '2027-03-12' : null) });
    expect(r.checks.filter((c) => c.blocking).map((c) => `${c.name}:${c.key}`)).toEqual(['Lina:visa', 'Lina:iqama', 'Lina:reentry']);
    const sara = entryChecks({ destination: 'istanbul', travellers: [OMAR, SARA], depart: '2027-04-01', return: null, answers: {}, today: TODAY });
    expect(sara.checks[0]).toMatchObject({ key: 'passport', blocking: true, name: 'Sara' });
    expect(entryChecks({ destination: 'dubai', travellers: [OMAR], depart: '2027-03-09', return: null, answers: {}, today: TODAY }).okText).toBe('No visa needed.');
  });
});

describe("the desk's words", () => {
  it('quotes per person from the price table, and never with a banned word', () => {
    const q = deskQuote({ kind: 'umrah', answers: { stay: ['Steps from the Haram'] }, travellers: [OMAR, AHMED], needs: { [OMAR.id]: ['wheelchairGate', 'oxygen'] }, note: 'x', today: TODAY })!;
    expect(q.totalSar).toBe(2300 + 450 + 300 + 1650 + 450);
    for (const s of [q.text, q.lead ?? '', ...q.needLines]) expect(bannedIn(s)).toEqual([]);
    expect(deskQuote({ kind: 'todo', answers: { pick: ['Topkapı Palace tickets'] }, travellers: [OMAR, AHMED], needs: {}, note: '', today: TODAY })!.totalSar).toBe(85 + 43);
    expect(deskReply('umrah', 'Can we stay closer to the Haram?', 3).offer).toEqual({ label: 'Room at the King Abdulaziz Gate', perPersonSar: 380 });
    expect(bannedIn(deskReply('flight', 'cheaper?', 1).text)).toEqual([]);
  });
  it('words a price for one person in the singular, and a rental as a rental', () => {
    const one = deskQuote({ kind: 'visa', answers: {}, travellers: [OMAR], needs: {}, note: '', today: TODAY, locale: 'en' })!;
    expect(one.text).toContain('SAR 450, plus the embassy fee');
    expect(one.text).not.toMatch(/each|in total/);
    expect(deskQuote({ kind: 'visa', answers: {}, travellers: [OMAR, AHMED], needs: {}, note: '', today: TODAY, locale: 'en' })!.text).toContain('SAR 450 each, SAR 900 for all 2 of you');
    const car = deskQuote({ kind: 'car', answers: { size: ['Standard car'], days: ['The whole trip'] }, travellers: [OMAR], needs: {}, note: '', today: TODAY, locale: 'en' })!;
    expect(car.text).toMatch(/^Standard car, the whole trip: SAR 1,300\./);
    expect(car.text).not.toMatch(/driver/);
  });
  it('speaks Arabic when the traveller does', () => {
    const q = deskQuote({ kind: 'umrah', answers: { stay: ['Steps from the Haram'] }, travellers: [OMAR, AHMED], needs: { [OMAR.id]: ['wheelchairGate'] }, note: '', today: TODAY, locale: 'ar' })!;
    expect(q.text.replace(/\u2066[^\u2069]*\u2069/g, '')).not.toMatch(/[A-Za-z]{3,}/); // names stay as they are
    expect(q.breakdown[0]!.lines.map((l) => l.label).join(' ')).not.toMatch(/[A-Za-z]{3,}/);
    expect(deskReply('car', 'Can we change the dates?', 1, 'ar').text).toBe('أتأكد من السيارة لهالأيام وأرسل لك السعر هنا خلال ساعتين.');
    expect(requestTitle('car', { where: ['Riyadh'] }, '', 'ar')).toBe('تأجير سيارة: الرياض');
    expect(wordFor('Standard car', 'ar')).toBe('سيارة عادية');
  });
});

describe('requests ask only what is missing, and say each thing once', () => {
  const ctx = { today: TODAY, people: FAMILY };
  it('reads an outing by name as a thing to do, with its city and day', () => {
    const a = parseAskRules('Boulevard World at night in Riyadh', ctx);
    expect(a.kind).toBe('todo');
    expect(a.answers).toEqual({ pick: ['Boulevard World at night'], where: ['Riyadh'] });
    expect(parseAskRules('Riyadh Season tickets this weekend for 4', ctx)).toMatchObject({ kind: 'todo', answers: { when: ['This weekend'] } });
    expect(eventIn('Things to do in Istanbul')).toBeNull();
    expect(eventIn('I want to go to Boulevard World tonight with the kids')).toBe('Boulevard World');
  });
  it('fills a car and a table from the words, so those questions are skipped', () => {
    expect(parseAskRules('Rent a car in Riyadh tomorrow for 3 days', ctx).answers).toEqual({ where: ['Riyadh'], when: ['Tomorrow'], days: ['3 days'] });
    expect(parseAskRules('A table in Jeddah tonight', ctx).answers).toEqual({ where: ['Jeddah'], when: ['Tonight'] });
    expect(parseAskRules('A table somewhere good', ctx).answers).toEqual({});
  });
  it('never repeats the words as title, summary and note', () => {
    const ev = requestText({ kind: 'todo', answers: { pick: ['Boulevard World at night'], where: ['Riyadh'], when: ['This weekend'] }, query: 'Boulevard World at night in Riyadh', names: 'Omar, Hessa', needSummary: '', note: 'Boulevard World at night in Riyadh' });
    expect(ev).toEqual({ title: 'Boulevard World at night', summary: 'Riyadh · This weekend · Omar, Hessa', detail: 'Riyadh · This weekend · Omar, Hessa', note: null });
    const car = requestText({ kind: 'car', answers: { where: ['Riyadh'], when: ['Tomorrow'], size: ['Standard car'], days: ['1 day'] }, query: 'A car', names: '', needSummary: '', note: '' });
    expect(car.title).toBe('Car rental: Riyadh');
    expect(car.summary).toBe('Tomorrow · Standard car · 1 day');
    const gen = requestText({ kind: 'general', answers: { when: ['Any day is fine'] }, query: 'a desert camp with a chef', names: 'Omar', needSummary: '', note: '' });
    expect(gen).toMatchObject({ title: 'A desert camp with a chef', summary: 'Any day is fine · Omar', note: null });
  });
  it('prices an outing per person, and a self-drive car without a driver', () => {
    const q = deskQuote({ kind: 'todo', answers: { pick: ['Boulevard World at night'], when: ['This weekend'] }, travellers: [OMAR, AHMED], needs: {}, note: '', today: TODAY })!;
    expect(q.totalSar).toBe(120 + 60);
    expect(q.text).toBe('Boulevard World at night this weekend for the 2 of you: SAR 180. Children under 12 are half price. Pay and I’ll book them.');
    const car = deskQuote({ kind: 'car', answers: { size: ['Standard car'], days: ['3 days'] }, travellers: [OMAR], needs: {}, note: '', today: TODAY })!;
    expect(car.text).not.toMatch(/driver/);
    expect(car.totalSar).toBe(260 * 3);
    expect(deskFirstReply('food', { where: ['Riyadh'], when: ['Tonight'], pref: ['Halal'] }, 4)).toMatch(/^I’m asking for a table for 4 in Riyadh, tonight: halal\./);
  });
  it('answers a reply in the words of its kind', () => {
    expect(deskReply('food', 'Can we go a little later?', 4).text).toMatch(/restaurant/);
    expect(deskReply('food', 'Can we go a little later?', 4).text).not.toMatch(/airline|hotel/);
    expect(deskReply('car', 'Can we add a child seat?', 1).text).toMatch(/child seat/);
    expect(deskReply('todo', 'This weekend works', 2).text).toMatch(/that day/);
    expect(deskReply('visa', 'Is there an earlier appointment?', 1).text).toMatch(/earlier appointment/);
    for (const k of ['food', 'car', 'visa', 'todo', 'general', 'stay', 'flight']) expect(bannedIn(deskReply(k, 'anything', 2).text)).toEqual([]);
  });
});

describe('Saudi weekend', () => {
  it('is Thursday out, Saturday back, and a Friday is already this weekend', () => {
    expect(weekendDates('2026-10-22', 0)).toEqual(['2026-10-22', '2026-10-24']); // Thursday
    expect(weekendDates('2026-10-22', 1)).toEqual(['2026-10-29', '2026-10-31']);
    expect(weekendDates('2026-10-23', 0)).toEqual(['2026-10-23', '2026-10-24']); // Friday
    expect(weekendDates('2026-10-23', 1)).toEqual(['2026-10-29', '2026-10-31']);
    expect(weekendDates('2026-10-25', 0)).toEqual(['2026-10-29', '2026-10-31']); // Sunday
    expect(weekendDates('2026-10-24', 1)).toEqual(['2026-10-29', '2026-10-31']); // Saturday: "next weekend" is the coming one
    expect(weekendLine('2026-10-25')).toMatch(/Weekend Fri–Sat, out Thu.*2026-10-29→2026-10-31.*2026-11-05→2026-11-07/);
  });
});

describe('days of the week', () => {
  const read = (s: string) => { const r = parseAskRules(s, { today: '2026-10-22', people: [] }); return [r.destination, r.destinationName, r.depart, r.return]; };
  it('reads "Thursday to Saturday" as dates, never a place, in English and Arabic', () => {
    expect(read('Make it Thursday to Saturday instead')).toEqual([null, null, '2026-10-22', '2026-10-24']);
    expect(read('فندق في دبي من الخميس للسبت')).toEqual(['dubai', null, '2026-10-22', '2026-10-24']);
    expect(read('flight to Jeddah on Friday')).toEqual(['jeddah', null, '2026-10-23', null]);
    expect(read('next Thursday to Saturday')[2]).toBe('2026-10-22');
    expect(read('flights to London next month')[2]).toBeNull();
  });
});
