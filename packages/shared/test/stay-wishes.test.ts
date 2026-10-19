import { describe, expect, it } from 'vitest';
import {
  CITY_CENTRES, distanceFrom, landmarkById, anchorOfLandmark, mergeWishes, parseFlightWishes, parseStayWishes, parseThingWishes, refineStays, roomTitle, sortByDistance, sortStays, stayLines, t, visibleStays, wishLabel,
  type StayFacts, type StayOption,
} from '../src';

const facts = (f: Partial<StayFacts>): StayFacts => ({ stars: 4, apartment: false, board: 'RO', room: 'Double standard', refundable: false, payAtHotel: null, zone: 'Downtown', lat: null, lng: null, content: true, amenities: [], views: [], quiet: false, deal: false, ...f });
const stay = (id: string, sar: number, f: Partial<StayFacts>, extra: Partial<StayOption> = {}): StayOption => ({
  id: `00000000-0000-4000-8000-00000000000${id}`, label: 'best', name: `Hotel ${id}`, area: '', address: '', note: '', rating: '', photo: 'hotel-room', focal: '50% 50%', checkIn: '2026-10-22', nights: 2, rooms: 1, roomsLabel: '1 room',
  total: { amount: sar * 100, currency: 'SAR' }, cancellation: '', freeCancelUntil: null, expiresAt: '2026-10-22T00:00:00.000Z', facts: facts(f), ...extra,
});
const list = [
  stay('1', 1400, { stars: 5, lat: 25.1975, lng: 55.2750, amenities: ['pool', 'spa', 'gym'], views: ['burj'] }, { score: 90 }), // ~70 m from the Burj
  stay('2', 600, { stars: 3, lat: 25.2711, lng: 55.3075, board: 'BB' }, { score: 60 }), // Deira
  stay('3', 900, { stars: 4, lat: 25.0805, lng: 55.1403, amenities: ['pool', 'beach', 'kidsClub'], views: ['sea'], refundable: true }, { score: 75, freeCancelUntil: '2026-10-19' }), // Marina
  stay('4', 500, { stars: 1, lat: null, lng: null, content: false }, { score: 20 }),
];

describe('wishes: what people say', () => {
  it.each([
    ['I need a beach view', [{ k: 'view', view: 'beach' }]],
    ['closer to Burj Khalifa', [{ k: 'near', id: 'burj-khalifa', walk: false }]],
    ['quiet, for kids', [{ k: 'vibe', vibe: 'quiet' }, { k: 'vibe', vibe: 'family' }]],
    ['with a pool', [{ k: 'has', what: 'pool' }]],
    ['under SAR 600 a night', [{ k: 'price', max: 60000, per: 'night' }]],
    ['under 3000 in total', [{ k: 'price', max: 300000, per: 'stay' }]],
    ['breakfast included', [{ k: 'board', board: 'BB' }]],
    ['free cancellation', [{ k: 'freeCancel' }]],
    ['5 star please', [{ k: 'stars', min: 5 }]],
    ['a view of the Burj', [{ k: 'view', view: 'burj' }]],
  ] as const)('%s', (text, want) => {
    expect(parseStayWishes(text, 'dubai').wishes).toEqual(want);
  });
  it.each([
    ['إطلالة بحرية', [{ k: 'view', view: 'sea' }]],
    ['قريب من برج خليفة', [{ k: 'near', id: 'burj-khalifa', walk: false }]],
    ['فيه مسبح وفطور', [{ k: 'has', what: 'pool' }, { k: 'board', board: 'BB' }]],
    ['أقل من ٦٠٠ ريال بالليلة', [{ k: 'price', max: 60000, per: 'night' }]],
    ['إلغاء مجاني', [{ k: 'freeCancel' }]],
    ['هادئ ومناسب للأطفال', [{ k: 'vibe', vibe: 'quiet' }, { k: 'vibe', vibe: 'family' }]],
    ['خمس نجوم', [{ k: 'stars', min: 5 }]],
  ] as const)('Arabic: %s', (text, want) => {
    expect(parseStayWishes(text, 'dubai').wishes).toEqual(want);
  });
  it('walking to the Haram in Makkah', () => {
    expect(parseStayWishes('walk to the Haram', 'makkah').wishes).toEqual([{ k: 'near', id: 'haram', walk: true }]);
    expect(parseStayWishes('مشي للحرم', 'makkah').wishes).toEqual([{ k: 'near', id: 'haram', walk: true }]);
  });
  it('says what it could not read', () => {
    expect(parseStayWishes('a room with a piano', 'dubai')).toEqual({ wishes: [], rest: 'a room with a piano' });
  });
  it('a newer price replaces the older one', () => {
    const a = parseStayWishes('under 600 a night', 'dubai').wishes;
    const b = parseStayWishes('under 800 a night', 'dubai').wishes;
    expect(mergeWishes(a, b)).toEqual(b);
  });
  it('labels', () => {
    expect(wishLabel({ k: 'near', id: 'burj-khalifa', walk: false })).toBe('Near Burj Khalifa');
    expect(wishLabel({ k: 'price', max: 60000, per: 'night' })).toBe('Under SAR 600 a night');
    expect(t('wish.near', { place: 'برج خليفة' }, 'ar')).toBe('قريب من برج خليفة');
  });
});

