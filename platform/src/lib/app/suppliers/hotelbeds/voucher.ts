import { t, type CopyLocale, type Voucher } from "@mada/shared";
import type { HbBooking, HotelFacts } from "./hotels";
import type { HbTransferBooking } from "./transfers";

/*
 * The voucher for a Hotelbeds booking (certification §4), built from what Hotelbeds confirmed:
 *   4.2 hotel: name and address (mandatory), category, destination, phone
 *   4.3 guests: the holder, at least one name per room, children's ages
 *   4.4 booking: HBX Group reference, check-in and check-out, room type, board, rate comments, our reference
 *   4.5 payment: no price; the statement naming the supplier, its VAT number and the reference
 * Rendered natively in the app, in the desk, and as a standalone HTML page (download / print to PDF), en and ar.
 */

/**
 * The payment statement as Hotelbeds vouchers carry it. The wording is the one published on HBX Group vouchers
 * ("Payable through <supplier>, acting as agent for the service operating company, details of which can be provided
 * upon request. VAT: <vat> Reference: <reference>"); the certification page asks for this statement by name, supplier,
 * VAT and reference. Kept in English on every voucher (it is the legal text), with a translation beside it in Arabic.
 */
export function payableThrough(supplierName: string, vat: string, reference: string): string {
  return `Payable through ${supplierName}, acting as agent for the service operating company, details of which can be provided upon request. VAT: ${vat} Reference: ${reference}`;
}

const FALLBACK_SUPPLIER = { name: "HOTELBEDS PROFESSIONAL SERVICES, S.L.U", vatNumber: "ESB38877676" };

const title = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/(^|[\s,(-])\p{L}/gu, (c) => c.toUpperCase()) : null);

export type VoucherSource = {
  id: string;
  product: "stay" | "transfer";
  status: string;
  supplierRef: string | null;
  agencyReference: string | null;
  createdAt: Date;
  details: { booking?: HbBooking | HbTransferBooking; cancellation?: string | null; facts?: HotelFacts | null; category?: string | null; transfer?: Record<string, unknown> | null };
};

