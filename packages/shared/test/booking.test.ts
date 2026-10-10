import { describe, expect, it } from 'vitest';
import {
  bannedIn, bundleFor, calendarMonths, cardBrandOf, cardProblems, checkPromo, deskQuote, deskReply, entryChecks, fareSar, luhnOk, parseAskRules, quickDates, seatsFor,
  weekendDates, type Person,
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
    expect(c.depart).toBe('2026-10-22');
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
});
