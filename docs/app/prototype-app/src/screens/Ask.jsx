import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, MRZ, FLIGHTS, HOTELS, STAY_NIGHTS, PICKUP, fmt, passportIssue } from '../store.jsx';
import { Icon, Sun, TopBar, Sheet, Steps, AirlineMark, AddPersonSheet, Plane, EmptyState, ArtCalendar, ArtSuitcase, ArtMap, ArtCompass, ArtDesk, InlineError } from '../ui.jsx';
import { PLANS } from './Plan.jsx';

/* Ask: one composer for flights, stays, plans and anything Faisal does by hand.
   State this file owns (read with defaults): askEntry (entry-rule answers per traveller),
   requestThreads (replies under a request, keyed by request id). It also appends to s.requests. */

/* ---------- dates ---------- */

export const TODAY = new Date(2026, 9, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromIso = (x) => { const [y, m, d] = x.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const nightsBetween = (a, b) => Math.round((fromIso(b) - fromIso(a)) / 864e5);
const yr = (d) => (d.getFullYear() !== TODAY.getFullYear() ? ' ' + d.getFullYear() : '');
const TODAY_ISO = iso(TODAY);
export const dayLabel = (x) => { const d = fromIso(x); return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${yr(d)}`; };
export function rangeLabel(a, b) {
  const A = fromIso(a);
  if (!b) return `${A.getDate()} ${MON[A.getMonth()]}${yr(A)}`;
  const B = fromIso(b);
  if (A.getMonth() === B.getMonth() && A.getFullYear() === B.getFullYear()) return `${A.getDate()}–${B.getDate()} ${MON[A.getMonth()]}${yr(B)}`;
  return `${A.getDate()} ${MON[A.getMonth()]}${A.getFullYear() !== B.getFullYear() ? yr(A) : ''} – ${B.getDate()} ${MON[B.getMonth()]}${yr(B)}`;
}
/* Saudi weekends: out on Thursday, back on Saturday. */
function weekend(offset) {
  const delta = (4 - TODAY.getDay() + 7) % 7;
  const thu = addDays(TODAY, delta + offset * 7);
  return [iso(thu), iso(addDays(thu, 2))];
}
const QUICK = [
  { id: 'thisWeekend', label: 'This weekend', dates: weekend(0) },
  { id: 'nextWeekend', label: 'Next weekend', dates: weekend(1) },
  { id: 'eid', label: 'Eid al-Fitr · Mar 2027', dates: ['2027-03-09', '2027-03-15'] },
  { id: 'school', label: 'School break', dates: ['2027-01-07', '2027-01-16'] },
];

/* ---------- reading what people type ---------- */

const REQUEST_KINDS = {
  visa: { short: 'visa', title: 'Visa', icon: 'visa' },
  umrah: { short: 'Umrah trip', title: 'Umrah', icon: 'umrah' },
  car: { short: 'car', title: 'Car rental', icon: 'car' },
  food: { short: 'table', title: 'Restaurant table', icon: 'food' },
  todo: { short: 'plans', title: 'Things to do', icon: 'star' },
  flight: { short: 'flights', title: 'Flights', icon: 'flight' },
  stay: { short: 'rooms', title: 'A place to stay', icon: 'stay' },
  general: { short: 'request', title: 'Request', icon: 'doc' },
};

const CITY_WORDS = [
  ['istanbul', /istanbul|t\u00fcrkiye|turkiye|turkey/],
  ['dubai', /dubai/],
  ['cairo', /cairo/],
  ['london', /london/],
  ['baku', /baku/],
  ['jeddah', /jeddah|jiddah/],
  ['alula', /al[- ]?ula/],
  ['abha', /abha/],
  ['tbilisi', /tbilisi|georgia/],
  ['paris', /paris/],
  ['bali', /bali\b/],
  ['maldives', /maldives/],
];
const FLIGHT_WORDS = /\b(flights?|fly|flying|plane|one[- ]?way|round[- ]?trip|return ticket|business class|economy|first class|premium economy|airfare|tickets? to)\b/;
const STAY_WORDS = /\b(hotels?|rooms?|apartment|villa|resort|somewhere to stay|place to stay|a stay)\b/;
const PLAN_WORDS = /\b(itinerary|plan (a|my|the)|days in|weekend in|day trip|what to do in)\b/;

export function parseIntent(text) {
  const t = text.toLowerCase();
  if (/\bumrah\b|makkah|mecca|madinah|medina/.test(t)) return 'umrah';
  if (/\bvisa\b|schengen|\beta\b|appointment/.test(t)) return 'visa';
  if (FLIGHT_WORDS.test(t)) return 'flight';
  if (/\besim\b|data plan|sim card|\bdata\b/.test(t)) return 'esim';
  if (STAY_WORDS.test(t)) return 'stay';
  if (/\bcars?\b|car rental|rent a car|\bdriver\b|\brental\b/.test(t)) return 'car';
  if (/restaurant|dinner|lunch|\btable\b|breakfast/.test(t)) return 'food';
  if (/\btours?\b|things to do|activit|museum|cruise|tickets/.test(t)) return 'todo';
  if (PLAN_WORDS.test(t) || (/alula|weekend/.test(t) && !/\bto\b/.test(t))) return 'plan';
  if (/\beid\b|\btrip\b|\breturn\b|\bto\b|same as last/.test(t) || CITY_WORDS.some(([, re]) => re.test(t))) return 'flight';
  return 'general';
}

const MRE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const mIdx = (m) => MON.map((x) => x.toLowerCase()).indexOf(m.slice(0, 3));
const NUMW = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const toNum = (w) => (/\d/.test(w) ? Number(w) : NUMW[w] || null);
function upcoming(day, mi) {
  let d = new Date(TODAY.getFullYear(), mi, day);
  if (d.getMonth() !== mi) return null;
  if (d < TODAY) d = new Date(TODAY.getFullYear() + 1, mi, day);
  return d;
}

/* People the account can book for. Works for any household, including a new one with just the account holder. */
export function householdOf(s) {
  const hh = (s.household && s.household.length ? s.household : ['omar']).filter((id) => PEOPLE[id]);
  const me = hh.find((id) => PEOPLE[id].role === 'You') || hh[0] || 'omar';
  const age = (p) => { const y = Number(p.born); return Number.isFinite(y) && y > 1900 ? TODAY.getFullYear() - y : 30; };
  const isChild = (id) => /\b(daughter|son|child)\b/i.test(PEOPLE[id].role || '') || age(PEOPLE[id]) < 18;
  const nonHelper = [me, ...hh.filter((id) => id !== me && !PEOPLE[id].helper)];
  return { hh, me, nonHelper, kids: nonHelper.filter(isChild), spouse: hh.find((id) => /spouse|wife|husband/i.test(PEOPLE[id].role || '')), helper: hh.find((id) => PEOPLE[id].helper), age };
}

function parseWho(t, s) {
  const H = householdOf(s);
  let ids = null;
  let n = null;
  let infants = 0;
  if (/\btwins\b/.test(t)) infants = 2;
  else if (/\b(baby|infant|newborn)\b/.test(t)) infants = 1;
  if (/just me|only me|\bfor me\b(?! and)|by myself|on my own|\balone\b|\bsolo\b/.test(t)) return { ids: [H.me], n: 1, infants };
  if (/all of us|whole family|the family|\bfamily\b|everyone|\ball (three|four|five|six)\b|the (three|four|five|six) of us|same as last/.test(t)) ids = [...H.nonHelper];
  const picked = new Set(ids || []);
  if (/\b(my )?(wife|husband|spouse)\b|the two of us|\bcouple\b/.test(t)) { picked.add(H.me); if (H.spouse) picked.add(H.spouse); n = 2; }
  if (/\b(kids|children|the boys|the girls)\b/.test(t)) { picked.add(H.me); H.kids.forEach((k) => picked.add(k)); }
  H.hh.forEach((id) => { if (id !== H.me && new RegExp(`\\b${PEOPLE[id].name.toLowerCase()}\\b`).test(t)) { picked.add(H.me); picked.add(id); } });
  if (/\b(helper|nanny|maid|housekeeper)\b/.test(t) && H.helper) { picked.add(H.me); picked.add(H.helper); }
  const nm = t.match(/\bfor (\d+|two|three|four|five|six)\b(?!\s*(?:nights?|days?|weeks?))|\b(\d+|two|three|four|five|six) (?:people|adults|travellers|passengers|of us)\b/);
  if (nm) n = toNum(nm[1] || nm[2]);
  if (picked.size) ids = [...picked];
  if (n && (!ids || ids.length < n)) ids = n <= H.nonHelper.length ? H.nonHelper.slice(0, n) : null;
  return { ids, n, infants };
}

export function parseDetails(text, s) {
  const t = ` ${text.toLowerCase()} `;
  const out = { city: null, cityName: null, from: null, dep: null, ret: null, type: null, monthOnly: null, cabin: null, cabinNote: null };
  const fm = t.match(/\bfrom (riyadh|jeddah|dammam|ruh|jed|dmm)\b/);
  if (fm) out.from = ({ riyadh: 'RUH', ruh: 'RUH', jeddah: 'JED', jed: 'JED', dammam: 'DMM', dmm: 'DMM' })[fm[1]];
  const t2 = fm ? t.replace(fm[0], ' ') : t;
  const hit = CITY_WORDS.find(([, re]) => re.test(t2));
  if (hit) out.city = hit[0];
  else if (/same as last/.test(t2)) out.city = 'istanbul';
  else {
    const m = t2.match(/\bto ([a-z][a-z-]{2,}(?: [a-z][a-z-]{2,})?)(?=\s+(?:on|in|for|next|this|with|at|by|and|from|over|during)\b|\s*[.,]|\s*$)/);
    const stop = /^(the|go|be|me|us|stay|fly|visit|book|see|get|take|bring|somewhere|anywhere|travel|do|have|leave|come)\b/;
    if (m && !stop.test(m[1])) { out.city = 'other'; out.cityName = m[1].replace(/\b\w/g, (c) => c.toUpperCase()); }
  }
  /* dates */
  let dep = null;
  let ret = null;
  let m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|\\u2013|to|until|till)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MRE})\\b`));
  if (m) {
    dep = upcoming(+m[1], mIdx(m[3]));
    if (dep) { const r = new Date(dep.getFullYear(), dep.getMonth(), +m[2]); if (r > dep) ret = r; }
  } else {
    const all = [...t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MRE})\\b|\\b(${MRE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))];
    const ds = all.map((x) => (x[1] ? upcoming(+x[1], mIdx(x[2])) : upcoming(+x[4], mIdx(x[3])))).filter(Boolean);
    if (ds[0]) dep = ds[0];
    if (ds[1]) { ret = ds[1]; if (ret <= dep) ret = new Date(ret.getFullYear() + 1, ret.getMonth(), ret.getDate()); }
  }
  if (!dep) {
    if (/next weekend/.test(t)) [dep, ret] = weekend(1).map(fromIso);
    else if (/this weekend|the weekend|\bweekend\b/.test(t)) [dep, ret] = weekend(0).map(fromIso);
    else if (/eid al[- ]?adha|\badha\b/.test(t)) { dep = new Date(2027, 4, 15); ret = new Date(2027, 4, 20); }
    else if (/\beid\b|same as last/.test(t)) { dep = new Date(2027, 2, 9); ret = new Date(2027, 2, 15); }
    else if (/school break|mid-?year break|winter break/.test(t)) { dep = new Date(2027, 0, 7); ret = new Date(2027, 0, 16); }
    else if (/\btomorrow\b/.test(t)) dep = addDays(TODAY, 1);
    else if (/\btonight\b|\btoday\b/.test(t)) dep = TODAY;
  }
  if (!dep) {
    const mo = t.match(new RegExp(`\\b(?:in|during|early|late|mid|end of|start of|this|next)\\s+(${MRE})\\b`)) || t.match(/\b(jan(?:uary)?|feb(?:ruary)?|march|april|june|july|august|sept(?:ember)?|october|november|december)\b/);
    if (mo) { const mi = mIdx(mo[1]); const y = mi < TODAY.getMonth() ? TODAY.getFullYear() + 1 : TODAY.getFullYear(); out.monthOnly = { mi, year: y }; }
    else if (/ramadan/.test(t)) out.monthOnly = { mi: 1, year: 2027, label: 'Ramadan' };
    else if (/summer/.test(t)) out.monthOnly = { mi: 6, year: 2027, label: 'the summer' };
  }
  const dur = t.match(/\bfor (\d+|a|one|two|three|four|five|six|seven) (night|day|week)s?\b/);
  if (dep && !ret && dur) ret = addDays(dep, toNum(dur[1]) * (dur[2] === 'week' ? 7 : 1));
  if (/one[- ]?way|single ticket|no return|not coming back/.test(t)) { out.type = 'oneway'; ret = null; }
  else if (ret || /\breturn\b|round[- ]?trip|and back|coming back/.test(t)) out.type = 'return';
  out.dep = dep ? iso(dep) : null;
  out.ret = ret ? iso(ret) : null;
  if (/first class|\bin first\b/.test(t)) { out.cabin = 'Business'; out.cabinNote = 'First isn’t sold on these routes. Business is the best cabin.'; }
  else if (/premium/.test(t)) out.cabin = 'Premium';
  else if (/business/.test(t)) out.cabin = 'Business';
  else if (/economy/.test(t)) out.cabin = 'Economy';
  Object.assign(out, parseWho(t, s));
  return out;
}

