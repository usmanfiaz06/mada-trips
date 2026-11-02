// Shared shapes for the three branded document types. Kept framework-free (no server-only imports) so the
// same types and helpers are used by the client builder, the presentational sheet and the server action.

export type DocType = "itinerary" | "voucher" | "receipt";
export const DOC_TYPES: DocType[] = ["itinerary", "voucher", "receipt"];
export const REF_PREFIX: Record<DocType, string> = { itinerary: "TKT", voucher: "VCHR", receipt: "RCPT" };

export type Pax = { name: string; kind: string }; // kind: Adult | Child | Infant
export type Segment = {
  airline: string; flightNo: string;
  fromCode: string; fromCity: string; toCode: string; toCity: string;
  departDate: string; departTime: string; arriveDate: string; arriveTime: string;
  cabin: string; baggage: string;
};
export type ItineraryData = {
  bookingRef: string;        // airline PNR / booking reference
  passengers: Pax[];
  segments: Segment[];
  ticketNumbers: string;     // free text, one per line
  notes: string;
  authorisedBy: string;
  stamp: boolean;
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
export type DocData = ItineraryData | VoucherData | ReceiptData;

export const VAT_RATE = 0.15;

export const DEFAULT_COMPANY: Company = {
  name: "Mada Trips", cr: "7055256312", vat: "", address: "Riyadh, Kingdom of Saudi Arabia", phone: "", email: "",
};

export function blankData(type: DocType): DocData {
  if (type === "itinerary") return {
    bookingRef: "", passengers: [{ name: "", kind: "Adult" }],
    segments: [{ airline: "", flightNo: "", fromCode: "", fromCity: "", toCode: "", toCity: "", departDate: "", departTime: "", arriveDate: "", arriveTime: "", cabin: "Economy", baggage: "" }],
    ticketNumbers: "", notes: "", authorisedBy: "", stamp: false,
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
