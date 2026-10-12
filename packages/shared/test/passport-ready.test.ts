import { describe, expect, it } from 'vitest';
import { addMonthsIso, needsPassports, passportCopyFields, passportReady } from '../src/schemas/passport-ready';

const pp = (expiry: string) => ({ passport: { numberMasked: 'A08•••41', issuingCountry: 'SAU', nationality: 'SAU', expiry, source: 'scan' as const, updatedAt: '2026-01-01T00:00:00Z' } });

describe('passport ready for the booking', () => {
  it('adds months, landing on the last day of a short month', () => {
    expect(addMonthsIso('2026-10-11', 6)).toBe('2027-04-11');
    expect(addMonthsIso('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonthsIso('2027-12-15', 1)).toBe('2028-01-15');
  });

  it('missing without a passport', () => {
    expect(passportReady(undefined, { today: '2026-10-11' })).toEqual({ state: 'missing' });
    expect(passportReady({ passport: null }, { today: '2026-10-11' })).toEqual({ state: 'missing' });
  });

  it('needs a look when expired', () => {
    expect(passportReady(pp('2026-09-01'), { today: '2026-10-11' })).toMatchObject({ state: 'expiring', reason: 'expired' });
  });

  it('needs a look with under six months left on the day they come home', () => {
    const r = passportReady(pp('2027-05-01'), { today: '2026-10-11', travelEnds: '2026-12-20' });
    expect(r).toEqual({ state: 'expiring', reason: 'short', expiry: '2027-05-01', needUntil: '2027-06-20' });
  });

  it('ready with six months to spare after the return', () => {
    expect(passportReady(pp('2027-06-20'), { today: '2026-10-11', travelEnds: '2026-12-20' })).toEqual({ state: 'ready', expiry: '2027-06-20' });
  });

  it('counts from today when the return is unknown or already past', () => {
    expect(passportReady(pp('2027-04-10'), { today: '2026-10-11' })).toMatchObject({ state: 'expiring', reason: 'short', needUntil: '2027-04-11' });
    expect(passportReady(pp('2027-04-11'), { today: '2026-10-11', travelEnds: '2026-01-01' })).toMatchObject({ state: 'ready' });
  });

  it('asks for passports on flights, packages, visas and Umrah only', () => {
    expect(['trip', 'package', 'flight', 'visa', 'umrah'].every(needsPassports)).toBe(true);
    expect(['stay', 'esim', 'share', 'car', null].some(needsPassports)).toBe(false);
  });

  it('keeps only the allowed fields with a copy, never the number', () => {
    expect(passportCopyFields({ name: ' OMAR ALHARBI ', number: 'A08493141', issued: '', expiry: '2031-06-22' })).toEqual({ name: 'OMAR ALHARBI', expiry: '2031-06-22' });
  });
});
