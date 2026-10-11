import { z } from 'zod';
/*
 * Landmarks and areas people ask to stay near, for the cities Mada sells, with coordinates (to about 100 m). Each has
 * the words people type for it in English and in Arabic (Arabic as normalizeArabic writes it: ا for أ/إ/آ, ي for ى,
 * ه for ة). The radius is what "near" means there: a walk in a dense centre, a short ride for a long beach front.
 */

export type Landmark = {
  id: string;
  /** Destination key (DESTINATIONS) or a city we don't sell live yet. */
  city: string;
  name: string;
  nameAr: string;
  lat: number;
  lng: number;
  /** "Near" in km. */
  km: number;
  en: RegExp;
  ar: RegExp;
  /** A view people ask for by this landmark's name ("Burj view", "Haram view"). */
  view?: 'burj' | 'haram';
};

export const LANDMARKS: readonly Landmark[] = [
  // Dubai
  { id: 'burj-khalifa', city: 'dubai', name: 'Burj Khalifa', nameAr: 'برج خليفة', lat: 25.1972, lng: 55.2744, km: 2, en: /burj(?: khalifa)?\b|khalifa tower/, ar: /برج خليفه|البرج|برج خليفة/, view: 'burj' },
  { id: 'dubai-mall', city: 'dubai', name: 'Dubai Mall', nameAr: 'دبي مول', lat: 25.1985, lng: 55.2796, km: 2, en: /dubai mall/, ar: /دبي مول|مول دبي/ },
  { id: 'downtown-dubai', city: 'dubai', name: 'Downtown Dubai', nameAr: 'وسط دبي', lat: 25.195, lng: 55.278, km: 2.5, en: /downtown/, ar: /داون تاون|داونتاون|وسط دبي|وسط البلد/ },
  { id: 'dubai-marina', city: 'dubai', name: 'Dubai Marina', nameAr: 'دبي مارينا', lat: 25.0805, lng: 55.1403, km: 2, en: /marina/, ar: /مارينا|المارينا/ },
  { id: 'jbr', city: 'dubai', name: 'JBR', nameAr: 'جي بي ار', lat: 25.078, lng: 55.134, km: 1.5, en: /\bjbr\b|jumeirah beach residence/, ar: /جي بي ار|جميرا بيتش ريزيدنس/ },
  { id: 'palm-jumeirah', city: 'dubai', name: 'Palm Jumeirah', nameAr: 'نخلة جميرا', lat: 25.1124, lng: 55.139, km: 3, en: /\bpalm\b/, ar: /النخله|نخله جميرا|نخلة جميرا/ },
  { id: 'business-bay', city: 'dubai', name: 'Business Bay', nameAr: 'الخليج التجاري', lat: 25.186, lng: 55.265, km: 2, en: /business bay/, ar: /الخليج التجاري|بزنس باي/ },
  { id: 'deira', city: 'dubai', name: 'Deira', nameAr: 'ديرة', lat: 25.2711, lng: 55.3075, km: 2.5, en: /\bdeira\b|\bcreek\b|gold souk/, ar: /ديره|الخور|سوق الذهب/ },
  { id: 'dxb', city: 'dubai', name: 'Dubai Airport', nameAr: 'مطار دبي', lat: 25.2532, lng: 55.3657, km: 4, en: /airport|\bdxb\b/, ar: /المطار|مطار دبي/ },
  // Makkah and Madinah
  { id: 'haram', city: 'makkah', name: 'the Haram', nameAr: 'الحرم', lat: 21.4225, lng: 39.8262, km: 1, en: /\bharam\b|masjid al[- ]haram|grand mosque|kaaba/, ar: /الحرم|المسجد الحرام|الكعبه/, view: 'haram' },
  { id: 'nabawi', city: 'madinah', name: 'Masjid an-Nabawi', nameAr: 'المسجد النبوي', lat: 24.4672, lng: 39.6111, km: 1, en: /nabawi|prophet'?s mosque|masjid an[- ]nabawi/, ar: /المسجد النبوي|النبوي|الحرم النبوي/, view: 'haram' },
  // Istanbul
  { id: 'sultanahmet', city: 'istanbul', name: 'Sultanahmet', nameAr: 'السلطان أحمد', lat: 41.0054, lng: 28.9768, km: 1.2, en: /sultanahmet|blue mosque|hagia sophia|old city/, ar: /السلطان احمد|الجامع الازرق|ايا صوفيا|المدينه القديمه/ },
  { id: 'taksim', city: 'istanbul', name: 'Taksim', nameAr: 'تقسيم', lat: 41.037, lng: 28.985, km: 1.2, en: /taksim|istiklal/, ar: /تقسيم|ميدان تقسيم|الاستقلال/ },
  { id: 'galata', city: 'istanbul', name: 'Galata Tower', nameAr: 'برج غلطة', lat: 41.0256, lng: 28.9741, km: 1, en: /galata|karak[oö]y/, ar: /غلطه|جالاتا|كاراكوي/ },
  { id: 'bosphorus', city: 'istanbul', name: 'the Bosphorus', nameAr: 'البوسفور', lat: 41.0473, lng: 29.027, km: 1.5, en: /bosphorus|bosporus|be[sş]ikta[sş]|ortak[oö]y/, ar: /البوسفور|بشكتاش|اورتاكوي/ },
  // London
  { id: 'hyde-park', city: 'london', name: 'Hyde Park', nameAr: 'هايد بارك', lat: 51.5073, lng: -0.1657, km: 1.2, en: /hyde park|marble arch|park lane/, ar: /هايد بارك|ماربل ارش/ },
  { id: 'oxford-street', city: 'london', name: 'Oxford Street', nameAr: 'شارع أكسفورد', lat: 51.5152, lng: -0.1419, km: 1, en: /oxford st(?:reet)?|bond street|edgware/, ar: /اكسفورد|شارع اكسفورد|ادجوار/ },
  { id: 'knightsbridge', city: 'london', name: 'Knightsbridge', nameAr: 'نايتسبريدج', lat: 51.4994, lng: -0.1632, km: 1, en: /knightsbridge|harrods/, ar: /نايتسبريدج|هارودز/ },
  { id: 'westminster', city: 'london', name: 'Westminster', nameAr: 'وستمنستر', lat: 51.5007, lng: -0.1246, km: 1.2, en: /westminster|big ben|london eye/, ar: /وستمنستر|بيج بن|عين لندن/ },
  // Riyadh
  { id: 'boulevard', city: 'riyadh', name: 'Boulevard City', nameAr: 'بوليفارد سيتي', lat: 24.7701, lng: 46.6024, km: 3, en: /boulevard/, ar: /بوليفارد|البوليفارد/ },
  { id: 'kingdom-centre', city: 'riyadh', name: 'Kingdom Centre', nameAr: 'برج المملكة', lat: 24.7113, lng: 46.6744, km: 2, en: /kingdom (?:centre|center|tower)|olaya/, ar: /برج المملكه|العليا/ },
  { id: 'diriyah', city: 'riyadh', name: 'Diriyah', nameAr: 'الدرعية', lat: 24.734, lng: 46.575, km: 3, en: /diriyah|al[- ]?bujairi/, ar: /الدرعيه|البجيري/ },
  // Jeddah
  { id: 'corniche', city: 'jeddah', name: 'the Corniche', nameAr: 'الكورنيش', lat: 21.5636, lng: 39.1219, km: 2, en: /corniche|waterfront|seafront/, ar: /الكورنيش|الواجهه البحريه/ },
  { id: 'al-balad', city: 'jeddah', name: 'Al-Balad', nameAr: 'البلد', lat: 21.4858, lng: 39.1925, km: 1.5, en: /al[- ]?balad|old town|historic/, ar: /البلد|جده التاريخيه|جدة التاريخية/ },
  // AlUla
  { id: 'alula-old-town', city: 'alula', name: 'AlUla Old Town', nameAr: 'البلدة القديمة', lat: 26.6145, lng: 37.9187, km: 3, en: /old town|the old town/, ar: /البلده القديمه/ },
  { id: 'hegra', city: 'alula', name: 'Hegra', nameAr: 'الحِجر', lat: 26.7907, lng: 37.952, km: 15, en: /hegra|mada'?in salih/, ar: /الحجر|مدائن صالح/ },
  { id: 'elephant-rock', city: 'alula', name: 'Elephant Rock', nameAr: 'جبل الفيل', lat: 26.6618, lng: 37.967, km: 6, en: /elephant rock/, ar: /جبل الفيل|صخره الفيل/ },
  // Cairo
  { id: 'pyramids', city: 'cairo', name: 'the Pyramids', nameAr: 'الأهرامات', lat: 29.9792, lng: 31.1342, km: 3, en: /pyramids?|giza/, ar: /الاهرامات|الاهرام|الجيزه/ },
  { id: 'nile', city: 'cairo', name: 'the Nile', nameAr: 'النيل', lat: 30.0478, lng: 31.2336, km: 1.5, en: /\bnile\b|tahrir|zamalek/, ar: /النيل|التحرير|الزمالك/ },
];

/** Great-circle distance in km. */
export function kmApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where Mada's cities are, so "Makkah" stays and "the Haram" go together. */
export const landmarksIn = (city: string | null | undefined) => LANDMARKS.filter((l) => !city || l.city === city);

/** City centres, for "Distance from: the centre" (the cities we sell, and the holy cities). */
export const CITY_CENTRES: Readonly<Record<string, { lat: number; lng: number }>> = {
  dubai: { lat: 25.1972, lng: 55.2744 }, istanbul: { lat: 41.0082, lng: 28.9784 }, london: { lat: 51.5072, lng: -0.1276 }, cairo: { lat: 30.0444, lng: 31.2357 },
  baku: { lat: 40.3777, lng: 49.892 }, jeddah: { lat: 21.5433, lng: 39.1728 }, alula: { lat: 26.6084, lng: 37.9232 }, abha: { lat: 18.2164, lng: 42.5053 },
  tbilisi: { lat: 41.6938, lng: 44.8015 }, paris: { lat: 48.8566, lng: 2.3522 }, riyadh: { lat: 24.7136, lng: 46.6753 }, makkah: { lat: 21.4225, lng: 39.8262 }, madinah: { lat: 24.4672, lng: 39.6111 },
};

/** Where distances are measured from: a landmark, the centre, the traveller, or a place they typed. */
export type DistanceAnchor = { id: string; kind: 'landmark' | 'centre' | 'me' | 'place'; name: string; nameAr?: string | null; lat: number; lng: number };

export const anchorOfLandmark = (l: Landmark): DistanceAnchor => ({ id: l.id, kind: 'landmark', name: l.name, nameAr: l.nameAr, lat: l.lat, lng: l.lng });
export const landmarkById = (id: string) => LANDMARKS.find((l) => l.id === id) ?? null;

/** GET /geocode?q=&city=: a place or address the traveller typed, as a point (OpenStreetMap Nominatim, cached). */
export const GeocodeResponse = z.object({ point: z.object({ lat: z.number(), lng: z.number(), name: z.string() }).nullable() });
export type GeocodeResponse = z.infer<typeof GeocodeResponse>;
