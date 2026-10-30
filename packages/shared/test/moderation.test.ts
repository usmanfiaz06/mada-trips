import { describe, expect, it } from 'vitest';
import { fingerprint, holdFromFlag, flagOf, looksSpam, screenContent, screenText, unlistedVenue, type VenueInput } from '../src/moderation';

const code = (s: string) => screenText(s)?.code ?? null;

describe('screenText: contact, links, addresses', () => {
  it('holds phone numbers, e-mails, messenger asks and links, in English and Arabic', () => {
    expect(code('call 0551234567 for a table')).toBe('contact');
    expect(code('رقمي 055 123 4567')).toBe('contact');
    expect(code('+44 7700 900 123')).toBe('contact');
    expect(code('mail me at ali@example.com')).toBe('contact');
    expect(code('whatsapp me for the deal')).toBe('contact');
    expect(code('كلمني خاص')).toBe('contact');
    expect(code('راسلني على الواتس')).toBe('contact');
    expect(code('see www.example.com')).toBe('link');
    expect(code('https://bit.ly/x')).toBe('link');
    expect(code('menu at kunefe.sa/menu')).toBe('link');
    expect(code('we are in room 412')).toBe('address');
    expect(code('ساكنين في شقة رقم 12')).toBe('address');
  });
  it('lets ordinary tips through, in English and Arabic', () => {
    for (const s of [
      'A quiet café by the water. Go before 8.', 'Book the family room upstairs. The jareesh is the thing to order.', 'Kids loved the ferry, 20 minutes each way.',
      'كنافة قرب برج غلطة. روحوا قبل الثامنة.', 'المكان هادي والجلسات العائلية فوق، اطلبوا الجريش.', 'الأطفال حبّوا العبّارة، عشرين دقيقة.', 'Sushi at 7, sunset at 6.',
    ]) expect(screenText(s), s).toBeNull();
  });
  it("lets Mada's own links through, and still holds anyone else's next to them", () => {
    expect(screenText('Trip to Istanbul, 14–18 Nov\nhttps://travel.madatrips.sa/#/p/eyJmIjoiUlVIIiwidCI6IklTVCJ9')).toBeNull();
    expect(screenText('Join us: https://travel.madatrips.sa/#/join/abcd1234-xyz123')).toBeNull();
    expect(code('https://madatrips.sa/call-me-0501234567')).toBe('contact');
    expect(code('https://madatrips.sa/r?to=https://evil.xyz')).toBe('link');
    expect(code('https://travel.madatrips.sa/#/p/x and https://bit.ly/x')).toBe('link');
    expect(code('http://madatrips.sa.evil.io/x')).toBe('link');
    expect(code('https://madatrips.sa.evil.io/x')).toBe('link');
  });
});

describe('screenText: abuse and profanity', () => {
  it('English, with leet and repeated letters', () => {
    expect(code('this place is shit')).toBe('abuse');
    expect(code('f u c k')).toBeNull(); // spaced letters are not a word; a person reads reports
    expect(code('what a b1tch')).toBe('abuse');
    expect(code('fuuuuck this')).toBe('abuse');
    expect(code('sh1t service')).toBe('abuse');
    expect(code('kill yourself')).toBe('abuse');
  });
  it('Arabic, with diacritics, alef and taa marbuta variants, prefixes and suffixes', () => {
    expect(code('يا حمار')).toBe('abuse');
    expect(code('شَرْمُوطَة')).toBe('abuse');
    expect(code('قحبة')).toBe('abuse');
    expect(code('ابن الكلب')).toBe('abuse');
    expect(code('والله يلعنك')).toBe('abuse');
    expect(code('كسسسس امك')).toBe('abuse');
    expect(code('بقتلك')).toBe('abuse');
  });
  it('Arabizi', () => {
    expect(code('ya 7mar')).toBe('abuse');
    expect(code('sharmoota')).toBe('abuse');
    expect(code('kos omak')).toBe('abuse');
    expect(code('ibn kalb')).toBe('abuse');
    expect(code('ga7ba')).toBe('abuse');
  });
  it('no false alarms on words that contain a bad one', () => {
    for (const s of ['Scunthorpe fish and chips', 'the cocktail of juices', 'كسرة خبز', 'مكسرات وحلويات', 'Dickens museum', 'زبدة وعسل', 'Kosher bakery', 'طيزان', 'class trip']) {
      expect(screenText(s), s).toBeNull();
    }
  });
  it('scam words', () => {
    expect(code('guaranteed profit, DM')).toBe('scam');
    expect(code('ربح مضمون مع توصيات تداول')).toBe('scam');
  });
});

