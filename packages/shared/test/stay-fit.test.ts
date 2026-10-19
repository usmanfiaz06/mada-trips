import { describe, expect, it } from 'vitest';
import { rankByFit, rankStays, reasonsLine, sharedStay, stayFit, tripShape, type Person, type StayFacts } from '../src';

const on = '2026-12-01';
const p = (relation: Person['relation'], dateOfBirth: string | null, isSelf = false) => ({ relation, dateOfBirth, isSelf });

describe('tripShape: from the travellers, never a guess', () => {
  it('a child under 12 makes a family', () => {
    const s = tripShape([p('self', '1988-01-01', true), p('spouse', '1990-01-01'), p('child', '2019-05-01'), p('child', '2021-05-01')], on);
    expect(s).toMatchObject({ shape: 'family', under12: 2, travellers: 4, because: '2 children under 12' });
  });
  it('two generations make a family even with grown children', () => {
    expect(tripShape([p('self', '1960-01-01', true), p('child', '1995-01-01')], on)).toMatchObject({ shape: 'family', generations: 2 });
    expect(tripShape([p('self', '1990-01-01', true), p('parent', '1960-01-01')], on).shape).toBe('family');
  });
  it('solo, couple, group, pilgrimage', () => {
    expect(tripShape([p('self', '1990-01-01', true)], on).shape).toBe('solo');
    expect(tripShape([p('self', '1990-01-01', true), p('spouse', '1991-01-01')], on)).toMatchObject({ shape: 'couple', because: 'you and your spouse' });
    expect(tripShape([p('self', '1990-01-01', true), p('friend', '1991-01-01'), p('friend', '1992-01-01')], on)).toMatchObject({ shape: 'group', because: '3 adults' });
    expect(tripShape([p('self', '1990-01-01', true), p('spouse', '1991-01-01')], on, { pilgrimage: true }).shape).toBe('pilgrimage');
  });
  it('a helper travelling along changes nothing', () => {
    expect(tripShape([p('self', '1990-01-01', true), p('helper', '1985-01-01')], on).shape).toBe('solo');
  });
});

const facts = (f: Partial<StayFacts>): StayFacts => ({ stars: 4, apartment: false, board: 'RO', room: null, refundable: false, payAtHotel: null, zone: null, lat: null, lng: null, content: true, amenities: [], views: [], quiet: false, deal: false, ...f });
// One set of Makkah hotels: a family resort further out, a 5-star tower downtown, and a plain hotel by the Haram.
const hotels = [
  { name: 'Family resort', total: 300000, facts: facts({ stars: 4, lat: 21.40, lng: 39.86, amenities: ['connecting', 'familyRooms', 'pool', 'kidsClub'], board: 'BB' }) },
  { name: 'Luxury tower', total: 380000, facts: facts({ stars: 5, lat: 21.4185, lng: 39.8262, amenities: ['spa'] }) },
  { name: 'By the Haram', total: 280000, facts: facts({ stars: 3, lat: 21.4232, lng: 39.8268, amenities: [] }) },
];
const ctx = { prices: { min: 280000, median: 300000 }, city: 'makkah', radiusKm: 8 };
const top = (shape: 'family' | 'couple' | 'pilgrimage') => rankByFit(hotels.map((h) => ({ ...h, total: { amount: h.total }, fit: stayFit({ facts: h.facts, total: h.total }, { ...ctx, shape }) })))[0]!;

describe('stayFit: the same hotels, ranked for who is going', () => {
  it('a family gets connecting rooms and a pool, a couple stars and location, a pilgrim the walk to the Haram', () => {
    expect(top('family').name).toBe('Family resort');
    expect(top('couple').name).toBe('Luxury tower');
    expect(top('pilgrimage').name).toBe('By the Haram');
  });
  it('the reasons are the facts that scored', () => {
    expect(reasonsLine(top('family').fit.reasons)).toBe('connecting rooms, family rooms, pool');
    expect(reasonsLine(top('pilgrimage').fit.reasons)).toBe('100 m to the Haram, good value for the area');
    // Thin facts: a plain line, never an invented one.
    expect(reasonsLine([])).toBe('well placed and well priced');
  });
  it('the same inputs always give the same order; a tie goes to the cheaper', () => {
    const twin = [{ name: 'B', total: { amount: 2 }, fit: { shape: 'solo' as const, score: 50, reasons: [] } }, { name: 'A', total: { amount: 1 }, fit: { shape: 'solo' as const, score: 50, reasons: [] } }];
    expect(rankByFit(twin).map((x) => x.name)).toEqual(['A', 'B']);
    expect(rankByFit(twin)).toEqual(rankByFit([...twin].reverse()));
  });
});

describe('shared rooms and hostels: never a pick, out of the list until asked for', () => {
  it('reads dorm beds, shared bathrooms and hostels, and leaves private rooms alone', () => {
    expect(sharedStay({ room: '8-bed mixed with external shared bathroom', hotelName: "St Christopher's London Bridge the Inn" })).toBe(true);
    expect(sharedStay({ room: 'Bed in 6-bed female dormitory' })).toBe(true);
    expect(sharedStay({ room: 'Double room with shared bathroom' })).toBe(true);
    expect(sharedStay({ room: 'Standard double', roomCode: 'DOR.ST' })).toBe(true);
    expect(sharedStay({ room: 'Private twin', categoryCode: 'HS' })).toBe(true);
    expect(sharedStay({ room: 'Private twin', hotelName: 'Generator London Hostel' })).toBe(true);
    for (const room of ['Deluxe double', 'Family room with bunk beds', 'Twin room 2 single beds', '1-bed apartment', 'Suite 2 bedrooms', 'Double room with private bathroom']) {
      expect(sharedStay({ room, roomCode: 'DBL.ST', categoryCode: '4EST', hotelName: 'The Strand Palace' })).toBe(false);
    }
  });
  it('a dorm bed never takes "Best for you" or "Lowest price", and comes after every private room', () => {
    const list = [
      { name: 'Dorm inn', total: { amount: 30000 }, facts: facts({ stars: 3, shared: true, refundable: true, lat: 51.505, lng: -0.09 }) },
      { name: 'Budget hotel', total: { amount: 90000 }, facts: facts({ stars: 2 }) },
      { name: 'Good hotel', total: { amount: 120000 }, facts: facts({ stars: 4 }) },
    ];
    const r = rankStays(list, { shape: 'solo', city: 'london', radiusKm: 8 });
    expect(r.map((x) => x.name).at(-1)).toBe('Dorm inn');
    expect(r.find((x) => x.badge === 'best')?.name).toBe('Good hotel');
    expect(r.find((x) => x.badge === 'lowest')?.name).toBe('Budget hotel');
    expect(r.find((x) => x.name === 'Dorm inn')?.badge).toBeNull();
  });
});
