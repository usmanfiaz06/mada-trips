import { describe, expect, it } from 'vitest';
import {
  ApiErrorBody, CreatePersonRequest, FlightOffer, OtpVerifyRequest, PassportInput, UpdateMeRequest, maskPassportNumber, firstNameOf,
} from '../src/schemas';

describe('schemas', () => {
  it('validates OTP verification', () => {
    expect(OtpVerifyRequest.safeParse({ phone: '0500004127', code: '123456' }).success).toBe(true);
    expect(OtpVerifyRequest.safeParse({ phone: '0500004127', code: '12345' }).success).toBe(false);
    expect(OtpVerifyRequest.safeParse({ phone: '0500004127', code: '12345a' }).success).toBe(false);
  });
  it('normalises passport numbers and refuses junk', () => {
    const p = PassportInput.parse({ number: ' a08493141 ', issuingCountry: 'SAU', nationality: 'SAU', expiry: '2031-06-22' });
    expect(p.number).toBe('A08493141');
    expect(p.source).toBe('manual');
    expect(PassportInput.safeParse({ number: 'A08-49', issuingCountry: 'SAU', nationality: 'SAU', expiry: '2031-06-22' }).success).toBe(false);
    expect(PassportInput.safeParse({ number: 'A08493141', issuingCountry: 'SAU', nationality: 'SAU', expiry: '2031-02-30' }).success).toBe(false);
  });
  it('never lets a person be created as self', () => {
    expect(CreatePersonRequest.safeParse({ givenNames: 'Sara', surname: 'Alharbi', relation: 'self' }).success).toBe(false);
    expect(CreatePersonRequest.safeParse({ givenNames: 'Sara', surname: 'Alharbi', relation: 'child' }).success).toBe(true);
  });
  it('needs something to change on /me', () => {
    expect(UpdateMeRequest.safeParse({}).success).toBe(false);
    expect(UpdateMeRequest.safeParse({ name: 'Omar' }).success).toBe(true);
    expect(UpdateMeRequest.safeParse({ name: 'x'.repeat(31) }).success).toBe(false);
  });
  it('masks the way the prototype does', () => {
    expect(maskPassportNumber('A08493141')).toBe('A08•••41');
    expect(maskPassportNumber('P7132')).toBe('•••32');
    expect(firstNameOf('OMAR ABDULLAH')).toBe('Omar');
  });
  it('checks the error envelope', () => {
    expect(ApiErrorBody.safeParse({ error: { code: 'OTP_WRONG', message: 'x', triesLeft: 2 } }).success).toBe(true);
    expect(ApiErrorBody.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });
  it('describes a flight offer like the prototype', () => {
    const r = FlightOffer.safeParse({
      id: 'mock-sv263', supplier: 'mock', label: 'best', reason: 'Direct. Lands before check-in.',
      out: [{ carrier: 'SV', carrierName: 'Saudia', flightNumber: 'SV263', from: 'RUH', to: 'IST', departLocal: '2027-03-09T09:40', departTz: 'Asia/Riyadh', arriveLocal: '2027-03-09T13:55', arriveTz: 'Europe/Istanbul', durationMin: 255 }],
      back: [], cabin: 'economy', pricePerPerson: { amount: 216000, currency: 'SAR' }, total: { amount: 864000, currency: 'SAR' },
      baggage: '2 × 23 kg', changeRule: 'SAR 300 per person', refundRule: 'Refund minus SAR 400 per person', seatsLeft: null, expiresAt: '2027-02-14T08:00:00Z',
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

import { icaoCallsign } from '../src/schemas';
describe('ADS-B callsigns', () => {
  it('maps IATA flight numbers to ICAO callsigns', () => {
    expect(icaoCallsign('SV263')).toBe('SVA263');
    expect(icaoCallsign('xy 125')).toBe('KNE125');
    expect(icaoCallsign('F3 0101')).toBe('FAD101');
    expect(icaoCallsign('ZZ1')).toBeNull();
    expect(icaoCallsign('nonsense')).toBeNull();
  });
});
