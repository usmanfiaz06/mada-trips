import { describe, expect, it } from 'vitest';
import {
  UMRAH_HOTELS, carNowAsk, checkInFor, checkInForWhen, correctAsk, deskQuote, inLastTen, lastTenOf, nextRamadan, parseAskRules, requestText, umrahPlan,
  umrahSummary, umrahHotelsIn, askIntentOfRules, type Person,
} from '../src';

const today = '2026-10-17';
const parse = (text: string) => parseAskRules(text, { today, people: [] });
const person = (id: string, firstName: string, relation: Person['relation'], dateOfBirth: string) =>
  ({ id, isSelf: relation === 'self', givenNames: firstName, surname: 'A', firstName, relation, dateOfBirth, sex: null, nationality: 'SAU', passport: null }) as unknown as Person;
const omar = person('p-omar', 'Omar', 'self', '1985-03-02');
const sara = person('p-sara', 'Sara', 'spouse', '1988-06-11');
const noor = person('p-noor', 'Noor', 'child', '2019-01-20');

describe('a taxi, a cab or a driver, now', () => {
  it.each(['Get me a taxi now in Abha', 'cab now', 'driver right now', 'a car now to the airport', 'I need a ride now', 'taxi asap in Riyadh'])('%s is a car', (text) => {
    expect(parse(text).kind).toBe('car');
  });
  it.each(['تاكسي الحين في أبها', 'أبي سواق الحين', 'سيارة الحين للمطار', 'كريم حالا'])('%s is a car', (text) => {
    expect(parse(text).kind).toBe('car');
    expect(carNowAsk('car', text)).toBe(true);
  });
  it('keeps the city for the driver, and still reads flights and stays', () => {
    expect(parse('Get me a taxi now in Abha').answers.where).toEqual(['Abha']);
    expect(parse('flights to Abha now').kind).toBe('flight');
    expect(parse('a taxi to the airport tomorrow').kind).toBe('car');
    expect(parse('Rent a car now').kind).toBe('car');
    expect(carNowAsk('car', 'Rent a car now')).toBe(false);
  });
});

