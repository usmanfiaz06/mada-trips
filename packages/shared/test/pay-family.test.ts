import { describe, expect, it } from 'vitest';
import { RENEWAL_DAYS, catalogueStay, entryChecks, fareAirline, fareRulesFor, familyLines, labelLast2, renewalAnswers, renewalPlan, renewalsOf, usedCardsOf, type Person } from '../src';

const person = (id: string, over: Partial<Person> = {}): Person => ({
  id, isSelf: false, givenNames: id, surname: 'Alharbi', firstName: id, relation: 'child', dateOfBirth: null, sex: null, nationality: 'SAU', passport: null, createdAt: '2026-01-01T00:00:00.000Z', ...over,
} as Person);
const pp = (expiry: string) => ({ number: 'A1', nationality: 'SAU', issuingCountry: 'SAU', expiry, source: 'scan' }) as unknown as Person['passport'];

describe('a short passport is never a dead end (CRITIQUE-2 #1)', () => {
  const me = person('Noura', { isSelf: true, relation: 'self', passport: pp('2027-01-01') });
  const kid = person('Omar', { dateOfBirth: '2013-05-12', passport: pp('2031-01-01') });
  const base = { destination: 'istanbul', travellers: [me, kid], depart: '2027-03-09', return: '2027-03-15', today: '2026-10-18' };
  it('says when Mada can have it renewed, the fee, and that the account holder can stay home', () => {
    const r = entryChecks({ ...base, answers: {} });
    const c = r.checks.find((x) => x.key === 'passport')!;
    expect(c).toMatchObject({ blocking: true, removable: true, answerKey: `${me.id}:passport`, renewal: { by: '2026-11-01', fee: 15_000, inTime: true, asked: false } });
    expect(renewalsOf(r)).toEqual([{ personId: me.id, name: 'Noura', by: '2026-11-01', fee: 15_000, inTime: true, asked: false }]);
  });
  it('once asked, the booking goes ahead with the renewal alongside', () => {
    const r = entryChecks({ ...base, answers: renewalAnswers([me.id]) });
    expect(r.blocking).toBe(0);
    expect(r.checks.find((x) => x.key === 'passport')).toMatchObject({ done: true, blocking: false, renewal: { asked: true } });
  });
  it('a renewal that would land too close to the flight still holds it, and says so', () => {
    const late = renewalPlan('2027-03-01', '2027-03-09');
    expect(late.inTime).toBe(false);
    expect(late.by).toBe('2027-03-15');
    const r = entryChecks({ ...base, today: '2027-03-01', answers: renewalAnswers([me.id]) });
    expect(r.checks.find((x) => x.key === 'passport')).toMatchObject({ blocking: true, renewal: { inTime: false, asked: true } });
    expect(RENEWAL_DAYS).toBe(14);
  });
  it('travelling alone, the account holder is not offered to stay home', () => {
    const r = entryChecks({ ...base, travellers: [me], answers: {} });
    expect(r.checks.find((x) => x.key === 'passport')?.removable).toBe(false);
  });
});

describe('the family on the order sheet (CRITIQUE-2 #10)', () => {
  it('bags each, a bassinet per lap baby, child meals, and who 12 to 17 pays as an adult', () => {
    const f = familyLines({ bags: '2 × 23 kg', infants: 1 }, [person('Me', { dateOfBirth: '1985-01-01' }), person('Omar', { dateOfBirth: '2013-05-12' }), person('Sara', { dateOfBirth: '2020-02-02' }), person('Lina', { dateOfBirth: '2024-06-01' })], '2027-03-09');
    expect(f).toMatchObject({ bags: '2 × 23 kg', bassinets: 1, childMeals: 2, adultFares: [{ name: 'Omar', age: 13 }] });
  });
});

describe('one list of payment methods (CRITIQUE-2 #13)', () => {
  it('a card paid with but not saved is used, once, newest first; a saved one is left out', () => {
    expect(labelLast2('Visa ending 42')).toBe('42');
    expect(labelLast2('فيزا تنتهي بـ ٤٢')).toBe('42');
    const used = usedCardsOf([
      { label: 'Visa ending 42', at: '2026-10-01T10:00:00.000Z' }, { label: 'Visa ending 42', at: '2026-10-11T10:00:00.000Z' }, { label: 'Visa ending 41', at: '2026-10-12T10:00:00.000Z' }, { label: null, at: '2026-10-13T10:00:00.000Z' },
    ], [{ last4: '4141' }]);
    expect(used).toEqual([{ label: 'Visa ending 42', last2: '42', usedAt: '2026-10-11T10:00:00.000Z' }]);
  });
  it('the fare rule names the airline whose fare it is, even after a rebooking', () => {
    const seg = (carrier: string, carrierName: string) => ({ carrier, carrierName, direction: 'out' }) as never;
    expect(fareAirline({ fare: fareRulesFor('SV'), segments: [seg('XY', 'flynas')] })).toBe('Saudia');
    expect(fareAirline({ fare: null, segments: [seg('XY', 'flynas')] })).toBe('flynas');
  });
});

describe('the hotel page and bundle card say the same (CRITIQUE-2 #9)', () => {
  it('room × rooms, a night, board, rating and the last day to cancel', () => {
    const s = catalogueStay('galata', 5, '2027-03-09', '2027-03-15')!;
    expect(s).toMatchObject({ name: 'Bereketzade Hotel', room: 'Deluxe double', rooms: 2, connecting: true, board: 'BB', rating: '9.1', nights: 6, perNight: 98_000, total: 588_000, freeUntil: '2027-03-02' });
    expect(catalogueStay('nope', 2)).toBeNull();
  });
});
