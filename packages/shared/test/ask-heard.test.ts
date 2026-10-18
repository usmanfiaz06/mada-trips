import { describe, expect, it } from 'vitest';
import {
  carNowAsk, correctAsk, correctionLine, mockRideMatch, parseAskRules, rideRouteEstimate, rideSaid, umrahPlan, visaAdvice, visaPlaceOf, wantsNow, wordFor,
  type AskIntent, type Person,
} from '../src';

/*
 * Critique 2, #2, #6, #14, #16, #17: what was said in the sentence fills the flow before anything is asked, in English
 * and in Arabic; a correction says what changed; a visa runs the entry rules first; a car right now knows where to.
 */

const today = '2026-10-18'; // a Sunday
const person = (id: string, firstName: string, relation: Person['relation'], extra: Partial<Person> = {}): Person => ({
  id, isSelf: relation === 'self', givenNames: firstName, surname: 'Alharbi', firstName, relation, dateOfBirth: null, sex: null, nationality: null, passport: null, createdAt: '2026-01-01T00:00:00Z', ...extra,
});
const OMAR = person('00000000-0000-4000-8000-000000000001', 'Omar', 'self', { dateOfBirth: '1984-03-11' });
const HESSA = person('00000000-0000-4000-8000-000000000002', 'Hessa', 'spouse', { dateOfBirth: '1988-07-24' });
const LINA = person('00000000-0000-4000-8000-000000000005', 'Lina', 'helper', { nationality: 'PHL' });
const COUPLE = [OMAR, HESSA];
const parse = (text: string, people: Person[] = []) => parseAskRules(text, { today, people });

describe('#2 the permit said is never asked', () => {
  it.each([
    'Umrah in Ramadan, I have a Nusuk permit', 'umrah next month, we already have the permit', 'Umrah with my Nusuk permit in Ramadan', 'my permit is ready, umrah please',
    'عمرة في رمضان عندي تصريح', 'عمرة، عندنا التصاريح', 'طلعت التصريح، أبغى عمرة', 'أبغى عمرة والتصريح جاهز',
  ])('%s', (text) => {
    const r = parse(text);
    expect(r.kind).toBe('umrah');
    expect(r.answers.permit).toEqual(['has']);
  });
  it('no permit said, no permit answer', () => {
    expect(parse('Umrah in Ramadan').answers.permit).toBeUndefined();
    expect(parse('عمرة في رمضان').answers.permit).toBeUndefined();
  });
});

describe('#2 now is now', () => {
  it.each(['I need a car right now', 'a taxi now', 'car asap to Taksim', 'أبغى سيارة الحين', 'تاكسي حالا'])('%s is a car right now', (text) => {
    expect(wantsNow(text)).toBe(true);
    expect(carNowAsk('car', text)).toBe(true);
  });
  it('a car tomorrow is not now', () => expect(wantsNow('a car tomorrow')).toBe(false));
});

describe('#2 #17 where from and where to, from the sentence', () => {
  it('English: Istanbul airport to Taksim', () => {
    const r = rideSaid('I just landed at Istanbul airport, I need a car right now to Taksim');
    expect(r.city).toBe('Istanbul');
    expect(r.from?.name).toBe('Istanbul Airport');
    expect(r.to?.name).toBe('Taksim');
  });
  it('Arabic: «وصلت مطار إسطنبول أبغى سيارة الحين لتقسيم»', () => {
    const r = rideSaid('وصلت مطار إسطنبول أبغى سيارة الحين لتقسيم');
    expect(r).toMatchObject({ city: 'Istanbul', from: { name: 'Istanbul Airport' }, to: { name: 'Taksim' } });
  });
  it('to the airport: the airport is where they go', () => {
    expect(rideSaid('taxi now from Taksim to the airport, Istanbul')).toMatchObject({ city: 'Istanbul', to: { name: 'Istanbul Airport' }, from: { name: 'Taksim' } });
  });
  it('a place Mada doesn’t know stays as typed, with no distance', () => {
    const r = rideSaid('car now in Riyadh to my cousin’s house');
    expect(r.city).toBe('Riyadh');
    expect(r.to).toBeNull();
    expect(r.toText).toBe('my cousin’s house');
  });
  it('the airport to Taksim is about 45 km, and the fare is for that ride', () => {
    const e = rideRouteEstimate('Istanbul', 'Istanbul Airport', 'Taksim', 44)!;
    expect(e.km).toBeGreaterThan(35);
    expect(e.km).toBeLessThan(55);
    expect(e.fareSar).toBeGreaterThan(44);
    expect(mockRideMatch('ride-1', 'Istanbul', { meetingPoint: 'Istanbul Airport', destination: 'Taksim' })!.priceSar).toBe(e.fareSar);
    // Without a destination, the city's fixed fare as before.
    expect(mockRideMatch('ride-1', 'Istanbul')!.priceSar).toBe(44);
  });
});

describe('#2 months and weeks become a range', () => {
  it.each([
    ['Flights to Istanbul the first week of December', '2026-12-01', '2026-12-07'],
    ['رحلات لإسطنبول الأسبوع الأول من ديسمبر', '2026-12-01', '2026-12-07'],
    ['flights to Dubai in the second week of November', '2026-11-08', '2026-11-14'],
    ['طيران لدبي أول أسبوع في نوفمبر', '2026-11-01', '2026-11-07'],
    ['flights to London the last week of January', '2027-01-25', '2027-01-31'],
    ['flights to Dubai next week', '2026-10-25', '2026-10-31'],
    ['طيران لدبي الأسبوع الجاي', '2026-10-25', '2026-10-31'],
  ])('%s', (text, dep, ret) => {
    expect(parse(text)).toMatchObject({ kind: 'flight', depart: dep, return: ret, ask: null });
  });
  it.each([
    ['flights to London in December', 12], ['طيران للندن في ديسمبر', 12], ['flights to London next month', 11], ['طيران للندن الشهر الجاي', 11],
  ] as const)('%s: the month, then "When in …?" asks the days', (text, month) => {
    expect(parse(text)).toMatchObject({ depart: null, monthOnly: { month, year: 2026 }, ask: 'when' });
  });
  it('"next weekend" is still the weekend, not next week', () => {
    expect(parse('flights to Dubai next weekend')).toMatchObject({ depart: '2026-10-29', return: '2026-10-31' });
  });
});