const INTENT_PROMPT = {
  flight: 'Flights', stay: 'A place to stay', visa: 'A visa', umrah: 'An Umrah trip', car: 'A car', food: 'A table somewhere good', todo: 'Things to do', esim: 'Data for the trip',
};

/* ---------- where we fly ---------- */

const SV = { airline: 'Saudia', iata: 'SV', brand: '#0b6b52' };
const XY = { airline: 'flynas', iata: 'XY', brand: '#5b2a86' };
const TK = { airline: 'Turkish Airlines', iata: 'TK', brand: '#c8102e' };
const AIRPORT = { RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam' };

export const DEST = {
  istanbul: { name: 'Istanbul', code: 'IST', country: 'TR' },
  dubai: { name: 'Dubai', code: 'DXB', country: 'AE', flights: [
    { id: 'sv', label: 'Best for you', ...SV, code: 'SV554', dep: '08:05', arr: '11:10', dur: '2h 05m', pp: 1240, reason: 'Arrives at Terminal 1 before lunch.', bags: '2 × 23 kg', change: 'SAR 200 per person', refund: 'Refund minus SAR 300 per person' },
    { id: 'xy', label: 'Lowest price', ...XY, code: 'XY201', dep: '14:40', arr: '17:45', dur: '2h 05m', pp: 690, reason: 'Cabin bag only. A 20 kg bag is SAR 120 more.', bags: '7 kg cabin bag', change: 'SAR 150 per person', refund: 'Not refundable' },
  ] },
  cairo: { name: 'Cairo', code: 'CAI', country: 'EG', flights: [
    { id: 'sv', label: 'Best for you', ...SV, code: 'SV305', dep: '10:15', arr: '11:40', dur: '2h 25m', pp: 1180, reason: 'A daytime flight. Meals on board.', bags: '2 × 23 kg', change: 'SAR 200 per person', refund: 'Refund minus SAR 300 per person' },
    { id: 'xy', label: 'Lowest price', ...XY, code: 'XY501', dep: '06:30', arr: '07:55', dur: '2h 25m', pp: 820, reason: 'Early start, a full first day.', bags: '1 × 20 kg', change: 'SAR 150 per person', refund: 'Not refundable' },
  ] },
  london: { name: 'London', code: 'LHR', country: 'GB', flights: [
    { id: 'sv', label: 'Best for you', ...SV, code: 'SV119', dep: '01:50', arr: '05:45', dur: '6h 55m', pp: 3950, reason: 'Direct to Heathrow. Sleep on the way.', bags: '2 × 23 kg', change: 'SAR 400 per person', refund: 'Refund minus SAR 600 per person' },
    { id: 'tk', label: 'Lowest price', ...TK, code: 'TK145', dep: '03:05', arr: '10:50', dur: '10h 45m', stop: 'One stop in Istanbul', pp: 2780, reason: 'One stop in Istanbul, 1h 50m to change.', bags: '2 × 23 kg', change: 'SAR 300 per person', refund: 'Refund minus SAR 450 per person' },
  ] },
  baku: { name: 'Baku', code: 'GYD', country: 'AZ', flights: [
    { id: 'xy', label: 'Best for you', ...XY, code: 'XY241', dep: '09:20', arr: '14:00', dur: '3h 40m', pp: 1150, reason: 'The only direct flight. Arrives mid-afternoon.', bags: '1 × 20 kg', change: 'SAR 150 per person', refund: 'Not refundable' },
    { id: 'tk', label: 'Two bags each', ...TK, code: 'TK143', dep: '02:10', arr: '11:35', dur: '8h 25m', stop: 'One stop in Istanbul', pp: 1890, reason: 'One stop in Istanbul. Two bags each.', bags: '2 × 23 kg', change: 'Free', refund: 'Refund minus SAR 300 per person' },
  ] },
  jeddah: { name: 'Jeddah', code: 'JED', country: 'SA', flights: [
    { id: 'sv', label: 'Best for you', ...SV, code: 'SV1021', dep: '07:00', arr: '08:50', dur: '1h 50m', pp: 420, reason: 'Every hour through the day. This one beats the traffic.', bags: '1 × 23 kg', change: 'SAR 100 per person', refund: 'Refund minus SAR 150 per person' },
    { id: 'xy', label: 'Lowest price', ...XY, code: 'XY35', dep: '13:15', arr: '15:00', dur: '1h 45m', pp: 290, reason: 'Cabin bag only.', bags: '7 kg cabin bag', change: 'SAR 100 per person', refund: 'Not refundable' },
  ] },
  alula: { name: 'AlUla', code: 'ULH', country: 'SA', flights: [
    { id: 'sv', label: 'Best for you', ...SV, code: 'SV1561', dep: '09:30', arr: '11:05', dur: '1h 35m', pp: 680, reason: 'In time for lunch in the Old Town.', bags: '1 × 23 kg', change: 'SAR 100 per person', refund: 'Refund minus SAR 150 per person' },
    { id: 'xy', label: 'Lowest price', ...XY, code: 'XY581', dep: '16:20', arr: '17:50', dur: '1h 30m', pp: 510, reason: 'Arrives for sunset.', bags: '1 × 20 kg', change: 'SAR 100 per person', refund: 'Not refundable' },
  ] },
  abha: { name: 'Abha', code: 'AHB', country: 'SA', flights: [
    { id: 'sv', label: 'Best for you', ...SV, code: 'SV1703', dep: '08:10', arr: '09:50', dur: '1h 40m', pp: 470, reason: 'Morning in the mountains.', bags: '1 × 23 kg', change: 'SAR 100 per person', refund: 'Refund minus SAR 150 per person' },
    { id: 'xy', label: 'Lowest price', ...XY, code: 'XY115', dep: '18:00', arr: '19:35', dur: '1h 35m', pp: 330, reason: 'After work. Cabin bag only.', bags: '7 kg cabin bag', change: 'SAR 100 per person', refund: 'Not refundable' },
  ] },
  tbilisi: { name: 'Tbilisi', code: 'TBS', country: 'GE', byHand: { pp: 1380, text: 'flynas direct on Thursdays and Sundays, 4h 05m' } },
  paris: { name: 'Paris', code: 'CDG', country: 'FR', byHand: { pp: 3400, text: 'Saudia direct to Charles de Gaulle, 6h 50m' } },
  bali: { name: 'Bali', code: 'DPS', country: 'ID', byHand: { pp: 3900, text: 'Saudia direct to Denpasar three times a week, 9h 40m' } },
  maldives: { name: 'the Maldives', code: 'MLE', country: 'MV', byHand: { pp: 3600, text: 'Saudia direct to Malé, 5h 30m' } },
};

/* ---------- entry rules ---------- */

/* Kept small and plausible. Production reads Timatic; the date on the label is the day it was checked. */
const RULES = {
  TR: { name: 'Türkiye', SAU: { ok: 'Visa-free for 90 days.' }, PHL: { need: 'Türkiye e-Visa', text: (n) => `${n} needs a Türkiye e-Visa. A Philippine passport gets one online only with a valid US, UK or Schengen visa. Without one, it’s a visa from the consulate in Riyadh, about 10 working days.` } },
  AE: { name: 'the UAE', SAU: { ok: 'No visa needed.' }, PHL: { need: 'UAE visit visa', text: (n) => `${n} needs a UAE visit visa before flying. It takes about 3 working days.` } },
  EG: { name: 'Egypt', SAU: { ok: 'Visa on arrival, USD 25.' }, PHL: { need: 'Egypt visa', text: (n) => `${n} needs an Egypt visa from the embassy in Riyadh before flying, about 7 working days.` } },
  GB: { name: 'the UK', SAU: { eta: true, ok: 'A UK ETA for each Saudi passport: online, GBP 16, usually 3 days.' }, PHL: { need: 'UK visit visa', text: (n) => `${n} needs a UK visit visa. VFS Riyadh appointments take about 3 weeks.` } },
  AZ: { name: 'Azerbaijan', SAU: { ok: 'Visa on arrival.' }, PHL: { need: 'Azerbaijan e-Visa', text: (n) => `${n} needs an Azerbaijan e-Visa. It’s online, about 3 working days.` } },
  GE: { name: 'Georgia', SAU: { ok: 'Visa-free for a year.' }, PHL: { ok: 'Visa-free with a valid Saudi iqama.' } },
  SA: { name: 'Saudi Arabia', domestic: true },
};
const NAT = { SAU: 'Saudi', PHL: 'Philippine' };
const IQAMA = { lina: '2027-03-12' };

function natOf(id, s) {
  const p = PEOPLE[id];
  if (p?.nationality) return p.nationality;
  if (p?.role === 'You' || p?.self) { const n = s?.user?.passport?.nationality; if (n && !/saudi/i.test(n)) return n.slice(0, 3).toUpperCase(); }
  const mrz = MRZ[id];
  const code = mrz?.[0]?.slice(2, 5) || '';
  if (p?.helper && (!mrz || mrz[1] === 'Not scanned yet' || code.length < 3)) return null;
  return code.length === 3 && !code.includes('<') ? code : 'SAU';
}

/* Everything that could stop someone boarding, worked out before anyone pays. */
function entryChecks(s, who, destKey, dep, ret) {
  const dest = DEST[destKey];
  const c = dest?.country;
  const rule = RULES[c] || {};
  const ans = s.askEntry || {};
  const until = ret || dep;
  const out = [];
  who.forEach((id) => {
    const p = PEOPLE[id];
    if (!p) return;
    const nat = natOf(id, s);
    if (c === 'TR') {
      const pi = passportIssue(s, id);
      if (pi?.blocking) out.push({ id, p, key: 'passport', blocking: true, thing: 'passport', title: `${p.name} can't travel on this passport.`, text: pi.text });
    }
    if (!rule.domestic) {
      const r = nat ? rule[nat] : null;
      if (r?.need) {
        const k = `${id}:${c}:visa`;
        out.push(ans[k]
          ? { id, p, key: 'visa', blocking: false, done: true, text: ans[k] === 'has' ? `${p.name} already has the ${r.need}.` : `Faisal is getting ${p.name}’s ${r.need}. We check it before you fly.` }
          : { id, p, key: 'visa', blocking: true, thing: 'visa', title: `${p.name} needs a visa for ${rule.name}.`, text: r.text(p.name), need: r.need, ansKey: k });
      } else if (!r && dest) {
        out.push({ id, p, key: 'manual', blocking: false, info: true, text: `We don’t have ${p.name}’s passport country yet. Faisal checks the rules for ${rule.name || dest.name} by hand before booking.` });
      }
    }
    if (p.helper || (nat && nat !== 'SAU')) {
      const iq = ans[`${id}:iqama`] || IQAMA[id];
      if (iq && until && iq < until) {
        out.push({ id, p, key: 'iqama', blocking: true, thing: 'iqama', title: `${p.name}’s iqama runs out during the trip.`, text: `It expires ${dayLabel(iq)}, before you’re back on ${dayLabel(until)}. It must be valid for the whole trip.` });
      }
      if (!rule.domestic && dest) {
        const k = `${id}:reentry`;
        out.push(ans[k]
          ? { id, p, key: 'reentry', blocking: false, done: true, text: ans[k] === 'has' ? `${p.name} has an exit and re-entry visa.` : `Faisal is arranging ${p.name}’s exit and re-entry visa. We check it before you fly.` }
          : { id, p, key: 'reentry', blocking: true, thing: 'exit and re-entry visa', title: `${p.name} needs an exit and re-entry visa.`, text: `Anyone on an iqama needs one to leave Saudi Arabia and come back. It’s issued on Absher by the sponsor, usually the same day.`, ansKey: k });
      }
    }
  });
  if (rule.SAU?.eta && who.some((id) => natOf(id, s) === 'SAU')) {
    const k = `eta:${c}`;
    out.unshift(ans[k]
      ? { id: 'eta', key: 'eta', blocking: false, done: true, text: 'Faisal is applying for everyone’s UK ETA. We check them before you fly.' }
      : { id: 'eta', key: 'eta', blocking: false, info: true, eta: true, text: `Each Saudi passport needs a UK ETA. It’s online, GBP 16, usually ready in 3 days.`, ansKey: k });
  }
  return out;
}

const newRequest = (s, r) => ({ id: 'r' + Date.now() + Math.floor(Math.random() * 1000), status: s.demo.offline ? 'queued' : 'sent', created: Date.now(), ...r });

function EntryChecks({ checks, who, setWho, destKey, dep, ret }) {
  const { s, set } = useStore();
  const dest = DEST[destKey];
  const rule = RULES[dest?.country] || {};
  const answer = (k, v) => set((p) => ({ askEntry: { ...(p.askEntry || {}), [k]: v } }));
  const ask = (k, r) => { set((p) => ({ askEntry: { ...(p.askEntry || {}), [k]: 'asked' }, requests: [...p.requests, newRequest(s, r)] })); buzz(HAPTIC.success); };
  const range = rangeLabel(dep, ret);
  const nats = [...new Set(who.map((id) => natOf(id, s)).filter(Boolean))].map((n) => NAT[n] || n);
  const without = (id) => { setWho(who.filter((x) => x !== id)); buzz(HAPTIC.select); };
  if (!dest) return null;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row tiny rise" style={{ gap: 6 }}><Icon name="check" color="#2f7a4b" size={14} width={2.4} />Rules checked today · {rule.domestic ? 'a flight inside Saudi Arabia' : `${rule.name || dest.name}, for ${nats.join(' and ') || 'your'} passports`}{!checks.length && !rule.domestic && rule.SAU?.ok ? ` · ${rule.SAU.ok}` : ''}</div>
      {checks.map((c) => {
        if (c.done || (c.info && !c.eta)) return (
          <div key={c.id + c.key} className="row small rise" style={{ gap: 8, alignItems: 'flex-start', color: '#1e352d' }}><Icon name={c.done ? 'check' : 'doc'} size={16} color={c.done ? '#2f7a4b' : '#7d5d27'} width={2.2} /><span>{c.text}</span></div>
        );
        if (c.eta) return (
          <div key="eta" className="notice rise">
            <Icon name="visa" />
            <div className="grow">
              <span className="small" style={{ color: '#1e352d' }}>{c.text}</span>
              <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => ask(c.ansKey, { kind: 'visa', short: 'UK ETA', title: 'UK ETA for everyone', detail: `${who.map((id) => PEOPLE[id].name).join(', ')} · for ${range}`, quote: 60 * who.length })}>Ask Mada to apply</button>
            </div>
          </div>
        );
        return (
          <div key={c.id + c.key} className="notice warn rise" role="alert">
            <Icon name="visa" color="#7d5d27" />
            <div className="grow">
              <span className="h3">{c.title}</span>
              <span className="small">{c.text}</span>
              <div className="row" style={{ marginTop: 6, flexWrap: 'wrap', gap: 8 }}>
                {c.key === 'visa' && <button type="button" className="btn primary small" onClick={() => ask(c.ansKey, { kind: 'visa', short: c.need, title: `${c.need} for ${c.p.name}`, detail: `For ${dest.name}, ${range} · ${NAT[natOf(c.id, s)] || ''} passport`, quote: 350 })}>Ask Mada to get it</button>}
                {c.key === 'reentry' && <button type="button" className="btn primary small" onClick={() => ask(c.ansKey, { kind: 'visa', short: 'exit and re-entry visa', title: `Exit and re-entry visa for ${c.p.name}`, detail: `Single, valid 90 days · covers ${range}`, quote: 200 })}>Ask Mada to arrange the exit and re-entry visa</button>}
                {c.key === 'reentry' && <button type="button" className="btn secondary small" onClick={() => answer(c.ansKey, 'has')}>{c.p.name} already has one</button>}
                {c.key === 'iqama' && <button type="button" className="btn secondary small" onClick={() => answer(`${c.id}:iqama`, iso(addDays(fromIso(ret || dep), 365)))}>It’s been renewed</button>}
                {c.key === 'passport' && <RenewButton p={c.p} />}
                {c.p.id !== householdOf(s).me && <button type="button" className={'btn small ' + (c.key === 'passport' ? 'primary' : 'secondary')} onClick={() => without(c.id)}>Book without {c.p.name}</button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RenewButton({ p }) {
  const { s, set } = useStore();
  const asked = s.requests.some((r) => r.title === `Passport renewal for ${p.name}`);
  return (
    <button type="button" className="btn secondary small" disabled={asked} onClick={() => {
      set((prev) => ({ requests: [...prev.requests, newRequest(s, { kind: 'visa', short: 'passport renewal', title: `Passport renewal for ${p.name}`, detail: 'Before the trip', quote: 150 })] }));
      buzz(HAPTIC.success);
    }}>{asked ? 'Mada is on it' : 'Renew it first'}</button>
  );
}

const blockLabel = (b) => `Sort out ${b.p.name}’s ${b.thing} first`;

/* ---------- the screen ---------- */

export default function Ask({ params }) {
  const { s, set, pop, toast } = useStore();
  const [query, setQuery] = useState(params.prefill || (params.intent ? INTENT_PROMPT[params.intent] : ''));
  const [intent, setIntent] = useState(params.intent || (params.prefill ? parseIntent(params.prefill) : null));
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [cta, setCta] = useState(null);

  const submit = (text) => {
    const v = (text ?? draft).trim();
    if (!v) return;
    buzz(HAPTIC.tap);
    setQuery(v);
    setIntent(parseIntent(v));
    setRound((r) => r + 1);
    setCta(null);
    setDraft('');
  };

  useEffect(() => { if (s.guest && intent) setNeedsSignIn(true); }, [intent]);

  let body;
  if (!intent) body = <Start onPick={submit} />;
  else if (intent === 'flight') body = <FlightFlow key={round} query={query} setCta={setCta} />;
  else if (intent === 'stay') body = <StayFlow key={round} query={query} setCta={setCta} />;
  else if (intent === 'esim') body = <EsimFlow />;
  else if (intent === 'plan') body = <PlanFlow key={round} query={query} />;
  else body = <RequestFlow key={round} kind={intent} query={query} />;

  return (
    <div className={'screen push ask' + (s.demo.offline ? ' is-offline' : '')}>
      <TopBar onBack={pop} backLabel="Close" />
      <p className="tiny" style={{ margin: '0 24px 8px' }}>Instant answers from Mada. Faisal and the team confirm anything you book.</p>
      <div className="scroll no-dock ask-scroll">
        {query && <div className="rise ask-bubble">{query}</div>}
        {s.demo.offline && ['flight', 'stay'].includes(intent) ? <Offline /> : body}
      </div>
      {cta && !s.demo.offline ? (
        <div className="act ask-act">
          <button type="button" className="btn primary block" disabled={cta.disabled} onClick={cta.onClick}>{cta.label}</button>
          <button type="button" className="link" style={{ alignSelf: 'center', fontSize: 13 }} onClick={() => setCta(null)}>Ask something else</button>
        </div>
      ) : (
        <form className="act ask-act" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="row ask-composer">
            <label htmlFor="ask-input" className="sr-only-ask">Ask Mada</label>
            <input id="ask-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={intent ? 'Anything else?' : 'Where to? Say it any way you like'} autoComplete="off" />
            <button type={draft ? 'submit' : 'button'} className="icon-btn dark" aria-label={draft ? 'Send' : 'Hold to talk'} onClick={draft ? undefined : () => toast('Voice comes in the app. Type here for now.')}>
              <Icon name={draft ? 'up' : 'mic'} color="#f6f2ec" size={20} />
            </button>
          </div>
        </form>
      )}
      {needsSignIn && (
        <Sheet label="Sign in to book" onClose={() => { setNeedsSignIn(false); pop(); }}>
          <h2 className="h2">Sign in to book</h2>
          <p className="body">Booking needs an account, so Mada can confirm with your details and your tickets land in your Wallet.</p>
          <button type="button" className="btn primary block" onClick={() => set({ onboarded: false, guest: false, stack: [], signinFrom: { name: 'ask', params: { prefill: query || params.prefill || '' } } })}>Sign in</button>
          <button type="button" className="btn ghost block" onClick={() => { setNeedsSignIn(false); pop(); }}>Not now</button>
        </Sheet>
      )}
    </div>
  );
}

function Start({ onPick }) {
  const { s } = useStore();
  /* Ideas only use what we actually know about this person. */
  const H = householdOf(s);
  const n = H.nonHelper.length;
  const kid = H.kids[0] ? PEOPLE[H.kids[0]].name : null;
  const ideas = s.trip
    ? [`Add a hotel in ${s.trip.city || 'Istanbul'}`, 'Dinner on the first night', 'A car for a day trip', 'Data for the trip']
    : n > 2
      ? [`Istanbul for Eid, all ${n} of us`, ...((s.pastTrips || []).length ? ['Same as last Eid'] : []), 'A hotel in Istanbul', kid ? `Schengen visa for ${kid}` : 'A Schengen visa', 'Umrah in Ramadan']
      : ['Flights to Istanbul', 'Flights to Dubai next weekend', 'A hotel in Istanbul', 'A weekend in AlUla', 'Umrah in Ramadan'];
  return (
    <div className="col rise" style={{ gap: 14 }}>
      <h1 className="display" style={{ fontSize: 40 }}>Where to?</h1>
      <p className="body">Say it any way you like. A place, dates, who's going. We'll ask only what we need.</p>
      <div className="chips">{ideas.map((i) => <button key={i} type="button" className="chip" onClick={() => onPick(i)}>{i}</button>)}</div>
    </div>
  );
}

function Offline() {
  return (
    <div className="notice rise">
      <Icon name="wifiOff" />
      <div className="grow">
        <span className="h3">You're offline.</span>
        <span className="small">Searching needs a connection. Everything for your trips is still on this phone, and requests to Mada send once you're back.</span>
      </div>
    </div>
  );
}

function Working({ lines, step }) {
  return (
    <div className="row rise" style={{ alignItems: 'flex-start', gap: 12 }}>
      <Sun width={34} color="#b98f4a" className={step < lines.length ? 'think' : ''} style={{ flexShrink: 0, marginTop: 2 }} />
      <Steps items={lines.map((text, i) => ({ text, state: i < step ? 'done' : i === step ? 'now' : 'todo' })).filter((x, i) => i <= step)} />
    </div>
  );
}

function useSequence(n, ms, run) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!run) return undefined;
    setStep(0);
    const ts = Array.from({ length: n }, (_, i) => setTimeout(() => setStep(i + 1), ms * (i + 1)));
    return () => ts.forEach(clearTimeout);
  }, [run]);
  return step;
}

/* ---------- travellers picker ---------- */

function useTravellers(initial) {
  const { s } = useStore();
  return useState(() => initial || householdOf(s).nonHelper);
}

export function TravellerChips({ value, onChange }) {
  const { s } = useStore();
  const [adding, setAdding] = useState(false);
  const { hh } = householdOf(s);
  const all = [...hh, ...value.filter((id) => !hh.includes(id) && PEOPLE[id])];
  return (
    <div className="chips">
      {adding && <AddPersonSheet onClose={() => setAdding(false)} onAdded={(p) => { onChange([...value, p.id]); setAdding(false); }} />}
      {all.map((id) => {
        const p = PEOPLE[id];
        const on = value.includes(id);
        return (
          <button key={id} type="button" className="chip" aria-pressed={on ? 'true' : 'false'}
            onClick={() => { buzz(HAPTIC.select); if (on && value.length === 1) return; onChange(on ? value.filter((x) => x !== id) : [...value, id]); }}>
            {p.name}{p.helper ? ' (helper)' : ''}
          </button>
        );
      })}
      <button type="button" className="chip chip-add" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add someone</button>
    </div>
  );
}

/* ---------- flights ---------- */

const EMPTY_TRIP = { type: 'return', dep: null, ret: null, cabin: 'Economy', infants: 0, flex: false };

/* What Pay reads: { type, dep, ret, month, year, cabin, infants, flex } plus retMonth, retYear, nights, from, to. */
function toSearch(trip, dest) {
  const D = fromIso(trip.dep);
  const R = trip.ret ? fromIso(trip.ret) : null;
  return {
    type: trip.type, dep: D.getDate(), ret: R ? R.getDate() : D.getDate(), month: MON[D.getMonth()], year: D.getFullYear(),
    retMonth: R ? MON[R.getMonth()] : undefined, retYear: R ? R.getFullYear() : undefined, nights: R ? nightsBetween(trip.dep, trip.ret) : 0,
    depISO: trip.dep, retISO: trip.ret || null, cabin: trip.cabin, infants: trip.infants, flex: trip.flex, from: trip.from, to: dest.code, city: dest.name,
  };
}

function soloReason(text, n) {
  if (n === 1) return text.replace('Window seats together.', 'A window seat held for you.');
  if (n === 2) return text.replace('Window seats together.', 'Two seats side by side.');
  return text;
}

function FlightFlow({ query, setCta }) {
  const { s, set, push } = useStore();
  const d = useMemo(() => parseDetails(query, s), []);
  const H = householdOf(s);
  const home = s.account?.home || 'RUH';
  const [where, setWhere] = useState(d.city === 'other' ? { other: d.cityName } : d.city);
  const [otherDraft, setOtherDraft] = useState('');
  const [askingCity, setAskingCity] = useState(false);
  const [trip, setTrip] = useState({ ...EMPTY_TRIP, type: d.type || 'return', dep: d.dep, ret: d.ret, cabin: d.cabin || 'Economy', infants: d.infants || 0, from: d.from || home });
  const [who, setWho] = useTravellers(d.ids);
  const [whoDone, setWhoDone] = useState(!!d.ids || H.nonHelper.length <= 1);
  const [mode, setMode] = useState('normal');
  const [editing, setEditing] = useState(null);
  const [runKey, setRunKey] = useState(0);
  const [pick, setPick] = useState(null);
  const [open, setOpen] = useState(null);
  const [bundle, setBundle] = useState(false);
  const [retried, setRetried] = useState(false);
  const [sort, setSort] = useState('best');
  const [heldId, setHeldId] = useState(null);

  const destKey = typeof where === 'string' ? where : null;
  const dest = destKey ? DEST[destKey] : where?.other ? { name: where.other, byHand: { pp: 2400, text: 'one stop, about 9 hours' } } : null;
  const from = dest && dest.code === trip.from ? (trip.from === 'RUH' ? 'JED' : 'RUH') : trip.from;
  const needRet = trip.type === 'return' && trip.dep && !trip.ret;
  const ready = !!dest && !!trip.dep && !needRet && whoDone;
  const live = ready && !dest.byHand;
  const lines = [`Checking flights to ${dest?.name || ''}`, 'Holding seats at this price', `Matching seats and meals for ${who.length}`];
  const step = useSequence(lines.length, 750, live ? `${runKey}` : null);

  const cabinX = trip.cabin === 'Business' ? 3.2 : trip.cabin === 'Premium' ? 1.7 : 1;
  const legX = trip.type === 'oneway' ? 0.55 : 1;
  const fare = (f) => Math.round(f.pp * cabinX * legX);
  const infantFare = (f) => Math.round(fare(f) * 0.1);
  const dateLabel = trip.dep ? (trip.type === 'oneway' ? `${rangeLabel(trip.dep)}, one way` : rangeLabel(trip.dep, trip.ret)) : '';
  const nights = trip.dep && trip.ret ? nightsBetween(trip.dep, trip.ret) : 0;

  const pickCity = (v) => {
    if (v === 'other') { setAskingCity(true); return; }
    setWhere(v);
  };
  const submitCity = () => {
    const v = otherDraft.trim();
    if (!v) return;
    const hit = CITY_WORDS.find(([, re]) => re.test(v.toLowerCase()));
    setWhere(hit ? hit[0] : { other: v.replace(/\b\w/g, (c) => c.toUpperCase()) });
    setAskingCity(false);
    buzz(HAPTIC.tap);
  };
  const sheet = editing && (
    <SearchSheet value={{ ...trip, from }} month={editing.month} adults={who.length} onClose={() => setEditing(null)}
      onDone={(t) => { setTrip(t); setEditing(null); setRunKey((k) => k + 1); }} />
  );

  if (!dest) return (
    <div className="col rise" style={{ gap: 12 }}>
      <Ask1 q="Where to?" options={[['Istanbul', 'istanbul'], ['Dubai', 'dubai'], ['Cairo', 'cairo'], ['London', 'london'], ['Somewhere else', 'other']]} onPick={pickCity} />
      {askingCity && (
        <form className="row rise" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); submitCity(); }}>
          <div className="field grow"><label htmlFor="ask-city">Which city?</label><input id="ask-city" className="input" value={otherDraft} onChange={(e) => setOtherDraft(e.target.value)} placeholder="Tbilisi, Baku, Abha…" autoFocus autoComplete="off" /></div>
          <button type="submit" className="btn primary small" style={{ alignSelf: 'flex-end', height: 52 }} disabled={!otherDraft.trim()}>Go</button>
        </form>
      )}
    </div>
  );

  if (!trip.dep) {
    const mo = d.monthOnly;
    const inMonth = mo ? QUICK.filter((q) => fromIso(q.dates[0]).getMonth() === mo.mi) : [];
    const opts = mo
      ? [...inMonth.map((q) => [`${q.label.split(' ·')[0]} · ${rangeLabel(...q.dates)}`, q.id]), ['I’ll pick dates', 'pick']]
      : [['Eid al-Fitr · 9–15 Mar', 'eid'], [`This weekend · ${rangeLabel(...QUICK[0].dates)}`, 'thisWeekend'], [`Next weekend · ${rangeLabel(...QUICK[1].dates)}`, 'nextWeekend'], [`School break · ${rangeLabel(...QUICK[3].dates)}`, 'school'], ['I’ll pick dates', 'pick']];
    return (
      <>
        <Ask1 q={mo ? `When in ${mo.label || MONTH_LONG[mo.mi]}?` : 'When?'} options={opts} onPick={(v) => {
          if (v === 'pick') { setEditing({ month: mo }); return; }
          const q = QUICK.find((x) => x.id === v);
          setTrip({ ...trip, dep: q.dates[0], ret: trip.type === 'oneway' ? null : q.dates[1] });
        }} />
        {sheet}
      </>
    );
  }
  if (needRet) {
    const dd = fromIso(trip.dep);
    return (
      <>
        <Ask1 q={`Leaving ${dayLabel(trip.dep)}. Coming back when?`} options={[[`After 3 nights · ${dayLabel(iso(addDays(dd, 3)))}`, 3], [`After a week · ${dayLabel(iso(addDays(dd, 7)))}`, 7], ['One way', 'oneway'], ['I’ll pick dates', 'pick']]} onPick={(v) => {
          if (v === 'pick') setEditing({});
          else if (v === 'oneway') setTrip({ ...trip, type: 'oneway', ret: null });
          else setTrip({ ...trip, ret: iso(addDays(dd, v)) });
        }} />
        {sheet}
      </>
    );
  }
  if (!whoDone) return (
    <div className="col rise" style={{ gap: 12 }}>
      <span className="h2">Who's going?</span>
      {d.n && d.n > who.length && <span className="small">You said {d.n}. Add the others so we have their names as on their passports.</span>}
      <TravellerChips value={who} onChange={setWho} />
      <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => { buzz(HAPTIC.tap); setWhoDone(true); }}>{who.length === 1 ? 'Just ' + PEOPLE[who[0]].name : `These ${who.length}`}</button>
    </div>
  );

  if (dest.byHand) return <FaisalSearch what="flights" dest={dest} trip={{ ...trip, from }} who={who} />;

  if (step < lines.length) return <Working lines={lines} step={step} />;

  const istanbul = destKey === 'istanbul';
  /* Our own search can't be reached: say so in place, keep everything they chose, one Try again. */
  if (s.demo.serverDown) return (
    <InlineError art={<ArtDesk />} title="We can’t reach our flight search right now."
      body="It’s on our side, not your connection. Your dates and travellers are kept, and saved trips still open."
      onRetry={() => setRunKey((k) => k + 1)} />
  );
  /* One airline isn't answering: the same in-place design, with the airlines that are. */
  if (istanbul && s.demo.supplierDown && mode === 'normal') return (
    <InlineError tone="partial" icon="flight" title="Saudia isn’t answering right now."
      body="flynas and Turkish Airlines are. Or Faisal can search Saudia by hand and reply here within 20 minutes."
      secondary={<>
        <button type="button" className="btn primary small" onClick={() => { setMode('others'); buzz(HAPTIC.tap); }}>Show the others</button>
        <button type="button" className="btn secondary small" onClick={() => setMode('byhand')}>Ask Mada</button>
      </>} />
  );
  if (mode === 'byhand') return <RequestFlow kind="flight" query={`Saudia flights to Istanbul · ${dateLabel}`} note="Faisal will search Saudia by hand and send you the options here within 20 minutes." autoSend />;
  if (mode === 'askall') return <RequestFlow kind="flight" query={`Flights to ${dest.name} · ${dateLabel}`} note="Faisal will search by hand and send you the options here within 20 minutes." autoSend />;
  /* The search ran out of time: nothing is lost, try once more or hand it to Mada. */
  if (s.demo.searchTimeout && !retried && mode === 'normal') return (
    <InlineError art={<ArtCompass />} title="The search took too long."
      body={`Airlines were slow to answer for ${dest.name}. Your dates and travellers are kept.`}
      onRetry={() => { setRetried(true); setRunKey((k) => k + 1); }}
      secondary={<button type="button" className="btn secondary small" onClick={() => { buzz(HAPTIC.tap); setMode('askall'); }}>Ask Mada to search</button>} />
  );

  if (s.demo.noResults && mode === 'normal') return (
    <EmptyState art={<ArtCalendar day={String(fromIso(trip.dep).getDate())} />} title="Nothing direct on those dates."
      body={`Seats to ${dest.name} are gone on ${dayLabel(trip.dep)}. There’s room a day either side, or with one short stop.`}
      action={<button type="button" className="btn primary block" onClick={() => { setMode('flex'); setRunKey((k) => k + 1); }}>Try a day either side</button>}
      ideas={[['Allow one stop', () => { setMode('flex'); setRunKey((k) => k + 1); }]]} />
  );

  const durMin = (f) => { const m = f.dur.match(/(\d+)h (\d+)m/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  const base = istanbul ? FLIGHTS : dest.flights;
  const options = base.filter((f) => !(s.demo.supplierDown && mode === 'others' && f.iata === 'SV'))
    .map((f) => ({ ...f, from, reason: soloReason(f.reason, who.length) }))
    .sort((a, b) => (sort === 'cheapest' ? a.pp - b.pp : sort === 'fastest' ? durMin(a) - durMin(b) : sort === 'earliest' ? a.dep.localeCompare(b.dep) : 0));
  const current = options.find((f) => f.id === pick) || options[0];
  const checks = entryChecks(s, who, destKey, trip.dep, trip.ret);
  const blocking = checks.filter((c) => c.blocking);
  const lastEid = who.length > 2 && (s.pastTrips || []).some((t) => /eid/i.test(t.note || ''));
  const showBundle = istanbul && trip.type === 'return' && nights > 0;
  const hotelTotal = Math.round(HOTELS[0].night * nights * (who.length > 2 ? 1 : 0.55)) + PICKUP;
  const total = fare(current) * who.length + infantFare(current) * trip.infants + (bundle && showBundle ? hotelTotal : 0);
  const search = toSearch({ ...trip, from }, dest);
  const flexLabel = mode === 'flex' && trip.type === 'return' ? rangeLabel(iso(addDays(fromIso(trip.dep), 1)), trip.ret) : dateLabel;

  const review = () => {
    if (istanbul) { push('pay', { kind: 'trip', flightId: current.id, travellers: who, bundle: bundle && showBundle, flex: mode === 'flex', search }); return; }
    /* Routes outside the live booking flow: Faisal holds the fare and the traveller pays the held price. */
    const names = who.map((id) => PEOPLE[id].name).join(', ');
    const r = newRequest(s, {
      kind: 'flight', short: `flights to ${dest.name}`, title: `Flights to ${dest.name} · ${dateLabel}`,
      detail: `${current.airline} ${current.code} · ${AIRPORT[from] || from} → ${dest.name} · ${names} · ${trip.cabin}`,
      status: 'quote', quote: total,
      quoteText: `${current.airline} ${current.code}, leaving ${dayLabel(trip.dep)} at ${current.dep}${trip.ret ? `, back ${dayLabel(trip.ret)}` : ''}. ${trip.cabin}, ${current.bags}. Held at SAR ${fmt(total)} for ${who.length === 1 ? 'you' : `all ${who.length} of you`} until 18:00 today.`,
    });
    const existing = heldId && s.requests.find((x) => x.id === heldId && x.quote === total && x.status === 'quote');
    if (!existing) { set((p) => ({ requests: [...p.requests, r] })); setHeldId(r.id); }
    push('pay', { kind: 'quote', requestId: existing ? existing.id : r.id, search });
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row tiny rise"><Icon name="check" color="#2f7a4b" size={16} width={2.4} />Checked {istanbul ? 14 : 9} flights · holding seats for {who.length}</div>
      {blocking.length > 0 && <span className="row small rise" style={{ color: '#7d5d27', gap: 6 }}><Icon name="visa" size={16} color="#7d5d27" />{blocking.length === 1 ? 'One thing' : `${blocking.length} things`} to sort out before booking. They’re below the flights.</span>}
      <h2 className="h2 rise d1" style={{ fontSize: 24 }}>{options.length === 3 ? 'Three' : options.length === 2 ? 'Two' : 'One'} {options.length === 1 ? 'way' : 'ways'} to get there.</h2>
      {d.cabinNote && <span className="small rise d1">{d.cabinNote}</span>}
      <button type="button" className="search-summary rise d1" onClick={() => setEditing({})} aria-label="Edit search">
        <span className="col" style={{ gap: 1 }}>
          <span className="h3" style={{ fontSize: 15 }}>{AIRPORT[from] || from} → {dest.name} · {flexLabel}</span>
          <span className="tiny">{who.length} {who.length === 1 ? 'adult' : 'people'}{trip.infants ? ` + ${trip.infants} on a lap` : ''} · {trip.cabin}{trip.flex ? ' · ±2 days' : ''}</span>
        </span>
        <span className="link" style={{ fontSize: 14 }}>Edit</span>
      </button>
      <div className="row" style={{ gap: 16 }} role="group" aria-label="Sort flights">
        {[['best', 'Best'], ['cheapest', 'Cheapest'], ['fastest', 'Fastest'], ['earliest', 'Earliest']].map(([id, label]) => (
          <button key={id} type="button" className="sort-tab" aria-pressed={sort === id ? 'true' : 'false'} onClick={() => { setSort(id); buzz(HAPTIC.select); }}>{label}</button>
        ))}
      </div>
      {options.map((f, i) => {
        const on = current.id === f.id;
        return (
          <div key={f.id} className={'card rise d' + (i + 2) + (on ? ' selected' : '')} style={{ padding: 0, gap: 0 }}>
            <button type="button" aria-pressed={on ? 'true' : 'false'} className="flight-opt" onClick={() => { buzz(HAPTIC.select); if (on) setOpen(open === f.id ? null : f.id); else { setPick(f.id); setOpen(null); } }}>
              <span className="spread">
                <span className="row" style={{ gap: 10 }}>
                  <AirlineMark flight={f} />
                  <span className="col" style={{ gap: 2 }}>
                    <span className="h3" style={{ fontSize: 15 }}>{f.airline}</span>
                    <span className="pill" style={{ height: 22, alignSelf: 'flex-start', ...(on ? { background: '#d9b77a' } : {}) }}>{f.label}</span>
                  </span>
                </span>
                <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>SAR {fmt(fare(f) * who.length + infantFare(f) * trip.infants)}</span>
              </span>
              <Leg f={f} to={f.to || dest.code} />
              <span className="small">{f.reason}</span>
            </button>
            {on && open === f.id && (
              <div className="col rise" style={{ padding: '0 16px 14px', gap: 8 }}>
                <div className="divider" />
                {[['Bags', f.bags], ['Change', f.change], ['Cancel', f.refund], ...(trip.type === 'oneway' || !trip.ret ? [] : [['Return', `${f.back || f.code.replace(/\d+$/, (x) => String(Number(x) + 1))} · ${dayLabel(trip.ret)}`]]), ...(trip.infants ? [['Lap infant', `SAR ${fmt(infantFare(f))} each · bassinet on request`]] : [])].map(([k, v]) => (
                  <div key={k} className="spread small"><span>{k}</span><span style={{ color: '#1e352d', fontWeight: 600 }}>{v}</span></div>
                ))}
              </div>
            )}
            {on && open !== f.id && <span className="tiny" style={{ padding: '0 16px 12px' }}>Tap again for bags and change rules</span>}
          </div>
        );
      })}

      <div className="card well rise d4" style={{ gap: 10 }}>
        <span className="h3">Travellers</span>
        <TravellerChips value={who} onChange={setWho} />
      </div>

      <EntryChecks checks={checks} who={who} setWho={setWho} destKey={destKey} dep={trip.dep} ret={trip.ret} />

      {showBundle && (
        <div className="card rise d5" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div className="grow col" style={{ gap: 3 }}>
            <span className="h3">{who.some((id) => PEOPLE[id]?.helper) ? 'Add rooms near Galata Tower and airport pickup?' : who.length > 2 ? 'Add connecting rooms near Galata Tower and airport pickup?' : who.length === 2 ? 'Add a room for two near Galata Tower and airport pickup?' : 'Add a room near Galata Tower and airport pickup?'}</span>
            <span className="small">{lastEid ? 'You asked for connecting rooms last Eid. ' : ''}{nights} {nights === 1 ? 'night' : 'nights'} · SAR {fmt(hotelTotal)}</span>
          </div>
          <button type="button" className={'btn small ' + (bundle ? 'primary' : 'secondary')} aria-pressed={bundle ? 'true' : 'false'} onClick={() => { setBundle(!bundle); buzz(HAPTIC.select); }}>{bundle ? 'Added' : 'Add'}</button>
        </div>
      )}

      <PublishCta setCta={setCta} cta={{
        label: blocking.length ? blockLabel(blocking[0]) : `Review · SAR ${fmt(total)}`,
        disabled: blocking.length > 0,
        onClick: review,
      }} deps={[blocking.length, blocking[0]?.key, total, current.id, who.join(), bundle, mode, JSON.stringify(trip), heldId]} />
      {sheet}
    </div>
  );
}

/* Same look as Route, but honest about stops. */
function Leg({ f, to }) {
  return (
    <div className="route">
      <div className="end"><span className="t">{f.dep}</span><span className="c">{f.from}</span></div>
      <div className="mid">
        <div className="line"><span /><Plane /><span /></div>
        <span className="tiny">{f.dur} · {f.stop ? '1 stop, IST' : 'direct'}</span>
      </div>
      <div className="end r"><span className="t">{f.arr}</span><span className="c">{to}</span></div>
    </div>
  );
}

/* A city we don't sell live: Faisal searches it by hand and replies in the request. */
function FaisalSearch({ what, dest, trip, who }) {
  const { s, set, go } = useStore();
  const [sent, setSent] = useState(null);
  useEffect(() => {
    const names = who.map((id) => PEOPLE[id].name).join(', ');
    const dates = trip.dep ? (trip.type === 'oneway' ? `${rangeLabel(trip.dep)}, one way` : rangeLabel(trip.dep, trip.ret)) : 'Dates to agree';
    const pp = Math.round((dest.byHand?.pp || 0) * (trip.cabin === 'Business' ? 3.2 : trip.cabin === 'Premium' ? 1.7 : 1) * (trip.type === 'oneway' ? 0.55 : 1));
    const r = newRequest(s, what === 'stay'
      ? { kind: 'stay', short: `rooms in ${dest.name}`, title: `A place to stay in ${dest.name}`, detail: `${dates} · ${names}`, quote: 0 }
      : { kind: 'flight', short: `flights to ${dest.name}`, title: `Flights to ${dest.name} · ${dates}`, detail: `From ${AIRPORT[trip.from] || trip.from} · ${names} · ${trip.cabin}`, quote: pp * who.length,
        quoteText: `Best option: ${dest.byHand.text}. SAR ${fmt(pp)} each, SAR ${fmt(pp * who.length)} for ${who.length === 1 ? 'you' : `all ${who.length} of you`}. I can hold it until 18:00 tomorrow.` });
    set((p) => ({ requests: [...p.requests, r] }));
    setSent(r);
    buzz(HAPTIC.success);
  }, []);
  if (!sent) return null;
  return (
    <div className="col rise" style={{ gap: 14 }}>
      <div className="es-stage" aria-hidden="true"><ArtMap /></div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span className="avatar green">F</span>
        <div className="col" style={{ gap: 2 }}>
          <span className="h3">{sent.status === 'queued' ? `Saved. Faisal starts on ${dest.name} when you’re back online.` : what === 'stay' ? `Faisal is finding rooms in ${dest.name} for you.` : `Faisal is searching ${dest.name} for you.`}</span>
          <span className="small">Options here within 20 minutes. You don’t need to stay on this screen.</span>
        </div>
      </div>
      <div className="card well"><span className="h3">{sent.title}</span><span className="small">{sent.detail}</span></div>
      <button type="button" className="btn primary block" onClick={() => go('trips')}>See it in Trips</button>
    </div>
  );
}

/* Edit a search in one place: where from, dates, trip type, cabin, babies. */
function SearchSheet({ value, month, adults = 1, onClose, onDone }) {
  const [t, setT] = useState(value);
  const [pickRet, setPickRet] = useState(value.type === 'return' && !!value.dep && !value.ret);
  const start = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  const idxOf = (d) => (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth();
  const initial = value.dep ? idxOf(fromIso(value.dep)) : month ? idxOf(new Date(month.year, month.mi, 1)) : 0;
  const [page, setPage] = useState(Math.min(11, Math.max(0, initial)));
  const pm = new Date(start.getFullYear(), start.getMonth() + page, 1);
  const days = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
  const lead = pm.getDay();
  const strip = useRef(null);
  useEffect(() => { strip.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [page]);

  const pickDay = (x) => {
    buzz(HAPTIC.select);
    if (t.type === 'oneway') { setT({ ...t, dep: x, ret: null }); return; }
    if (!pickRet || !t.dep || x <= t.dep) { setT({ ...t, dep: x, ret: null }); setPickRet(true); return; }
    setT({ ...t, ret: x }); setPickRet(false);
  };
  const quick = (q) => { buzz(HAPTIC.select); setT({ ...t, type: 'return', dep: q.dates[0], ret: q.dates[1] }); setPickRet(false); setPage(idxOf(fromIso(q.dates[0]))); };
  const n = t.dep && t.ret ? nightsBetween(t.dep, t.ret) : 0;
  const status = !t.dep ? (t.type === 'oneway' ? 'Pick the day you leave' : 'Pick the day you leave, then the day back')
    : t.type === 'oneway' ? `Leaving ${dayLabel(t.dep)}`
      : !t.ret ? `Leaving ${dayLabel(t.dep)} · now pick the return`
        : `${dayLabel(t.dep)} → ${dayLabel(t.ret)} · ${n} ${n === 1 ? 'night' : 'nights'}`;
  const canSearch = t.dep && (t.type === 'oneway' || t.ret);
  return (
    <Sheet label="Edit search" onClose={onClose}>
      <div className="search-sheet">
      <h2 className="h2">Your search</h2>
      <div className="seg" role="radiogroup" aria-label="Flying from">
        {['RUH', 'JED', 'DMM'].map((c) => <button key={c} type="button" role="radio" aria-checked={t.from === c ? 'true' : 'false'} onClick={() => setT({ ...t, from: c })}>{AIRPORT[c]}</button>)}
      </div>
      <div className="seg" role="radiogroup" aria-label="Trip type">
        {[['return', 'Return'], ['oneway', 'One way']].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={t.type === id ? 'true' : 'false'} onClick={() => { setT({ ...t, type: id, ret: id === 'oneway' ? null : t.ret }); setPickRet(id === 'return' && !!t.dep && !t.ret); }}>{label}</button>)}
      </div>
      <div className="chips cal-quick">{QUICK.map((q) => <button key={q.id} type="button" className={'chip' + (t.dep === q.dates[0] && t.ret === q.dates[1] ? ' on' : '')} onClick={() => quick(q)}>{q.label}</button>)}</div>
      <span className="h3" style={{ fontSize: 15 }} aria-live="polite">{status}</span>
      <div className="cal-months" ref={strip} role="group" aria-label="Months">
        {Array.from({ length: 12 }, (_, i) => { const m = new Date(start.getFullYear(), start.getMonth() + i, 1); return <button key={i} type="button" aria-pressed={page === i ? 'true' : 'false'} onClick={() => setPage(i)}>{MON[m.getMonth()]}{m.getMonth() === 0 || i === 0 ? ` ${m.getFullYear()}` : ''}</button>; })}
      </div>
      <div className="spread cal-head">
        <button type="button" className="icon-btn" aria-label="Previous month" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="back" size={18} /></button>
        <span className="h3" style={{ fontSize: 16 }}>{MONTH_LONG[pm.getMonth()]} {pm.getFullYear()}</span>
        <button type="button" className="icon-btn" aria-label="Next month" disabled={page === 11} onClick={() => setPage(page + 1)}><Icon name="chevron" size={18} /></button>
      </div>
      <div className="cal" role="grid" aria-label={`${MONTH_LONG[pm.getMonth()]} ${pm.getFullYear()}`}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <span key={i} className="cal-h">{x}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={'b' + i} />)}
        {Array.from({ length: days }, (_, i) => i + 1).map((dn) => {
          const x = iso(new Date(pm.getFullYear(), pm.getMonth(), dn));
          const past = x < TODAY_ISO;
          const inRange = t.type === 'return' && t.dep && t.ret && x > t.dep && x < t.ret;
          const end = x === t.dep || (t.type === 'return' && x === t.ret);
          const flex = t.flex && t.dep && !end && Math.abs(nightsBetween(t.dep, x)) <= 2;
          return <button key={dn} type="button" disabled={past} aria-label={dayLabel(x)} className={'cal-d' + (end ? ' end' : inRange ? ' in' : '') + (flex ? ' flex' : '') + (x === TODAY_ISO ? ' today' : '')} aria-pressed={end ? 'true' : 'false'} onClick={() => pickDay(x)}>{dn}</button>;
        })}
      </div>
      <label className="spread small" style={{ color: '#1e352d' }}><span>Flexible ±2 days</span><input type="checkbox" checked={t.flex} onChange={(e) => setT({ ...t, flex: e.target.checked })} /></label>
      <span className="eyebrow">Cabin</span>
      <div className="seg" role="radiogroup" aria-label="Cabin">
        {['Economy', 'Premium', 'Business'].map((c) => <button key={c} type="button" role="radio" aria-checked={t.cabin === c ? 'true' : 'false'} onClick={() => setT({ ...t, cabin: c })}>{c}</button>)}
      </div>
      <div className="spread">
        <span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Babies on a lap</span><span className="tiny">Under 2 on the day you fly back. One per adult.</span></span>
        <span className="row" style={{ gap: 10 }}>
          <button type="button" className="icon-btn" aria-label="One fewer baby" disabled={!t.infants} onClick={() => setT({ ...t, infants: t.infants - 1 })}>−</button>
          <span className="num h3" aria-live="polite">{t.infants}</span>
          <button type="button" className="icon-btn" aria-label="One more baby" disabled={t.infants >= Math.max(1, adults)} onClick={() => setT({ ...t, infants: t.infants + 1 })}>+</button>
        </span>
      </div>
      <button type="button" className="btn primary block" disabled={!canSearch} onClick={() => onDone(t)}>{canSearch ? 'Search' : !t.dep ? 'Pick a date' : 'Pick a return date'}</button>
      </div>
    </Sheet>
  );
}

