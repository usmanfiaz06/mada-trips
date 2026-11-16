import "server-only";
import { AIRPORTS, AIRLINES } from "@/lib/travel-data";

// Read a SAPTCO / SAT bus e-ticket PDF: pull out the trip details and the QR code, so a Mada-branded
// transport ticket can be pre-filled (the user reviews and saves). SAT-templated for now; other operators
// return what text we can, for manual completion.

export type ParsedTicket = {
  operator: string; serviceNo: string; bookingRef: string;
  from: string; to: string; date: string; departTime: string; arriveTime: string;
  travelClass: string; seat: string; passenger: string;
  qrImage: string; // data URL of a regenerated QR (empty if none found)
};

const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** pdfjs needs a few browser globals and a canvas factory in Node — set once, lazily. */
async function pdfModules() {
  const napi = await import("@napi-rs/canvas");
  const g = globalThis as unknown as Record<string, unknown>;
  g.DOMMatrix ??= napi.DOMMatrix;
  g.Path2D ??= napi.Path2D;
  g.ImageData ??= napi.ImageData;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = napi;
  class CanvasFactory {
    create(w: number, h: number) { const c = createCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h))); return { canvas: c, context: c.getContext("2d") }; }
    reset(cc: { canvas: { width: number; height: number } }, w: number, h: number) { cc.canvas.width = Math.max(1, Math.ceil(w)); cc.canvas.height = Math.max(1, Math.ceil(h)); }
    destroy(cc: { canvas: { width: number; height: number } }) { cc.canvas.width = 0; cc.canvas.height = 0; }
  }
  return { pdfjs, napi, createCanvas, CanvasFactory };
}

type Item = { x: number; w: number; s: string };
const lineOf = (arr: Item[]) => { arr.sort((a, b) => a.x - b.x); let o = "", pe: number | null = null; for (const it of arr) { if (pe !== null && it.x - pe > 1.5) o += " "; o += it.s; pe = it.x + it.w; } return o.replace(/\s+/g, " ").trim(); };

/**
 * Pull a QR code out of any ticket PDF (airline e-ticket, boarding pass, bus/train ticket): render page 1,
 * decode a QR on it and regenerate a crisp QR encoding the same value. Returns empty strings when none is
 * found. Used so the team can drop a carrier PDF in and have its QR carried onto the Mada ticket.
 */
export async function extractQrFromPdf(bytes: Uint8Array): Promise<{ value: string; image: string }> {
  try {
    const { pdfjs, createCanvas, CanvasFactory } = await pdfModules();
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, CanvasFactory, isEvalSupported: false }).promise;
    const jsQR = (await import("jsqr")).default;
    const QRCode = (await import("qrcode")).default;
    // Scan every page — the barcode can sit on a later page of a multi-page e-ticket.
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
      const idata = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(idata.data as unknown as Uint8ClampedArray, idata.width, idata.height, { inversionAttempts: "attemptBoth" });
      if (found?.data) return { value: found.data, image: await QRCode.toDataURL(found.data, { margin: 1, width: 240 }) };
    }
    return { value: "", image: "" };
  } catch { return { value: "", image: "" }; }
}

/* ───────────────────────── Airline e-ticket import ───────────────────────── */

// A flight leg / journey divider parsed from an e-ticket, shaped to the itinerary builder's items.
export type ParsedFlight = {
  kind: "flight"; airline: string; airlineCode: string; flightNo: string;
  fromCode: string; fromCity: string; toCode: string; toCity: string;
  fromTerminal: string; toTerminal: string;
  departDate: string; departTime: string; arriveDate: string; arriveTime: string;
  cabin: string; baggage: string;
};
export type ParsedItItem = ParsedFlight | { kind: "divider"; label: string };
export type ParsedItinerary = { bookingRef: string; ticketNumbers: string; passengers: { name: string; kind: string }[]; items: ParsedItItem[] };

// Reconstruct positioned text lines across every page of a PDF (top-to-bottom, gap-aware left-to-right).
async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  const { pdfjs } = await pdfModules();
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  const lines: string[] = [];
  for (let pi = 1; pi <= doc.numPages; pi++) {
    const page = await doc.getPage(pi);
    const tc = await page.getTextContent();
    const rows = new Map<number, Item[]>();
    for (const it of tc.items as { str?: string; transform: number[]; width: number }[]) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4], w: it.width, s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) { const l = lineOf(rows.get(y)!); if (l) lines.push(l); }
  }
  return lines;
}

