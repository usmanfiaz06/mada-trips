import "server-only";

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
