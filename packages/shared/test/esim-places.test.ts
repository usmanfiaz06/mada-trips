import { describe, expect, it } from 'vitest';
import { ESIM_COUNTRIES, correctEsimAsk, esimCountriesOf, esimDaysIn, esimDestinationOf, esimFlag, esimNearest, esimPlacesOf, esimRegionCoverage, findEsimPlace, type AskIntent } from '../src';
import { ESIM_FIXTURE_PACKAGES } from '../src/internal';

const base: AskIntent = {
  kind: 'esim', destination: null, destinationName: null, from: null, depart: null, return: null, tripType: null, monthOnly: null, cabin: null, cabinNote: null,
  travellerIds: null, travellerCount: null, infants: 0, party: null, needs: {}, needsMentioned: [], answers: {}, ask: null, source: 'rules',
} as unknown as AskIntent;

describe('eSIM places: any country, city or region by name', () => {
  it('names well over 150 countries, each with its flag and an Arabic name', () => {
    expect(ESIM_COUNTRIES.length).toBeGreaterThan(150);
    expect(new Set(ESIM_COUNTRIES.map((c) => c.code)).size).toBe(ESIM_COUNTRIES.length);
    expect(ESIM_COUNTRIES.every((c) => /[؀-ۿ]/.test(c.ar))).toBe(true);
    expect(esimFlag('PK')).toBe('🇵🇰');
    expect(esimFlag('europe')).toBeNull();
  });
  it('reads countries, cities and regions in English and Arabic', () => {
    for (const [text, code] of [['Pakistan', 'PK'], ['pakistan for 10 days', 'PK'], ['باكستان', 'PK'], ['لباكستان', 'PK'], ['Lahore', 'PK'], ['لاهور', 'PK'], ['Istanbul', 'TR'],
      ['اسطنبول', 'TR'], ['esim for turkey', 'TR'], ['Türkiye', 'TR'], ['the UAE', 'AE'], ['الإمارات', 'AE'], ['uk', 'GB'], ['South Africa', 'ZA'], ['Bali', 'ID'], ['New York', 'US'], ['PK', 'PK']] as const) {
      expect(findEsimPlace(text), text).toEqual({ kind: 'country', code });
    }
    expect(findEsimPlace('Europe')).toEqual({ kind: 'region', code: 'europe' });
    expect(findEsimPlace('أوروبا')).toEqual({ kind: 'region', code: 'europe' });
    for (const text of ['Need an esim', 'أبي شريحة', 'a nice plan for us', 'more data please']) expect(findEsimPlace(text), text).toBeNull();
  });
  it('reads the days', () => {
    expect(esimDaysIn('pakistan for 10 days')).toBe(10);
    expect(esimDaysIn('١٠ أيام')).toBe(10);
    expect(esimDaysIn('two weeks')).toBe(14);
    expect(esimDaysIn('اسبوعين')).toBe(14);
    expect(esimDaysIn('a week')).toBe(7);
    expect(esimDaysIn('شهر')).toBe(30);
    expect(esimDaysIn('5')).toBe(5);
    expect(esimDaysIn('Pakistan')).toBeNull();
  });
  it('lists what the supplier sells, and finds the closest plan where it sells none', () => {
    const places = esimPlacesOf(ESIM_FIXTURE_PACKAGES);
    expect(places.find((p) => p.code === 'PK')).toMatchObject({ kind: 'country', en: 'Pakistan', ar: 'باكستان' });
    expect(places.find((p) => p.code === 'world')).toMatchObject({ kind: 'region', en: 'Global' });
    expect(places.at(-1)?.code).toBe('world');
    expect(esimRegionCoverage(ESIM_FIXTURE_PACKAGES, 'europe')?.code).toBe('europe');
    expect(esimNearest(ESIM_FIXTURE_PACKAGES, 'RS')?.code).toBe('europe');
    expect(esimNearest(ESIM_FIXTURE_PACKAGES, 'MN')?.code).toBe('world');
    expect(esimDestinationOf('Lahore')).toEqual({ countries: ['PK'], region: null });
    expect(esimDestinationOf('istanbul')).toEqual({ countries: ['TR'], region: null });
    expect(esimCountriesOf({ city: 'Lahore', country: 'Pakistan' })).toEqual(['PK']);
  });
});

describe('typing while the eSIM planner is open', () => {
  it('sets the place and the days, never a dead end', () => {
    const a = correctEsimAsk(base, 'Pakistan');
    expect(a).toMatchObject({ type: 'apply', intent: { destination: 'PK' } });
    const b = correctEsimAsk(base, 'pakistan for 10 days');
    expect(b).toMatchObject({ type: 'apply', intent: { destination: 'PK', answers: { days: ['10'] } } });
    expect(correctEsimAsk(base, 'باكستان')).toMatchObject({ type: 'apply', intent: { destination: 'PK' } });
    expect(correctEsimAsk({ ...base, destination: 'PK' }, '14 days')).toMatchObject({ type: 'apply', intent: { destination: 'PK', answers: { days: ['14'] } } });
    expect(correctEsimAsk(base, 'Narnia')).toMatchObject({ type: 'place', intent: { destination: 'Narnia' } });
    expect(correctEsimAsk(base, 'a hotel in Dubai for 3 nights')).toEqual({ type: 'new' });
  });
});
