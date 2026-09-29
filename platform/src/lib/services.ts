// Structured questions for each service type, so every visa, hotel, package, transfer and event is
// recorded the same way. Shared by the sale form (client) and the server-side check.
import { AIRPORTS } from "./travel-data";

export type Opt = { value: string; en: string; ar: string };

export const VISA_TYPES: Opt[] = [
  { value: "tourist", en: "Tourist", ar: "سياحية" },
  { value: "business", en: "Business", ar: "عمل تجاري" },
  { value: "umrah", en: "Umrah", ar: "عمرة" },
  { value: "hajj", en: "Hajj", ar: "حج" },
  { value: "family", en: "Family visit", ar: "زيارة عائلية" },
  { value: "work", en: "Work", ar: "عمل" },
  { value: "student", en: "Student", ar: "دراسة" },
  { value: "medical", en: "Medical", ar: "علاج" },
  { value: "transit", en: "Transit", ar: "عبور" },
];
export const VISA_ENTRIES: Opt[] = [
  { value: "single", en: "Single entry", ar: "دخول واحد" },
  { value: "multiple", en: "Multiple entry", ar: "دخول متعدد" },
];
export const VISA_SPEED: Opt[] = [
  { value: "normal", en: "Normal", ar: "عادي" },
  { value: "express", en: "Express", ar: "مستعجل" },
];
export const VISA_PROVIDERS: Opt[] = [
  { value: "Embassy", en: "Embassy", ar: "السفارة" },
  { value: "VFS Global", en: "VFS Global", ar: "VFS Global" },
  { value: "TLScontact", en: "TLScontact", ar: "TLScontact" },
  { value: "BLS International", en: "BLS International", ar: "BLS International" },
  { value: "eVisa portal", en: "eVisa portal", ar: "بوابة التأشيرة الإلكترونية" },
  { value: "Other", en: "Other", ar: "أخرى" },
];

// Visa destinations: the countries customers actually apply for, Schengen as one entry.
export const VISA_COUNTRIES: { code: string; en: string; ar: string }[] = [
  { code: "SCH", en: "Schengen area", ar: "منطقة شنغن" },
  { code: "GB", en: "United Kingdom", ar: "المملكة المتحدة" },
  { code: "US", en: "United States", ar: "الولايات المتحدة" },
  { code: "CA", en: "Canada", ar: "كندا" },
  { code: "AU", en: "Australia", ar: "أستراليا" },
  { code: "NZ", en: "New Zealand", ar: "نيوزيلندا" },
  { code: "IE", en: "Ireland", ar: "أيرلندا" },
  { code: "TR", en: "Türkiye", ar: "تركيا" },
  { code: "EG", en: "Egypt", ar: "مصر" },
  { code: "JO", en: "Jordan", ar: "الأردن" },
  { code: "MA", en: "Morocco", ar: "المغرب" },
  { code: "AZ", en: "Azerbaijan", ar: "أذربيجان" },
  { code: "GE", en: "Georgia", ar: "جورجيا" },
  { code: "UZ", en: "Uzbekistan", ar: "أوزبكستان" },
  { code: "KZ", en: "Kazakhstan", ar: "كازاخستان" },
  { code: "RU", en: "Russia", ar: "روسيا" },
  { code: "IN", en: "India", ar: "الهند" },
  { code: "PK", en: "Pakistan", ar: "باكستان" },
  { code: "BD", en: "Bangladesh", ar: "بنغلاديش" },
  { code: "LK", en: "Sri Lanka", ar: "سريلانكا" },
  { code: "CN", en: "China", ar: "الصين" },
  { code: "JP", en: "Japan", ar: "اليابان" },
  { code: "KR", en: "South Korea", ar: "كوريا الجنوبية" },
  { code: "TH", en: "Thailand", ar: "تايلاند" },
  { code: "MY", en: "Malaysia", ar: "ماليزيا" },
  { code: "ID", en: "Indonesia", ar: "إندونيسيا" },
  { code: "SG", en: "Singapore", ar: "سنغافورة" },
  { code: "PH", en: "Philippines", ar: "الفلبين" },
  { code: "VN", en: "Vietnam", ar: "فيتنام" },
  { code: "KE", en: "Kenya", ar: "كينيا" },
  { code: "TZ", en: "Tanzania", ar: "تنزانيا" },
  { code: "ZA", en: "South Africa", ar: "جنوب أفريقيا" },
  { code: "SA", en: "Saudi Arabia (inbound)", ar: "السعودية (للقادمين)" },
];