describe('unlistedVenue: places we don’t list', () => {
  it('by keyword, English and Arabic', () => {
    expect(unlistedVenue({ name: 'Blue Bar', text: 'great cocktails' })).toBe('bar');
    expect(unlistedVenue({ name: 'Club 9', text: 'best nightclub in Dubai' })).toBe('nightclub');
    expect(unlistedVenue({ name: 'Grand Casino' })).toBe('casino');
    expect(unlistedVenue({ name: 'ملهى الليل' })).toBe('ملهى');
    expect(unlistedVenue({ text: 'كازينو على البحر' })).toBe('كازينو');
    expect(unlistedVenue({ text: 'فيه خمور ونبيذ' })).not.toBeNull();
    expect(unlistedVenue({ text: 'nadi laili ra2e3' })).toBe('nadi laili');
  });
  it('by OpenStreetMap tag, Wikidata class and category', () => {
    expect(unlistedVenue({ name: 'The Anchor', tags: { amenity: 'pub' } })).toBe('amenity=pub');
    expect(unlistedVenue({ name: 'Cellar', tags: { shop: 'wine' } })).toBe('shop=wine');
    expect(unlistedVenue({ name: 'Taps', tags: { 'drink:beer': 'yes' } })).toBe('drink:beer=yes');
    expect(unlistedVenue({ name: 'Lucky', wikidataClasses: ['Q133215'] })).toBe('wikidata Q133215');
    expect(unlistedVenue({ name: 'Event', category: 'Nightlife' })).toBe('category Nightlife');
  });
  it('innocent places pass', () => {
    for (const v of [
      { name: 'Juice Bar Riyadh' }, { name: 'Coffee bar at the souq' }, { name: 'Baraka Barbecue' }, { name: 'Barber shop' }, { name: 'National Museum', tags: { tourism: 'museum' } },
      { name: 'عصير بار' }, { name: 'مطعم نجد فيليج' }, { name: 'Kingdom Tower', tags: { 'drink:beer': 'no' } }, { name: 'Mocktail lounge' },
    ] as VenueInput[]) expect(unlistedVenue(v), JSON.stringify(v)).toBeNull();
  });
});

describe('looksSpam', () => {
  it('the same text again, a flood of links, one thing repeated', () => {
    expect(looksSpam('Best kunefe in town, go now!', ['best kunefe in town go now'])).toBe('duplicate');
    expect(looksSpam('أفضل كنافة في المدينة، روحوا الحين', ['أفضل كنافة في المدينة روحوا الحين'])).toBe('duplicate');
    expect(looksSpam('a.com b.com c.com')).toBe('flood');
    expect(looksSpam('!!!!!!!!!!!!')).toBe('repeated');
    expect(looksSpam('buy buy buy buy buy now')).toBe('repeated');
    expect(looksSpam('تعال تعال تعال تعال تعال الحين')).toBe('repeated');
    expect(looksSpam('A fresh tip about the ferry')).toBeNull();
    expect(looksSpam('ok', ['ok'])).toBeNull(); // short lines repeat in normal chat
  });
  it('fingerprints ignore case, punctuation and diacritics', () => {
    expect(fingerprint('Hello, WORLD!')).toBe('hello world');
    expect(fingerprint('مَرْحَبًا')).toBe(fingerprint('مرحبا'));
  });
});

describe('screenContent', () => {
  it('runs the rules in order and keeps a chat line free to name places', () => {
    expect(screenContent({ text: 'Lovely view', place: 'Sky Bar' })?.code).toBe('venue');
    expect(screenContent({ text: 'Meet at the Sky Bar?', noVenue: true })).toBeNull();
    expect(screenContent({ text: 'نشوفكم هناك', place: 'كافيه البحر' })).toBeNull();
    expect(screenContent({ text: 'same text here again', recent: ['Same text here, again.'] })?.code).toBe('spam');
    expect(screenContent({ text: 'call 0551234567', place: 'Casino' })?.code).toBe('contact');
  });
  it('flags round-trip through the stored string', () => {
    const h = screenContent({ text: 'nice', place: 'Lucky Casino' })!;
    expect(holdFromFlag(flagOf(h))).toEqual(h);
    expect(holdFromFlag('matched something old')).toBeNull();
  });
});
