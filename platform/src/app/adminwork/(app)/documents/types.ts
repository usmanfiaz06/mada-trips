// Shared shapes for the three branded document types. Kept framework-free (no server-only imports) so the
// same types and helpers are used by the client builder, the presentational sheet and the server action.
import { AIRLINES } from "@/lib/travel-data";

export type DocType = "itinerary" | "transport" | "voucher" | "receipt";
export const DOC_TYPES: DocType[] = ["itinerary", "transport", "voucher", "receipt"];
export const REF_PREFIX: Record<DocType, string> = { itinerary: "TKT", transport: "TRN", voucher: "VCHR", receipt: "RCPT" };

export type TransportMode = "train" | "bus" | "ferry" | "car";
export const TRANSPORT_MODES: { key: TransportMode; label: string }[] = [
  { key: "train", label: "Train" }, { key: "bus", label: "Bus" }, { key: "ferry", label: "Ferry" }, { key: "car", label: "Car / transfer" },
];
export const TRANSPORT_LABEL: Record<TransportMode, string> = { train: "Train", bus: "Bus", ferry: "Ferry", car: "Car / transfer" };

export type Pax = { name: string; kind: string }; // kind: Adult | Child | Infant
// A flight leg. The itinerary is an ordered list of these interleaved with explicit layovers and dividers.
export type FlightItem = {
  kind: "flight";
  airline: string; airlineCode: string; flightNo: string;
  fromCode: string; fromCity: string; toCode: string; toCity: string;
  fromTerminal: string; toTerminal: string;   // optional departure / arrival terminal
  departDate: string; departTime: string; arriveDate: string; arriveTime: string;
  cabin: string; baggage: string;
};
// A layover is its own explicit step between flights: where, how long, and an optional note.
export type LayoverItem = { kind: "layover"; place: string; duration: string; note: string };
// A labelled break between journeys (e.g. "Return"), inserted explicitly for round trips.
export type DividerItem = { kind: "divider"; label: string };
export type ItItem = FlightItem | LayoverItem | DividerItem;

export type ItineraryData = {
  bookingRef: string;        // airline PNR / booking reference
  passengers: Pax[];
  items: ItItem[];           // ordered flights, layovers and journey dividers
  ticketNumbers: string;     // free text, one per line
  notes: string;
  authorisedBy: string;
  stamp: boolean;
  qrImage?: string;          // data URL of a QR — extracted from an uploaded ticket, or uploaded by the team
  segments?: FlightItem[];   // legacy: documents issued before layovers became explicit items
};
export type VoucherData = {
  guest: string;
  hotel: string; city: string; address: string;
  checkIn: string; checkOut: string;
  roomType: string; board: string; rooms: string; occupancy: string;
  confirmationNo: string;
  notes: string;
  authorisedBy: string;
  stamp: boolean;
};
export type LineItem = { description: string; amount: string }; // amount: SAR as typed
export type Company = { name: string; cr: string; vat: string; address: string; phone: string; email: string };
export type ReceiptData = {
  invoice: boolean;          // true → "Tax Invoice", false → "Receipt"
  company: Company;
  billTo: string; billToVat: string;
  items: LineItem[];
  vatEnabled: boolean;       // apply 15% VAT
  method: string;            // Cash | mada | Credit card | Bank transfer
  reference: string;
  notes: string;
  authorisedBy: string;
  stamp: boolean;
};
// A bus / train / ferry / car ticket — a single journey from one stop to another, with the operator's details.
export type TransportData = {
  mode: TransportMode;
  operator: string;          // carrier / company (e.g. SAR, SAPTCO)
  serviceNo: string;         // train / bus / service number
  fromPlace: string; toPlace: string;   // stations or stops (free text)
  date: string; departTime: string; arriveTime: string;
  travelClass: string;       // e.g. Economy, Business, First
  seat: string; coach: string;          // seat, and coach / platform / gate
  bookingRef: string;
  passengers: Pax[];
  notes: string;
  authorisedBy: string;
  stamp: boolean;
  qrImage?: string; // data URL of the ticket's QR (regenerated from an imported carrier PDF)
};

export type DocData = ItineraryData | TransportData | VoucherData | ReceiptData;

export const VAT_RATE = 0.15;

export const DEFAULT_COMPANY: Company = {
  name: "Mada Trips", cr: "7055256312", vat: "", address: "Riyadh, Kingdom of Saudi Arabia",
  phone: "+966 59 305 4981", email: "info@madatrips.sa",
};