const norm = (s: string) => (s || "").toLowerCase().replace(/international|intl|airport|[().]/g, "").replace(/\s+/g, " ").trim();
// Resolve a city + airport name (as printed on the ticket) to an IATA code using the app's airport list.
function airportCode(city: string, apName: string): string {
  const c = (city || "").trim().toLowerCase();
  const cands = AIRPORTS.filter((a) => a.city.toLowerCase() === c);
  if (cands.length === 1) return cands[0].code;
  const n = norm(apName);
  if (cands.length > 1) {
    const m = cands.find((a) => norm(a.name).split(" ").some((t) => t.length > 3 && n.includes(t)));
    return (m ?? cands[0]).code;
  }
  const byName = AIRPORTS.find((a) => { const an = norm(a.name); return an && an.split(" ").filter((t) => t.length > 3).some((t) => n.includes(t)); });
  return byName?.code ?? "";
}

/**
 * Read an airline e-ticket / itinerary PDF (Amadeus "CheckMyTrip" style, as issued by iTrip and many B2B
 * agencies) and return a pre-filled itinerary for the builder: PNR, ticket numbers, passengers and each
 * flight leg. Nothing is saved — the user reviews and saves. Other layouts return what can be read.
 */
export async function parseAirlineTicket(bytes: Uint8Array): Promise<{ ok: true; data: ParsedItinerary } | { ok: false; error: string }> {
  try {
    const lines = await pdfLines(bytes);
    const all = lines.join("\n");

    const bookingRef = (all.match(/Booking ref:\s*([A-Z0-9]{5,7})/i) || all.match(/Booking Reference[\s\S]{0,40}?:\s*([A-Z0-9]{5,7})/i) || all.match(/\bPNR[:\s]+([A-Z0-9]{6})\b/i) || [])[1] || "";
    const tickets = [...new Set([...all.matchAll(/\b(\d{3}-\d{10})\b/g)].map((m) => m[1]))];

    const stripTitle = (s: string) => s.replace(/^(Mr|Mrs|Ms|Mstr|Master|Miss|Dr)\.?\s+/i, "").trim();
    const pax = new Set<string>();
    const trav = all.match(/^Traveler\s+(.+?)(?:\s+Agency)?$/mi); if (trav) pax.add(trav[1]);
    for (const m of all.matchAll(/\bfor\s+(Mr|Mrs|Ms|Mstr|Master|Miss|Dr)\.?\s+([A-Z][A-Za-z .'-]+?)(?:\s*$|\s{2})/gmi)) pax.add(`${m[1]} ${m[2]}`.trim());
    const passengers = [...pax].map((n) => ({ name: stripTitle(n), kind: "Adult" })).filter((p) => p.name.length > 1);

    const items: ParsedItItem[] = [];
    let lastArr: string | null = null, curYear = new Date().getFullYear();
    const dateHdr = /^(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+\d{1,2}\s+[A-Za-z]+\s+(\d{4})$/i;
    const segLine = /^(.+?)\s+([A-Z][A-Z0-9])\s?(\d{1,4})$/;
    const legRe = (label: string) => new RegExp(`^${label}\\s+(\\d{1,2})\\s+([A-Za-z]+)\\s+(\\d{2}:\\d{2})\\s+(.+?),\\s*\\(([^)]+)\\)(?:[^T]*Terminal:\\s*(\\S+))?`);
    const mk = (d: RegExpMatchArray | null | undefined) => d ? `${curYear}-${String(MONTHS[d[2].toLowerCase()] ?? 0).padStart(2, "0")}-${String(+d[1]).padStart(2, "0")}` : "";
    for (let i = 0; i < lines.length; i++) {
      const dh = lines[i].match(dateHdr); if (dh) { curYear = +dh[1]; continue; }
      const sl = lines[i].match(segLine);
      if (!sl || !lines.slice(i + 1, i + 4).some((l) => /^Departure /.test(l))) continue;
      const [, airlineText, code, num] = sl;
      const win = lines.slice(i, i + 12);
      const dep = (win.find((l) => /^Departure /.test(l)) || "").match(legRe("Departure"));
      const arr = (win.find((l) => /^Arrival /.test(l)) || "").match(legRe("Arrival"));
      const cabin = (win.find((l) => /^Class /.test(l)) || "").replace(/^Class\s+/, "").replace(/\s*\([A-Z]\)\s*$/, "").trim();
      const baggage = ((win.find((l) => /^Baggage allowance /.test(l)) || "").match(/^Baggage allowance\s+(.+?)\s+for\b/) || [])[1] || "";
      const al = AIRLINES.find((a) => a.code === code);
      const f: ParsedFlight = {
        kind: "flight", airline: al?.name ?? airlineText, airlineCode: code, flightNo: `${code} ${num}`,
        fromCode: dep ? airportCode(dep[4], dep[5]) : "", fromCity: dep?.[4] ?? "", toCode: arr ? airportCode(arr[4], arr[5]) : "", toCity: arr?.[4] ?? "",
        fromTerminal: dep?.[6] ?? "", toTerminal: arr?.[6] ?? "",
        departDate: mk(dep), departTime: dep?.[3] ?? "", arriveDate: mk(arr), arriveTime: arr?.[3] ?? "",
        cabin: cabin || "Economy", baggage,
      };
      if (lastArr && f.departDate && f.departDate > lastArr && (Date.parse(f.departDate) - Date.parse(lastArr)) / 864e5 >= 1) items.push({ kind: "divider", label: "Return" });
      items.push(f);
      lastArr = f.arriveDate || lastArr;
    }

    if (!items.length && !bookingRef) return { ok: false, error: "Couldn't read this e-ticket. Fill it in manually" };
    return { ok: true, data: { bookingRef, ticketNumbers: tickets.join("\n"), passengers, items } };
  } catch {
    return { ok: false, error: "Couldn't read this e-ticket. Fill it in manually" };
  }
}

export async function parseBusTicket(bytes: Uint8Array): Promise<{ ok: true; data: ParsedTicket } | { ok: false; error: string }> {
  try {
    const { pdfjs, createCanvas, CanvasFactory } = await pdfModules();
    const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, CanvasFactory, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);

    // 1) Reconstruct positioned lines (and keep the raw rows for column splitting).
    const tc = await page.getTextContent();
    const rows = new Map<number, Item[]>();
    for (const it of tc.items as { str?: string; transform: number[]; width: number }[]) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4], w: it.width, s: it.str });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    const lines = ys.map((y) => lineOf(rows.get(y)!)).filter(Boolean);
    const all = lines.join("\n");
    const mid = page.getViewport({ scale: 1 }).width / 2;

    // 2) QR: render page 1 and decode, then regenerate a crisp QR encoding the same value.
    let qrValue = "", qrImage = "";
    try {
      const jsQR = (await import("jsqr")).default;
      const QRCode = (await import("qrcode")).default;
      const vp = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
      const idata = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(idata.data as unknown as Uint8ClampedArray, idata.width, idata.height, { inversionAttempts: "attemptBoth" });
      qrValue = found?.data ?? "";
      if (qrValue) qrImage = await QRCode.toDataURL(qrValue, { margin: 1, width: 240 });
    } catch { /* QR is best-effort; fields still import */ }

    // 3) Fields from the reconstructed text.
    const bookingRef = all.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] ?? "";
    const nameLine = lines.find((l) => /^[A-Z][A-Z .'-]{4,}\s+\d{4}-\d{2}-\d{2}/.test(l));
    const passenger = nameLine ? nameLine.replace(/\s+\d{4}-\d{2}-\d{2}.*/, "").trim() : "";
    const times = [...all.matchAll(/\b([01]\d|2[0-3]):[0-5]\d\b/g)].map((x) => x[0]);
    const dm = all.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
    const date = dm ? `${dm[3]}-${String(MONTHS[dm[2].toLowerCase()]).padStart(2, "0")}-${String(dm[1]).padStart(2, "0")}` : "";

    // from / to by column (departure on the left, arrival on the right).
    let from = "", to = "";
    for (const y of ys) {
      const arr = rows.get(y)!; const t = lineOf(arr);
      if (/Azziziya|Jeddah|Dammam|Makkah|Madinah|Riyadh|Khobar|Abha|Tabuk|Jubail/i.test(t) && !/BAGGAGE|Baggage|DEPARTURE|ARRIVAL/i.test(t)) {
        from = lineOf(arr.filter((i) => i.x < mid)).replace(/\s*-\s*/, " - ");
        to = lineOf(arr.filter((i) => i.x >= mid));
        break;
      }
    }

    // The SAT ticket number ends "-<seat>", so the QR's trailing number is the seat.
    const serviceNo = qrValue || "";
    const seat = qrValue.match(/-(\d{1,3})$/)?.[1] ?? "";

    return { ok: true, data: {
      operator: "SAPTCO ALSA (SAT)", serviceNo, bookingRef, from, to, date,
      departTime: times[0] ?? "", arriveTime: times[1] ?? "", travelClass: "", seat, passenger, qrImage,
    } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read this PDF" };
  }
}