describe('Umrah around the permit', () => {
  it('reads "I have a permit" in English and Arabic as a correction', () => {
    const it0 = askIntentOfRules(parse('Umrah in Ramadan'));
    for (const said of ['I have a permit', 'عندي تصريح']) {
      const c = correctAsk(it0, said, { today, people: [] });
      expect(c.type).toBe('apply');
      if (c.type === 'apply') expect(c.intent.answers.permit).toEqual(['has']);
    }
  });
  it('reads the last ten nights, in English and Arabic', () => {
    expect(parse('Umrah in the last ten nights').answers.when).toEqual(['The last ten nights']);
    expect(parse('عمرة في العشر الأواخر').answers.when).toEqual(['The last ten nights']);
    expect(parse('عمرة بعد العيد').answers.when).toEqual(['After Eid']);
  });
  it('knows the last ten nights of Ramadan 1448', () => {
    const r = nextRamadan(today);
    expect(r).toEqual({ start: '2027-02-08', eid: '2027-03-09' });
    expect(lastTenOf(r)).toEqual({ from: '2027-02-27', to: '2027-03-08' });
    expect(inLastTen('2027-03-01', '2027-03-04')).toBe(true);
    expect(inLastTen('2027-02-20', '2027-02-27')).toBe(false);
    expect(inLastTen('2027-02-24', '2027-02-28')).toBe(true);
    expect(inLastTen('2027-04-02')).toBe(false);
  });
  it('checks in the night before a dawn or morning slot', () => {
    expect(checkInFor('2027-01-10', 'Before Fajr')).toBe('2027-01-09');
    expect(checkInFor('2027-01-10', 'Morning')).toBe('2027-01-09');
    expect(checkInFor('2027-01-10', 'Evening')).toBe('2027-01-10');
    expect(checkInForWhen('The last ten nights', today)).toBe('2027-02-27');
    expect(checkInForWhen('After Eid', today)).toBe('2027-03-13');
  });
  it('names a hotel in every band, Makkah and Madinah', () => {
    for (const b of ['steps', 'walk', 'shuttle'] as const) expect(umrahHotelsIn('makkah', b).length).toBeGreaterThan(0);
    expect(umrahHotelsIn('madinah', 'steps').length).toBeGreaterThan(0);
    expect(new Set(UMRAH_HOTELS.map((h) => h.key)).size).toBe(UMRAH_HOTELS.length);
  });
  it('prices Madinah first, the train, Makkah and flights, with the dates of each', () => {
    const p = umrahPlan({ checkIn: '2027-01-10', makkah: { key: 'swissotel-makkah', nights: 3 }, madinah: { key: 'anwar-movenpick', nights: 2, order: 'before' }, flyFrom: 'RUH', ages: [41, 38, 7] })!;
    // Makkah stays on the permit's check-in; Madinah comes before it.
    expect(p.dates).toEqual({ madinahIn: '2027-01-08', madinahOut: '2027-01-10', makkahIn: '2027-01-10', makkahOut: '2027-01-13', leave: '2027-01-08', home: '2027-01-13' });
    const after = umrahPlan({ checkIn: '2027-01-10', makkah: { key: 'swissotel-makkah', nights: 3 }, madinah: { key: 'anwar-movenpick', nights: 2, order: 'after' }, flyFrom: null, ages: [41] })!;
    expect(after.dates).toMatchObject({ makkahIn: '2027-01-10', madinahIn: '2027-01-13', home: '2027-01-15' });
    expect(after.lines.map((l) => l.k)).toEqual(['makkah', 'madinah', 'train']);
    expect(p.lines.map((l) => l.k)).toEqual(['makkah', 'madinah', 'train', 'flights']);
    expect(p.lines[0]!.sar).toBe(1650 * 3);
    expect(p.lines[2]!.sar).toBe(250 + 250 + Math.round(250 * 0.75));
    expect(p.totalSar).toBe(p.lines.reduce((a, b) => a + b.sar, 0));
  });
  const answers = {
    permit: ['has'], permitDay: ['2027-01-11'], permitSlot: ['Morning'], checkIn: ['2027-01-10'], makkahHotel: ['hilton-suites-makkah'], makkahNights: ['3'],
    madinah: ['after'], madinahHotel: ['oberoi-madinah'], madinahNights: ['2'], flyFrom: ['RUH'], stay: ['Good value, short ride'],
  };
  it('the desk quotes the plan as chosen and says the permit back', () => {
    const q = deskQuote({ kind: 'umrah', answers, travellers: [omar, sara, noor], needs: { 'p-sara': ['wheelchairGate'] }, note: '', today, locale: 'en' })!;
    expect(q.breakdown[0]!.name).toBe('Rooms');
    expect(q.breakdown[0]!.lines.map((l) => l.label)).toEqual(['Hilton Suites Makkah, 3 nights', 'The Oberoi Madinah, 2 nights']);
    expect(q.lead).toContain('Hilton Suites Makkah');
    expect(q.lead).toContain('Planned around your permit');
    expect(q.text).toContain('Planned around your permit');
    expect(q.totalSar).toBe(q.breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l.sar, 0), 0));
    const ar = deskQuote({ kind: 'umrah', answers, travellers: [omar], needs: {}, note: '', today, locale: 'ar' })!;
    expect(ar.text).toMatch(/تصريحك/);
  });
  it('reads back as one line for the desk and Trips', () => {
    expect(umrahSummary(answers, 'Omar, Sara', '', 'en')).toMatch(/^Permit .*Morning · From .* · Hilton Suites Makkah, 3 nights · The Oberoi Madinah, 2 nights · Haramain train · Flights from Riyadh · Omar, Sara$/);
    const r = requestText({ kind: 'umrah', answers, query: 'Umrah', names: 'Omar', needSummary: '', note: '', locale: 'ar' });
    expect(r.summary).toMatch(/الصبح/);
    expect(r.summary).toMatch(/قطار الحرمين/);
  });
});
