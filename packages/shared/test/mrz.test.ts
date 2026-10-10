import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { checkDigit, countryCode, dmyToIso, findMrz, makeTd3, parseMrz } from '../src/mrz';

// The prototype's MRZ tests (docs/app/prototype-app/test/mrz.test.mjs), unchanged, plus the helpers the app adds.

// Build a valid TD3 line 2 from its parts, so the test data can't drift from the check digit rules.
function td3(num: string, nat: string, dob: string, sex: string, exp: string, opt = '') {
  const n = num.padEnd(9, '<');
  const o = opt.padEnd(14, '<');
  const oc = /^<+$/.test(o) ? '<' : checkDigit(o);
  const body = n + checkDigit(n) + nat + dob + checkDigit(dob) + sex + exp + checkDigit(exp) + o + oc;
  return body + checkDigit(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
}

describe('mrz', () => {
const ICAO = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];
const OMAR = ['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', td3('A08493141', 'SAU', '840311', 'M', '310622')];

// check digits
it('ICAO examples', () => {
  assert.equal(checkDigit('L898902C3'), '6');
  assert.equal(checkDigit('740812'), '2');
  assert.equal(checkDigit('120415'), '9');
  assert.equal(checkDigit('ZE184226B<<<<<'), '1');
  assert.equal(checkDigit('520727'), '3');
});

// clean TD3
it('ICAO specimen passport', () => {
  const r = parseMrz(ICAO);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.format, 'TD3');
  assert.deepEqual(
    { s: r.fields!.surname, g: r.fields!.given, n: r.fields!.number, nat: r.fields!.nationality, dob: r.fields!.dob, exp: r.fields!.expiry, sex: r.fields!.sex },
    { s: 'ERIKSSON', g: 'ANNA MARIA', n: 'L898902C3', nat: 'Utopia', dob: '12/08/1974', exp: '15/04/2012', sex: 'F' },
  );
  assert.deepEqual(r.doubtful, []);
});
it('Saudi passport, no personal number', () => {
  const r = parseMrz(OMAR);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.number, 'A08493141');
  assert.equal(r.fields!.nationality, 'Saudi Arabia');
  assert.equal(r.fields!.dob, '11/03/1984');
  assert.equal(r.fields!.expiry, '22/06/2031');
  assert.equal(r.fields!.given, 'OMAR');
});
it('long given names keep every part', () => {
  const r = parseMrz(['P<SAUAL<SAUD<<ABDULLAH<BIN<FAHD<<<<<<<<<<<<<', td3('B12345678', 'SAU', '020228', 'M', '290101')]);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.surname, 'AL SAUD');
  assert.equal(r.fields!.given, 'ABDULLAH BIN FAHD');
});
it('name starting with K after the separator is kept', () => {
  const r = parseMrz(['P<SAUALOTAIBI<<KHALID<<<<<<<<<<<<<<<<<<<<<<<', td3('K0001234', 'SAU', '900101', 'M', '300101')]);
  assert.equal(r.fields!.given, 'KHALID');
  assert.equal(r.fields!.number, 'K0001234');
  assert.equal(r.ok, true);
});