describe('refining a list', () => {
  it('near a landmark: nearest first, with the distance', () => {
    const r = refineStays(list, parseStayWishes('near Burj Khalifa', 'dubai').wishes);
    expect(r.matches.map((m) => m.option.name)).toEqual(['Hotel 1']);
    expect(r.matches[0]!.ev[0]).toMatch(/^\d+ m to Burj Khalifa$/);
    expect(r.answer).toMatch(/^1 place fits: Near Burj Khalifa\. The closest is \d+ m from Burj Khalifa\.$/);
  });
  it('a pool and free cancellation', () => {
    const r = refineStays(list, parseStayWishes('pool and free cancellation', 'dubai').wishes);
    expect(r.matches.map((m) => m.option.name)).toEqual(['Hotel 3']);
    expect(r.matches[0]!.ev).toEqual(['Pool', 'Free cancellation until 19 Oct']);
  });
  it('never claims a view the content does not show, and says so', () => {
    const r = refineStays(list.slice(1), parseStayWishes('Burj view', 'dubai').wishes);
    expect(r.matches).toEqual([]);
    expect(r.unknown).toEqual([{ k: 'view', view: 'burj' }]);
    expect(r.answer).toContain('don’t say which have Burj Khalifa view');
  });
  it('under a price, cheapest first', () => {
    const r = refineStays(list, parseStayWishes('under SAR 450 a night', 'dubai').wishes);
    expect(r.matches.map((m) => m.option.name)).toEqual(['Hotel 4', 'Hotel 2', 'Hotel 3']);
    expect(r.answer).toBe('3 places fit: Under SAR 450 a night. From SAR 250 a night.');
  });
  it('nothing fits: the closest, honestly', () => {
    const r = refineStays(list, parseStayWishes('5 stars with a kids club', 'dubai').wishes);
    expect(r.matches).toEqual([]);
    expect(r.closest.length).toBeGreaterThan(0);
    expect(r.answer.startsWith('Nothing here has all of that.')).toBe(true);
  });
});

