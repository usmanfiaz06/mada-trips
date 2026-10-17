import { describe, expect, it } from 'vitest';
import { bcbpDate, bcbpLegMatches, bcbpNameMatches, parseBcbp } from '../src/schemas/bcbp';
import { buildBcbp } from '../src/schemas/bcbp-build';

// The example from IATA Resolution 792 (one leg, no conditional items).
const IATA_ONE = 'M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 326J001A0025 100';

// A Saudia pass in the version 6 layout, written field by field the way a check-in system prints it.
const SV_V6 =
  'M1ALHARBI/OMAR MR     E' +
  'K7PQ2M RUHISTSV 0263 133Y014A0025 1' + '48' +
  '>6' + '18' + '1WW6132BSV ' + '             ' +
  '2A' + '0652312345678' + '0 ' + 'SV ' + 'SV ' + '1234567890      ' + ' ' + '2PC' + 'N' +
  '^164GIWVC5EH7JNT684FVNJ91W2QA4DVN5J8K4F0L0GEQ3DF5TGBN8709HKT5D3DW3GBHFCVHMY7J5T6HFR41W2QA4DVN5J8K4F0L0GE';

describe('IATA BCBP', () => {
  it('reads the Resolution 792 example', () => {
    const p = parseBcbp(IATA_ONE)!;
    expect(p).toMatchObject({ name: 'DESMARAIS/LUC', surname: 'DESMARAIS', given: 'LUC', eticket: true, version: null });
    expect(p.legs).toHaveLength(1);
    expect(p.legs[0]).toMatchObject({ pnr: 'ABC123', from: 'YUL', to: 'FRA', carrier: 'AC', flightNumber: '834', julianDay: 326, compartment: 'J', seat: '1A', sequence: '25', passengerStatus: '1' });
  });

  it('reads a version 6 pass with conditional items and security data', () => {
    const p = parseBcbp(SV_V6)!;
    expect(p.surname).toBe('ALHARBI');
    expect(p.given).toBe('OMAR');
    expect(p.version).toBe(6);
    expect(p.issued).toEqual({ yearDigit: 6, julianDay: 132 });
    expect(p.issuer).toBe('SV');
    expect(p.hasSecurity).toBe(true);
    expect(p.legs[0]).toMatchObject({ pnr: 'K7PQ2M', from: 'RUH', to: 'IST', carrier: 'SV', flightNumber: '263', julianDay: 133, seat: '14A', sequence: '25', ticketNumber: '0652312345678', marketingCarrier: 'SV', frequentFlyer: 'SV 1234567890', freeBaggage: '2PC' });
  });

  it('reads two legs on one pass', () => {
    const raw = buildBcbp({
      name: 'ALHARBI/SARA MRS', version: 6, issuedJulian: 132, issuer: 'TK',
      legs: [
        { pnr: 'TK4XQ1', from: 'RUH', to: 'IST', carrier: 'TK', flight: '145', julianDay: 133, seat: '22C', sequence: '41', ticket: '2352312345670' },
        { pnr: 'TK4XQ1', from: 'IST', to: 'LHR', carrier: 'TK', flight: '1979', julianDay: 133, seat: '9F', sequence: '7', ticket: '2352312345671' },
      ],
    });
    const p = parseBcbp(raw)!;
    expect(p.legs.map((l) => `${l.carrier}${l.flightNumber} ${l.from}-${l.to} ${l.seat} #${l.sequence}`)).toEqual(['TK145 RUH-IST 22C #41', 'TK1979 IST-LHR 9F #7']);
    expect(p.legs[1]!.ticketNumber).toBe('2352312345671');
  });

  it('refuses what is not a boarding pass', () => {
    expect(parseBcbp('https://example.com/checkin?pnr=ABC123')).toBeNull();
    expect(parseBcbp('0652312345678')).toBeNull();
    expect(parseBcbp(IATA_ONE.replace('YUL', 'Y1L'))).toBeNull();
    expect(parseBcbp(`M5${IATA_ONE.slice(2)}`)).toBeNull();
    expect(parseBcbp(IATA_ONE.slice(0, 50))).toBeNull();
  });

  it('puts the Julian day in the nearest year', () => {
    expect(bcbpDate(133, '2027-05-13')).toBe('2027-05-13');
    expect(bcbpDate(2, '2026-12-30')).toBe('2027-01-02');
    expect(bcbpDate(365, '2027-01-01')).toBe('2026-12-31');
    expect(bcbpDate(60, '2028-02-28')).toBe('2028-02-29');
  });

  it('matches a pass to the traveller and the flight', () => {
    const p = parseBcbp(SV_V6)!;
    expect(bcbpNameMatches(p, { surname: 'Alharbi', givenNames: 'Omar Abdullah' })).toBe(true);
    expect(bcbpNameMatches(p, { surname: 'Al-Harbi', givenNames: 'Omar' })).toBe(true);
    expect(bcbpNameMatches(p, { fullName: 'Omar Alharbi' })).toBe(true);
    expect(bcbpNameMatches(p, { surname: 'Alharbi', givenNames: 'Sara' })).toBe(false);
    expect(bcbpNameMatches(p, { surname: 'Alqahtani', givenNames: 'Omar' })).toBe(false);
    // Long names are cut at 20 characters on the pass.
    expect(bcbpNameMatches({ surname: 'ALABDULKARIM', given: 'MOHAMMED ABD' }, { surname: 'Alabdulkarim', givenNames: 'Mohammed Abdulrahman' })).toBe(true);
    const seg = { flightNumber: 'SV263', from: 'RUH', to: 'IST', departLocal: '2027-05-13T10:25' };
    expect(bcbpLegMatches(p.legs[0]!, seg)).toBe(true);
    expect(bcbpLegMatches(p.legs[0]!, { ...seg, departLocal: '2027-05-14T10:25' })).toBe(false);
    expect(bcbpLegMatches(p.legs[0]!, { ...seg, flightNumber: 'SV265' })).toBe(false);
  });

  it('round-trips what the builder writes', () => {
    const raw = buildBcbp({ name: 'ALHARBI/HESSA MISS', legs: [{ pnr: 'K7PQ2M', from: 'RUH', to: 'IST', carrier: 'SV', flight: '263', julianDay: 133, seat: '14C', sequence: '27' }] });
    expect(raw.length).toBe(60);
    const p = parseBcbp(raw)!;
    expect(p.given).toBe('HESSA');
    expect(p.legs[0]).toMatchObject({ seat: '14C', sequence: '27' });
  });
});