export const BOARD: Opt[] = [
  { value: "RO", en: "Room only", ar: "غرفة فقط" },
  { value: "BB", en: "Bed & breakfast", ar: "مع الإفطار" },
  { value: "HB", en: "Half board", ar: "نصف إقامة" },
  { value: "FB", en: "Full board", ar: "إقامة كاملة" },
  { value: "AI", en: "All inclusive", ar: "شامل كليًا" },
];
export const HOTEL_SUPPLIERS: Opt[] = [
  { value: "Hotelbeds", en: "Hotelbeds", ar: "Hotelbeds" },
  { value: "WebBeds", en: "WebBeds", ar: "WebBeds" },
  { value: "Expedia TAAP", en: "Expedia TAAP", ar: "Expedia TAAP" },
  { value: "Booking.com", en: "Booking.com", ar: "Booking.com" },
  { value: "Direct with hotel", en: "Direct with hotel", ar: "مباشرة مع الفندق" },
  { value: "Other", en: "Other", ar: "أخرى" },
];
export const PACKAGE_INCLUDES: Opt[] = [
  { value: "flight", en: "Flight", ar: "طيران" },
  { value: "hotel", en: "Hotel", ar: "فندق" },
  { value: "transfers", en: "Transfers", ar: "تنقلات" },
  { value: "visa", en: "Visa", ar: "تأشيرة" },
  { value: "tours", en: "Tours", ar: "جولات" },
  { value: "insurance", en: "Insurance", ar: "تأمين" },
];
export const TRANSPORT_TYPES: Opt[] = [
  { value: "airport", en: "Airport transfer", ar: "توصيل من/إلى المطار" },
  { value: "rental", en: "Car rental", ar: "تأجير سيارة" },
  { value: "chauffeur", en: "Car with driver", ar: "سيارة مع سائق" },
  { value: "intercity", en: "Intercity (bus / train)", ar: "بين المدن (حافلة / قطار)" },
];
export const EVENT_TYPES: Opt[] = [
  { value: "conference", en: "Conference", ar: "مؤتمر" },
  { value: "corporate", en: "Corporate event", ar: "فعالية شركات" },
  { value: "exhibition", en: "Exhibition", ar: "معرض" },
  { value: "wedding", en: "Wedding", ar: "حفل زفاف" },
  { value: "tickets", en: "Event tickets", ar: "تذاكر فعاليات" },
  { value: "other", en: "Other", ar: "أخرى" },
];

// Cities: every airport city, plus Makkah (no airport, but the most booked hotel city).
export const CITIES: { city: string; cityAr?: string; country: string }[] = [
  { city: "Makkah", cityAr: "مكة المكرمة", country: "SA" },
  ...Array.from(new Map(AIRPORTS.map((a) => [a.city, { city: a.city, cityAr: a.cityAr, country: a.country }])).values()),
];
const CITY_SET = new Set(CITIES.map((c) => c.city));

const has = (list: Opt[], v: unknown) => typeof v === "string" && list.some((o) => o.value === v);
const en = (list: Opt[], v: string) => list.find((o) => o.value === v)?.en ?? v;
const nightsBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

export type Details = Record<string, unknown>;

