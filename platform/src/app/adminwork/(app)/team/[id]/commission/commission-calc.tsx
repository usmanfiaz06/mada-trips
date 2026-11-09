"use client";
import { useActionState, useMemo, useState } from "react";
import { Printer, AlertCircle, Check } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { SERVICE } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { Badge, Card, CardHead, cx } from "@/components/ui";
import { useSubmit } from "@/components/client";
import { payCommission } from "../../actions";

type Row = { id: string; ref: string; date: string; serviceType: string; client: string; revenue: number; margin: number; paid: boolean };
type Totals = { revenue: number; margin: number };
type Hist = { id: string; ref: string; periodStart: string; periodEnd: string; amount: number; basis: string; rateBps: number; status: string; account: string | null; paidOn: string | null; byName: string | null; salesCount: number };
type Acct = { value: string; label: string };
type Props = {
  memberId: string; memberName: string; isPartner: boolean; byName: string;
  defaultRate: number; defaultBasis: "profit" | "revenue"; commissionFrom: string | null;
  from: string; to: string;
  unpaid: Row[]; paid: Row[]; unpaidTotals: Totals; paidTotals: Totals;
  accounts: Acct[]; canPay: boolean; history: Hist[]; basePath: string;
};

const show = (h: number) => (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CommissionCalc(p: Props) {
  const t = useT();
  const L = t.locale;
  const [basis, setBasis] = useState<"profit" | "revenue">(p.defaultBasis);
  const [pct, setPct] = useState(String(p.defaultRate || 5));
  const [account, setAccount] = useState(p.accounts[0]?.value ?? "");
  const [state, action] = useActionState(payCommission, null);
  const onSubmit = useSubmit(action);

  const rate = Math.max(0, Number(pct.replace(/,/g, "")) || 0);
  const base = basis === "revenue" ? p.unpaidTotals.revenue : p.unpaidTotals.margin;
  const commission = Math.round((base * rate) / 100);
  const today = new Date().toISOString().slice(0, 10);
  const accName = (k: string | null) => p.accounts.find((a) => a.value === k)?.label ?? k ?? "—";
  const tone = (s: string) => (s === "paid" ? "ok" : s === "pending_approval" ? "warn" : "neutral") as "ok";
  const statusLabel = (s: string) => (s === "paid" ? t("Paid") : s === "pending_approval" ? t("Waiting approval") : t("Cancelled"));

  const totalPaid = useMemo(() => p.history.filter((h) => h.status === "paid").reduce((s, h) => s + h.amount, 0), [p.history]);

  return (
    <div className="space-y-4">
      <style>{`@media print { body * { visibility: hidden !important; } #stmt, #stmt * { visibility: visible !important; } #stmt { position: absolute; inset: 0; margin: 0; padding: 24px; } .no-print { display: none !important; } }`}</style>

      {/* ── Controls ── */}
      <Card className="no-print">
        <CardHead title={t("Commission for {name}", { name: p.memberName })} hint={t("Pick a period, set the basis and rate, then record the payout. A director approves it before any money moves. Only sales not already paid are included.")} />
        {state?.error && <div role="alert" className="mb-3 flex items-start gap-2 rounded-2xl bg-bad-soft px-4 py-3 text-[13.5px] text-bad"><AlertCircle className="mt-0.5 size-4" />{t(state.error)}</div>}
        {state?.ok && <div className="mb-3 flex items-start gap-2 rounded-2xl bg-ok-soft px-4 py-3 text-[13.5px] text-ok"><Check className="mt-0.5 size-4" />{t(state.ok)}</div>}

        <form method="get" action={p.basePath} className="flex flex-wrap items-end gap-3">
          <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("From")}</span><input type="date" name="from" defaultValue={p.from} min={p.commissionFrom ?? undefined} max={p.to} className="field h-9" /></label>
          <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("To")}</span><input type="date" name="to" defaultValue={p.to} max={today} className="field h-9" /></label>
          <button className="h-9 rounded-full bg-surface-2 px-4 text-[13px] font-medium text-ink-2 ring-1 ring-line hover:text-ink">{t("Load sales")}</button>
        </form>
        {p.commissionFrom && <p className="mt-2 text-[12px] text-ink-4">{t("Earns commission from {d}.", { d: fmtDate(p.commissionFrom, L) })}</p>}

        {p.paid.length > 0 && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-[12.5px] text-warn">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{t("{n} sales in this range already have commission paid or pending — they're excluded so nobody is paid twice. Change the dates if you meant a different period.", { n: p.paid.length })}</span>
          </div>
        )}
      </Card>

      {/* ── Record payout ── */}
      {p.canPay && (
        <Card className="no-print">
          <CardHead title={t("Record commission payout")} hint={t("Goes to a director to approve; then it's paid from the account you choose and recorded against each sale.")} />
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={p.memberId} />
            <input type="hidden" name="from" value={p.from} />
            <input type="hidden" name="to" value={p.to} />
            <div>
              <span className="mb-2 block text-[12.5px] text-ink-3">{t("Calculate on")}</span>
              <div className="flex gap-1 rounded-full bg-sunken p-1">
                {([["profit", t("Profit (margin)")], ["revenue", t("Revenue (sales)")]] as const).map(([k, lbl]) => (
                  <button key={k} type="button" onClick={() => setBasis(k)} className={cx("h-9 flex-1 rounded-full text-[13px] transition", basis === k ? "bg-ink text-bg" : "text-ink-3 hover:text-ink")}>{lbl}</button>
                ))}
              </div>
              <input type="hidden" name="basis" value={basis} />
            </div>
            <label><span className="mb-2 block text-[12.5px] text-ink-3">{t("Rate")} (%)</span>
              <input name="rate" value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className="field num" dir="ltr" /></label>
            <label><span className="mb-2 block text-[12.5px] text-ink-3">{t("Pay from")}</span>
              <select name="account" value={account} onChange={(e) => setAccount(e.target.value)} className="field h-10">{p.accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
            <label><span className="mb-2 block text-[12.5px] text-ink-3">{t("Note (optional)")}</span>
              <input name="note" className="field" /></label>
            <div className="sm:col-span-2 flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
              <span className="text-[13px] text-ink-2">{t("{n} unpaid sales · commission", { n: p.unpaid.length })}</span>
              <span className="figure text-[22px]" dir="ltr">{show(commission)}<span className="figure-unit">SAR</span></span>
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={p.unpaid.length === 0} className="w-full rounded-full bg-gold px-4 py-2.5 text-[14px] font-medium text-ink disabled:opacity-40">{t("Record & send for approval")}</button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Printable statement ── */}
      <Card id="stmt">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-[20px] font-[450] tracking-[-0.02em]">{t("Commission statement")}</div>
            <div className="mt-1 text-[13px] text-ink-3">{p.memberName}{p.isPartner ? ` · ${t("Partner")}` : ""}</div>
          </div>
          <div className="text-end text-[12px] text-ink-3">
            <div>{t("Period")}: {fmtDate(p.from, L)} – {fmtDate(p.to, L)}</div>
            <div>{t("Prepared by {name}", { name: p.byName })} · {fmtDate(today, L)}</div>
          </div>
        </div>
        {p.isPartner && <p className="mb-4 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-ink-3">{t("This team member is a partner. Partners normally take profit through the Day-25 settlement, not commission — pay only if you intend to.")}</p>}

        {p.unpaid.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-3">{t("No unpaid sales for this person in this period.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-wide text-ink-4">
                  <th className="py-2 pe-3 text-start font-semibold">{t("Date")}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t("Ref")}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t("Client")}</th>
                  <th className="py-2 pe-3 text-start font-semibold">{t("Service")}</th>
                  <th className="py-2 pe-3 text-end font-semibold">{t("Revenue")}</th>
                  <th className="py-2 text-end font-semibold">{t("Margin")}</th>
                </tr>
              </thead>
              <tbody>
                {p.unpaid.map((r) => (
                  <tr key={r.id} className="border-b border-line/60">
                    <td className="py-2 pe-3">{fmtDate(r.date, L)}</td>
                    <td className="num py-2 pe-3" dir="ltr">{r.ref}</td>
                    <td className="py-2 pe-3">{r.client}</td>
                    <td className="py-2 pe-3">{t(SERVICE[r.serviceType] ?? r.serviceType)}</td>
                    <td className="num py-2 pe-3 text-end" dir="ltr">{show(r.revenue)}</td>
                    <td className="num py-2 text-end" dir="ltr">{show(r.margin)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold">
                  <td className="py-2.5" colSpan={4}>{t("Total")} · {t("{n} sales", { n: p.unpaid.length })}</td>
                  <td className="num py-2.5 text-end" dir="ltr">{show(p.unpaidTotals.revenue)}</td>
                  <td className="num py-2.5 text-end" dir="ltr">{show(p.unpaidTotals.margin)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="mt-5 rounded-xl bg-surface-2 p-4">
          <div className="flex items-center justify-between text-[13px] text-ink-2">
            <span>{basis === "revenue" ? t("Revenue (sales)") : t("Profit (margin)")} × {rate}%</span>
            <span className="num" dir="ltr">{show(base)} × {rate}%</span>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[15px] font-semibold">{t("Commission")}</span>
            <span className="figure text-[26px]" dir="ltr">{show(commission)}<span className="figure-unit">SAR</span></span>
          </div>
        </div>
        <button type="button" onClick={() => window.print()} className="no-print mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13.5px] text-bg hover:opacity-90">
          <Printer className="size-4" />{t("Print / Save as PDF")}
        </button>
      </Card>

      {/* ── History ── */}
      <Card pad={false} className="no-print">
        <div className="p-6 pb-3"><CardHead className="mb-0" title={t("Commission history")} hint={t("Total paid: {v}", { v: `${show(totalPaid)} SAR` })} /></div>
        {p.history.length === 0 ? (
          <p className="px-6 pb-6 text-[13px] text-ink-3">{t("No commission recorded yet.")}</p>
        ) : (
          <ul className="px-3 pb-3">
            {p.history.map((h) => (
              <li key={h.id} className="flex items-center gap-3 rounded-2xl px-3 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px]"><span className="num">{h.ref}</span> · {fmtDate(h.periodStart, L)} – {fmtDate(h.periodEnd, L)}</span>
                  <span className="block text-[11.5px] text-ink-3">{h.rateBps / 100}% {t("of")} {h.basis === "revenue" ? t("revenue") : t("profit")} · {t("{n} sales", { n: h.salesCount })}{h.status === "paid" && h.account ? ` · ${accName(h.account)}` : ""}{h.byName ? ` · ${h.byName}` : ""}</span>
                </span>
                <Badge tone={tone(h.status)} dot>{statusLabel(h.status)}</Badge>
                <span className="num shrink-0 text-[14px]" dir="ltr">{show(h.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