describe('the card and sorting', () => {
  it('plain room and board lines, never supplier jargon', () => {
    expect(roomTitle('Double standard .')).toBe('Double room');
    expect(roomTitle('Double or twin deluxe')).toBe('Deluxe double or twin room');
    expect(roomTitle('AVANI ROOM')).toBe('Avani room');
    expect(roomTitle('CLASSIC ROOM CITY VIEW')).toBe('Classic room, city view');
    const l = stayLines(stay('9', 532, { stars: 5, zone: 'Deira', room: 'AVANI ROOM', payAtHotel: 4100 }));
    expect(l).toEqual({ where: 'Deira · 5-star', room: 'Avani room · Room only', cancel: { text: 'Non-refundable', free: false }, tax: '+ SAR 41 local tax, paid at the hotel', perNight: 'SAR 266 a night' });
  });
  it('sorts', () => {
    expect(sortStays(list, 'price').map((o) => o.name)).toEqual(['Hotel 4', 'Hotel 2', 'Hotel 3', 'Hotel 1']);
    expect(sortStays(list, 'stars').map((o) => o.name)).toEqual(['Hotel 1', 'Hotel 3', 'Hotel 2', 'Hotel 4']);
    expect(sortStays(list, 'best').map((o) => o.name)).toEqual(['Hotel 1', 'Hotel 3', 'Hotel 2', 'Hotel 4']);
  });
  it('distance from a landmark or the centre', () => {
    const marina = anchorOfLandmark(landmarkById('dubai-marina')!);
    expect(sortByDistance(list, marina).map((o) => o.name)).toEqual(['Hotel 3', 'Hotel 1', 'Hotel 2', 'Hotel 4']);
    expect(distanceFrom(list[2]!, marina)!.text).toBe('About 50 m from Dubai Marina · 1 min walk');
    const centre = { id: 'centre', kind: 'centre' as const, name: 'the centre', lat: CITY_CENTRES.dubai!.lat, lng: CITY_CENTRES.dubai!.lng };
    expect(distanceFrom(list[1]!, centre)!.text).toMatch(/^About 8\.\d km from the centre · \d+ min by car$/);
    expect(distanceFrom(list[3]!, centre)).toBeNull();
  });
});

describe('flights and things to do', () => {
  it('flight wishes', () => {
    expect(parseFlightWishes('morning flight, direct only, extra bag').wishes.map((w) => w.k)).toEqual(['morning', 'direct', 'bags']);
    expect(parseFlightWishes('مباشر الصبح').wishes.map((w) => w.k)).toEqual(['morning', 'direct']);
    expect(parseFlightWishes('aisle seats together').wishes.map((w) => w.k)).toEqual(['aisle']);
  });
  it('things to do wishes', () => {
    expect(parseThingWishes("indoors, it's hot, for kids, tonight").wishes.map((w) => w.k)).toEqual(['indoor', 'kids', 'tonight']);
    expect(parseThingWishes('مكان مكيف للأطفال الليلة').wishes.map((w) => w.k)).toEqual(['indoor', 'kids', 'tonight']);
  });
});

describe('shared rooms: a filter, off by default', () => {
  const withDorm = [...list, stay('5', 150, { stars: 2, shared: true, room: '8-bed mixed dorm' }, { score: 99 })];
  it('a dorm is out of the list until the traveller asks for shared rooms', () => {
    expect(visibleStays(withDorm, []).map((o) => o.name)).not.toContain('Hotel 5');
    expect(refineStays(withDorm, [{ k: 'has', what: 'pool' }]).matches.map((m) => m.option.name)).not.toContain('Hotel 5');
    const on = refineStays(withDorm, [{ k: 'shared' }]);
    expect(on.matches[0]!.option.name).toBe('Hotel 5');
    expect(on.answer).toMatch(/Shared rooms and hostels are in the list too: 1/);
  });
  it('heard in English and Arabic; a city with only shared rooms still shows them', () => {
    expect(parseStayWishes('a hostel, the cheapest bed').wishes).toContainEqual({ k: 'shared' });
    expect(parseStayWishes('أبي هوستل رخيص').wishes).toContainEqual({ k: 'shared' });
    expect(wishLabel({ k: 'shared' })).toBe('Shared rooms');
    const onlyDorms = [stay('6', 100, { shared: true })];
    expect(visibleStays(onlyDorms, [])).toHaveLength(1);
  });
});