/** Checks the answers for a service and builds the one-line description saved on the sale. */
export function describeService(service: string, d: Details): { ok: true; description: string; supplier?: string; travelDate?: string } | { ok: false; error: string } {
  const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string).trim() : "");
  switch (service) {
    case "visa": {
      const country = VISA_COUNTRIES.find((c) => c.code === s("country"));
      if (!country) return { ok: false, error: "Choose the visa country" };
      if (!has(VISA_TYPES, s("type"))) return { ok: false, error: "Choose the visa type" };
      if (!has(VISA_ENTRIES, s("entries"))) return { ok: false, error: "Choose single or multiple entry" };
      if (!has(VISA_SPEED, s("speed"))) return { ok: false, error: "Choose normal or express processing" };
      if (!has(VISA_PROVIDERS, s("provider"))) return { ok: false, error: "Choose where the visa is processed" };
      return { ok: true, description: `${country.en} · ${en(VISA_TYPES, s("type"))} visa · ${en(VISA_ENTRIES, s("entries"))}${s("speed") === "express" ? " · Express" : ""}`, supplier: s("provider") };
    }
    case "hotel": {
      if (!CITY_SET.has(s("city"))) return { ok: false, error: "Choose the hotel city" };
      if (s("hotel").length < 2 || s("hotel").length > 100) return { ok: false, error: "Enter the hotel name" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s("checkIn")) || !/^\d{4}-\d{2}-\d{2}$/.test(s("checkOut"))) return { ok: false, error: "Enter check-in and check-out dates" };
      const nights = nightsBetween(s("checkIn"), s("checkOut"));
      if (nights < 1 || nights > 90) return { ok: false, error: "Check-out must be after check-in" };
      const rooms = Number(d.rooms ?? 1);
      if (!Number.isInteger(rooms) || rooms < 1 || rooms > 50) return { ok: false, error: "Enter the number of rooms" };
      if (!has(BOARD, s("board"))) return { ok: false, error: "Choose the meal plan" };
      if (!has(HOTEL_SUPPLIERS, s("provider"))) return { ok: false, error: "Choose the hotel supplier" };
      return { ok: true, description: `${s("city")} · ${s("hotel")} · ${nights} night${nights > 1 ? "s" : ""}${rooms > 1 ? ` · ${rooms} rooms` : ""} · ${s("board")}`, supplier: s("provider"), travelDate: s("checkIn") };
    }
    case "package": {
      if (!CITY_SET.has(s("city"))) return { ok: false, error: "Choose the package destination" };
      const nights = Number(d.nights);
      if (!Number.isInteger(nights) || nights < 1 || nights > 90) return { ok: false, error: "Enter the number of nights" };
      const inc = Array.isArray(d.includes) ? (d.includes as string[]).filter((x) => has(PACKAGE_INCLUDES, x)) : [];
      if (!inc.length) return { ok: false, error: "Tick what the package includes" };
      return { ok: true, description: `${s("city")} package · ${nights} night${nights > 1 ? "s" : ""} · ${inc.map((x) => en(PACKAGE_INCLUDES, x)).join(" + ")}` };
    }
    case "transport": {
      if (!has(TRANSPORT_TYPES, s("type"))) return { ok: false, error: "Choose the transport type" };
      if (!CITY_SET.has(s("city"))) return { ok: false, error: "Choose the city" };
      return { ok: true, description: `${en(TRANSPORT_TYPES, s("type"))} · ${s("city")}` };
    }
    case "event": {
      if (!has(EVENT_TYPES, s("type"))) return { ok: false, error: "Choose the event type" };
      if (!CITY_SET.has(s("city"))) return { ok: false, error: "Choose the city" };
      if (s("venue").length > 100) return { ok: false, error: "Keep the venue under 100 characters" };
      return { ok: true, description: `${en(EVENT_TYPES, s("type"))} · ${s("city")}${s("venue") ? ` · ${s("venue")}` : ""}` };
    }
    default:
      if (s("text").length < 2 || s("text").length > 200) return { ok: false, error: "Describe what was sold" };
      return { ok: true, description: s("text") };
  }
}

// The answers kept for each service. Anything else the browser sends is dropped before saving.
const DETAIL_KEYS: Record<string, string[]> = {
  visa: ["country", "type", "entries", "speed", "provider"],
  hotel: ["city", "hotel", "checkIn", "checkOut", "rooms", "board", "provider"],
  package: ["city", "nights", "includes"],
  transport: ["type", "city"],
  event: ["type", "city", "venue"],
  other: ["text"],
};

export function cleanDetails(service: string, d: Details): Details {
  const out: Details = {};
  for (const k of DETAIL_KEYS[service] ?? []) {
    const v = d[k];
    if (typeof v === "string") out[k] = v.trim().slice(0, 120);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 30));
  }
  return out;
}
