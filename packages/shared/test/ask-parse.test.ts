import { describe, expect, it } from 'vitest';
import { arabicForRules, normalizeArabic, parseAskRules } from '../src';

const today = '2026-10-11'; // a Sunday
const parse = (text: string) => parseAskRules(text, { today, people: [] });

describe('Ask: English ways to ask for a stay', () => {
  it.each(['Stays', 'stay', 'hotel', 'hotels', 'rooms', 'accommodation', 'a place to stay in Dubai', 'stay in Dubai', 'rooms in Istanbul', 'accommodation in Cairo', 'where to stay in London', 'a villa in AlUla'])('%s is a stay', (text) => {
    expect(parse(text).kind).toBe('stay');
  });
  it('reads the place, the days and the party', () => {
    const r = parse('hotel in Dubai next weekend for 4');
    expect(r).toMatchObject({ kind: 'stay', destination: 'dubai', depart: '2026-10-22', return: '2026-10-24', count: 4 });
  });
  it('"this weekend" is a day, not a curated plan', () => {
    expect(parse('A desert camp with a chef this weekend').kind).toBe('general');
    expect(parse('A weekend in AlUla').kind).toBe('plan');
  });
  it('a flight with a stay word stays a flight', () => {
    expect(parse('flights to London for a 3 night stay').kind).toBe('flight');
  });
});

describe('Ask: Arabic is read by the same rules', () => {
  it('normalizes letters and digits', () => {
    expect(normalizeArabic('إقامة لـ ٤')).toBe('اقامه ل 4');
  });
  it.each([
    ['فندق في دبي', { kind: 'stay', destination: 'dubai' }],
    ['إقامة في إسطنبول', { kind: 'stay', destination: 'istanbul' }],
    ['فندق في دبي الويكند الجاي لـ ٤', { kind: 'stay', destination: 'dubai', depart: '2026-10-22', return: '2026-10-24', count: 4 }],
    ['رحلات إلى لندن', { kind: 'flight', destination: 'london' }],
    ['طيران للندن', { kind: 'flight', destination: 'london' }],
    ['عمرة في رمضان', { kind: 'umrah', answers: { when: ['In Ramadan'] } }],
    ['طاولة الليلة', { kind: 'food', depart: today, answers: { when: ['Tonight'] } }],
    ['حجز طاولة في الرياض الليلة', { kind: 'food', answers: { where: ['Riyadh'], when: ['Tonight'] } }],
    ['سيارة لمدة ٣ أيام', { kind: 'car', answers: { days: ['3 days'] } }],
    ['تأشيرة بريطانيا', { kind: 'visa', answers: { where: ['UK'] } }],
    ['بوليفارد وورلد الليلة', { kind: 'todo', depart: today, answers: { pick: ['Boulevard World'], when: ['Today'] } }],
    ['أبغى شي أسويه في الرياض', { kind: 'todo', answers: { where: ['Riyadh'] } }],
    ['شريحة انترنت', { kind: 'esim' }],
  ] as const)('%s', (text, want) => {
    expect(parse(text)).toMatchObject(want);
  });
  it('glued prefixes: لدبي, بدبي, للرياض', () => {
    expect(arabicForRules('طيران لدبي')).toBe('flights to dubai');
    expect(arabicForRules('فندق بدبي')).toBe('hotel in dubai');
    expect(arabicForRules('سيارة للرياض')).toBe('car to riyadh');
  });
  it('English comes back unchanged', () => {
    expect(arabicForRules('Hotel in Dubai')).toBe('Hotel in Dubai');
  });
});
