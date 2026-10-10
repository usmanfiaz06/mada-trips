// Unit tests for src/mrz.js. Usage: node test/mrz.test.mjs
import assert from 'node:assert/strict';
import { checkDigit, parseMrz, findMrz } from '../src/mrz.js';

let passed = 0;
const failures = [];
const test = (name, fn) => { try { fn(); passed += 1; console.log('  ok  ', name); } catch (e) { failures.push(name); console.log('  FAIL', name, '\n       ', e.message.split('\n')[0]); } };

// Build a valid TD3 line 2 from its parts, so the test data can't drift from the check digit rules.
function td3(num, nat, dob, sex, exp, opt = '') {
  const n = num.padEnd(9, '<');
  const o = opt.padEnd(14, '<');
  const oc = /^<+$/.test(o) ? '<' : checkDigit(o);
  const body = n + checkDigit(n) + nat + dob + checkDigit(dob) + sex + exp + checkDigit(exp) + o + oc;
  return body + checkDigit(body.slice(0, 10) + body.slice(13, 20) + body.slice(21, 43));
}

const ICAO = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'];
const OMAR = ['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', td3('A08493141', 'SAU', '840311', 'M', '310622')];

console.log('check digits');
test('ICAO examples', () => {
  assert.equal(checkDigit('L898902C3'), '6');
  assert.equal(checkDigit('740812'), '2');
  assert.equal(checkDigit('120415'), '9');
  assert.equal(checkDigit('ZE184226B<<<<<'), '1');
  assert.equal(checkDigit('520727'), '3');
});

console.log('clean TD3');
test('ICAO specimen passport', () => {
  const r = parseMrz(ICAO);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.format, 'TD3');
  assert.deepEqual(
    { s: r.fields.surname, g: r.fields.given, n: r.fields.number, nat: r.fields.nationality, dob: r.fields.dob, exp: r.fields.expiry, sex: r.fields.sex },
    { s: 'ERIKSSON', g: 'ANNA MARIA', n: 'L898902C3', nat: 'Utopia', dob: '12/08/1974', exp: '15/04/2012', sex: 'F' },
  );
  assert.deepEqual(r.doubtful, []);
});
test('Saudi passport, no personal number', () => {
  const r = parseMrz(OMAR);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields.number, 'A08493141');
  assert.equal(r.fields.nationality, 'Saudi Arabia');
  assert.equal(r.fields.dob, '11/03/1984');
  assert.equal(r.fields.expiry, '22/06/2031');
  assert.equal(r.fields.given, 'OMAR');
});
test('long given names keep every part', () => {
  const r = parseMrz(['P<SAUAL<SAUD<<ABDULLAH<BIN<FAHD<<<<<<<<<<<<<', td3('B12345678', 'SAU', '020228', 'M', '290101')]);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields.surname, 'AL SAUD');
  assert.equal(r.fields.given, 'ABDULLAH BIN FAHD');
});
test('name starting with K after the separator is kept', () => {
  const r = parseMrz(['P<SAUALOTAIBI<<KHALID<<<<<<<<<<<<<<<<<<<<<<<', td3('K0001234', 'SAU', '900101', 'M', '300101')]);
  assert.equal(r.fields.given, 'KHALID');
  assert.equal(r.fields.number, 'K0001234');
  assert.equal(r.ok, true);
});

console.log('OCR noise');
test('spaces, lower case and guillemets', () => {
  const r = parseMrz(['p<uto eriksson«anna<maria<<<<<<<<<<<<<<<<<<<', 'L898902C36 UTO7408122F1204159ZE184226B<<<<< 10']);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields.given, 'ANNA MARIA');
});
test('fillers read as K', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<K<<<<<KK<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<K<<10']);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields.given, 'ANNA MARIA');
});
test('O/I/B/S swaps inside dates and check digits', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C3GUTO74O8I22FI2O4I59ZE184226B<<<<<IO']);
  assert.equal(r.fields.dob, '12/08/1974');
  assert.equal(r.fields.expiry, '15/04/2012');
  assert.equal(r.checks.dob, true);
  assert.equal(r.checks.expiry, true);
  assert.equal(r.ok, true, r.errors.join(', '));
});
test('digits in the name become letters', () => {
  const r = parseMrz(['P<UTOER1KSS0N<<ANNA<MAR1A<<<<<<<<<<<<<<<<<<<', ICAO[1]]);
  assert.equal(r.fields.surname, 'ERIKSSON');
  assert.equal(r.fields.given, 'ANNA MARIA');
  assert.ok(r.doubtful.includes('surname'), 'name with digits should be flagged');
});
test('swapped letters are not forced into the nationality digits', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UT07408122F1204159ZE184226B<<<<<10']);
  assert.equal(r.fields.nationality, 'Utopia');
});
test('passport number repaired when one swap fixes the check digit', () => {
  const l2 = OMAR[1].replace('A08493141', 'AO8493141');
  const r = parseMrz([OMAR[0], l2]);
  assert.equal(r.fields.number, 'A08493141');
  assert.equal(r.checks.number, true);
  assert.equal(r.ok, true, r.errors.join(', '));
});
test('wrong digit in the birth date is flagged, not dropped', () => {
  const r = parseMrz(['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408132F1204159ZE184226B<<<<<10']);
  assert.equal(r.ok, false);
  assert.equal(r.checks.dob, false);
  assert.ok(r.doubtful.includes('dob'));
  assert.equal(r.fields.dob, '13/08/1974');
  assert.equal(r.fields.surname, 'ERIKSSON');
});
test('one filler missing from line 2', () => {
  const r = parseMrz([ICAO[0], 'L898902C36UTO7408122F1204159ZE184226B<<<<10']);
  assert.equal(r.ok, true, r.errors.join(', '));
});
test('one filler too many on both lines', () => {
  const r = parseMrz([ICAO[0] + '<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<<10']);
  assert.equal(r.ok, true, r.errors.join(', '));
});

console.log('finding the MRZ in page text');
test('junk lines around it', () => {
  const text = 'PASSPORT\nKINGDOM OF SAUDI ARABIA\nSURNAME ALHARBI\n' + 'XP<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<\n' + OMAR[1] + '\n';
  const r = findMrz(text);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields.surname, 'ALHARBI');
});
test('nothing MRZ-shaped', () => {
  const r = findMrz('HELLO WORLD\nTHIS IS A RECEIPT FOR COFFEE AND CAKE 12 SAR');
  assert.equal(r.ok, false);
  assert.equal(r.fields, null);
});
test('expired passport still parses', () => {
  const r = parseMrz(['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', td3('A08493141', 'SAU', '840311', 'M', '210622')]);
  assert.equal(r.ok, true);
  assert.equal(r.fields.expiry, '22/06/2021');
});

console.log('ID cards');
test('ICAO TD1 specimen', () => {
  const r = parseMrz(['I<UTOD231458907<<<<<<<<<<<<<<<', '7408122F1204159UTO<<<<<<<<<<<6', 'ERIKSSON<<ANNA<MARIA<<<<<<<<<<']);
  assert.equal(r.format, 'TD1');
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields.number, 'D23145890');
  assert.equal(r.fields.given, 'ANNA MARIA');
});
test('ICAO TD2 specimen', () => {
  const r = parseMrz(['I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<', 'D231458907UTO7408122F1204159<<<<<<<6']);
  assert.equal(r.format, 'TD2');
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.equal(r.fields.expiry, '15/04/2012');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