export function buildVoucher(src: VoucherSource): Voucher {
  const status: Voucher["status"] = src.status === "cancelled" ? "cancelled" : src.status === "confirmed" ? "confirmed" : "pending";
  const ref = src.supplierRef ?? "";
  if (src.product === "stay") {
    const b = (src.details.booking ?? {}) as HbBooking;
    const h = b.hotel;
    const f = src.details.facts ?? null;
    const paxes = (h?.rooms ?? []).flatMap((r) => ((r as unknown as { paxes?: { roomId?: number; type: string; age?: number; name?: string; surname?: string }[] }).paxes ?? []).map((p) => ({
      room: p.roomId ?? (r as unknown as { id?: number }).id ?? 1, name: [p.name, p.surname].filter(Boolean).join(" ").trim(), child: p.type === "CH", age: p.type === "CH" ? p.age ?? null : null,
    })));
    const room0 = h?.rooms?.[0];
    const rate0 = room0?.rates?.[0];
    const supplier = h?.supplier?.name ? { name: h.supplier.name, vatNumber: h.supplier.vatNumber ?? "" } : FALLBACK_SUPPLIER;
    const remarks = [...new Set((h?.rooms ?? []).flatMap((r) => r.rates.map((x) => x.rateComments).filter(Boolean)))].join(" ") || null;
    return {
      id: src.id, kind: "stay", status, reference: ref, agencyReference: src.agencyReference, bookedOn: b.creationDate?.slice(0, 10) ?? src.createdAt.toISOString().slice(0, 10),
      holder: [b.holder?.name, b.holder?.surname].filter(Boolean).join(" "), paxes,
      hotel: h ? { name: f?.name ?? title(h.name) ?? h.name, address: f?.address ?? null, category: title(h.categoryName) ?? src.details.category ?? null, destination: title(h.destinationName), phone: f?.phone ?? null } : null,
      checkIn: h?.checkIn ?? null, checkOut: h?.checkOut ?? null, room: title(room0?.name), board: title(rate0?.boardName ?? rate0?.boardCode ?? null),
      transfer: null, remarks, cancellation: src.details.cancellation ?? null,
      payableThrough: payableThrough(supplier.name, supplier.vatNumber, ref), canCancel: status === "confirmed",
    };
  }
  const b = (src.details.booking ?? {}) as HbTransferBooking;
  const tr = (src.details.transfer ?? {}) as { vehicle?: string; kind?: "private" | "shared"; airport?: string; hotel?: string | null; arrival?: string; flightNumber?: string | null; pickupNote?: string | null };
  const s0 = b.transfers?.[0];
  const holder = (b as unknown as { holder?: { name?: string; surname?: string } }).holder;
  return {
    id: src.id, kind: "transfer", status, reference: ref, agencyReference: src.agencyReference, bookedOn: src.createdAt.toISOString().slice(0, 10),
    holder: [holder?.name, holder?.surname].filter(Boolean).join(" "), paxes: [], hotel: null, checkIn: null, checkOut: null, room: null, board: null,
    transfer: {
      vehicle: tr.vehicle ?? title(s0?.vehicle?.name) ?? "", kind: tr.kind ?? (s0?.transferType === "SHARED" ? "shared" : "private"), from: tr.airport ?? s0?.pickupInformation?.from?.code ?? "",
      to: tr.hotel ?? s0?.pickupInformation?.to?.description ?? "", date: (tr.arrival ?? "").slice(0, 10), time: (tr.arrival ?? "").slice(11, 16), flight: tr.flightNumber ?? null,
      pickup: tr.pickupNote ?? s0?.pickupInformation?.pickup?.description ?? null,
    },
    remarks: null, cancellation: null, payableThrough: payableThrough(FALLBACK_SUPPLIER.name, FALLBACK_SUPPLIER.vatNumber, ref), canCancel: status === "confirmed",
  };
}

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A standalone, printable page (print to PDF from any browser). No scripts, no remote assets. */
export function voucherHtml(v: Voucher, locale: CopyLocale): string {
  const L = (k: string, vars?: Record<string, string | number>) => t(k as never, vars, locale);
  const row = (label: string, value: string | null | undefined) => (value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : "");
  const ltr = (s: string | null | undefined) => (s ? `<bdi dir="ltr">${esc(s)}</bdi>` : "");
  const guests = v.paxes.length
    ? `<ul>${v.paxes.map((p) => `<li>${esc(L("voucher.roomN", { n: p.room }))} · ${ltr(p.name)}${p.child ? ` · ${esc(L("voucher.child", { age: p.age ?? "" }))}` : ""}</li>`).join("")}</ul>` : "";
  return `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L("voucher.title"))} ${esc(v.reference)}</title>
<style>body{font:14px/1.5 -apple-system,system-ui,'Segoe UI',Tahoma,sans-serif;margin:32px auto;max-width:720px;padding:0 16px;color:#1e352d;background:#fffdf9}
h1{font:400 28px Georgia,serif;margin:0 0 4px}.sub{color:#5f6b65;margin:0 0 20px}table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:7px 6px;border-bottom:1px solid #e3dcd1;text-align:start;vertical-align:top}th{width:34%;font-weight:500;color:#5f6b65}
.ref{font:600 22px ui-monospace,Menlo,monospace;letter-spacing:.04em}.box{border:1px solid #e3dcd1;border-radius:12px;padding:12px 14px;margin:14px 0;background:#fff}
.legal{font-size:12.5px;color:#3d4a44}.cancelled{color:#a33;font-weight:600}ul{margin:0;padding-inline-start:18px}@media print{body{margin:0}}</style></head><body>
<h1>${esc(L(v.kind === "stay" ? "voucher.title" : "voucher.titleTransfer"))}</h1>
<p class="sub">${esc(L("voucher.show"))}${v.status === "cancelled" ? ` <span class="cancelled">${esc(L("voucher.cancelled"))}</span>` : ""}</p>
<div class="box"><div>${esc(L("voucher.reference"))}</div><div class="ref" dir="ltr">${esc(v.reference)}</div>${v.agencyReference ? `<div>${esc(L("voucher.agency"))}: <bdi dir="ltr">${esc(v.agencyReference)}</bdi></div>` : ""}</div>
<table>
${v.hotel ? row(L("voucher.hotel"), v.hotel.name) + row(L("voucher.address"), v.hotel.address) + row(L("voucher.category"), v.hotel.category) + row(L("voucher.destination"), v.hotel.destination) + row(L("voucher.phone"), v.hotel.phone) : ""}
${row(L("voucher.checkIn"), v.checkIn)}${row(L("voucher.checkOut"), v.checkOut)}${row(L("voucher.room"), v.room)}${row(L("voucher.board"), v.board)}
${v.transfer ? row(L("voucher.vehicle"), `${v.transfer.vehicle} · ${L(v.transfer.kind === "private" ? "pickup.private" : "pickup.shared")}`) + row(L("voucher.route"), `${v.transfer.from} → ${v.transfer.to}`) + row(L("voucher.when"), `${v.transfer.date} ${v.transfer.time}`) + row(L("voucher.flight"), v.transfer.flight) + row(L("voucher.pickup"), v.transfer.pickup) : ""}
${row(L("voucher.holder"), v.holder)}${guests ? `<tr><th>${esc(L("voucher.guests"))}</th><td>${guests}</td></tr>` : ""}
${row(L("voucher.bookedOn"), v.bookedOn)}
</table>
${v.remarks ? `<div class="box"><strong>${esc(L("voucher.remarks"))}</strong><p dir="ltr">${esc(v.remarks)}</p></div>` : ""}
${v.cancellation ? `<div class="box"><strong>${esc(L("voucher.cancellation"))}</strong><p>${esc(v.cancellation)}</p></div>` : ""}
<div class="box legal"><strong>${esc(L("voucher.payment"))}</strong><p dir="ltr">${esc(v.payableThrough)}</p>${locale === "ar" ? `<p>${esc(L("voucher.payableAr"))}</p>` : ""}</div>
</body></html>`;
}