// OCR noise
it('spaces, lower case and guillemets', () => {
  const r = parseMrz(['p<uto eriksson«anna<maria<<<<<<<<<<<<<<<<<<<', 'L898902C36 UTO7408122F1204159ZE184226B<<<<< 10']);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.given, 'ANNA MARIA');
});
it('fillers read as K', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<K<<<<<KK<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<K<<10']);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.given, 'ANNA MARIA');
});
it('O/I/B/S swaps inside dates and check digits', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C3GUTO74O8I22FI2O4I59ZE184226B<<<<<IO']);
  assert.equal(r.fields!.dob, '12/08/1974');
  assert.equal(r.fields!.expiry, '15/04/2012');
  assert.equal(r.checks.dob, true);
  assert.equal(r.checks.expiry, true);
  assert.equal(r.ok, true, r.errors.join(', '));
});
it('digits in the name become letters', () => {
  const r = parseMrz(['P<UTOER1KSS0N<<ANNA<MAR1A<<<<<<<<<<<<<<<<<<<', ICAO[1]]);
  assert.equal(r.fields!.surname, 'ERIKSSON');
  assert.equal(r.fields!.given, 'ANNA MARIA');
  assert.ok(r.doubtful.includes('surname'), 'name with digits should be flagged');
});
it('swapped letters are not forced into the nationality digits', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UT07408122F1204159ZE184226B<<<<<10']);
  assert.equal(r.fields!.nationality, 'Utopia');
});
it('passport number repaired when one swap fixes the check digit', () => {
  const l2 = OMAR[1].replace('A08493141', 'AO8493141');
  const r = parseMrz([OMAR[0], l2]);
  assert.equal(r.fields!.number, 'A08493141');
  assert.equal(r.checks.number, true);
  assert.equal(r.ok, true, r.errors.join(', '));
});
it('wrong digit in the birth date is flagged, not dropped', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408132F1204159ZE184226B<<<<<10']);
  assert.equal(r.ok, false);
  assert.equal(r.checks.dob, false);
  assert.ok(r.doubtful.includes('dob'));
  assert.equal(r.fields!.dob, '13/08/1974');
  assert.equal(r.fields!.surname, 'ERIKSSON');
});
it('one filler missing from line 2', () => {
  const r = parseMrz([ICAO[0], 'L898902C36UTO7408122F1204159ZE184226B<<<<10']);
  assert.equal(r.ok, true, r.errors.join(', '));
});
it('one filler too many on both lines', () => {
  const r = parseMrz([ICAO[0] + '<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<<10']);
  assert.equal(r.ok, true, r.errors.join(', '));
});

// finding the MRZ in page text
it('junk lines around it', () => {
  const text = 'PASSPORT\nKINGDOM OF SAUDI ARABIA\nSURNAME ALHARBI\n' + 'XP<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<\n' + OMAR[1] + '\n';
  const r = findMrz(text);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.surname, 'ALHARBI');
});
it('nothing MRZ-shaped', () => {
  const r = findMrz('HELLO WORLD\nTHIS IS A RECEIPT FOR COFFEE AND CAKE 12 SAR');
  assert.equal(r.ok, false);
  assert.equal(r.fields, null);
});
it('expired passport still parses', () => {
  const r = parseMrz(['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', td3('A08493141', 'SAU', '840311', 'M', '210622')]);
  assert.equal(r.ok, true);
  assert.equal(r.fields!.expiry, '22/06/2021');
});

// ID cards
it('ICAO TD1 specimen', () => {
  const r = parseMrz(['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<']);
  assert.equal(r.format, 'TD1');
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.number, 'D23145890');
  assert.equal(r.fields!.given, 'ANNA MARIA');
});
it('ICAO TD2 specimen', () => {
  const r = parseMrz(['I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<', 'D231458907UTO7408122F1204159<<<<<<<6']);
  assert.equal(r.format, 'TD2');
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.expiry, '15/04/2012');
});


// helpers
it('makes TD3 lines that parse back', () => {
  const [l1, l2] = makeTd3({ surname: 'Alharbi', given: 'Hessa', number: 'A11493107', nationality: 'SAU', dob: '1988-07-24', sex: 'F', expiry: '2029-01-15' });
  const r = parseMrz([l1, l2]);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields!.given, 'HESSA');
  assert.equal(r.fields!.expiry, '15/01/2029');
});
it('converts days and countries', () => {
  assert.equal(dmyToIso('22/06/2031'), '2031-06-22');
  assert.equal(dmyToIso('31/02/2031'), null);
  assert.equal(countryCode('Saudi Arabia'), 'SAU');
  assert.equal(countryCode('phl'), 'PHL');
  assert.equal(countryCode('Atlantis'), null);
});
});