function Ask1({ q, options, onPick }) {
  return (
    <div className="col rise" style={{ gap: 12 }}>
      <span className="h2">{q}</span>
      <div className="chips">{options.map(([label, v]) => <button key={label} type="button" className="chip" onClick={() => { buzz(HAPTIC.select); onPick(v); }}>{label}</button>)}</div>
    </div>
  );
}

/* ---------- stays ---------- */

function hotelNote(h, n, lastEid) {
  if (n > 2) return h.id === 'galata' ? (lastEid ? h.note : 'Connecting rooms on one floor.') : h.note;
  return ({ galata: n === 2 ? 'A quiet room for two on a high floor.' : 'A quiet room on a high floor.', sultan: 'Breakfast included.', bosphorus: 'Sea view. Late checkout.' })[h.id] || h.note;
}

function StayFlow({ query, setCta }) {
  const { s, push } = useStore();
  const d = useMemo(() => parseDetails(query || '', s), []);
  const [who, setWho] = useTravellers(d.ids);
  const run = useSequence(2, 700, 'go');
  const [pick, setPick] = useState('galata');
  const [byHand, setByHand] = useState(false);
  const otherCity = d.city && d.city !== 'istanbul' ? (d.city === 'other' ? { name: d.cityName, byHand: {} } : DEST[d.city]) : null;
  if (otherCity) return <FaisalSearch what="stay" dest={otherCity} trip={{ type: 'return', dep: d.dep, ret: d.ret, cabin: 'Economy', from: 'RUH' }} who={who} />;
  const n = who.length;
  const rooms = n > 2 ? '2 connecting rooms' : n === 2 ? '1 room for 2' : '1 room';
  if (run < 2) return <Working lines={['Checking 120 places near your plans', n > 2 ? 'Keeping rooms side by side' : 'Picking the quiet rooms']} step={run} />;
  if (byHand) return <FaisalSearch what="stay" dest={{ name: 'Istanbul', byHand: {} }} trip={{ type: 'return', dep: '2027-03-09', ret: '2027-03-15', cabin: 'Economy', from: 'RUH' }} who={who} />;
  if (s.demo.noResults) return (
    <EmptyState art={<ArtSuitcase />} title="No rooms free on those dates."
      body={`Everything near Galata is taken for ${rooms}. Faisal knows places that never show online, and can look by hand.`}
      action={<button type="button" className="btn primary block" onClick={() => { setByHand(true); buzz(HAPTIC.tap); }}>Ask Mada to find rooms</button>} />
  );
  const lastEid = n > 2 && (s.pastTrips || []).some((t) => /eid/i.test(t.note || ''));
  const cur = HOTELS.find((h) => h.id === pick);
  const factor = n > 2 ? 1 : 0.55;
  const dep = '2027-03-09';
  const checks = entryChecks(s, who, 'istanbul', dep, '2027-03-15');
  const blocking = checks.filter((c) => c.blocking);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="col rise" style={{ gap: 2 }}>
        <h2 className="h2" style={{ fontSize: 24 }}>Three places you'd like.</h2>
        <span className="small">9–15 Mar · 6 nights · {rooms}</span>
      </div>
      {HOTELS.map((h, i) => {
        const on = h.id === pick;
        return (
          <button key={h.id} type="button" className={'card tap rise d' + (i + 1) + (on ? ' selected' : '')} style={{ padding: 0, overflow: 'hidden', gap: 0 }} aria-pressed={on ? 'true' : 'false'} onClick={() => { setPick(h.id); buzz(HAPTIC.select); }}>
            <span className="photo" style={{ height: 120, borderRadius: 0, display: 'block' }}>
              <img src="img/istanbul.jpg" alt="" style={{ objectPosition: ['30% 60%', '80% 70%', '50% 20%'][i], filter: i === 2 ? 'hue-rotate(-10deg) saturate(1.1)' : undefined }} />
              <span className="pill" style={{ position: 'absolute', top: 10, insetInlineStart: 10, color: '#1e352d', background: on ? '#d9b77a' : 'rgba(255,253,249,.92)' }}>{h.label}</span>
              <span className="pill num" style={{ position: 'absolute', top: 10, insetInlineEnd: 10, color: '#1e352d', background: 'rgba(255,253,249,.92)' }}>{h.rating}</span>
            </span>
            <span className="col" style={{ padding: '12px 16px 14px', gap: 4 }}>
              <span className="spread"><span className="h3">{h.name}</span><span className="num" style={{ fontWeight: 600 }}>SAR {fmt(h.night * STAY_NIGHTS * factor)}</span></span>
              <span className="small">{h.area}</span>
              <span className="small" style={{ color: '#1e352d' }}>{hotelNote(h, n, lastEid)}</span>
            </span>
          </button>
        );
      })}
      <div className="card well rise d4" style={{ gap: 10 }}>
        <span className="h3">Who's staying</span>
        <TravellerChips value={who} onChange={setWho} />
      </div>
      <EntryChecks checks={checks} who={who} setWho={setWho} destKey="istanbul" dep={dep} ret="2027-03-15" />
      <PublishCta setCta={setCta} cta={{ label: blocking.length ? blockLabel(blocking[0]) : `Review · SAR ${fmt(cur.night * STAY_NIGHTS * factor)}`, disabled: blocking.length > 0, onClick: () => push('pay', { kind: 'stay', hotelId: cur.id, travellers: who }) }} deps={[cur.id, who.join(), blocking.length, blocking[0]?.key]} />
    </div>
  );
}

