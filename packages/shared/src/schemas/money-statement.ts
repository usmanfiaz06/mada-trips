import { formatSar } from '../money';
import { t } from '../copy';
import type { TripDetail, TripMoney, TripMoneyItem, TripMoneyPending } from './trips';

/*
 * The trip statement (owner audit item 7): the Money screen's numbers in words, shareable as text, and the same as a
 * printable page. Shared so the platform (GET /trips/{id}/money) and the app's mock say exactly the same thing.
 */

export type StatementInput = { trip: Pick<TripDetail, 'city' | 'bookingRef'>; items: TripMoneyItem[]; travellers: TripMoney["travellers"]; payers: TripMoney["payers"]; total: number; refunded: number; pending: TripMoneyPending[]; generatedAt: Date; locale?: 'en' | 'ar' };

/** The statement in words: shareable as text, and the body of the HTML version. */
export function statementText(s: StatementInput): string {
  const L = s.locale;
  const day = new Intl.DateTimeFormat(L === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(s.generatedAt);
  const lines: string[] = [];
  lines.push(`${t("money.statement.title", undefined, L)} · ${s.trip.city}${s.trip.bookingRef ? ` · ${s.trip.bookingRef}` : ""}`);
  lines.push("");
  for (const it of s.items) lines.push(t("money.statement.line", { title: it.title, amount: formatSar(it.amount.amount, { locale: L }) + (it.refunded ? ` (${t("money.back", { amount: formatSar(it.refunded.amount, { locale: L }) }, L)})` : ""), by: it.paidBy }, L));
  lines.push("");
  lines.push(`${formatSar(s.total, { locale: L })} ${s.refunded ? t("money.totalRefunded", { amount: formatSar(s.refunded, { locale: L }) }, L) : t("money.total", undefined, L)}`);
  if (s.travellers.length > 1) {
    lines.push("");
    lines.push(t("money.perPerson", undefined, L));
    for (const p of s.travellers) lines.push(t("money.statement.person", { name: p.name, amount: formatSar(p.amount.amount, { locale: L }) }, L));
  }
  if (s.payers.length) {
    lines.push("");
    lines.push(t("money.perPayer", undefined, L));
    for (const p of s.payers) lines.push(t("money.statement.person", { name: p.name, amount: formatSar(p.amount.amount, { locale: L }) }, L));
  }
  if (s.pending.length) {
    lines.push("");
    lines.push(t("money.pending", undefined, L));
    for (const p of s.pending) lines.push(t("money.statement.line", { title: p.title, amount: formatSar(p.amount.amount, { locale: L }), by: p.kind === "friend" ? t("money.pendingFriend", { name: p.who ?? "" }, L) : p.kind === "you" ? t("money.pendingYou", undefined, L) : t("money.pendingDesk", undefined, L) }, L));
  }
  lines.push("");
  lines.push(t("money.statement.foot", { date: day }, L));
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The statement as a printable page (Save as PDF from any browser), in the same quiet style as the invoices. */
export function statementHtml(m: TripMoney, locale?: 'en' | 'ar'): string {
  const L = locale ?? "en";
  const rtl = L === "ar";
  const f = (h: number) => esc(formatSar(h, { locale: L }));
  const rows = m.items.map((it) => `<tr><td>${esc(it.title)}<div class="sub">${esc(it.paidBy)}${it.refunded ? ` · ${esc(t("money.back", { amount: formatSar(it.refunded.amount, { locale: L }) }, L))}` : ""}</div></td><td class="num">${f(it.amount.amount)}</td></tr>`).join("");
  const people = m.travellers.length > 1 ? `<h2>${esc(t("money.perPerson", undefined, L))}</h2><table>${m.travellers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${f(p.amount.amount)}</td></tr>`).join("")}</table><p class="sub">${esc(t("money.perPersonNote", undefined, L))}</p>` : "";
  const payers = m.payers.length ? `<h2>${esc(t("money.perPayer", undefined, L))}</h2><table>${m.payers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${f(p.amount.amount)}</td></tr>`).join("")}</table>` : "";
  const pending = m.pending.length ? `<h2>${esc(t("money.pending", undefined, L))}</h2><table>${m.pending.map((p) => `<tr><td>${esc(p.title)}<div class="sub">${esc(p.kind === "friend" ? t("money.pendingFriend", { name: p.who ?? "" }, L) : p.kind === "you" ? t("money.pendingYou", undefined, L) : t("money.pendingDesk", undefined, L))}</div></td><td class="num">${f(p.amount.amount)}</td></tr>`).join("")}</table>` : "";
  const foot = m.statement.split("\n").at(-1) ?? "";
  return `<!doctype html><html lang="${L}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(t("money.statement.title", undefined, L))} · ${esc(m.city)}</title>
<style>body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic",sans-serif;color:#0f1a16;margin:0;padding:40px;max-width:720px}h1{font-weight:500;font-size:28px;margin:0 0 4px}h2{font-size:14px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#5c6b64;margin:28px 0 8px}.eyebrow{color:#5c6b64;font-size:13px}.total{font-size:40px;font-weight:600;margin:24px 0 2px;font-variant-numeric:tabular-nums}.sub{color:#5c6b64;font-size:12.5px}table{width:100%;border-collapse:collapse}td{padding:10px 0;border-top:1px solid #e6e1d8;vertical-align:top;font-size:14.5px}td.num{text-align:${rtl ? "left" : "right"};font-variant-numeric:tabular-nums;white-space:nowrap}.foot{margin-top:36px;color:#5c6b64;font-size:12px}</style></head>
<body><div class="eyebrow">Mada Trips</div><h1>${esc(t("money.statement.title", undefined, L))} · ${esc(m.city)}</h1><div class="sub">${m.ref ? esc(m.ref) : ""}</div>
<div class="total">${f(m.total.amount)}</div><div class="sub">${esc(m.refunded.amount ? t("money.totalRefunded", { amount: formatSar(m.refunded.amount, { locale: L }) }, L) : t("money.total", undefined, L))}</div>
<h2>${esc(t("money.items", undefined, L))}</h2><table>${rows}</table>${people}${payers}${pending}<p class="foot">${esc(foot)}</p></body></html>`;
}