describe('#6 a visa: the month and who, from the sentence', () => {
  it.each(['I need a UK visa for me and my wife in December', 'أبغى فيزا بريطانيا لي ولزوجتي في ديسمبر'])('%s', (text) => {
    const r = parse(text, COUPLE);
    expect(r.kind).toBe('visa');
    expect(r.answers).toMatchObject({ where: ['UK'], when: ['December'] });
    expect(r.ids).toEqual([OMAR.id, HESSA.id]);
  });
  it('the month reads in Arabic', () => {
    expect(wordFor('December', 'ar')).toBe('ديسمبر');
    expect(wordFor('December', 'en')).toBe('December');
  });
});

describe('#6 the entry rules come before any form', () => {
  it('Saudi passports to the UK: an ETA, online, GBP 16, never an appointment', () => {
    const a = visaAdvice(visaPlaceOf('UK', ''), COUPLE, 'en')!;
    expect(a.kind).toBe('eta');
    expect(a.service).toBe('uk_eta');
    expect(a.lines.join(' ')).toMatch(/UK ETA, not a visa: online, GBP 16, about 3 days/);
    expect(a.lines.join(' ')).not.toMatch(/VFS|appointment at/);
    expect(a.priceSar).toBe(120);
    expect(a.priceLine).toBe('Mada applies for both, Omar and Hessa: SAR 120.');
    expect(visaAdvice('GB', COUPLE, 'ar')!.lines[0]).toMatch(/ETA/);
  });
  it('a helper on a Philippine passport needs a visit visa: some of each', () => {
    const a = visaAdvice('GB', [OMAR, LINA], 'en')!;
    expect(a.kind).toBe('mixed');
    expect(a.lines.some((l) => /Lina needs a UK visit visa/.test(l))).toBe(true);
  });
  it('Türkiye: nothing to apply for', () => {
    const a = visaAdvice(visaPlaceOf(null, 'a visa for Turkey'), COUPLE, 'en')!;
    expect(a.kind).toBe('none');
    expect(a.title).toBe('No visa needed for Türkiye');
  });
  it('Schengen and the US: a visa with an appointment', () => {
    expect(visaAdvice(visaPlaceOf('Schengen', ''), COUPLE, 'en')!.kind).toBe('visa');
    expect(visaAdvice(visaPlaceOf('United States', ''), COUPLE, 'en')!.lines[0]).toMatch(/B1\/B2/);
  });
});

describe('#14 a correction says what changed', () => {
  const base = (over: Partial<AskIntent> = {}): AskIntent => ({
    kind: 'flight', destination: 'istanbul', destinationName: null, from: null, depart: '2026-10-22', return: '2026-10-24', tripType: 'return', monthOnly: null, cabin: null, cabinNote: null,
    travellerIds: [OMAR.id], travellerCount: 1, infants: 0, party: null, needs: {}, needsMentioned: [], answers: {}, ask: null, source: 'rules', ...over,
  });
  const line = (prev: AskIntent, text: string, locale: 'en' | 'ar' = 'en') => {
    const c = correctAsk(prev, text, { today, people: COUPLE });
    if (c.type !== 'apply') throw new Error(c.type);
    return correctionLine(prev, c, { people: COUPLE, locale });
  };
  it('who: the party with ages', () => {
    expect(line(base(), 'we are 2 adults and 3 children, aged 2, 6 and 13')).toBe('Now 5 people: 2 adults, 3 children (2, 6, 13).');
    expect(line(base(), 'احنا ٢ بالغين و٣ أطفال أعمارهم ٢ و٦ و١٣', 'ar')).toBe('الحين 5 أشخاص: بالغين، 3 أطفال (2، 6، 13).');
  });
  it('when: the days, or the month', () => {
    expect(line(base(), 'actually make it the first week of December')).toBe('Now 1–7 Dec.');
    expect(line(base(), 'الشهر الجاي', 'ar')).toMatch(/^الحين نوفمبر/);
  });
  it('from: the airport', () => expect(line(base(), 'from Jeddah')).toBe('Now from Jeddah.'));
  it('the permit', () => expect(line(base({ kind: 'umrah' }), 'I have a permit')).toBe('Noted: you have the permit.'));
});

describe('#16 Umrah from any Saudi airport, with the car to Makkah', () => {
  it('Abha, into Jeddah and home from Jeddah: two cars', () => {
    const p = umrahPlan({ checkIn: '2027-02-28', makkah: { key: 'hilton-suites-makkah', nights: 3 }, madinah: null, flyFrom: 'AHB', ages: [40] })!;
    expect(p.lines.map((l) => l.k)).toEqual(['makkah', 'flights', 'transfer']);
    expect(p.lines.find((l) => l.k === 'flights')!.sar).toBe(690);
    expect(p.lines.find((l) => l.k === 'transfer')!.sar).toBe(560);
  });
  it('driving: no flights, no airport car', () => {
    const p = umrahPlan({ checkIn: '2027-02-28', makkah: { key: 'hilton-suites-makkah', nights: 3 }, madinah: null, flyFrom: null, ages: [40] })!;
    expect(p.lines.map((l) => l.k)).toEqual(['makkah']);
  });
});
