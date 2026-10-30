import { crowKm } from "../routes/estimate";
import { openState } from "./hours";
import type { OpeningPeriod, PlaceRecord, PlacesSupplier } from "./types";

/*
 * Sample places (SUPPLIER_MODE_PLACES=mock), for the tests and the staging copy's demo: a few in Istanbul, Dubai and
 * Riyadh, matched on the words of the search and the city, nearest first when there is a point. Never real: the ids
 * start with "mock-" and the photos have no image behind them (the card shows its tile).
 */

const daily = (open: string, close: string): OpeningPeriod[] => [0, 1, 2, 3, 4, 5, 6].map((day) => {
  const [oh, om] = open.split(":").map(Number) as [number, number];
  const [ch, cm] = close.split(":").map(Number) as [number, number];
  const overnight = ch * 60 + cm <= oh * 60 + om;
  return { open: { day, hour: oh, minute: om }, close: { day: overnight ? (day + 1) % 7 : day, hour: ch, minute: cm } };
});
const weekOf = (line: string) => ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => `${d}: ${line}`);

type Fixture = Omit<PlaceRecord, "phone" | "website" | "mapsUrl" | "photos" | "lat" | "lng"> & { lat: number; lng: number; city: string; words: RegExp; phone?: string; website?: string };
const F = (x: Fixture) => x;

export const MOCK_PLACES: Fixture[] = [
  F({ id: "mock-ist-durum-01", name: "Dürümzade Beyoğlu", type: "Shawarma restaurant", city: "istanbul", words: /shawarma|doner|döner|durum|dürüm|wrap|شاورما|دونر/i, address: "Kamer Hatun, Hamalbaşı Cd. 26/B, Beyoğlu, İstanbul", lat: 41.0336, lng: 28.9768, rating: 4.6, ratings: 18420, price: 1, periods: daily("11:00", "03:00"), week: weekOf("11:00 AM – 3:00 AM"), utcOffsetMinutes: 180, phone: "+90 212 249 0147" }),
  F({ id: "mock-ist-shawarma-02", name: "Taksim Şam Shawarma", type: "Shawarma restaurant", city: "istanbul", words: /shawarma|doner|döner|wrap|شاورما/i, address: "Sıraselviler Cd. 12, Taksim, İstanbul", lat: 41.0352, lng: 28.9862, rating: 4.4, ratings: 3210, price: 1, periods: daily("10:00", "02:00"), week: weekOf("10:00 AM – 2:00 AM"), utcOffsetMinutes: 180 }),
  F({ id: "mock-ist-doner-03", name: "Karadeniz Döner Asım Usta", type: "Turkish restaurant", city: "istanbul", words: /shawarma|doner|döner|turkish|شاورما|دونر/i, address: "Sinanpaşa, Beşiktaş Cd. 1, Beşiktaş, İstanbul", lat: 41.0431, lng: 29.0064, rating: 4.7, ratings: 9870, price: 2, periods: daily("10:30", "21:30"), week: weekOf("10:30 AM – 9:30 PM"), utcOffsetMinutes: 180, website: "https://example.com/karadeniz" }),
  F({ id: "mock-ist-cafe-04", name: "Galata Kahve Evi", type: "Café", city: "istanbul", words: /caf[eé]|coffee|قهوة|كوفي|مقهى/i, address: "Bereketzade, Galata Kulesi Sk. 5, Beyoğlu, İstanbul", lat: 41.0257, lng: 28.9742, rating: 4.5, ratings: 1240, price: 2, periods: daily("08:00", "23:00"), week: weekOf("8:00 AM – 11:00 PM"), utcOffsetMinutes: 180 }),
  F({ id: "mock-ist-mosque-05", name: "Süleymaniye Mosque", type: "Mosque", city: "istanbul", words: /mosque|masjid|pray|مسجد|جامع|صلاة/i, address: "Süleymaniye, Prof. Sıddık Sami Onar Cd. 1, Fatih, İstanbul", lat: 41.0162, lng: 28.9639, rating: 4.8, ratings: 61200, price: null, periods: daily("09:00", "18:00"), week: weekOf("9:00 AM – 6:00 PM"), utcOffsetMinutes: 180 }),
  F({ id: "mock-ist-pharmacy-06", name: "Taksim Eczanesi", type: "Pharmacy", city: "istanbul", words: /pharmac|chemist|صيدلي/i, address: "İstiklal Cd. 3, Beyoğlu, İstanbul", lat: 41.0358, lng: 28.9849, rating: 4.3, ratings: 210, price: null, periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }], week: weekOf("Open 24 hours"), utcOffsetMinutes: 180 }),
  F({ id: "mock-dxb-mandi-01", name: "Al Rawsha Mandi", type: "Yemeni restaurant", city: "dubai", words: /mandi|mandy|madfoon|yemeni|rice|مندي|مضغوط|مظبي|يمني/i, address: "Al Muteena St, Deira, Dubai", lat: 25.2721, lng: 55.3234, rating: 4.5, ratings: 6420, price: 2, periods: daily("12:00", "01:00"), week: weekOf("12:00 PM – 1:00 AM"), utcOffsetMinutes: 240, phone: "+971 4 266 1155" }),
  F({ id: "mock-dxb-mandi-02", name: "Bait Al Mandi", type: "Yemeni restaurant", city: "dubai", words: /mandi|mandy|yemeni|مندي|يمني/i, address: "Sheikh Zayed Rd, Al Wasl, Dubai", lat: 25.1989, lng: 55.2706, rating: 4.3, ratings: 2980, price: 2, periods: daily("11:30", "00:30"), week: weekOf("11:30 AM – 12:30 AM"), utcOffsetMinutes: 240 }),
  F({ id: "mock-dxb-mandi-03", name: "Mandi House Downtown", type: "Arabic restaurant", city: "dubai", words: /mandi|arabic|مندي|عربي/i, address: "Mohammed Bin Rashid Blvd, Downtown Dubai", lat: 25.1955, lng: 55.2751, rating: 4.1, ratings: 870, price: 3, periods: daily("13:00", "23:00"), week: weekOf("1:00 PM – 11:00 PM"), utcOffsetMinutes: 240, website: "https://example.com/mandi-house" }),
  F({ id: "mock-dxb-mall-04", name: "The Dubai Mall", type: "Shopping mall", city: "dubai", words: /mall|shopping|مول|تسوق/i, address: "Financial Center Rd, Downtown Dubai", lat: 25.1985, lng: 55.2796, rating: 4.7, ratings: 185000, price: null, periods: daily("10:00", "00:00"), week: weekOf("10:00 AM – 12:00 AM"), utcOffsetMinutes: 240 }),
  F({ id: "mock-ruh-cafe-01", name: "Diriyah Coffee House", type: "Café", city: "riyadh", words: /caf[eé]|coffee|قهوة|كوفي|مقهى/i, address: "Al Bujairi, Diriyah, Riyadh", lat: 24.7349, lng: 46.5753, rating: 4.6, ratings: 3400, price: 2, periods: daily("07:00", "01:00"), week: weekOf("7:00 AM – 1:00 AM"), utcOffsetMinutes: 180 }),
];

