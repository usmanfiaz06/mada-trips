// Machine-readable zone (ICAO 9303) parsing for passports and ID cards.
// Pure functions, no DOM. Handles TD3 (passport, 2 x 44), TD2 (2 x 36) and TD1 (3 x 30).
// OCR noise is cleaned up before parsing; digit/letter swaps are only applied where the field must be numeric.

const WEIGHTS = [7, 3, 1];
const charValue = (c) => {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  return 0; // '<' and anything else
};

/** ICAO 9303 check digit for a string of A-Z, 0-9 and '<'. */
export function checkDigit(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) sum += charValue(s[i]) * WEIGHTS[i % 3];
  return String(sum % 10);
}

// Letters OCR tends to return where a digit was printed.
const TO_DIGIT = { O: '0', Q: '0', D: '0', U: '0', I: '1', L: '1', T: '1', Z: '2', S: '5', G: '6', B: '8' };
// Digits OCR tends to return where a letter was printed.
const TO_LETTER = { 0: 'O', 1: 'I', 2: 'Z', 5: 'S', 6: 'G', 8: 'B' };

const digitsOnly = (s) => s.replace(/[^0-9<]/g, (c) => TO_DIGIT[c] || c);
const lettersOnly = (s) => s.replace(/[0-9]/g, (c) => TO_LETTER[c] || c);

