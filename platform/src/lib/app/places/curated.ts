/*
 * The cities we know by hand: our own photos (apps/mobile/assets/photos), the booking catalogue's key when we sell it
 * in the app (DESTINATIONS in @mada/shared), and the order they appear in "Popular". Keyed by GeoNames id.
 * No server-only import: the ingestion script reads it too.
 */
export type CuratedCity = { geonameId: number; slug: string; photo: string; bookingKey: string | null; served: boolean; airport: string; aliases?: string[]; name?: string };

export const CURATED: CuratedCity[] = [
  { geonameId: 745044, slug: 'istanbul', photo: 'istanbul-galata', bookingKey: 'istanbul', served: true, airport: 'IST', aliases: ['Türkiye', 'Turkey'] },
  { geonameId: 292223, slug: 'dubai', photo: 'dubai-skyline', bookingKey: 'dubai', served: true, airport: 'DXB' },
  { geonameId: 108841, slug: 'alula', photo: 'alula-elephant-rock', bookingKey: 'alula', served: true, airport: 'ULH', name: 'AlUla', aliases: ['AlUla', 'Al Ula', 'العلا'] },
  { geonameId: 2643743, slug: 'london', photo: 'london-kensington', bookingKey: 'london', served: true, airport: 'LHR' },
  { geonameId: 611717, slug: 'tbilisi', photo: 'tbilisi-old-town', bookingKey: 'tbilisi', served: false, airport: 'TBS', aliases: ['Georgia'] },
  { geonameId: 587084, slug: 'baku', photo: 'baku-old-city', bookingKey: 'baku', served: true, airport: 'GYD' },
  { geonameId: 360630, slug: 'cairo', photo: 'cairo-pyramids', bookingKey: 'cairo', served: true, airport: 'CAI' },
  { geonameId: 110690, slug: 'abha', photo: 'abha-mountains', bookingKey: 'abha', served: true, airport: 'AHB' },
  { geonameId: 105343, slug: 'jeddah', photo: 'jeddah-al-balad', bookingKey: 'jeddah', served: true, airport: 'JED' },
  { geonameId: 104515, slug: 'makkah', photo: 'makkah-clock-tower', bookingKey: null, served: false, airport: 'JED', aliases: ['Mecca', 'Makkah', 'مكة المكرمة'] },
  { geonameId: 109223, slug: 'madinah', photo: 'madinah-green-dome', bookingKey: null, served: false, airport: 'MED', aliases: ['Medina', 'Madinah', 'المدينة المنورة'] },
  { geonameId: 1282027, slug: 'male', photo: 'maldives-overwater', bookingKey: 'maldives', served: false, airport: 'MLE', name: 'Malé', aliases: ['Maldives', 'المالديف'] },
  { geonameId: 108410, slug: 'riyadh', photo: 'riyadh-kingdom-centre', bookingKey: null, served: false, airport: 'RUH' },
];

export const curatedById = new Map(CURATED.map((c) => [c.geonameId, c]));

/** GeoNames says "Turkey"; the app says what the country calls itself where that's what travellers expect. */
export const COUNTRY_NAME_OVERRIDES: Record<string, string> = { TR: 'Türkiye', CZ: 'Czechia', MK: 'North Macedonia', SZ: 'Eswatini', CV: 'Cabo Verde' };