const CITY: Record<string, RegExp> = { istanbul: /istanbul|إسطنبول|اسطنبول|taksim|تقسيم/i, dubai: /dubai|دبي/i, riyadh: /riyadh|الرياض|diriyah/i };

const record = (f: Fixture): PlaceRecord => ({
  id: f.id, name: f.name, type: f.type, address: f.address, lat: f.lat, lng: f.lng, rating: f.rating, ratings: f.ratings, price: f.price,
  periods: f.periods, week: f.week, utcOffsetMinutes: f.utcOffsetMinutes, phone: f.phone ?? null, website: f.website ?? null,
  mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.name)}&query_place_id=${f.id}`,
  photos: [{ name: `places/${f.id}/photos/p1`, authors: [{ name: "A Mada traveller", uri: null }] }],
});

export const mockPlaces: PlacesSupplier = {
  name: "mock",
  async search(q) {
    const words = q.query;
    const city = Object.entries(CITY).find(([, re]) => re.test(words))?.[0] ?? null;
    let hits = MOCK_PLACES.filter((f) => f.words.test(words) && (!city || f.city === city) && (!q.near || crowKm(q.near, f) < 40));
    if (q.openNow) hits = hits.filter((f) => openState(f.periods, f.utcOffsetMinutes)?.now);
    if (q.near) hits = [...hits].sort((a, b) => crowKm(q.near!, a) - crowKm(q.near!, b));
    return hits.slice(0, Math.max(1, Math.min(5, q.max))).map(record);
  },
  async details(id) {
    const f = MOCK_PLACES.find((x) => x.id === id);
    return f ? record(f) : null;
  },
  async photoUri() {
    return null;
  },
};