/* ---------- planned trips ---------- */

function PlanFlow({ query }) {
  const { s, push } = useStore();
  const step = useSequence(3, 650, 'go');
  const id = /istanbul/i.test(query) ? 'istanbul3' : 'alula2';
  const plan = PLANS[id];
  const kids = householdOf(s).kids.length > 0;
  if (step < 3) return <Working lines={['Looking at what’s open that weekend', kids ? 'Fitting it around prayer times and the kids' : 'Fitting it around prayer times', 'Holding tables and tour slots']} step={step} />;
  return (
    <div className="col rise" style={{ gap: 12 }}>
      <span className="h2">We've planned it. Change anything you like.</span>
      <button type="button" className="photo" style={{ height: 220, border: 0, padding: 0 }} onClick={() => push('plan', { id })}>
        <img src={plan.img} alt="" /><span className="shade" />
        <span className="over" style={{ textAlign: 'start', gap: 4 }}>
          <span className="pill glass" style={{ alignSelf: 'flex-start' }}>{plan.days} days · {plan.plan.reduce((a, x) => a + x.stops.length, 0)} stops</span>
          <span className="display" style={{ fontSize: 30, color: '#fffdf9' }}>{plan.title}</span>
          <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{plan.sub}</span>
        </span>
      </button>
      <button type="button" className="btn primary block" onClick={() => push('plan', { id })}>See the plan</button>
    </div>
  );
}

