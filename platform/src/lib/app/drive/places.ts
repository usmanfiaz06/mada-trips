import type { PlanPlaceJson } from "@/db/app-schema-plans";
import type { DrivePoint } from "./drive";

/*
 * Where a plan place is, for the router: its own coordinates when it has them (a hotel, a pinned stop), else the city
 * centre we know for its airport code or name. A place we can't find stays unknown (no drive asked, nothing guessed).
 * City centres, not airports: a drive from "RUH" starts in Riyadh.
 */

type City = { lat: number; lng: number; country: string; codes?: string[]; names?: string[] };

export const CITIES: Record<string, City> = {
  riyadh: { lat: 24.7136, lng: 46.6753, country: "SA", codes: ["RUH"], names: ["الرياض"] },
  jeddah: { lat: 21.4858, lng: 39.1925, country: "SA", codes: ["JED"], names: ["jidda", "جدة"] },
  makkah: { lat: 21.3891, lng: 39.8579, country: "SA", names: ["mecca", "makkah al mukarramah", "مكة"] },
  madinah: { lat: 24.5247, lng: 39.5692, country: "SA", codes: ["MED"], names: ["medina", "al madinah", "المدينة"] },
  alula: { lat: 26.6084, lng: 37.9232, country: "SA", codes: ["ULH"], names: ["al ula", "al-ula", "العلا"] },
  hegra: { lat: 26.7917, lng: 37.9536, country: "SA", names: ["mada'in salih", "madain salih", "al hijr", "الحجر"] },
  taif: { lat: 21.2703, lng: 40.4158, country: "SA", codes: ["TIF"], names: ["الطائف"] },
  abha: { lat: 18.2164, lng: 42.5053, country: "SA", codes: ["AHB"], names: ["أبها"] },
  dammam: { lat: 26.4207, lng: 50.0888, country: "SA", codes: ["DMM"], names: ["الدمام"] },
  khobar: { lat: 26.2794, lng: 50.2083, country: "SA", names: ["al khobar", "الخبر"] },
  tabuk: { lat: 28.3835, lng: 36.5662, country: "SA", codes: ["TUU"], names: ["تبوك"] },
  hail: { lat: 27.5114, lng: 41.7208, country: "SA", codes: ["HAS"], names: ["حائل"] },
  yanbu: { lat: 24.0895, lng: 38.0618, country: "SA", codes: ["YNB"], names: ["ينبع"] },
  manama: { lat: 26.2285, lng: 50.586, country: "BH", codes: ["BAH"], names: ["bahrain", "المنامة"] },
  doha: { lat: 25.2854, lng: 51.531, country: "QA", codes: ["DOH"], names: ["الدوحة"] },
  dubai: { lat: 25.2048, lng: 55.2708, country: "AE", codes: ["DXB", "DWC"], names: ["دبي"] },
  "abu dhabi": { lat: 24.4539, lng: 54.3773, country: "AE", codes: ["AUH"], names: ["أبوظبي"] },
  muscat: { lat: 23.588, lng: 58.3829, country: "OM", codes: ["MCT"], names: ["مسقط"] },
  "kuwait city": { lat: 29.3759, lng: 47.9774, country: "KW", codes: ["KWI"], names: ["kuwait", "الكويت"] },
  amman: { lat: 31.9454, lng: 35.9284, country: "JO", codes: ["AMM"], names: ["عمّان", "عمان"] },
  aqaba: { lat: 29.5321, lng: 35.0063, country: "JO", codes: ["AQJ"], names: ["العقبة"] },
  petra: { lat: 30.3285, lng: 35.4444, country: "JO", names: ["البتراء"] },
  singapore: { lat: 1.2903, lng: 103.8519, country: "SG", codes: ["SIN"], names: ["سنغافورة"] },
  "johor bahru": { lat: 1.4927, lng: 103.7414, country: "MY", codes: ["JHB"], names: ["johor"] },
  melaka: { lat: 2.1896, lng: 102.2501, country: "MY", codes: ["MKZ"], names: ["malacca", "ملاكا"] },
  "kuala lumpur": { lat: 3.139, lng: 101.6869, country: "MY", codes: ["KUL"], names: ["kl", "كوالالمبور"] },
  ipoh: { lat: 4.5975, lng: 101.0901, country: "MY", codes: ["IPH"] },
  "cameron highlands": { lat: 4.4718, lng: 101.3766, country: "MY" },
  penang: { lat: 5.4141, lng: 100.3288, country: "MY", codes: ["PEN"], names: ["george town", "بينانغ"] },
  istanbul: { lat: 41.0082, lng: 28.9784, country: "TR", codes: ["IST", "SAW"], names: ["إسطنبول", "اسطنبول"] },
  bursa: { lat: 40.1885, lng: 29.061, country: "TR", names: ["بورصة"] },
  trabzon: { lat: 41.0027, lng: 39.7168, country: "TR", codes: ["TZX"], names: ["طرابزون"] },
  uzungol: { lat: 40.6194, lng: 40.2869, country: "TR", names: ["uzungöl", "أوزنجول"] },
  antalya: { lat: 36.8969, lng: 30.7133, country: "TR", codes: ["AYT"], names: ["أنطاليا"] },
  cappadocia: { lat: 38.6431, lng: 34.8289, country: "TR", codes: ["NAV", "ASR"], names: ["goreme", "göreme", "كابادوكيا"] },
};

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9؀-ۿ']+/g, " ").trim();

const BY_CODE = new Map<string, City>();
const BY_NAME = new Map<string, City>();
for (const [name, c] of Object.entries(CITIES)) {
  BY_NAME.set(fold(name), c);
  for (const n of c.names ?? []) BY_NAME.set(fold(n), c);
  for (const code of c.codes ?? []) BY_CODE.set(code, c);
}

/** The router's point for a plan place, or null when we don't know where it is. */
export function pointOf(p: PlanPlaceJson | null | undefined): DrivePoint | null {
  if (!p) return null;
  if (typeof p.lat === "number" && typeof p.lng === "number") return { lat: p.lat, lng: p.lng, country: p.country ?? null, name: p.name };
  const c = (p.code ? BY_CODE.get(p.code.toUpperCase()) : undefined) ?? BY_NAME.get(fold(p.city || p.name)) ?? BY_NAME.get(fold(p.name));
  return c ? { lat: c.lat, lng: c.lng, country: p.country ?? c.country, name: p.city || p.name } : null;
}
