import { t, type CopyLocale } from '../copy';
import type { SupplierVoucher } from './transfers';

/*
 * The printable voucher page (Hotelbeds certification §4): one standalone HTML document, no scripts, no remote assets.
 * The server sends it for download (GET /vouchers/{id}?format=html) and the desk opens it; the app prints the same
 * page from the voucher it already has.
 */

const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A standalone, printable page (print to PDF from any browser). No scripts, no remote assets. */
export function voucherHtml(v: SupplierVoucher, locale: CopyLocale): string {
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