/* ---------- eSIM ---------- */

function EsimFlow() {
  const { s, push } = useStore();
  const n = s.trip ? s.trip.travellers.length : 1;
  return (
    <div className="col rise" style={{ gap: 12 }}>
      <h2 className="h2" style={{ fontSize: 24 }}>Data in Türkiye, ready on landing.</h2>
      <div className="card">
        <div className="spread"><span className="h3">10 GB for 7 days</span><span className="num" style={{ fontWeight: 600 }}>SAR 39 each</span></div>
        <span className="small">Installs on each phone before you fly. Turns on when you land. Your Saudi number keeps working for calls.</span>
      </div>
      <button type="button" className="btn primary block" onClick={() => push('pay', { kind: 'esim', count: n })}>Review · SAR {fmt(39 * n)}</button>
    </div>
  );
}

/* ---------- requests Faisal completes ---------- */

const NEEDS = [
  ['wheelchairGate', 'Wheelchair to the gate'],
  ['wheelchairSeat', 'Wheelchair to the seat'],
  ['diabetic', 'Diabetic meal'],
  ['lowSalt', 'Low-salt meal'],
  ['soft', 'Soft food'],
  ['toilet', 'Seat near the toilet'],
  ['oxygen', 'Travelling with oxygen'],
];
const NEED_LABEL = Object.fromEntries(NEEDS);
const NEED_WORDS = [
  ['wheelchairSeat', /wheel ?chair|can'?t walk|cannot walk|walking frame|walker/],
  ['diabetic', /diabet|sugar/],
  ['lowSalt', /low[- ]salt|blood pressure|hypertension|heart/],
  ['soft', /soft food|soft meal|dentures|chewing/],
  ['toilet', /toilet|bathroom|restroom/],
  ['oxygen', /oxygen|concentrator/],
];
const needsIn = (text) => NEED_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);