/** Tidy a raw OCR line: upper case, no spaces, guillemets to fillers, stray symbols dropped. */
export function cleanLine(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[«‹]/g, '<<')
    .replace(/[\s'`’.,:;_\-|]/g, '')
    .replace(/[^A-Z0-9<]/g, '<');
}

/** Filler '<' is often read as K (sometimes C or X) inside runs of fillers. */
function fixFillers(s) {
  let out = s;
  // A run of 3+ characters made only of fillers and K/C/X, mostly real fillers, that starts with a filler
  // and ends with one (or runs to the end of the line). "<<KHALID" is left alone.
  out = out.replace(/[<KCX]{3,}/g, (run, at, str) => {
    const fillers = (run.match(/</g) || []).length;
    const closed = run.endsWith('<') || at + run.length === str.length;
    return run.startsWith('<') && closed && fillers >= Math.ceil(run.length / 2) ? '<'.repeat(run.length) : run;
  });
  // A single K between fillers, or between a filler and the end of the line.
  out = out.replace(/<[KCX](?=<|$)/g, '<<');
  return out;
}

/** Names never contain three fillers in a row, so anything after such a run is noise from the page edge. */
function dropNameTail(line, nameStart) {
  const name = line.slice(nameStart);
  const m = name.match(/<{3,}/);
  if (!m) return line;
  return line.slice(0, nameStart + m.index) + '<'.repeat(name.length - m.index);
}

/** Bring a line to the expected length by growing or shrinking its longest run of fillers. */
function fitLength(s, len) {
  if (s.length === len) return s;
  if (s.length > len) {
    let extra = s.length - len;
    // Trim trailing fillers first, then shrink the longest run.
    let t = s;
    while (extra > 0 && /<<$/.test(t)) { t = t.slice(0, -1); extra -= 1; }
    while (extra > 0) {
      const runs = [...t.matchAll(/<{2,}/g)].sort((a, b) => b[0].length - a[0].length);
      if (!runs.length) return t.slice(0, len);
      const r = runs[0];
      t = t.slice(0, r.index) + t.slice(r.index + 1);
      extra -= 1;
    }
    return t;
  }
  const runs = [...s.matchAll(/<{2,}/g)].sort((a, b) => b[0].length - a[0].length);
  const at = runs.length ? runs[0].index : s.length;
  return s.slice(0, at) + '<'.repeat(len - s.length) + s.slice(at);
}

const pad = (n) => String(n).padStart(2, '0');

/** YYMMDD -> { text: 'DD/MM/YYYY', date } or null. Birth dates never land in the future; expiry dates are 20xx. */
export function mrzDate(yymmdd, kind) {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = +yymmdd.slice(0, 2);
  const mm = +yymmdd.slice(2, 4);
  const dd = +yymmdd.slice(4, 6);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const nowYY = new Date().getFullYear() % 100;
  let year;
  if (kind === 'dob') year = yy > nowYY ? 1900 + yy : 2000 + yy;
  else year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const date = new Date(year, mm - 1, dd);
  if (date.getMonth() !== mm - 1) return null;
  return { text: `${pad(dd)}/${pad(mm)}/${year}`, date };
}

export const COUNTRIES = {
  SAU: 'Saudi Arabia', ARE: 'United Arab Emirates', KWT: 'Kuwait', QAT: 'Qatar', BHR: 'Bahrain', OMN: 'Oman', YEM: 'Yemen',
  JOR: 'Jordan', EGY: 'Egypt', LBN: 'Lebanon', SYR: 'Syria', IRQ: 'Iraq', PSE: 'Palestine', SDN: 'Sudan', MAR: 'Morocco',
  DZA: 'Algeria', TUN: 'Tunisia', LBY: 'Libya', TUR: 'Türkiye', IRN: 'Iran', PAK: 'Pakistan', IND: 'India', BGD: 'Bangladesh',
  LKA: 'Sri Lanka', NPL: 'Nepal', PHL: 'Philippines', IDN: 'Indonesia', MYS: 'Malaysia', THA: 'Thailand', VNM: 'Viet Nam',
  CHN: 'China', JPN: 'Japan', KOR: 'South Korea', SGP: 'Singapore', AUS: 'Australia', NZL: 'New Zealand', ETH: 'Ethiopia',
  KEN: 'Kenya', NGA: 'Nigeria', ZAF: 'South Africa', GBR: 'United Kingdom', GBD: 'United Kingdom', IRL: 'Ireland',
  USA: 'United States', CAN: 'Canada', MEX: 'Mexico', BRA: 'Brazil', FRA: 'France', DEU: 'Germany', D: 'Germany',
  ITA: 'Italy', ESP: 'Spain', PRT: 'Portugal', NLD: 'Netherlands', BEL: 'Belgium', CHE: 'Switzerland', AUT: 'Austria',
  SWE: 'Sweden', NOR: 'Norway', DNK: 'Denmark', FIN: 'Finland', POL: 'Poland', GRC: 'Greece', RUS: 'Russia', UKR: 'Ukraine',
  UTO: 'Utopia',
};

const nameFrom = (field) => {
  const clean = lettersOnly(field).replace(/<+$/, '');
  const [sur, ...rest] = clean.split('<<');
  const tidy = (x) => (x || '').replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  return { surname: tidy(sur), given: tidy(rest.join(' ')) };
};

// For a document number that fails its check digit, try the usual letter/digit swaps.
// Only accept a fix when exactly one single swap makes the check digit agree.
const SWAPS = { 0: 'O', O: '0', 1: 'I', I: '1', 8: 'B', B: '8', 5: 'S', S: '5', 2: 'Z', Z: '2', 6: 'G', G: '6' };
function repairNumber(num, cd) {
  const hits = [];
  for (let i = 0; i < num.length; i += 1) {
    const alt = SWAPS[num[i]];
    if (!alt) continue;
    const cand = num.slice(0, i) + alt + num.slice(i + 1);
    if (checkDigit(cand) === cd) hits.push(cand);
  }
  return hits.length === 1 ? hits[0] : null;
}

function field(value, cd, label, checks, errors, key) {
  const ok = /^\d$/.test(cd) && checkDigit(value) === cd;
  checks[key] = ok;
  if (!ok) errors.push(`${label} check digit doesn't match`);
  return ok;
}

function finish(format, lines, f, checks, errors) {
  const doubtful = new Set();
  if (!checks.number) doubtful.add('number');
  if (!checks.dob || !f.dob) doubtful.add('dob');
  if (!checks.expiry || !f.expiry) doubtful.add('expiry');
  // When only the overall digit disagrees, every field it covers has already passed its own check,
  // so the misread is almost always that last digit. Nothing for the person to fix.
  if (!f.surname) doubtful.add('surname');
  if (/[0-9]/.test(f.rawName || '')) { doubtful.add('surname'); doubtful.add('given'); }
  if (!COUNTRIES[f.nationalityCode]) doubtful.add('nationality');
  delete f.rawName;
  const ok = Object.values(checks).every(Boolean) && !!f.dob && !!f.expiry && !!f.surname;
  return { ok, format, lines, fields: f, checks, errors, doubtful: [...doubtful] };
}

function parseTD3(l1, l2) {
  const a = dropNameTail(fitLength(fixFillers(l1), 44), 5);
  let b = fitLength(fixFillers(l2), 44);
  // Numeric positions on line 2: check digit 9, dob 13-19, expiry 21-27, final 42-43.
  const num = (s, from, to) => s.slice(0, from) + digitsOnly(s.slice(from, to)) + s.slice(to);
  b = num(b, 9, 10); b = num(b, 13, 20); b = num(b, 21, 28); b = num(b, 42, 44);
  b = b.slice(0, 10) + lettersOnly(b.slice(10, 13)) + b.slice(13, 20) + b[20].replace(/[^MFX<]/, (c) => ({ H: 'M', N: 'M', E: 'F', P: 'F' })[c] || '<') + b.slice(21);
  const checks = {}; const errors = [];
  let number = b.slice(0, 9);
  if (!field(number, b[9], 'Passport number', checks, errors, 'number')) {
    const fixed = repairNumber(number, b[9]);
    if (fixed) { number = fixed; b = fixed + b.slice(9); checks.number = true; errors.pop(); }
  }
  field(b.slice(13, 19), b[19], 'Date of birth', checks, errors, 'dob');
  field(b.slice(21, 27), b[27], 'Expiry date', checks, errors, 'expiry');
  let opt = b.slice(28, 42);
  const composite = () => b.slice(0, 10) + b.slice(13, 20) + b.slice(21, 43);
  if (/^<+$/.test(opt) && (b[42] === '<' || b[42] === '0')) checks.optional = true;
  else if (!field(opt, b[42], 'Personal number', checks, errors, 'optional')) {
    // Mostly fillers with a few stray marks: if a blank personal number makes the overall check agree, it was blank.
    const blank = b.slice(0, 28) + '<'.repeat(15) + b[43];
    if ((opt.match(/</g) || []).length >= 8 && checkDigit(blank.slice(0, 10) + blank.slice(13, 20) + blank.slice(21, 43)) === b[43]) {
      b = blank; opt = b.slice(28, 42); checks.optional = true; errors.pop();
    }
  }
  field(composite(), b[43], 'Overall', checks, errors, 'composite');
  const { surname, given } = nameFrom(a.slice(5));
  const nat = b.slice(10, 13).replace(/<+$/, '');
  const dob = mrzDate(b.slice(13, 19), 'dob');
  const exp = mrzDate(b.slice(21, 27), 'expiry');
  const f = {
    type: a.slice(0, 2).replace(/<$/, ''),
    issuer: lettersOnly(a.slice(2, 5)).replace(/<+$/, ''),
    surname, given,
    number: number.replace(/<+$/, ''),
    nationalityCode: nat,
    nationality: COUNTRIES[nat] || nat,
    dob: dob ? dob.text : '',
    expiry: exp ? exp.text : '',
    sex: b[20] === '<' ? 'X' : b[20],
    personal: opt.replace(/<+$/, ''),
    rawName: a.slice(5),
  };
  return finish('TD3', [a, b], f, checks, errors);
}

function parseTD2(l1, l2) {
  const a = dropNameTail(fitLength(fixFillers(l1), 36), 5);
  let b = fitLength(fixFillers(l2), 36);
  const num = (s, from, to) => s.slice(0, from) + digitsOnly(s.slice(from, to)) + s.slice(to);
  b = num(b, 9, 10); b = num(b, 13, 20); b = num(b, 21, 28); b = num(b, 35, 36);
  const checks = {}; const errors = [];
  let number = b.slice(0, 9);
  if (!field(number, b[9], 'Document number', checks, errors, 'number')) {
    const fixed = repairNumber(number, b[9]);
    if (fixed) { number = fixed; b = fixed + b.slice(9); checks.number = true; errors.pop(); }
  }
  field(b.slice(13, 19), b[19], 'Date of birth', checks, errors, 'dob');
  field(b.slice(21, 27), b[27], 'Expiry date', checks, errors, 'expiry');
  field(b.slice(0, 10) + b.slice(13, 20) + b.slice(21, 35), b[35], 'Overall', checks, errors, 'composite');
  const { surname, given } = nameFrom(a.slice(5));
  const nat = lettersOnly(b.slice(10, 13)).replace(/<+$/, '');
  const dob = mrzDate(b.slice(13, 19), 'dob');
  const exp = mrzDate(b.slice(21, 27), 'expiry');
  return finish('TD2', [a, b], {
    type: a.slice(0, 2).replace(/<$/, ''), issuer: lettersOnly(a.slice(2, 5)).replace(/<+$/, ''), surname, given,
    number: number.replace(/<+$/, ''), nationalityCode: nat, nationality: COUNTRIES[nat] || nat,
    dob: dob ? dob.text : '', expiry: exp ? exp.text : '', sex: b[20] === '<' ? 'X' : b[20], personal: b.slice(28, 35).replace(/<+$/, ''), rawName: a.slice(5),
  }, checks, errors);
}

function parseTD1(l1, l2, l3) {
  let a = fitLength(fixFillers(l1), 30);
  let b = fitLength(fixFillers(l2), 30);
  const c = dropNameTail(fitLength(fixFillers(l3), 30), 0);
  const num = (s, from, to) => s.slice(0, from) + digitsOnly(s.slice(from, to)) + s.slice(to);
  a = num(a, 14, 15);
  b = num(b, 0, 7); b = num(b, 8, 15); b = num(b, 29, 30);
  const checks = {}; const errors = [];
  let number = a.slice(5, 14);
  if (!field(number, a[14], 'Document number', checks, errors, 'number')) {
    const fixed = repairNumber(number, a[14]);
    if (fixed) { number = fixed; a = a.slice(0, 5) + fixed + a.slice(14); checks.number = true; errors.pop(); }
  }
  field(b.slice(0, 6), b[6], 'Date of birth', checks, errors, 'dob');
  field(b.slice(8, 14), b[14], 'Expiry date', checks, errors, 'expiry');
  field(a.slice(5, 30) + b.slice(0, 7) + b.slice(8, 15) + b.slice(18, 29), b[29], 'Overall', checks, errors, 'composite');
  const { surname, given } = nameFrom(c);
  const nat = lettersOnly(b.slice(15, 18)).replace(/<+$/, '');
  const dob = mrzDate(b.slice(0, 6), 'dob');
  const exp = mrzDate(b.slice(8, 14), 'expiry');
  return finish('TD1', [a, b, c], {
    type: a.slice(0, 2).replace(/<$/, ''), issuer: lettersOnly(a.slice(2, 5)).replace(/<+$/, ''), surname, given,
    number: number.replace(/<+$/, ''), nationalityCode: nat, nationality: COUNTRIES[nat] || nat,
    dob: dob ? dob.text : '', expiry: exp ? exp.text : '', sex: b[7] === '<' ? 'X' : b[7], personal: a.slice(15, 30).replace(/<+$/, ''), rawName: c,
  }, checks, errors);
}

/** Parse MRZ lines that are already split (2 lines for TD3/TD2, 3 for TD1). */
export function parseMrz(lines) {
  const ls = lines.map(cleanLine).filter(Boolean);
  if (ls.length === 3) return parseTD1(...ls);
  if (ls.length !== 2) return { ok: false, format: null, lines: ls, fields: null, checks: {}, errors: ['Expected two or three lines'], doubtful: [] };
  const avg = (ls[0].length + ls[1].length) / 2;
  if (avg < 40 && avg >= 33) return parseTD2(...ls);
  return parseTD3(...ls);
}

const score = (r) => (r && r.fields ? Object.values(r.checks).filter(Boolean).length * 10 + (r.ok ? 100 : 0) - r.doubtful.length : -1);

/**
 * Find and parse an MRZ inside free OCR text (any number of lines, with junk around it).
 * Returns the best parse, or { ok: false, fields: null } when nothing MRZ-shaped is there.
 */
export function findMrz(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter((l) => l.length >= 20);
  let best = null;
  const consider = (r) => { if (score(r) > score(best)) best = r; };
  for (let i = 0; i < lines.length - 1; i += 1) {
    const l1 = lines[i];
    const l2 = lines[i + 1];
    // TD3: first line starts with P (sometimes after a stray character or two).
    if (l1.length >= 38 && l2.length >= 38) {
      const m = l1.match(/P[A-Z<][A-Z<]{3}/);
      const start = m && m.index <= 3 ? m.index : -1;
      if (start >= 0 || /<{3,}/.test(l1)) {
        const first = start >= 0 ? l1.slice(start) : l1;
        consider(parseTD3(first, l2.length > 46 ? l2.slice(l2.length - 44) : l2));
        // A line wider than 44 may have junk at the front instead of the back.
        if (l2.length > 44) consider(parseTD3(first, l2.slice(0, 44)));
      }
    }
    if (l1.length >= 32 && l1.length <= 40 && l2.length >= 32 && l2.length <= 40 && /^[ACI]/.test(l1)) consider(parseTD2(l1, l2));
    if (i < lines.length - 2 && [l1, l2, lines[i + 2]].every((l) => l.length >= 27 && l.length <= 33) && /^[ACI]/.test(l1)) consider(parseTD1(l1, l2, lines[i + 2]));
  }
  // Only call it found when at least one check digit agrees; otherwise it's probably not an MRZ.
  if (!best || !Object.values(best.checks).some(Boolean)) return { ok: false, format: null, lines: [], fields: null, checks: {}, errors: ['No machine-readable zone found'], doubtful: [] };
  return best;
}
