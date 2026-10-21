import type { Activity, ActivityKind, Experience, WhatsOn } from './activities';
import type { PlaceAttribution } from './places';

/*
 * Things to do for mock mode (the app's EXPO_PUBLIC_API_MODE=mock, the Core API's SUPPLIER_MODE_ACTIVITIES=mock and
 * SUPPLIER_MODE_EVENTS=mock): a hand-made sample shaped exactly like the live data, for the cities the prototype
 * features. Opening hours are written in OpenStreetMap's format; summaries in Wikidata's one-line style. The OSM ids
 * here are placeholders for mock mode only (live ids come from Overpass). Photos are
 * our own (apps/mobile/assets/photos, Unsplash licence, credited in docs/app/photos/CREDITS.md).
 * Live data comes from OpenStreetMap, Wikidata, Hotelbeds and Ticketmaster (platform/src/lib/app/activities).
 */

const OSM: PlaceAttribution = { source: 'openstreetmap', text: '© OpenStreetMap contributors, ODbL', url: 'https://www.openstreetmap.org/copyright', licence: 'ODbL 1.0', licenceUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' };

type Row = [id: string, kind: ActivityKind, name: string, nameAr: string | null, lat: number, lon: number, summary: string | null, hours: string | null, popularity: number, extra?: { photo?: string; family?: boolean; indoor?: boolean; free?: boolean; wp?: string }];

/** Street addresses as OpenStreetMap maps them (addr:*), for the places that have one. */
const ADDRESSES: Readonly<Record<string, string>> = {
  'osm:r1374029': 'Sultan Ahmet, Ayasofya Meydanı No:1, Fatih, İstanbul',
  'osm:w24771046': 'Cankurtaran, 34122 Fatih, İstanbul',
  'osm:w28116322': 'Alemdar, Yerebatan Cd. 1/3, Fatih, İstanbul',
  'osm:w28119009': 'Bereketzade, Galata Kulesi, 34421 Beyoğlu, İstanbul',
  'osm:w140528417': 'King Saud Rd, Al Murabba, Riyadh 12631',
  'osm:w140528399': 'Imam Turki Ibn Abdullah Ibn Muhammad St, Ad Dirah, Riyadh 12634',
  'osm:w38545510': 'King Fahd Rd, Al Olaya, Riyadh 12214',
  'osm:w152183301': 'At-Turaif, Diriyah 13711',
  'osm:w687543221': 'Al-Bujairi Terrace, Diriyah 13711',
  'osm:w37392932': '1 Sheikh Mohammed bin Rashid Blvd, Downtown Dubai',
  'osm:w571346011': 'Sheikh Zayed Rd, Trade Centre 2, Dubai',
  'osm:w4317479': 'Great Russell St, London WC1B 3DG',
  'osm:w4361093': 'Cromwell Rd, London SW7 5BD',
  'osm:r11745282': 'Tower Hill, London EC3N 4AB',
};

const INDOOR = new Set<ActivityKind>(['museum', 'gallery', 'aquarium', 'mosque']);
const FAMILY = new Set<ActivityKind>(['zoo', 'aquarium', 'theme_park', 'water_park', 'park']);

const build = (placeId: string, rows: Row[]): Activity[] => rows.map(([id, kind, name, nameAr, lat, lon, summary, hours, popularity, x = {}]) => ({
  id, placeId, name, nameAr, kind, lat, lon, summary, summaryAr: null, image: null, photo: x.photo ?? null, hours, openNow: null, closesAt: null,
  indoor: x.indoor ?? INDOOR.has(kind), family: x.family ?? FAMILY.has(kind), free: x.free ?? null, website: null,
  wikipedia: x.wp ? `https://en.wikipedia.org/wiki/${x.wp}` : null, popularity, distanceKm: null, address: ADDRESSES[id] ?? null, attributions: [OSM],
}));

export const MOCK_ACTIVITIES: Readonly<Record<string, Activity[]>> = {
  // Istanbul
  '745044': build('745044', [
    ['osm:r1374029', 'mosque', 'Hagia Sophia', 'آيا صوفيا', 41.00858, 28.98002, 'mosque and former church in Istanbul, Turkey', 'Mo-Su 09:00-19:30', 100, { photo: 'istanbul-sultanahmet', wp: 'Hagia_Sophia', free: true }],
    ['osm:w24771046', 'museum', 'Topkapı Palace', 'قصر طوب قابي', 41.01152, 28.98336, 'palace in Istanbul, Turkey', 'We-Mo 09:00-18:00; Tu off', 91, { wp: 'Topkapı_Palace' }],
    ['osm:w28116322', 'historic', 'Basilica Cistern', 'صهريج البازيليك', 41.00837, 28.97790, 'largest of several hundred ancient cisterns beneath Istanbul', 'Mo-Su 09:00-22:00', 84, { indoor: true, family: true, wp: 'Basilica_Cistern' }],
    ['osm:w24797384', 'mosque', 'Süleymaniye Mosque', 'جامع السليمانية', 41.01608, 28.96398, 'Ottoman imperial mosque in Istanbul, Turkey', null, 78, { photo: 'istanbul-bosphorus', wp: 'Süleymaniye_Mosque', free: true }],
    ['osm:w28119009', 'viewpoint', 'Galata Tower', 'برج غلطة', 41.02562, 28.97418, 'medieval stone tower in Istanbul', 'Mo-Su 08:30-23:00', 82, { photo: 'istanbul-galata', wp: 'Galata_Tower' }],
    ['osm:w23585466', 'theme_park', 'Miniatürk', 'ميني تورك', 41.06058, 28.94897, 'miniature park in Istanbul, Turkey', 'Mo-Su 09:00-19:00', 52, { wp: 'Miniatürk' }],
    ['osm:w169345511', 'aquarium', 'Istanbul Aquarium', 'أكواريوم إسطنبول', 40.96285, 28.79876, 'public aquarium in Florya, Istanbul', 'Mo-Su 10:00-19:00', 47, { wp: 'Istanbul_Aquarium' }],
    ['osm:w24774095', 'park', 'Gülhane Park', 'حديقة غولهانة', 41.01300, 28.98100, 'urban park in Istanbul, Turkey', 'Mo-Su 07:00-22:00', 44, { wp: 'Gülhane_Park', free: true }],
    ['osm:n2563212210', 'viewpoint', 'Pierre Loti Hill', 'تلة بيير لوتي', 41.05433, 28.93356, 'hill and café above the Golden Horn', null, 38, { free: true }],
    ['osm:w37017346', 'museum', 'Istanbul Archaeology Museums', 'متاحف إسطنبول الأثرية', 41.01170, 28.98110, 'group of three archaeological museums in Istanbul', 'Mo-Su 09:00-18:30', 55, { wp: 'Istanbul_Archaeology_Museums' }],
  ]),
  // Riyadh
  '108410': build('108410', [
    ['osm:w152183301', 'historic', 'At-Turaif District, Diriyah', 'حي الطريف، الدرعية', 24.73404, 46.57487, 'UNESCO World Heritage Site in Diriyah, Saudi Arabia', 'Mo-Su 10:00-24:00', 100, { photo: 'riyadh-diriyah', wp: 'At-Turaif' }],
    ['osm:w140528417', 'museum', 'National Museum of Saudi Arabia', 'المتحف الوطني السعودي', 24.64755, 46.71038, 'national museum in Riyadh, Saudi Arabia', 'Su-Th 09:00-20:00; Fr 16:00-21:00; Sa 09:00-21:00', 86, { wp: 'National_Museum_of_Saudi_Arabia', family: true }],
    ['osm:w140528399', 'historic', 'Masmak Fortress', 'قصر المصمك', 24.63118, 46.71327, 'clay and mud-brick fort in Riyadh, Saudi Arabia', 'Sa-Th 08:00-21:00; Fr 16:00-21:00', 79, { wp: 'Masmak_fortress', free: true, indoor: true }],
    ['osm:w38545510', 'viewpoint', 'Kingdom Centre Sky Bridge', 'جسر المملكة', 24.71136, 46.67435, 'observation bridge atop the Kingdom Centre', 'Mo-Su 09:30-23:00', 74, { photo: 'riyadh-kingdom-centre', indoor: true }],
    ['osm:w148562811', 'park', 'King Abdullah Park', 'حديقة الملك عبدالله', 24.66570, 46.73780, 'urban park in Riyadh, Saudi Arabia', 'Mo-Su 16:00-24:00', 48, {}],
    ['osm:w232176318', 'zoo', 'Riyadh Zoo', 'حديقة حيوان الرياض', 24.66930, 46.73430, 'zoo in Riyadh, Saudi Arabia', 'Mo-Su 08:00-22:00', 42, {}],
    ['osm:w687543221', 'historic', 'Al-Bujairi', 'البجيري', 24.73520, 46.57610, 'heritage quarter facing At-Turaif across Wadi Hanifa', 'Mo-Su 17:00-01:00', 66, { photo: 'riyadh-night', free: true }],
  ]),
  // AlUla
  '108841': build('108841', [
    ['osm:r6236154', 'historic', 'Hegra', 'الحِجر', 26.79153, 37.95306, 'archaeological site in Saudi Arabia', 'Mo-Su 08:00-17:00', 100, { photo: 'alula-hegra', wp: 'Hegra_(Mada\'in_Salih)' }],
    ['osm:n5622781322', 'attraction', 'Elephant Rock', 'جبل الفيل', 26.68930, 37.98880, 'rock formation in AlUla, Saudi Arabia', 'Mo-Su 16:00-24:00', 83, { photo: 'alula-elephant-rock', free: true }],
    ['osm:w714320553', 'gallery', 'Maraya', 'مرايا', 26.65100, 37.84280, 'mirrored concert hall in AlUla, Saudi Arabia', null, 77, { photo: 'alula-maraya', wp: 'Maraya_(building)' }],
    ['osm:w714320590', 'historic', 'AlUla Old Town', 'البلدة القديمة بالعلا', 26.62000, 37.91500, 'old mud-brick town in AlUla', 'Mo-Su 09:00-24:00', 70, { free: true, photo: 'desert-camp' }],
    ['osm:n7001232211', 'viewpoint', 'Harrat Viewpoint', 'إطلالة حرة عويرض', 26.59400, 37.84800, 'viewpoint over the AlUla valley', null, 41, { free: true }],
  ]),
  // Dubai
  '292223': build('292223', [
    ['osm:w37392932', 'viewpoint', 'At the Top, Burj Khalifa', 'برج خليفة', 25.19720, 55.27440, 'observation decks of the tallest building in the world', 'Mo-Su 08:30-23:00', 100, { photo: 'dubai-skyline', indoor: true, wp: 'Burj_Khalifa' }],
    ['osm:w160416131', 'aquarium', 'Dubai Aquarium & Underwater Zoo', 'دبي أكواريوم', 25.19780, 55.27900, 'aquarium in The Dubai Mall', 'Mo-Su 10:00-23:00', 81, {}],
    ['osm:w571346011', 'museum', 'Museum of the Future', 'متحف المستقبل', 25.21920, 55.28190, 'museum in Dubai, United Arab Emirates', 'Mo-Su 10:00-21:30', 88, { wp: 'Museum_of_the_Future', family: true }],
    ['osm:w489342871', 'viewpoint', 'Dubai Frame', 'برواز دبي', 25.23560, 55.30030, 'picture-frame shaped landmark in Zabeel Park', 'Mo-Su 09:00-21:00', 72, { indoor: true }],
    ['osm:w40367742', 'historic', 'Al Fahidi Historical Neighbourhood', 'حي الفهيدي التاريخي', 25.26330, 55.29900, 'historic district in Dubai', null, 64, { photo: 'dubai-creek', free: true }],
  ]),
  // London
  '2643743': build('2643743', [
    ['osm:w4317479', 'museum', 'British Museum', 'المتحف البريطاني', 51.51939, -0.12693, 'national museum of history and culture in London', 'Mo-Th,Sa,Su 10:00-17:00; Fr 10:00-20:30', 100, { free: true, wp: 'British_Museum' }],
    ['osm:w4361093', 'museum', 'Natural History Museum', 'متحف التاريخ الطبيعي', 51.49634, -0.17640, 'natural history museum in London', 'Mo-Su 10:00-17:50', 93, { free: true, family: true, photo: 'london-kensington', wp: 'Natural_History_Museum,_London' }],
    ['osm:w4361094', 'museum', 'Science Museum', 'متحف العلوم', 51.49784, -0.17449, 'science museum in London', 'Mo-Su 10:00-18:00', 80, { free: true, family: true, wp: 'Science_Museum,_London' }],
    ['osm:r11745282', 'historic', 'Tower of London', 'برج لندن', 51.50812, -0.07595, 'historic castle in London', 'Tu-Sa 09:00-17:30; Su,Mo 10:00-17:30', 89, { wp: 'Tower_of_London' }],
    ['osm:w4082586', 'park', 'Hyde Park', 'هايد بارك', 51.50733, -0.16572, 'royal park in London', 'Mo-Su 05:00-24:00', 74, { free: true, wp: 'Hyde_Park,_London' }],
    ['osm:w4243745', 'zoo', 'ZSL London Zoo', 'حديقة حيوان لندن', 51.53530, -0.15340, 'zoo in Regent\'s Park, London', 'Mo-Su 10:00-18:00', 66, { wp: 'London_Zoo' }],
  ]),
};

/** A sample experience: `x:<slug>` (the mock supplier's code is the slug). */
const exp = (slug: string, title: string, sar: number, mins: number | null, x: Partial<Experience> = {}): Experience => ({
  id: `x:${slug}`, title, summary: null, image: null, photo: null,
  priceFrom: { amount: sar * 100, currency: 'SAR' }, durationMin: mins, rating: null, reviews: null, family: false, minAge: null, freeCancel: true, ...x,
});

export const MOCK_EXPERIENCES: Readonly<Record<string, Experience[]>> = {
  '745044': [
    exp('ist-bosdin', 'Bosphorus dinner cruise', 245, 180, { summary: 'Dinner on the water from Kabataş pier, with a halal menu and the bridges lit up.', photo: 'istanbul-bosphorus', family: true, minAge: 0, rating: 4.6, reviews: 2140, meetingPoint: { kind: 'meet', address: 'Kabataş pier, Meclis-i Mebusan Cd., Beyoğlu, İstanbul', note: 'Be at the pier 20 minutes before boarding. The crew wear navy jackets.', lat: 41.03313, lon: 28.99343 } }),
    exp('ist-hsophia', 'Hagia Sophia and Blue Mosque with a guide', 165, 150, { summary: 'A small group, a licensed guide, and the history you won’t read on the signs.', photo: 'istanbul-sultanahmet', rating: 4.7, reviews: 5120, meetingPoint: { kind: 'meet', address: 'German Fountain, Sultanahmet Square, Fatih, İstanbul', note: 'Your guide holds a red Mada sign.', lat: 41.00703, lon: 28.97626 } }),
    exp('ist-cistern', 'Basilica Cistern: timed entry', 120, 60, { summary: 'A set time slot, so no queue.', family: true, minAge: 0 }),
    exp('ist-islands', 'Princes’ Islands day trip with lunch', 310, 420, { summary: 'Ferry to Büyükada and Heybeliada. No cars, just bikes and walks.', family: true, rating: 4.4, reviews: 880 }),
  ],
  '108410': [
    exp('ruh-diriyah', 'Diriyah at sunset with a local guide', 190, 150, { summary: 'At-Turaif’s mud-brick lanes, then dinner on the Bujairi terrace.', photo: 'riyadh-diriyah', family: true, minAge: 4, rating: 4.8, reviews: 412, meetingPoint: { kind: 'meet', address: 'At-Turaif Visitor Centre, Diriyah 13711', note: 'Meet at the ticket desk 15 minutes before the start.', lat: 24.73326, lon: 46.57401 } }),
    exp('ruh-edge', 'Edge of the World by 4×4', 420, 480, { summary: 'The Tuwaiq escarpment with a driver, a picnic and a long view.', photo: 'dubai-desert', minAge: 8, rating: 4.7, reviews: 960, meetingPoint: { kind: 'pickup', address: null, note: 'The driver collects you from your hotel lobby.', lat: null, lon: null } }),
    exp('ruh-camp', 'Desert camp evening', 280, 240, { summary: 'Dunes, a camp fire, Arabic coffee and dinner under the stars.', photo: 'desert-camp', family: true, minAge: 0, rating: 4.5, reviews: 380 }),
  ],
  '108841': [
    exp('ulh-hegra', 'Hegra: the tombs by vintage Land Rover', 395, 180, { summary: 'Saudi Arabia’s first UNESCO site, with a Rawi storyteller.', photo: 'alula-hegra', family: true, minAge: 5, rating: 4.9, reviews: 1220, meetingPoint: { kind: 'meet', address: 'Hegra Welcome Centre, AlUla', note: null, lat: 26.78712, lon: 37.94877 } }),
    exp('ulh-stars', 'Stargazing at Gharameel', 210, 120, { summary: 'Telescopes, a guide to the night sky, and very dark skies.', photo: 'desert-camp', family: true, minAge: 6, rating: 4.8, reviews: 310 }),
  ],
  '292223': [
    exp('dxb-safari', 'Desert safari with dinner', 260, 360, { summary: 'Dune drive, sandboarding and a camp dinner.', photo: 'dubai-desert', family: true, minAge: 3, rating: 4.6, reviews: 8400 }),
    exp('dxb-burj-top', 'Burj Khalifa: At the Top, levels 124 and 125', 199, 90, { summary: 'A timed ticket to the observation decks.', photo: 'dubai-skyline', family: true, minAge: 0, rating: 4.5, reviews: 15200 }),
  ],
  '2643743': [
    exp('lon-tower', 'Tower of London with the Crown Jewels', 175, 180, { summary: 'Entry, the Yeoman Warders’ tour, and the jewels.', family: true, minAge: 0, rating: 4.6, reviews: 4100 }),
  ],
};

/** Desk-curated What's on and Ticketmaster-shaped events, relative to a day so they're always current in mock mode. */
export function mockEvents(placeId: string, day: string): WhatsOn[] {
  const add = (n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const e = (id: string, source: WhatsOn['source'], title: string, from: number, to: number, x: Partial<WhatsOn> = {}): WhatsOn => ({
    id, source, placeId, title, body: null, startsOn: add(from), endsOn: add(to), time: null, venue: null, image: null, photo: null, link: null, family: false, ...x,
  });
  const all: Record<string, WhatsOn[]> = {
    '108410': [
      e('desk:7d1c5e2a-0b6f-4a39-9a51-1f1d2b3c4d01', 'desk', 'Riyadh Season: Boulevard World', -20, 60, { body: 'Food, rides and shows from around the world, every evening.', venue: 'Boulevard World', time: '16:00', photo: 'riyadh-night', family: true, link: 'https://riyadhseason.com/' }),
      e('desk:7d1c5e2a-0b6f-4a39-9a51-1f1d2b3c4d02', 'desk', 'Diriyah Season: Bujairi nights', 0, 14, { body: 'Music and Najdi food on the terrace facing At-Turaif.', venue: 'Al-Bujairi', time: '19:00', photo: 'riyadh-diriyah', family: true }),
    ],
    '108841': [
      e('desk:7d1c5e2a-0b6f-4a39-9a51-1f1d2b3c4d03', 'desk', 'Winter at Tantora', 2, 40, { body: 'Concerts at Maraya and the old town lit up at night.', venue: 'Maraya', time: '20:30', photo: 'alula-maraya' }),
    ],
    '745044': [
      e('tm:Z698xZ2qZa7ZQ', 'ticketmaster', 'Istanbul Music Festival', 3, 3, { body: 'Music · Classical', venue: 'Süreyya Opera', time: '20:00', link: 'https://www.ticketmaster.com/' }),
    ],
    '2643743': [
      e('tm:G5vYZ9fKz1ArJ', 'ticketmaster', 'The Lion King', 1, 1, { body: 'Arts & Theatre · Musical', venue: 'Lyceum Theatre', time: '19:30', family: true, link: 'https://www.ticketmaster.co.uk/' }),
    ],
  };
  return all[placeId] ?? [];
}

/** Attribution for open data: every Things to do list carries these (licences permitting, always shown). */
export const THINGS_ATTRIBUTIONS: Readonly<Record<'osm' | 'wikidata' | 'wikipedia' | 'commons' | 'wikivoyage' | 'openmeteo' | 'ticketmaster', PlaceAttribution>> = {
  osm: OSM,
  wikidata: { source: 'wikidata', text: 'Descriptions from Wikidata, CC0', url: 'https://www.wikidata.org/', licence: 'CC0 1.0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  wikipedia: { source: 'wikipedia', text: 'Popularity from Wikipedia pageviews', url: 'https://wikimedia.org/api/rest_v1/', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  commons: { source: 'wikimedia', text: 'Photos from Wikimedia Commons, each with its own licence', url: 'https://commons.wikimedia.org/', licence: 'Various free licences', licenceUrl: null },
  wikivoyage: { source: 'wikivoyage', text: 'From Wikivoyage, CC BY-SA', url: 'https://en.wikivoyage.org/', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  openmeteo: { source: 'openmeteo', text: 'Weather data by Open-Meteo.com, CC BY 4.0', url: 'https://open-meteo.com/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  ticketmaster: { source: 'ticketmaster', text: 'Events from Ticketmaster', url: 'https://developer.ticketmaster.com/', licence: 'Ticketmaster API terms', licenceUrl: 'https://developer.ticketmaster.com/support/terms-of-use/' },
};