const FORMS = {
  visa: [
    { k: 'where', q: 'Which visa?', options: ['Schengen', 'UK', 'United States', 'Somewhere else'], from: [[/schengen|france|germany|italy|spain|europe/, 'Schengen'], [/\buk\b|britain|london|england/, 'UK'], [/\bus\b|\busa\b|america|united states/, 'United States']] },
    { k: 'who', q: 'For who?', people: true },
    { k: 'when', q: 'When do you travel?', options: ['This summer', 'In the next 3 months', 'Not sure yet'] },
  ],
  umrah: [
    { k: 'when', q: 'When?', options: ['In Ramadan', 'After Eid', 'Pick dates later'], from: [[/ramadan/, 'In Ramadan'], [/after eid/, 'After Eid']] },
    { k: 'who', q: 'Who’s going?', people: true },
    { k: 'needs', q: 'Anything we should arrange for each person?', needs: true },
    { k: 'stay', q: 'Where to stay in Makkah?', options: ['Steps from the Haram', 'Good value, short ride'], from: [[/haram|close|near|walk/, 'Steps from the Haram']] },
  ],
  car: [
    { k: 'where', q: 'Where?', options: ['Istanbul', 'Riyadh', 'Somewhere else'], from: [[/istanbul/, 'Istanbul'], [/riyadh/, 'Riyadh']] },
    { k: 'size', q: 'What size?', options: ['7 seats for the family', 'Standard car'] },
    { k: 'days', q: 'For how long?', options: ['1 day', '3 days', 'The whole trip'] },
  ],
  food: [
    { k: 'where', q: 'Where?', options: ['Istanbul, near the hotel', 'Riyadh'] },
    { k: 'when', q: 'When?', options: ['Tonight', 'Tomorrow', 'First night of the trip'], from: [[/tonight/, 'Tonight'], [/tomorrow/, 'Tomorrow'], [/first night/, 'First night of the trip']] },
    { k: 'pref', q: 'What matters?', options: ['Halal', 'Family seating', 'A view', 'Quiet'], multi: true },
  ],
  todo: [
    { k: 'pick', q: 'Pick what you like', options: ['Bosphorus dinner cruise', 'Princes’ Islands day trip', 'Topkapı Palace tickets', 'A food walk in Kadıköy'], multi: true },
    { k: 'who', q: 'Who’s going?', people: true },
    { k: 'needs', q: 'Anything we should arrange for each person?', needs: true },
  ],
  flight: [],
  stay: [],
  general: [],
};