export const blankFlight = (): FlightItem => ({
  kind: "flight", airline: "", airlineCode: "", flightNo: "", fromCode: "", fromCity: "", toCode: "", toCity: "",
  fromTerminal: "", toTerminal: "", departDate: "", departTime: "", arriveDate: "", arriveTime: "", cabin: "Economy", baggage: "",
});
export const blankLayover = (place = ""): LayoverItem => ({ kind: "layover", place, duration: "", note: "" });
export const returnDivider = (): DividerItem => ({ kind: "divider", label: "Return" });

// The ordered itinerary items, reading legacy `segments` as flights for documents issued before layovers existed.
export function itineraryItems(d: ItineraryData): ItItem[] {
  if (d.items?.length) return d.items;
  if (d.segments?.length) return d.segments.map((s) => ({ ...s, kind: "flight" as const }));
  return [];
}

export function blankData(type: DocType): DocData {
  if (type === "itinerary") return {
    bookingRef: "", passengers: [{ name: "", kind: "Adult" }],
    items: [blankFlight()],
    ticketNumbers: "", notes: "", authorisedBy: "", stamp: false,
  };
  if (type === "transport") return {
    mode: "train", operator: "", serviceNo: "", fromPlace: "", toPlace: "", date: "", departTime: "", arriveTime: "",
    travelClass: "Economy", seat: "", coach: "", bookingRef: "", passengers: [{ name: "", kind: "Adult" }], notes: "", authorisedBy: "", stamp: false,
  };
  if (type === "voucher") return {
    guest: "", hotel: "", city: "", address: "", checkIn: "", checkOut: "",
    roomType: "", board: "Room only", rooms: "1", occupancy: "", confirmationNo: "", notes: "", authorisedBy: "", stamp: false,
  };
  return {
    invoice: false, company: { ...DEFAULT_COMPANY }, billTo: "", billToVat: "",
    items: [{ description: "", amount: "" }], vatEnabled: true, method: "Cash", reference: "", notes: "", authorisedBy: "", stamp: false,
  };
}

export const parseAmount = (s: string) => { const n = Number(String(s).replace(/,/g, "").trim()); return Number.isFinite(n) ? n : 0; };

export function receiptTotals(d: ReceiptData) {
  const subtotal = d.items.reduce((s, it) => s + parseAmount(it.amount), 0);
  const vat = d.vatEnabled ? subtotal * VAT_RATE : 0;
  return { subtotal, vat, total: subtotal + vat };
}

export const money2 = (n: number, locale = "en") =>
  n.toLocaleString(locale === "ar" ? "ar-SA" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Nights between two YYYY-MM-DD dates, or null if either is missing / invalid.
export function nights(checkIn: string, checkOut: string): number | null {
  if (!checkIn || !checkOut) return null;
  const a = Date.parse(checkIn + "T00:00:00Z"), b = Date.parse(checkOut + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 86_400_000);
}

/* ─── Airlines & layovers ─── */

// Resolve a typed/selected airline name to its IATA code (for the logo). Empty string when unknown.
export const AIRLINE_BY_NAME = new Map(AIRLINES.map((a) => [a.name.toLowerCase(), a.code] as const));
// Airline logos, keyed by IATA code, from a stable public logo CDN. Name is shown as the fallback.
export const airlineLogoUrl = (code: string) => `https://pics.avs.io/120/40/${code}.png`;
// Codes whose IATA code was reassigned, so the logo CDN still serves the previous airline's brand. We show
// the airline name only for these rather than a wrong logo (OV: SalamAir shows old Estonian Air; RX: Riyadh
// Air shows Regent Airways; 9P: Fly Jinnah shows Air Arabia). Re-check and trim as the CDN updates.
export const LOGO_EXCLUDE = new Set(["OV", "RX", "9P"]);

function stamp(date: string, time: string): number | null {
  if (!date) return null;
  const t = /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, "0") : "00:00";
  const ms = Date.parse(`${date}T${t}:00`);
  return Number.isFinite(ms) ? ms : null;
}
// Minutes of layover between landing on `prev` and taking off on `next`, or null if times are missing/odd.
export function layoverMinutes(prev: FlightItem, next: FlightItem): number | null {
  const a = stamp(prev.arriveDate, prev.arriveTime), b = stamp(next.departDate, next.departTime);
  if (a == null || b == null) return null;
  const m = Math.round((b - a) / 60_000);
  return m > 0 && m < 7 * 24 * 60 ? m : null; // ignore gaps over a week (that's a trip, not a layover)
}
export function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}
