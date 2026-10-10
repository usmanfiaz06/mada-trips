/* Reference data for the mocks, lifted from the prototype (docs/app/prototype-app/src/store.jsx). */

export const AIRPORT_TZ: Record<string, string> = {
  RUH: "Asia/Riyadh", JED: "Asia/Riyadh", DMM: "Asia/Riyadh", MED: "Asia/Riyadh", AHB: "Asia/Riyadh", ULH: "Asia/Riyadh",
  DXB: "Asia/Dubai", AUH: "Asia/Dubai", DOH: "Asia/Qatar", IST: "Europe/Istanbul", SAW: "Europe/Istanbul",
  CAI: "Africa/Cairo", LHR: "Europe/London", FRA: "Europe/Berlin", GYD: "Asia/Baku", TBS: "Asia/Tbilisi",
};

export const AIRPORT_CITY: Record<string, string> = {
  RUH: "Riyadh", JED: "Jeddah", DMM: "Dammam", MED: "Madinah", AHB: "Abha", ULH: "AlUla", DXB: "Dubai", AUH: "Abu Dhabi",
  DOH: "Doha", IST: "Istanbul", SAW: "Istanbul", CAI: "Cairo", LHR: "London", FRA: "Frankfurt", GYD: "Baku", TBS: "Tbilisi",
};

export type MockFlight = {
  key: string; label: "best" | "lowest" | "earliest"; carrier: string; carrierName: string; number: string; backNumber: string;
  dep: string; arr: string; from: string; to: string; durationMin: number; ppSar: number; reason: string; bags: string; change: string; refund: string;
};

/** The three Istanbul options the prototype shows for Eid. */
export const ISTANBUL_FLIGHTS: MockFlight[] = [
  { key: "sv263", label: "best", carrier: "SV", carrierName: "Saudia", number: "SV263", backNumber: "SV264", dep: "09:40", arr: "13:55", from: "RUH", to: "IST", durationMin: 255, ppSar: 2160, reason: "Direct. Lands before check-in.", bags: "2 × 23 kg", change: "SAR 300 per person", refund: "Refund minus SAR 400 per person" },
  { key: "xy125", label: "lowest", carrier: "XY", carrierName: "flynas", number: "XY125", backNumber: "XY126", dep: "06:15", arr: "10:40", from: "RUH", to: "SAW", durationMin: 265, ppSar: 1745, reason: "The other airport, about 50 minutes from Galata.", bags: "1 × 20 kg", change: "SAR 250 per person", refund: "Not refundable" },
  { key: "tk141", label: "earliest", carrier: "TK", carrierName: "Turkish Airlines", number: "TK141", backNumber: "TK140", dep: "02:10", arr: "06:20", from: "RUH", to: "IST", durationMin: 250, ppSar: 2328, reason: "A full first day, after a short night.", bags: "2 × 23 kg", change: "Free", refund: "Refund minus SAR 300 per person" },
];

export const ISTANBUL_HOTELS = [
  { key: "galata", label: "best" as const, name: "Rooms near Galata Tower", area: "Beyoğlu · 3 min to the tower", nightSar: 980, note: "Connecting rooms on request. 3 minutes from the tower.", rating: 9.1, address: "Bereketzade Mah., Galata Kulesi Sk. No: 12, 34421 Beyoğlu/İstanbul" },
  { key: "sultan", label: "quiet" as const, name: "Garden hotel in Sultanahmet", area: "Old City · walk to the Blue Mosque", nightSar: 760, note: "Family suite. Breakfast included.", rating: 8.8, address: "Cankurtaran Mah., Akbıyık Cd. No: 21, 34122 Fatih/İstanbul" },
  { key: "bosphorus", label: "water" as const, name: "Bosphorus view rooms", area: "Beşiktaş · sea view", nightSar: 1420, note: "Two rooms side by side. Late checkout.", rating: 9.3, address: "Sinanpaşa Mah., Beşiktaş Cd. No: 8, 34353 Beşiktaş/İstanbul" },
];

export const AIRLINES: Record<string, { name: string; routes: [string, string, number][] }> = {
  SV: { name: "Saudia", routes: [["RUH", "JED", 110], ["JED", "RUH", 105], ["RUH", "DXB", 125], ["DMM", "RUH", 70], ["JED", "CAI", 130], ["RUH", "IST", 255], ["RUH", "LHR", 430], ["JED", "MED", 65]] },
  XY: { name: "flynas", routes: [["RUH", "JED", 110], ["JED", "DMM", 135], ["RUH", "DXB", 125], ["RUH", "SAW", 265], ["JED", "CAI", 130], ["DMM", "JED", 140]] },
  F3: { name: "flyadeal", routes: [["RUH", "JED", 110], ["JED", "RUH", 105], ["RUH", "AHB", 105], ["JED", "DMM", 135], ["RUH", "MED", 95]] },
  EK: { name: "Emirates", routes: [["DXB", "RUH", 120], ["RUH", "DXB", 125], ["JED", "DXB", 175], ["DXB", "JED", 185], ["DMM", "DXB", 80]] },
  QR: { name: "Qatar Airways", routes: [["DOH", "RUH", 95], ["RUH", "DOH", 90], ["JED", "DOH", 155], ["DOH", "DMM", 65]] },
  TK: { name: "Turkish Airlines", routes: [["IST", "RUH", 245], ["RUH", "IST", 255], ["JED", "IST", 250], ["IST", "JED", 240], ["DMM", "IST", 270]] },
  MS: { name: "EgyptAir", routes: [["CAI", "RUH", 140], ["RUH", "CAI", 155], ["CAI", "JED", 125], ["JED", "CAI", 130]] },
  EY: { name: "Etihad", routes: [["AUH", "RUH", 125], ["RUH", "AUH", 120], ["JED", "AUH", 180], ["AUH", "DMM", 75]] },
  BA: { name: "British Airways", routes: [["LHR", "RUH", 390], ["RUH", "LHR", 430]] },
  LH: { name: "Lufthansa", routes: [["FRA", "RUH", 340], ["RUH", "FRA", 370]] },
};

/** Deterministic id-like strings so mocks are stable across runs. */
export function stableCode(seed: string, len = 6): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < len; i += 1) { out += A[h % A.length]; h = Math.imul(h ^ (i + 7), 2654435761) >>> 0; }
  return out;
}