const TODO_PP = { 'Bosphorus dinner cruise': 190, 'Princes’ Islands day trip': 160, 'Topkapı Palace tickets': 85, 'A food walk in Kadıköy': 140 };

/* A quote priced per person, so the traveller can see where every riyal goes. */
function buildQuote(kind, answers, who, needs, note, s) {
  const H = householdOf(s);
  const name = (id) => PEOPLE[id]?.name || 'Guest';
  const age = (id) => H.age(PEOPLE[id] || {});
  const needLines = [];
  who.forEach((id) => (needs[id] || []).forEach((k) => {
    if (k === 'oxygen') needLines.push(`Oxygen for ${name(id)}: I’ll arrange the airline’s approval. I need a doctor’s form 7 days before.`);
    else if (k.startsWith('wheelchair')) needLines.push(`${NEED_LABEL[k]} for ${name(id)} on both flights, no charge.`);
    else if (k === 'toilet') needLines.push(`${name(id)} sits near the toilet.`);
    else needLines.push(`${NEED_LABEL[k]} for ${name(id)} on both flights.`);
  }));
  const anyWheelchair = who.some((id) => (needs[id] || []).some((k) => k.startsWith('wheelchair')));
  if (kind === 'umrah') {
    const near = [].concat(answers.stay || [])[0] === 'Steps from the Haram';
    const breakdown = who.map((id) => {
      const a = age(id);
      const lines = [[a < 2 ? 'On a lap, flights and transfers' : 'Flights, 3 nights, train and transfers', a < 2 ? 350 : a < 12 ? 1650 : 2300]];
      if (near && a >= 2) lines.push(['Room steps from the Haram', 450]);
      if ((needs[id] || []).some((k) => k.startsWith('wheelchair'))) lines.push(['Wheelchair and pusher at the Haram, 3 days', 300]);
      return { id, name: name(id), lines };
    });
    const total = breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l[1], 0), 0);
    const helped = who.filter((id) => (needs[id] || []).length).map((id) => `${name(id)}: ${needs[id].map((k) => (k === 'oxygen' ? 'oxygen, with airline approval' : NEED_LABEL[k].toLowerCase())).join(', ')}.`);
    const extra = [...needLines, ...(anyWheelchair ? ['Rooms on a low floor, next to the lift.'] : [])];
    return { quote: total, breakdown, needLines: extra, quoteLead: `Flights to Madinah, 3 nights ${near ? 'steps from the Haram' : 'a short ride from the Haram'}, the Haramain train and transfers. Nusuk permits are yours to get; I’ll remind you.`, quoteText: `Flights to Madinah, 3 nights ${near ? 'steps from the Haram' : 'a short ride from the Haram'}, the Haramain train and transfers for ${who.length === 1 ? 'you' : `all ${who.length} of you`}: SAR ${fmt(total)}.${helped.length ? ` Arranged for each person. ${helped.join(' ')}` : ''}${note ? ' I’ve planned around your note.' : ''} Nusuk permits are yours to get; I’ll remind you.` };
  }
  if (kind === 'visa') {
    const breakdown = who.map((id) => ({ id, name: name(id), lines: [['Appointment, forms and checklist', 450]] }));
    const total = 450 * who.length;
    return { quote: total, breakdown, quoteText: `The earliest appointment is Tue 12 Jan, 10:20 at VFS Riyadh. I’ll book it and prepare every form. SAR 450 each, SAR ${fmt(total)} in total, plus the embassy fee paid on the day.` };
  }
  if (kind === 'todo') {
    const picks = [].concat(answers.pick || []);
    const breakdown = who.map((id) => ({ id, name: name(id), lines: picks.map((p) => [p, age(id) < 12 ? Math.round(TODO_PP[p] / 2) : TODO_PP[p]]) }));
    const total = breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l[1], 0), 0);
    return { quote: total, breakdown, quoteText: `${picks.join(', ')} for ${who.length === 1 ? 'you' : `all ${who.length} of you`}: SAR ${fmt(total)}. Children under 12 are half price.${needLines.length ? ' ' + needLines.join(' ').replace(/ on both flights/g, '') : ''}` };
  }
  return { quote: { car: 980, food: 0, general: 0, flight: 0, stay: 0 }[kind] ?? 0 };
}

function RequestFlow({ kind, query, note: sysNote, autoSend }) {
  const { s, set, go, push } = useStore();
  const form = FORMS[kind] || [];
  const lower = (query || '').toLowerCase();
  const H = householdOf(s);
  const typed = query && !Object.values(INTENT_PROMPT).includes(query) ? query : '';
  const [answers, setAnswers] = useState(() => {
    const a = {};
    form.forEach((f) => { const hit = (f.from || []).find(([re]) => re.test(lower)); if (hit) a[f.k] = [hit[1]]; });
    return a;
  });
  const named = H.hh.filter((id) => new RegExp(`\\b${PEOPLE[id].name.toLowerCase()}\\b`).test(lower));
  const [who, setWho] = useTravellers(named.length ? named : [H.me]);
  const mentioned = needsIn(lower);
  const [needs, setNeeds] = useState(() => {
    const out = {};
    /* "Hessa needs a wheelchair": a need in the same sentence as a name goes to that person. */
    lower.split(/[.;!?]|,| but /).forEach((part) => {
      const ks = needsIn(part);
      H.hh.filter((id) => new RegExp(`\\b${PEOPLE[id].name.toLowerCase()}\\b`).test(part)).forEach((id) => { out[id] = [...new Set([...(out[id] || []), ...ks])]; });
    });
    return out;
  });
  const [note, setNote] = useState(typed);
  const [sentId, setSentId] = useState(null);
  const firstOpen = form.findIndex((f) => !(f.people || f.needs ? answers[f.k] : answers[f.k]?.length));
  const done = firstOpen === -1;
  const assigned = new Set(Object.values(needs).flat());
  const unassigned = mentioned.filter((k) => !assigned.has(k));

  const send = () => {
    const info = REQUEST_KINDS[kind] || REQUEST_KINDS.general;
    const whoNames = who.map((id) => PEOPLE[id].name).join(', ');
    const needSummary = who.filter((id) => (needs[id] || []).length).map((id) => `${PEOPLE[id].name}: ${needs[id].map((k) => NEED_LABEL[k].toLowerCase()).join(', ')}`).join(' · ');
    const summary = form.map((f) => (f.people ? whoNames : f.needs ? needSummary : [].concat(answers[f.k] || []).join(', '))).filter(Boolean).join(' · ');
    const cleanNote = note.trim();
    const detail = [summary || (kind === 'general' || kind === 'flight' ? '' : query), cleanNote && cleanNote !== query ? `“${cleanNote}”` : cleanNote && form.length ? `“${cleanNote}”` : ''].filter(Boolean).join(' · ') || query;
    const q = buildQuote(kind, answers, who, needs, cleanNote, s);
    const r = newRequest(s, {
      kind, short: info.short, title: kind === 'general' || kind === 'flight' ? query : `${info.title}${answers.where ? ': ' + [].concat(answers.where)[0] : ''}`,
      detail, summary: summary || undefined, note: cleanNote || undefined, travellers: who, needs: needSummary || undefined, ...q,
    });
    set((prev) => ({ requests: [...prev.requests, r] }));
    setSentId(r.id);
    buzz(HAPTIC.success);
  };
  useEffect(() => { if (autoSend && !sentId) send(); }, []);

  if (sentId) return <SentRequest id={sentId} onTrips={() => go('trips')} />;

  return (
    <div className="col" style={{ gap: 18 }}>
      {sysNote && <div className="notice rise"><Icon name="doc" /><span className="grow small">{sysNote}</span></div>}
      {kind === 'umrah' && <div className="notice warn rise"><Icon name="umrah" color="#7d5d27" /><span className="grow small">Every traveller needs their own Nusuk permit. We'll remind you to get them once dates are set.</span></div>}
      {form.map((f, i) => (i > (done ? form.length : firstOpen) ? null : (
        <div key={f.k} className="col rise" style={{ gap: 10 }}>
          <span className="h2">{f.q}</span>
          {f.people && (
            <>
              <TravellerChips value={who} onChange={setWho} />
              {!answers[f.k] && <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => { setAnswers({ ...answers, [f.k]: true }); buzz(HAPTIC.tap); }}>Done</button>}
              {kind === 'visa' && who.some((id) => PEOPLE[id]?.helper) && <span className="small">For {who.filter((id) => PEOPLE[id]?.helper).map((id) => PEOPLE[id].name).join(' and ')} we'll also need the iqama and an exit and re-entry visa.</span>}
            </>
          )}
          {f.needs && (
            <>
              {unassigned.length > 0 && <span className="small" style={{ color: '#1e352d' }}>You mentioned {unassigned.map((k) => NEED_LABEL[k].toLowerCase()).join(' and ')}. Tap it for the right person.</span>}
              {who.map((id) => (
                <div key={id} className="card well need-card">
                  <span className="h3" style={{ fontSize: 15 }}>{PEOPLE[id].name}</span>
                  <div className="chips">
                    {NEEDS.map(([k, label]) => {
                      const on = (needs[id] || []).includes(k);
                      return <button key={k} type="button" className={'chip' + (!on && unassigned.includes(k) ? ' hint' : '')} aria-pressed={on ? 'true' : 'false'} aria-label={`${label} for ${PEOPLE[id].name}`} onClick={() => {
                        buzz(HAPTIC.select);
                        const cur = needs[id] || [];
                        let next = on ? cur.filter((x) => x !== k) : [...cur, k];
                        if (!on && k === 'wheelchairGate') next = next.filter((x) => x !== 'wheelchairSeat');
                        if (!on && k === 'wheelchairSeat') next = next.filter((x) => x !== 'wheelchairGate');
                        setNeeds({ ...needs, [id]: next });
                      }}>{label}</button>;
                    })}
                  </div>
                  {(needs[id] || []).includes('oxygen') && <span className="small" style={{ color: '#1e352d' }}>Faisal will arrange airline approval. He'll need a doctor's form 7 days before you fly.</span>}
                </div>
              ))}
              {!answers[f.k] && <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => { setAnswers({ ...answers, [f.k]: true }); buzz(HAPTIC.tap); }}>{Object.values(needs).some((x) => x.length) ? 'Done' : 'Nothing needed'}</button>}
            </>
          )}
          {f.options && (
            <div className="chips">
              {f.options.map((o) => {
                const cur = [].concat(answers[f.k] || []);
                const on = cur.includes(o);
                return <button key={o} type="button" className="chip" aria-pressed={on ? 'true' : 'false'} onClick={() => {
                  buzz(HAPTIC.select);
                  setAnswers({ ...answers, [f.k]: f.multi ? (on ? cur.filter((x) => x !== o) : [...cur, o]) : [o] });
                }}>{o}</button>;
              })}
            </div>
          )}
        </div>
      )))}
      {done && (
        <div className="col rise" style={{ gap: 10 }}>
          {form.length > 0 && (
            <div className="field">
              <label htmlFor="req-note">Anything else Faisal should know?</label>
              <textarea id="req-note" className="input req-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Times that suit you, a hotel you like, anyone’s health" />
            </div>
          )}
          <div className="row small"><span className="avatar sm green">F</span>Faisal will {kind === 'visa' ? 'find the earliest appointment and prepare the forms' : 'price it for each person'} and reply here.</div>
          <button type="button" className="btn primary block" onClick={send}>Send to Mada</button>
        </div>
      )}
    </div>
  );
}

function SentRequest({ id, onTrips }) {
  const { s, push } = useStore();
  const r = s.requests.find((x) => x.id === id);
  if (!r) return null;
  const answered = ['quote', 'paid', 'done'].includes(r.status);
  return (
    <div className="col rise" style={{ gap: 14 }}>
      <div className="row"><span className="avatar green">F</span><div className="col" style={{ gap: 0 }}><span className="h3">{r.status === 'queued' ? 'Saved. It sends when you’re back online.' : answered ? 'Faisal replied.' : 'Sent to Mada.'}</span><span className="small">{answered ? 'Here’s the price for each of you.' : 'Usually within 2 hours, any time of day.'}</span></div></div>
      <div className="card well" style={{ gap: 8 }}>
        <span className="h3">{r.title}</span>
        <span className="small">{r.summary || r.detail}</span>
        {r.note && r.summary && <span className="req-quote">“{r.note}”</span>}
      </div>
      {answered && r.quoteText && (
        <div className="card" style={{ gap: 10 }}>
          <div className="row"><span className="avatar sm green">F</span><span className="h3" style={{ fontSize: 14 }}>Faisal · your Mada agent</span></div>
          <span className="small" style={{ color: '#1e352d' }}>{r.quoteLead || r.quoteText}</span>
          {r.needLines?.length > 0 && <ul className="req-needs">{r.needLines.map((x) => <li key={x}>{x}</li>)}</ul>}
          <QuoteBreakdown r={r} />
          {r.status === 'quote' && r.quote > 0 && <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('pay', { kind: 'quote', requestId: r.id })}>Pay SAR {fmt(r.quote)}</button>}
        </div>
      )}
      <RequestThread requestId={r.id} />
      <button type="button" className="btn secondary block" onClick={onTrips}>See it in Trips</button>
    </div>
  );
}

export function QuoteBreakdown({ r }) {
  if (!r?.breakdown?.length) return null;
  return (
    <div className="quote-table" aria-label="Price for each person">
      {r.breakdown.map((b) => (
        <div key={b.id || b.name} className="quote-person">
          <span className="h3" style={{ fontSize: 14 }}>{b.name}</span>
          {b.lines.map(([label, price]) => (
            <div key={label} className="spread small"><span>{label}</span><span className="num" style={{ color: '#1e352d', fontWeight: 600 }}>SAR {fmt(price)}</span></div>
          ))}
        </div>
      ))}
      <div className="spread quote-total"><span>Total</span><span className="num">SAR {fmt(r.quote)}</span></div>
    </div>
  );
}

/* Replies under a request. Mount it under any request card: <RequestThread requestId={r.id} />. */
export function RequestThread({ requestId }) {
  const { s, set } = useStore();
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const r = s.requests.find((x) => x.id === requestId);
  const thread = (s.requestThreads || {})[requestId] || [];
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const add = (m) => set((p) => {
    const all = p.requestThreads || {};
    return { requestThreads: { ...all, [requestId]: [...(all[requestId] || []), { id: 't' + Date.now() + Math.random(), at: Date.now(), ...m }] } };
  });
  const answer = (text) => {
    const t = text.toLowerCase();
    const n = (r.travellers || []).length || 1;
    setTyping(true);
    timers.current.push(setTimeout(() => {
      setTyping(false);
      if (/closer|nearer|haram|walk/.test(t) && r.kind === 'umrah') add({ from: 'faisal', text: `Yes. A hotel at the King Abdulaziz Gate, 2 minutes’ walk to the Haram. SAR 380 more each, SAR ${fmt(380 * n)} for ${n === 1 ? 'you' : `all ${n}`}. Shall I switch it?`, offer: { add: 380, label: 'Room at the King Abdulaziz Gate' } });
      else if (/cheaper|less|budget|price/.test(t)) add({ from: 'faisal', text: 'I’ll look for a lower price on the same dates and reply here within 20 minutes.' });
      else if (/date|later|earlier|day|week/.test(t)) add({ from: 'faisal', text: 'I’ll check those dates with the airline and the hotel, and reply here within 20 minutes.' });
      else add({ from: 'faisal', text: 'Got it. I’ll check and reply here within 20 minutes.' });
      buzz(HAPTIC.knock);
    }, 1600));
  };
  const send = (text) => {
    const v = text.trim();
    if (!v) return;
    add({ from: 'me', text: v, queued: !!s.demo.offline });
    buzz(HAPTIC.tap);
    if (!s.demo.offline) answer(v);
  };
  useEffect(() => {
    if (s.demo.offline || !r) return;
    const q = thread.filter((m) => m.queued);
    if (!q.length) return;
    set((p) => ({ requestThreads: { ...p.requestThreads, [requestId]: (p.requestThreads[requestId] || []).map((m) => ({ ...m, queued: false })) } }));
    answer(q[q.length - 1].text);
  }, [s.demo.offline]);
  if (!r) return null;
  const accept = (m) => {
    const NEAR = 'Room steps from the Haram';
    const swap = (b) => {
      if (/^On a lap/.test(b.lines[0]?.[0] || '')) return b;
      const had = b.lines.some(([l]) => l === NEAR);
      return { ...b, lines: [...b.lines.filter(([l]) => l !== NEAR), [m.offer.label, m.offer.add + (had ? 450 : 0)]] };
    };
    const breakdown = r.breakdown ? r.breakdown.map(swap) : null;
    const total = breakdown ? breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l[1], 0), 0) : r.quote + m.offer.add * ((r.travellers || []).length || 1);
    set((p) => ({
      requests: p.requests.map((x) => (x.id !== requestId ? x : { ...x, quote: total, breakdown: breakdown || x.breakdown, quoteText: `${x.quoteText} Now at the King Abdulaziz Gate, 2 minutes’ walk to the Haram. New total SAR ${fmt(total)}.`, quoteLead: x.quoteLead ? `${x.quoteLead} Now at the King Abdulaziz Gate, 2 minutes’ walk to the Haram.` : undefined })),
      requestThreads: { ...p.requestThreads, [requestId]: (p.requestThreads[requestId] || []).map((t) => (t.id === m.id ? { ...t, accepted: true } : t)) },
    }));
    add({ from: 'me', text: 'Yes, switch it.' });
    setTyping(true);
    timers.current.push(setTimeout(() => {
      setTyping(false);
      add({ from: 'faisal', text: `Done. You’re at the King Abdulaziz Gate. New total SAR ${fmt(total)}. Pay when you’re ready.` });
      buzz(HAPTIC.success);
    }, 1400));
  };
  const suggestions = r.kind === 'umrah' ? ['Can we stay closer to the Haram?', 'Can we leave a day later?'] : r.kind === 'flight' ? ['Is there a later flight?', 'Can we pay less?'] : ['Can we change the dates?'];
  return (
    <div className="req-thread" aria-label="Replies to Faisal">
      {thread.map((m) => (
        <div key={m.id} className={'req-msg ' + (m.from === 'me' ? 'me' : 'them')}>
          {m.from !== 'me' && <span className="avatar sm green" aria-hidden="true">F</span>}
          <span className="col" style={{ gap: 6 }}>
            <span>{m.text}</span>
            {m.offer && !m.accepted && <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => accept(m)}>Switch it</button>}
            {m.queued && <span className="tiny">Sends when you’re back online</span>}
          </span>
        </div>
      ))}
      {typing && <div className="req-msg them"><span className="avatar sm green" aria-hidden="true">F</span><span className="dots" aria-label="Faisal is typing"><i /><i /><i /></span></div>}
      {!thread.length && <div className="chips">{suggestions.map((x) => <button key={x} type="button" className="chip" onClick={() => send(x)}>{x}</button>)}</div>}
      <form className="req-reply" onSubmit={(e) => { e.preventDefault(); send(draft); setDraft(''); }}>
        <label htmlFor={'rq-' + requestId} className="sr-only-ask">Reply to Faisal</label>
        <input id={'rq-' + requestId} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply to Faisal" autoComplete="off" />
        <button type="submit" className="icon-btn dark" aria-label="Send reply" disabled={!draft.trim()}><Icon name="up" color="#f6f2ec" size={18} /></button>
      </form>
    </div>
  );
}

function PublishCta({ setCta, cta, deps }) {
  useEffect(() => { setCta(cta); }, deps);
  useEffect(() => () => setCta(null), []);
  return <div style={{ height: 60 }} />;
}
